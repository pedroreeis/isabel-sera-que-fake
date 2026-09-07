import test from 'node:test';
import assert from 'node:assert/strict';
import { factImportSchema } from '@isabel/shared';
import { IsabelDatabase } from '../src/db.js';

const fact = {
  id: 'db-fact',
  statement: 'Uma afirmação suficientemente longa para o banco.',
  verdict: false,
  explanation: 'Uma explicação suficientemente longa para o banco.',
  correction: 'Esta é a correção apropriada.',
  category: 'Banco',
  difficulty: 3,
  tags: ['banco'],
  sensitivity: 'general',
  sources: [{ label: 'Fonte', url: 'https://example.com' }],
  verifiedAt: '2026-09-06',
  reviewStatus: 'verified',
  active: true,
};

test('fact schema accepts the seed contract and rejects false facts without correction', () => {
  assert.equal(factImportSchema.parse([fact]).length, 1);
  assert.equal(factImportSchema.safeParse([{ ...fact, correction: null }]).success, false);
  assert.equal(factImportSchema.safeParse([{ ...fact, verdict: true, correction: null }]).success, true);
});

test('database persists facts, snapshots, sessions, imports, and audit entries', () => {
  const database = new IsabelDatabase(':memory:');
  assert.equal(database.seedFacts([fact]), 1);
  assert.equal(database.seedFacts([fact]), 0);
  assert.equal(database.getPlayableFacts()[0].id, fact.id);
  assert.deepEqual(database.getShownClassicFactIds(), []);
  assert.equal(database.markClassicFactShown(fact.id), 1);
  assert.deepEqual(database.getShownClassicFactIds(), [fact.id]);
  assert.equal(database.resetClassicFactCycle(), 1);
  assert.deepEqual(database.getShownClassicFactIds(), []);

  const created = database.createFact({ ...fact, id: 'draft-fact', reviewStatus: 'pending', active: false });
  assert.equal(created.active, false);
  assert.equal(database.listFacts({ reviewStatus: 'pending' }).total, 1);
  assert.equal(database.archiveFact('draft-fact').reviewStatus, 'archived');

  database.saveRoom('main', { version: 7, private: true });
  assert.deepEqual(database.loadRoom('main'), { version: 7, private: true });

  database.createAdminSession({ tokenHash: 'token', csrfHash: 'csrf', now: 100, expiresAt: 200 });
  assert.equal(database.getAdminSession('token', 150).csrfHash, 'csrf');
  assert.equal(database.getAdminSession('token', 201), null);
  assert.equal(database.listAudit().length >= 2, true);
  database.close();
});
