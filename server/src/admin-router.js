import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import { z } from 'zod';
import { factImportSchema, factSchema } from '@isabel/shared';
import { AppError, serializeError } from './errors.js';

const COOKIE_NAME = 'isabel_admin';
const loginSchema = z.object({ password: z.string().min(1).max(1024) }).strict();
const importApplySchema = z.object({
  facts: factImportSchema,
  strategy: z.enum(['insert', 'upsert']).default('upsert'),
}).strict();
const duplicateSchema = z.object({ id: z.string().min(1).max(100).optional() }).strict().default({});

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && quoted && content[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new AppError('INVALID_CSV', 'O CSV termina com aspas abertas', 422);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => value.trim().replace(/^\uFEFF/, ''));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

function parseStructured(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeCsvFact(row) {
  const parsedSources = parseStructured(row.sources, null);
  const parsedTags = parseStructured(row.tags, null);
  return {
    id: row.id,
    statement: row.statement,
    verdict: String(row.verdict).toLowerCase() === 'true',
    explanation: row.explanation,
    correction: row.correction || null,
    category: row.category,
    difficulty: Number(row.difficulty),
    tags: parsedTags ?? String(row.tags || '').split('|').map((tag) => tag.trim()).filter(Boolean),
    sensitivity: row.sensitivity || 'general',
    sources: parsedSources ?? String(row.sources || '').split(';').filter(Boolean).map((source) => {
      const separator = source.indexOf('|');
      return { label: source.slice(0, separator).trim(), url: source.slice(separator + 1).trim() };
    }),
    verifiedAt: row.verifiedAt,
    reviewStatus: row.reviewStatus || 'pending',
    active: !['false', '0', 'no', 'não'].includes(String(row.active).toLowerCase()),
  };
}

function importCandidates(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.facts)) return body.facts;
  if (typeof body?.content !== 'string') throw new AppError('INVALID_IMPORT', 'Envie um arquivo JSON ou CSV válido', 422);
  if (body.format === 'csv') return parseCsv(body.content).map(normalizeCsvFact);
  try {
    const parsed = JSON.parse(body.content.replace(/^\uFEFF/, ''));
    return Array.isArray(parsed) ? parsed : parsed.facts;
  } catch {
    throw new AppError('INVALID_JSON', 'O arquivo JSON não pôde ser lido', 422);
  }
}

function validateImport(body) {
  const candidates = importCandidates(body);
  if (!Array.isArray(candidates)) throw new AppError('INVALID_IMPORT', 'A importação deve conter uma lista de fatos', 422);
  const items = [];
  const errors = [];
  candidates.forEach((candidate, index) => {
    const result = factSchema.safeParse(candidate);
    if (result.success) items.push(result.data);
    else {
      for (const issue of result.error.issues) {
        errors.push({ row: index + 2, path: issue.path.join('.'), message: issue.message });
      }
    }
  });
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push({ row: null, path: 'id', message: `ID repetido: ${item.id}` });
    seen.add(item.id);
  }
  return { candidates, items, errors };
}

function cleanFactInput(value, id) {
  return {
    id: id ?? value.id,
    statement: value.statement,
    verdict: value.verdict,
    explanation: value.explanation,
    correction: value.correction ?? null,
    category: value.category,
    difficulty: value.difficulty,
    tags: value.tags,
    sensitivity: value.sensitivity,
    sources: value.sources,
    verifiedAt: value.verifiedAt,
    reviewStatus: value.reviewStatus,
    active: value.active,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function sameHash(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function auditContext(request) {
  return { actor: 'admin', ip: request.ip };
}

export function createAdminRouter({ database, config }) {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } },
  });
  const mutationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 90,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Muitas alterações em sequência.' } },
  });

  function requireTrustedOrigin(request, _response, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.get('origin');
    if (!origin || !config.clientOrigins.includes(origin)) {
      return next(new AppError('UNTRUSTED_ORIGIN', 'Origem não autorizada', 403));
    }
    return next();
  }

  function requireAdmin(request, _response, next) {
    const rawToken = parseCookies(request.get('cookie'))[COOKIE_NAME];
    if (!rawToken) return next(new AppError('ADMIN_AUTH_REQUIRED', 'Entre como administrador', 401));
    const tokenHash = sha256(rawToken);
    const session = database.getAdminSession(tokenHash);
    if (!session) return next(new AppError('ADMIN_SESSION_EXPIRED', 'Sua sessão expirou', 401));
    request.adminSession = session;
    request.adminTokenHash = tokenHash;
    return next();
  }

  function requireCsrf(request, _response, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const token = request.get('x-csrf-token');
    if (!token || !sameHash(sha256(token), request.adminSession.csrfHash)) {
      return next(new AppError('INVALID_CSRF_TOKEN', 'Token de segurança inválido', 403));
    }
    return next();
  }

  router.use(requireTrustedOrigin);

  async function login(request, response, next) {
    try {
      if (!config.adminPasswordHash) {
        throw new AppError('ADMIN_NOT_CONFIGURED', 'A senha administrativa ainda não foi configurada', 503);
      }
      const { password } = loginSchema.parse(request.body);
      const valid = await argon2.verify(config.adminPasswordHash, password, { type: argon2.argon2id });
      if (!valid) {
        database.audit({
          actor: 'anonymous',
          action: 'admin.login_failed',
          entityType: 'admin_session',
          ip: request.ip,
        });
        throw new AppError('INVALID_CREDENTIALS', 'Senha inválida', 401);
      }
      const sessionToken = randomToken();
      const csrfToken = randomToken();
      const now = Date.now();
      const expiresAt = now + config.adminSessionMs;
      database.removeExpiredAdminSessions(now);
      database.createAdminSession({
        tokenHash: sha256(sessionToken),
        csrfHash: sha256(csrfToken),
        now,
        expiresAt,
      });
      database.audit({
        ...auditContext(request),
        action: 'admin.login',
        entityType: 'admin_session',
      });
      const cookie = [
        `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        'HttpOnly',
        'Path=/api/admin',
        'SameSite=Strict',
        `Max-Age=${Math.floor(config.adminSessionMs / 1000)}`,
        ...(config.environment === 'production' ? ['Secure'] : []),
      ].join('; ');
      response.set('Cache-Control', 'no-store');
      response.set('Set-Cookie', cookie);
      response.json({ csrfToken, expiresAt });
    } catch (error) {
      next(error);
    }
  }

  router.post('/login', loginLimiter, login);
  router.post('/session', loginLimiter, login);

  router.use(requireAdmin);
  router.use(mutationLimiter);
  router.use(requireCsrf);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  function logout(request, response) {
    database.deleteAdminSession(request.adminTokenHash);
    database.audit({ ...auditContext(request), action: 'admin.logout', entityType: 'admin_session' });
    response.set('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/api/admin; SameSite=Strict; Max-Age=0`);
    response.status(204).end();
  }

  router.post('/logout', logout);
  router.delete('/session', logout);

  router.get('/session', (request, response) => {
    const csrfToken = randomToken();
    database.updateAdminCsrf(request.adminTokenHash, sha256(csrfToken));
    response.json({ authenticated: true, expiresAt: request.adminSession.expiresAt, csrfToken });
  });

  router.get('/facts/export', (_request, response) => {
    response.set('Content-Disposition', `attachment; filename="facts-${new Date().toISOString().slice(0, 10)}.json"`);
    response.json(database.exportFacts());
  });

  router.post('/facts/import/validate', (request, response) => {
    const { items, errors } = validateImport(request.body);
    response.json({
      valid: errors.length === 0,
      validCount: items.length,
      count: items.length,
      items,
      errors,
      existingIds: items.filter(({ id }) => database.getFact(id)).map(({ id }) => id),
    });
  });

  router.post('/facts/import/apply', (request, response) => {
    const { facts, strategy } = importApplySchema.parse(request.body);
    const uniqueIds = new Set(facts.map(({ id }) => id));
    if (uniqueIds.size !== facts.length) throw new AppError('DUPLICATE_IMPORT_IDS', 'O arquivo contém IDs repetidos', 422);
    if (strategy === 'insert') {
      const conflicts = facts.filter(({ id }) => database.getFact(id)).map(({ id }) => id);
      if (conflicts.length) throw new AppError('FACT_ID_CONFLICT', 'Alguns IDs já existem', 409, { ids: conflicts });
    }
    const count = database.importFacts(facts, { strategy, ...auditContext(request) });
    response.status(201).json({ applied: count, strategy });
  });

  router.post('/facts/import', (request, response) => {
    const { items, errors } = validateImport(request.body);
    if (errors.length) throw new AppError('INVALID_IMPORT', 'Corrija os problemas antes de importar', 422, { errors });
    const count = database.importFacts(items, { strategy: 'upsert', ...auditContext(request) });
    response.status(201).json({ applied: count, strategy: 'upsert' });
  });

  router.get('/facts', (request, response) => {
    const active = request.query.active === undefined ? undefined : request.query.active === 'true';
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const verdict = request.query.verdict === undefined || request.query.verdict === ''
      ? undefined
      : request.query.verdict === 'true';
    const result = database.listFacts({
      query: String(request.query.q ?? request.query.search ?? '').slice(0, 200),
      reviewStatus: request.query.reviewStatus,
      category: request.query.category,
      difficulty: request.query.difficulty,
      verdict,
      active,
      limit,
      offset: request.query.offset === undefined ? (page - 1) * limit : Number(request.query.offset),
    });
    response.json({
      ...result,
      facts: result.items,
      pagination: {
        page,
        pages: Math.max(1, Math.ceil(result.total / limit)),
        total: result.total,
        limit,
      },
    });
  });

  router.get('/facts/:id', (request, response) => {
    const fact = database.getFact(request.params.id);
    if (!fact) throw new AppError('FACT_NOT_FOUND', 'Fato não encontrado', 404);
    response.json(fact);
  });

  router.post('/facts', (request, response) => {
    const fact = factSchema.parse(cleanFactInput(request.body, request.body?.id ?? randomUUID()));
    if (database.getFact(fact.id)) throw new AppError('FACT_ID_CONFLICT', 'Já existe um fato com esse ID', 409);
    response.status(201).json(database.createFact(fact, auditContext(request)));
  });

  router.put('/facts/:id', (request, response) => {
    const fact = factSchema.parse(cleanFactInput(request.body, request.params.id));
    const updated = database.updateFact(request.params.id, fact, auditContext(request));
    if (!updated) throw new AppError('FACT_NOT_FOUND', 'Fato não encontrado', 404);
    response.json(updated);
  });

  router.patch('/facts/:id', (request, response) => {
    const current = database.getFact(request.params.id);
    if (!current) throw new AppError('FACT_NOT_FOUND', 'Fato não encontrado', 404);
    const patch = { ...request.body };
    if (patch.active === false && Object.keys(patch).every((key) => key === 'active')) patch.reviewStatus = 'archived';
    const fact = factSchema.parse(cleanFactInput({ ...current, ...patch }, request.params.id));
    const updated = database.updateFact(request.params.id, fact, auditContext(request));
    response.json(updated);
  });

  function archive(request, response) {
    const archived = database.archiveFact(request.params.id, auditContext(request));
    if (!archived) throw new AppError('FACT_NOT_FOUND', 'Fato não encontrado', 404);
    response.json(archived);
  }

  router.post('/facts/:id/archive', archive);
  router.delete('/facts/:id', archive);

  router.post('/facts/:id/duplicate', (request, response) => {
    const { id } = duplicateSchema.parse(request.body ?? {});
    const duplicate = database.duplicateFact(request.params.id, id ?? randomUUID(), auditContext(request));
    if (!duplicate) throw new AppError('FACT_NOT_FOUND', 'Fato não encontrado', 404);
    response.status(201).json(duplicate);
  });

  router.get('/dashboard', (_request, response) => response.json(database.dashboard()));

  router.get('/audit', (request, response) => {
    response.json({
      items: database.listAudit({
        limit: Number(request.query.limit ?? 100),
        offset: Number(request.query.offset ?? 0),
      }),
    });
  });

  router.use((error, _request, response, _next) => {
    const normalized = error?.code?.startsWith?.('SQLITE_CONSTRAINT')
      ? new AppError('DATABASE_CONSTRAINT', 'A alteração conflita com um registro existente', 409)
      : error;
    const serialized = serializeError(normalized);
    response.status(normalized.status ?? (normalized?.name === 'ZodError' ? 422 : 500)).json({
      error: serialized,
      message: serialized.message,
    });
  });

  return router;
}
