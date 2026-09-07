import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { createApplication } from '../src/app.js';
import { IsabelDatabase } from '../src/db.js';

test('superadmin enforces origin, secure cookie, CSRF and reversible archive', async (context) => {
  const password = 'senha de integração segura';
  const runtime = createApplication({
    database: new IsabelDatabase(':memory:'),
    config: {
      environment: 'production',
      port: 0,
      clientOrigins: ['https://seraquefake.pedrooreis.me'],
      databasePath: ':memory:',
      adminPasswordHash: await argon2.hash(password, { type: argon2.argon2id }),
      adminSessionMs: 60_000,
      trustProxy: false,
      seedPath: fileURLToPath(new URL('../data/facts.seed.json', import.meta.url)),
    },
  });
  runtime.httpServer.listen(0, '127.0.0.1');
  await once(runtime.httpServer, 'listening');
  context.after(() => runtime.close());
  const baseUrl = `http://127.0.0.1:${runtime.httpServer.address().port}`;

  const health = await fetch(`${baseUrl}/api/healthz`, { headers: { Origin: 'https://seraquefake.pedrooreis.me' } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), 'https://seraquefake.pedrooreis.me');
  assert.equal((await health.json()).seededFacts, 100);

  const rejectedOrigin = await fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const login = await fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: { Origin: 'https://seraquefake.pedrooreis.me', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Secure/i);
  const { csrfToken } = await login.json();

  const fact = {
    statement: 'Afirmação administrativa criada durante um teste de integração.',
    verdict: true,
    explanation: 'A explicação administrativa é longa o suficiente para a validação.',
    correction: null,
    category: 'ciencia',
    difficulty: 1,
    tags: ['teste'],
    sensitivity: 'general',
    sources: [{ label: 'Fonte de teste', url: 'https://example.com/source' }],
    verifiedAt: '2026-09-06',
    reviewStatus: 'pending',
    active: true,
  };
  const withoutCsrf = await fetch(`${baseUrl}/api/admin/facts`, {
    method: 'POST',
    headers: { Origin: 'https://seraquefake.pedrooreis.me', Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(fact),
  });
  assert.equal(withoutCsrf.status, 403);

  const created = await fetch(`${baseUrl}/api/admin/facts`, {
    method: 'POST',
    headers: {
      Origin: 'https://seraquefake.pedrooreis.me', Cookie: cookie,
      'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(fact),
  });
  assert.equal(created.status, 201);
  const createdFact = await created.json();

  const archived = await fetch(`${baseUrl}/api/admin/facts/${createdFact.id}`, {
    method: 'DELETE',
    headers: { Origin: 'https://seraquefake.pedrooreis.me', Cookie: cookie, 'X-CSRF-Token': csrfToken },
  });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).reviewStatus, 'archived');
});
