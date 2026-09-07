import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createAdminRouter } from './admin-router.js';
import { IsabelDatabase } from './db.js';
import { serializeError } from './errors.js';
import { initializeFacts } from './facts.js';
import { GameCoordinator } from './socket-server.js';

export function createApplication({ config, database = null, now } = {}) {
  const db = database ?? new IsabelDatabase(config.databasePath);
  const seedResult = initializeFacts(db, config.seedPath);
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && config.clientOrigins.includes(origin)) {
      response.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token',
        Vary: 'Origin',
      });
    }
    if (request.method === 'OPTIONS') return response.status(204).end();
    return next();
  });
  app.use((_request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    next();
  });
  app.use(express.json({ limit: '3mb', type: ['application/json', 'application/*+json'] }));

  const healthcheck = (_request, response) => {
    response.json({ ok: true, room: 'main', seededFacts: seedResult.loaded });
  };
  app.get('/api/health', healthcheck);
  app.get('/api/healthz', healthcheck);
  app.use('/api/admin', createAdminRouter({ database: db, config }));

  app.use((error, _request, response, _next) => {
    const serialized = serializeError(error);
    response.status(error.status ?? (error?.name === 'ZodError' ? 422 : 500)).json({ error: serialized });
  });

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true, methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || config.clientOrigins.includes(origin));
    },
    maxHttpBufferSize: 100_000,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  const coordinator = new GameCoordinator({ io, database: db, now }).bind();

  return {
    app,
    httpServer,
    io,
    database: db,
    coordinator,
    async close() {
      coordinator.close();
      await new Promise((resolve) => io.close(resolve));
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
      db.close();
    },
  };
}
