import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/isabel.sqlite'),
  ADMIN_PASSWORD_HASH: z.string().default(''),
  ADMIN_SESSION_HOURS: z.coerce.number().positive().max(168).default(8),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export function loadConfig(environment = process.env) {
  const parsed = environmentSchema.parse(environment);
  const databasePath = parsed.DATABASE_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(serverRoot, parsed.DATABASE_PATH);
  return Object.freeze({
    environment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    clientOrigins: parsed.CLIENT_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    databasePath,
    adminPasswordHash: parsed.ADMIN_PASSWORD_HASH,
    adminSessionMs: parsed.ADMIN_SESSION_HOURS * 60 * 60 * 1000,
    trustProxy: parsed.TRUST_PROXY === 'true',
    seedPath: path.join(serverRoot, 'data', 'facts.seed.json'),
  });
}
