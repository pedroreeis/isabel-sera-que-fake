import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { io as createClient } from 'socket.io-client';
import { createApplication } from '../src/app.js';
import { IsabelDatabase } from '../src/db.js';

function envelope(version, payload = {}) {
  return { requestId: crypto.randomUUID(), version, payload };
}

function emit(socket, event, version, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(3_000).emit(event, envelope(version, payload), (timeoutError, response) => {
      if (timeoutError) reject(timeoutError);
      else resolve(response);
    });
  });
}

test('Socket.IO completes the private community handshake without leaking answers', async (context) => {
  const database = new IsabelDatabase(':memory:');
  const runtime = createApplication({
    database,
    config: {
      environment: 'test',
      port: 0,
      clientOrigins: ['http://localhost:5173'],
      databasePath: ':memory:',
      adminPasswordHash: '',
      adminSessionMs: 60_000,
      trustProxy: false,
      seedPath: fileURLToPath(new URL('../data/facts.seed.json', import.meta.url)),
    },
  });
  runtime.httpServer.listen(0, '127.0.0.1');
  await once(runtime.httpServer, 'listening');
  const { port } = runtime.httpServer.address();
  const clients = [1, 2].map(() => createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    extraHeaders: { Origin: 'http://localhost:5173' },
  }));
  context.after(async () => {
    clients.forEach((client) => client.disconnect());
    await runtime.close();
  });
  await Promise.all(clients.map((client) => once(client, 'connect')));

  const joinedA = await emit(clients[0], 'room:join', 0, { nickname: 'Ana' });
  const joinedB = await emit(clients[1], 'room:join', 0, { nickname: 'Beto' });
  assert.equal(joinedA.ok && joinedB.ok, true);

  const refreshed = await emit(clients[0], 'state:request', joinedA.version);
  const configured = await emit(clients[0], 'lobby:configure', refreshed.version, {
    mode: 'community', timerSeconds: 15, roundLimit: 10,
  });
  const started = await emit(clients[0], 'game:start', configured.version);
  const feeding = await emit(clients[0], 'state:request', started.version);
  assert.equal(feeding.data.snapshot.phase, 'FEEDING_INITIAL');
  assert.equal(feeding.data.snapshot.game.requiredFactsPerPlayer, 2);

  const firstBatch = [
    { statement: 'Polvos têm três corações de verdade.', verdict: true, explanation: 'Dois bombeiam para brânquias e um para o corpo.' },
    { statement: 'A Lua produz sua própria luz visível.', verdict: false, explanation: 'Ela reflete principalmente a luz recebida do Sol.' },
  ];
  const submittedA = await emit(clients[0], 'community:submit', feeding.version, { facts: firstBatch });
  const stateB = await emit(clients[1], 'state:request', joinedB.version);
  const submittedB = await emit(clients[1], 'community:submit', stateB.version, { facts: firstBatch.map((fact, index) => ({ ...fact, statement: `${fact.statement} ${index + 1}` })) });
  assert.equal(submittedA.ok && submittedB.ok, true);

  const publicState = await emit(clients[0], 'state:request', submittedB.version);
  const serialized = JSON.stringify(publicState.data.snapshot);
  for (const secret of ['verdict', 'explanation', 'score', 'streak', 'authorId']) {
    assert.equal(serialized.includes(`"${secret}"`), false, `${secret} leaked`);
  }
  assert.equal(publicState.data.snapshot.phase, 'COUNTDOWN');
});
