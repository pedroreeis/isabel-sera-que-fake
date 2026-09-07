import fs from 'node:fs';
import { factImportSchema } from '@isabel/shared';

export function loadSeedFacts(filename) {
  if (!fs.existsSync(filename)) return [];
  const contents = fs.readFileSync(filename, 'utf8');
  return factImportSchema.parse(JSON.parse(contents));
}

export function initializeFacts(database, seedPath) {
  const facts = loadSeedFacts(seedPath);
  return { loaded: facts.length, inserted: database.seedFacts(facts) };
}
