import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/game-room.js';

function makeFacts(count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    id: `fact-${String(index + 1).padStart(2, '0')}`,
    statement: `Esta é a afirmação de teste número ${index + 1}.`,
    verdict: index % 2 === 0,
    explanation: `Explicação verificável para o fato número ${index + 1}.`,
    correction: index % 2 === 0 ? null : `Correção do fato número ${index + 1}.`,
    category: 'Teste',
    difficulty: (index % 5) + 1,
    tags: ['teste'],
    sensitivity: 'general',
    sources: [{ label: 'Fonte', url: 'https://example.com/source' }],
    verifiedAt: '2026-09-06',
    reviewStatus: 'verified',
    active: true,
  }));
}

function communityFact(number, verdict = true) {
  return {
    statement: `Afirmação comunitária de teste número ${number}.`,
    verdict,
    explanation: `Explicação comunitária detalhada número ${number}.`,
    correction: verdict ? null : `Correção comunitária número ${number}.`,
    category: 'Comunidade',
    sources: [],
  };
}

function setupClassic({ playerCount = 1 } = {}) {
  let time = 1_000_000;
  const room = new GameRoom({ factsProvider: () => makeFacts(), now: () => time });
  const players = [];
  for (let index = 0; index < playerCount; index += 1) {
    players.push(room.join({ nickname: `Pessoa ${index + 1}` }));
  }
  room.start(players[0].playerId);
  time += 3_000;
  room.sweep();
  return { room, players, advance: (milliseconds) => { time += milliseconds; } };
}

test('public snapshot and open round never expose truth, votes, streaks, or scores', () => {
  const { room, players } = setupClassic();
  const snapshot = JSON.stringify(room.project(players[0].playerId));
  const opened = JSON.stringify(room.roundProjection(players[0].playerId));
  for (const secret of ['verdict', 'explanation', 'correction', 'sources', 'score', 'streak']) {
    assert.equal(snapshot.includes(`"${secret}"`), false, `${secret} leaked in snapshot`);
    assert.equal(opened.includes(`"${secret}"`), false, `${secret} leaked in round`);
  }
  assert.equal(room.project(players[0].playerId).phase, 'ROUND_OPEN');
  assert.equal(room.project(players[0].playerId).game.currentRound.statement.length > 0, true);
});

test('solo classic always plays all ten rounds and reveals results only at the finish', () => {
  const { room, players, advance } = setupClassic();
  for (let round = 0; round < 10; round += 1) {
    const fact = room.state.game.currentFact;
    room.answer(players[0].playerId, {
      roundId: room.state.game.currentRoundId,
      answer: fact.verdict,
    });
    if (round < 9) {
      assert.equal(room.phase, 'transition');
      advance(1_800);
      room.sweep();
    }
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.state.game.history.length, 10);
  const result = room.finalProjection();
  assert.equal(result.rounds.length, 10);
  assert.equal(typeof result.rounds[0].verdict, 'boolean');
  assert.equal(result.leaderboard[0].correctCount, 10);
});

test('a late join receives a waiting seat and cannot answer the active match', () => {
  const { room } = setupClassic({ playerCount: 2 });
  const late = room.join({ nickname: 'Pessoa atrasada' });
  const projection = room.project(late.playerId);
  assert.equal(projection.players.find(({ id }) => id === late.playerId).waitingForNextGame, true);
  assert.equal(projection.self.canAnswer, false);
});

test('the fixed room reserves exactly eight seats', () => {
  const room = new GameRoom();
  for (let index = 1; index <= 8; index += 1) room.join({ nickname: `Lugar ${index}` });
  assert.throws(() => room.join({ nickname: 'Lugar 9' }), { code: 'ROOM_FULL' });
  assert.equal(room.project().capacity.used, 8);
});

test('duplicate and late votes are rejected without changing the round', () => {
  const { room, players, advance } = setupClassic({ playerCount: 2 });
  const roundId = room.state.game.currentRoundId;
  room.answer(players[0].playerId, { roundId, answer: true });
  assert.throws(
    () => room.answer(players[0].playerId, { roundId, answer: false }),
    { code: 'ALREADY_ANSWERED' },
  );
  advance(30_000);
  assert.throws(
    () => room.answer(players[1].playerId, { roundId, answer: true }),
    { code: 'ROUND_CLOSED' },
  );
  assert.equal(Object.keys(room.state.game.answers).length, 1);
});

test('community collection requires two facts each and pauses an author streak', () => {
  let time = 50_000;
  const room = new GameRoom({ now: () => time });
  const first = room.join({ nickname: 'Ana' });
  const second = room.join({ nickname: 'Beto' });
  room.updateSettings(first.playerId, { mode: 'community', timerSeconds: 15, roundLimit: 10 });
  room.start(first.playerId);
  assert.equal(room.project(first.playerId).phase, 'FEEDING_INITIAL');
  room.submitCommunityFacts(first.playerId, { facts: [communityFact(1), communityFact(2, false)] });
  room.submitCommunityFacts(second.playerId, { facts: [communityFact(3), communityFact(4, false)] });
  assert.equal(room.phase, 'countdown');
  time += 3_000;
  room.sweep();
  assert.equal(room.phase, 'question');

  assert.equal(room.state.game.currentFact.authorId, second.playerId);
  room.answer(first.playerId, {
    roundId: room.state.game.currentRoundId,
    answer: room.state.game.currentFact.verdict,
  });
  assert.equal(room.state.players[first.playerId].streak, 1);

  time += 1_800;
  room.sweep();
  assert.equal(room.state.game.currentFact.authorId, first.playerId);
  const streakBeforeOwnFact = room.state.players[first.playerId].streak;
  time += 1_000;
  room.answer(second.playerId, {
    roundId: room.state.game.currentRoundId,
    answer: room.state.game.currentFact.verdict,
  });
  assert.equal(room.state.players[first.playerId].streak, streakBeforeOwnFact);
  assert.equal(room.state.game.history[1].answers.find(({ playerId }) => playerId === first.playerId).excluded, true);
});

test('host may remove a missing contributor only after sixty seconds', () => {
  let time = 5_000;
  const room = new GameRoom({ now: () => time });
  const host = room.join({ nickname: 'Host' });
  const stalled = room.join({ nickname: 'Parado' });
  room.updateSettings(host.playerId, { mode: 'community', timerSeconds: 15, roundLimit: 10 });
  room.start(host.playerId);
  room.submitCommunityFacts(host.playerId, { facts: [communityFact(1), communityFact(2)] });
  assert.throws(() => room.removeStalled(host.playerId, stalled.playerId), { code: 'STALL_GRACE_PERIOD' });
  time += 60_000;
  room.removeStalled(host.playerId, stalled.playerId);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.state.game, null);
  assert.equal(room.project(host.playerId).notice.code, 'COMMUNITY_CANCELLED');
});

test('host transfers after thirty seconds and disconnected seats expire after sixty', () => {
  let time = 10_000;
  const room = new GameRoom({ now: () => time });
  const host = room.join({ nickname: 'Primeiro' });
  const successor = room.join({ nickname: 'Segundo' });
  room.disconnect(host.playerId);
  time += 29_999;
  assert.equal(room.sweep(), false);
  assert.equal(room.state.hostPlayerId, host.playerId);
  time += 1;
  assert.equal(room.sweep(), true);
  assert.equal(room.state.hostPlayerId, successor.playerId);
  time += 30_000;
  room.sweep();
  assert.equal(room.state.players[host.playerId], undefined);
});

test('rehydrated room advances a question whose authoritative deadline elapsed', () => {
  let time = 100_000;
  const original = new GameRoom({ factsProvider: () => makeFacts(), now: () => time });
  const player = original.join({ nickname: 'Reconecta' });
  original.start(player.playerId);
  time += 3_000;
  original.sweep();
  const firstRoundId = original.state.game.currentRoundId;
  const snapshot = original.serialize();
  time += 30_001;
  const restored = new GameRoom({ snapshot, factsProvider: () => makeFacts(), now: () => time });
  assert.equal(restored.state.players[player.playerId].connected, false);
  assert.equal(restored.sweep(), true);
  assert.equal(restored.state.game.history.length, 1);
  assert.equal(restored.state.game.currentRoundId, null);
  assert.equal(restored.phase, 'transition');
  assert.equal(restored.state.players[player.playerId].streak, 0);
  time += 1_800;
  restored.sweep();
  assert.notEqual(restored.state.game.currentRoundId, firstRoundId);
});

test('finished report is frozen when a player leaves and is cleared after thirty empty minutes', () => {
  const { room, players, advance } = setupClassic();
  for (let round = 0; round < 10; round += 1) {
    room.answer(players[0].playerId, {
      roundId: room.state.game.currentRoundId,
      answer: room.state.game.currentFact.verdict,
    });
    if (round < 9) {
      advance(1_800);
      room.sweep();
    }
  }
  room.leave(players[0].playerId);
  assert.equal(room.finalProjection().leaderboard.length, 1);
  room.sweep();
  advance(30 * 60_000);
  room.sweep();
  assert.equal(room.phase, 'lobby');
  assert.equal(room.state.game, null);
});

test('community asks for one fact each when only one authorship cycle remains', () => {
  let time = 90_000;
  const room = new GameRoom({ now: () => time });
  const players = Array.from({ length: 8 }, (_, index) => room.join({ nickname: `Jogador ${index + 1}` }));
  room.updateSettings(players[0].playerId, { mode: 'community', timerSeconds: 15, roundLimit: 10 });
  room.start(players[0].playerId);
  const projection = room.project(players[0].playerId);
  assert.equal(projection.settings.effectiveRoundLimit, 8);
  assert.equal(projection.game.requiredFactsPerPlayer, 1);
  for (const [index, player] of players.entries()) {
    room.submitCommunityFacts(player.playerId, { facts: [communityFact(index + 1, index % 2 === 0)] });
  }
  assert.equal(room.phase, 'countdown');
});

test('idempotency receipts survive a persisted room reload', () => {
  let time = 110_000;
  const room = new GameRoom({ now: () => time });
  const player = room.join({ nickname: 'Repetição segura' });
  const response = { requestId: 'request-12345678', ok: true, version: room.version, code: 'OK' };
  room.saveRequestReceipt(player.playerId, response.requestId, response);

  time += 100;
  const restored = new GameRoom({ snapshot: room.serialize(), now: () => time });
  assert.deepEqual(restored.getRequestReceipt(player.playerId, response.requestId), response);
});

test('an exact score and response-time tie crowns co-winners', () => {
  const { room, players } = setupClassic({ playerCount: 2 });
  for (const player of players) {
    Object.assign(room.state.players[player.playerId], {
      score: 500,
      correctCount: 2,
      correctResponseMs: 4_000,
      eligibleCount: 2,
    });
  }
  room.finish('round_limit');
  assert.deepEqual(room.finalProjection().leaderboard.map(({ rank }) => rank), [1, 1]);
});
