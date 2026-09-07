import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToFact(row) {
  if (!row) return null;
  return {
    id: row.id,
    statement: row.statement,
    verdict: Boolean(row.verdict),
    explanation: row.explanation,
    correction: row.correction,
    category: row.category,
    difficulty: row.difficulty,
    tags: parseJson(row.tags_json, []),
    sensitivity: row.sensitivity,
    sources: parseJson(row.sources_json, []),
    verifiedAt: row.verified_at,
    reviewStatus: row.review_status,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function factBindings(fact, now = new Date().toISOString()) {
  return {
    id: fact.id,
    statement: fact.statement,
    verdict: fact.verdict ? 1 : 0,
    explanation: fact.explanation,
    correction: fact.correction ?? null,
    category: fact.category,
    difficulty: fact.difficulty,
    tags_json: JSON.stringify(fact.tags),
    sensitivity: fact.sensitivity,
    sources_json: JSON.stringify(fact.sources),
    verified_at: fact.verifiedAt,
    review_status: fact.reviewStatus,
    active: fact.active ? 1 : 0,
    now,
  };
}

export class IsabelDatabase {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.sqlite = new Database(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        verdict INTEGER NOT NULL CHECK (verdict IN (0, 1)),
        explanation TEXT NOT NULL,
        correction TEXT,
        category TEXT NOT NULL,
        difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
        tags_json TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        review_status TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS facts_active_difficulty_idx
        ON facts (active, review_status, difficulty);
      CREATE INDEX IF NOT EXISTS facts_category_idx ON facts (category);

      CREATE TABLE IF NOT EXISTS fact_sources (
        fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        PRIMARY KEY (fact_id, position)
      );
      CREATE INDEX IF NOT EXISTS fact_sources_fact_idx ON fact_sources (fact_id);

      CREATE TABLE IF NOT EXISTS classic_fact_exposure (
        fact_id TEXT PRIMARY KEY REFERENCES facts(id) ON DELETE CASCADE,
        shown_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_snapshots (
        room_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        metadata_json TEXT NOT NULL,
        ip TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log (occurred_at DESC);
    `);
  }

  close() {
    this.sqlite.close();
  }

  syncFactSources(fact) {
    this.sqlite.prepare('DELETE FROM fact_sources WHERE fact_id = ?').run(fact.id);
    const insert = this.sqlite.prepare(`
      INSERT INTO fact_sources (fact_id, position, label, url) VALUES (?, ?, ?, ?)
    `);
    fact.sources.forEach((source, position) => insert.run(fact.id, position, source.label, source.url));
  }

  seedFacts(facts) {
    const statement = this.sqlite.prepare(`
      INSERT OR IGNORE INTO facts (
        id, statement, verdict, explanation, correction, category, difficulty,
        tags_json, sensitivity, sources_json, verified_at, review_status, active,
        created_at, updated_at
      ) VALUES (
        @id, @statement, @verdict, @explanation, @correction, @category, @difficulty,
        @tags_json, @sensitivity, @sources_json, @verified_at, @review_status, @active,
        @now, @now
      )
    `);
    const transaction = this.sqlite.transaction((items) => {
      let inserted = 0;
      for (const fact of items) {
        inserted += statement.run(factBindings(fact)).changes;
        this.syncFactSources(fact);
      }
      return inserted;
    });
    return transaction(facts);
  }

  getPlayableFacts() {
    return this.sqlite
      .prepare("SELECT * FROM facts WHERE active = 1 AND review_status != 'archived' ORDER BY difficulty, id")
      .all()
      .map(rowToFact);
  }

  getShownClassicFactIds() {
    return this.sqlite
      .prepare('SELECT fact_id FROM classic_fact_exposure')
      .all()
      .map(({ fact_id: factId }) => factId);
  }

  markClassicFactShown(factId) {
    return this.sqlite.prepare(`
      INSERT INTO classic_fact_exposure (fact_id, shown_at) VALUES (?, ?)
      ON CONFLICT(fact_id) DO UPDATE SET shown_at = excluded.shown_at
    `).run(factId, new Date().toISOString()).changes;
  }

  resetClassicFactCycle() {
    return this.sqlite.prepare('DELETE FROM classic_fact_exposure').run().changes;
  }

  getFact(id) {
    return rowToFact(this.sqlite.prepare('SELECT * FROM facts WHERE id = ?').get(id));
  }

  listFacts({ query = '', reviewStatus, category, difficulty, verdict, active, limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const parsedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50;
    const parsedOffset = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0;
    const parameters = { limit: Math.min(200, Math.max(1, parsedLimit)), offset: Math.max(0, parsedOffset) };
    if (query) {
      clauses.push('(statement LIKE @query ESCAPE \'\\\' OR explanation LIKE @query ESCAPE \'\\\')');
      parameters.query = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    }
    if (reviewStatus) {
      clauses.push('review_status = @reviewStatus');
      parameters.reviewStatus = reviewStatus;
    }
    if (category) {
      clauses.push('category = @category');
      parameters.category = category;
    }
    if (difficulty !== undefined && difficulty !== '') {
      clauses.push('difficulty = @difficulty');
      parameters.difficulty = Number(difficulty);
    }
    if (typeof verdict === 'boolean') {
      clauses.push('verdict = @verdict');
      parameters.verdict = verdict ? 1 : 0;
    }
    if (typeof active === 'boolean') {
      clauses.push('active = @active');
      parameters.active = active ? 1 : 0;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM facts ${where}`).get(parameters).count;
    const items = this.sqlite
      .prepare(`SELECT * FROM facts ${where} ORDER BY updated_at DESC, id LIMIT @limit OFFSET @offset`)
      .all(parameters)
      .map(rowToFact);
    return { items, total, limit: parameters.limit, offset: parameters.offset };
  }

  createFact(fact, audit = {}) {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO facts (
        id, statement, verdict, explanation, correction, category, difficulty,
        tags_json, sensitivity, sources_json, verified_at, review_status, active,
        created_at, updated_at
      ) VALUES (
        @id, @statement, @verdict, @explanation, @correction, @category, @difficulty,
        @tags_json, @sensitivity, @sources_json, @verified_at, @review_status, @active,
        @now, @now
      )
    `).run(factBindings(fact, now));
    this.syncFactSources(fact);
    this.audit({ ...audit, action: 'fact.create', entityType: 'fact', entityId: fact.id });
    return this.getFact(fact.id);
  }

  updateFact(id, fact, audit = {}) {
    const now = new Date().toISOString();
    const result = this.sqlite.prepare(`
      UPDATE facts SET
        statement = @statement, verdict = @verdict, explanation = @explanation,
        correction = @correction, category = @category, difficulty = @difficulty,
        tags_json = @tags_json, sensitivity = @sensitivity, sources_json = @sources_json,
        verified_at = @verified_at, review_status = @review_status, active = @active,
        updated_at = @now
      WHERE id = @id
    `).run(factBindings({ ...fact, id }, now));
    if (!result.changes) return null;
    this.syncFactSources({ ...fact, id });
    this.audit({ ...audit, action: 'fact.update', entityType: 'fact', entityId: id });
    return this.getFact(id);
  }

  archiveFact(id, audit = {}) {
    const result = this.sqlite.prepare(`
      UPDATE facts SET active = 0, review_status = 'archived', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
    if (!result.changes) return null;
    this.audit({ ...audit, action: 'fact.archive', entityType: 'fact', entityId: id });
    return this.getFact(id);
  }

  duplicateFact(id, newId = randomUUID(), audit = {}) {
    const source = this.getFact(id);
    if (!source) return null;
    const duplicate = {
      ...source,
      id: newId,
      statement: `${source.statement} (cópia)`,
      reviewStatus: 'pending',
      active: false,
    };
    delete duplicate.createdAt;
    delete duplicate.updatedAt;
    const created = this.createFact(duplicate, { ...audit, metadata: { duplicatedFrom: id } });
    this.audit({ ...audit, action: 'fact.duplicate', entityType: 'fact', entityId: newId, metadata: { duplicatedFrom: id } });
    return created;
  }

  importFacts(facts, { strategy = 'upsert', ...audit } = {}) {
    const insert = this.sqlite.prepare(`
      INSERT INTO facts (
        id, statement, verdict, explanation, correction, category, difficulty,
        tags_json, sensitivity, sources_json, verified_at, review_status, active,
        created_at, updated_at
      ) VALUES (
        @id, @statement, @verdict, @explanation, @correction, @category, @difficulty,
        @tags_json, @sensitivity, @sources_json, @verified_at, @review_status, @active,
        @now, @now
      )
    `);
    const upsert = this.sqlite.prepare(`
      INSERT INTO facts (
        id, statement, verdict, explanation, correction, category, difficulty,
        tags_json, sensitivity, sources_json, verified_at, review_status, active,
        created_at, updated_at
      ) VALUES (
        @id, @statement, @verdict, @explanation, @correction, @category, @difficulty,
        @tags_json, @sensitivity, @sources_json, @verified_at, @review_status, @active,
        @now, @now
      ) ON CONFLICT(id) DO UPDATE SET
        statement = excluded.statement, verdict = excluded.verdict,
        explanation = excluded.explanation, correction = excluded.correction,
        category = excluded.category, difficulty = excluded.difficulty,
        tags_json = excluded.tags_json, sensitivity = excluded.sensitivity,
        sources_json = excluded.sources_json, verified_at = excluded.verified_at,
        review_status = excluded.review_status, active = excluded.active,
        updated_at = excluded.updated_at
    `);
    const transaction = this.sqlite.transaction((items) => {
      const now = new Date().toISOString();
      for (const fact of items) {
        (strategy === 'insert' ? insert : upsert).run(factBindings(fact, now));
        this.syncFactSources(fact);
      }
      this.audit({
        ...audit,
        action: 'fact.import',
        entityType: 'fact_batch',
        metadata: { count: items.length, strategy },
      });
      return items.length;
    });
    return transaction(facts);
  }

  exportFacts() {
    return this.sqlite.prepare('SELECT * FROM facts ORDER BY id').all().map((row) => {
      const fact = rowToFact(row);
      delete fact.createdAt;
      delete fact.updatedAt;
      return fact;
    });
  }

  dashboard() {
    const totals = this.sqlite.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN review_status = 'verified' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN review_status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM facts
    `).get();
    const byCategory = this.sqlite
      .prepare('SELECT category, COUNT(*) AS count FROM facts GROUP BY category ORDER BY count DESC, category')
      .all();
    const byDifficulty = this.sqlite
      .prepare('SELECT difficulty, COUNT(*) AS count FROM facts GROUP BY difficulty ORDER BY difficulty')
      .all();
    const verdicts = this.sqlite.prepare(`
      SELECT
        SUM(CASE WHEN verdict = 1 THEN 1 ELSE 0 END) AS true_count,
        SUM(CASE WHEN verdict = 0 THEN 1 ELSE 0 END) AS false_count
      FROM facts WHERE active = 1
    `).get();
    const sourceCount = this.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM fact_sources source
      JOIN facts fact ON fact.id = source.fact_id
      WHERE fact.active = 1
    `).get().count;
    const matrix = this.sqlite.prepare(`
      SELECT category, difficulty, COUNT(*) AS count
      FROM facts WHERE active = 1
      GROUP BY category, difficulty
      ORDER BY category, difficulty
    `).all();
    const staleBefore = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const staleSourceCount = this.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM fact_sources source
      JOIN facts fact ON fact.id = source.fact_id
      WHERE fact.active = 1 AND fact.verified_at < ?
    `).get(staleBefore).count;
    const lastAuditAt = this.sqlite.prepare('SELECT MAX(occurred_at) AS value FROM audit_log').get().value;
    return {
      total: totals.total ?? 0,
      active: totals.active ?? 0,
      pendingReview: totals.pending ?? 0,
      verified: totals.verified ?? 0,
      archived: totals.archived ?? 0,
      trueCount: verdicts.true_count ?? 0,
      falseCount: verdicts.false_count ?? 0,
      sourceCount,
      staleSourceCount,
      sourceReviewDays: 365,
      totals,
      byCategory,
      byDifficulty,
      matrix,
      lastAuditAt,
    };
  }

  audit({ actor = 'admin', action, entityType, entityId = null, metadata = {}, ip = null }) {
    this.sqlite.prepare(`
      INSERT INTO audit_log (occurred_at, actor, action, entity_type, entity_id, metadata_json, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), actor, action, entityType, entityId, JSON.stringify(metadata), ip);
  }

  listAudit({ limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const safeOffset = Math.max(0, offset);
    return this.sqlite
      .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(safeLimit, safeOffset)
      .map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        actor: row.actor,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: parseJson(row.metadata_json, {}),
        ip: row.ip,
      }));
  }

  saveRoom(roomId, snapshot) {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO room_snapshots (room_id, payload_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `).run(roomId, JSON.stringify(snapshot), now);
  }

  loadRoom(roomId) {
    const row = this.sqlite.prepare('SELECT payload_json FROM room_snapshots WHERE room_id = ?').get(roomId);
    return row ? parseJson(row.payload_json, null) : null;
  }

  createAdminSession({ tokenHash, csrfHash, now, expiresAt }) {
    this.sqlite.prepare(`
      INSERT INTO admin_sessions (token_hash, csrf_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, csrfHash, now, expiresAt, now);
  }

  getAdminSession(tokenHash, now = Date.now()) {
    const row = this.sqlite
      .prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, now);
    if (!row) return null;
    this.sqlite.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
    return { tokenHash: row.token_hash, csrfHash: row.csrf_hash, expiresAt: row.expires_at };
  }

  updateAdminCsrf(tokenHash, csrfHash) {
    return this.sqlite.prepare('UPDATE admin_sessions SET csrf_hash = ? WHERE token_hash = ?').run(csrfHash, tokenHash).changes;
  }

  deleteAdminSession(tokenHash) {
    return this.sqlite.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash).changes;
  }

  removeExpiredAdminSessions(now = Date.now()) {
    return this.sqlite.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now).changes;
  }
}
