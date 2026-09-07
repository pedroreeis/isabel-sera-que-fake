import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GameRoom } from '../src/game-room.js';

const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/facts.seed.json', import.meta.url)), 'utf8'));

test('twenty isolated rooms with eight players finish without duplicate votes or facts', () => {
  const rooms = Array.from({ length: 20 }, (_, roomIndex) => {
    let now = 1_000_000 + roomIndex * 100_000;
    const room = new GameRoom({ roomId: `load-${roomIndex + 1}`, factsProvider: () => catalog, now: () => now });
    const players = Array.from({ length: 8 }, (_, playerIndex) => room.join({ nickname: `R${roomIndex + 1} P${playerIndex + 1}` }));
    room.start(players[0].playerId);
    now += 3_000;
    room.sweep();
    for (let roundIndex = 0; roundIndex < 10; roundIndex += 1) {
      const roundId = room.state.game.currentRoundId;
      const verdict = room.state.game.currentFact.verdict;
      for (const player of players) room.answer(player.playerId, { roundId, answer: verdict });
      if (roundIndex < 9) {
        now += 1_800;
        room.sweep();
      }
    }
    return room;
  });

  for (const room of rooms) {
    assert.equal(room.phase, 'finished');
    assert.equal(room.state.game.history.length, 10);
    assert.equal(new Set(room.state.game.usedFactIds).size, 10);
    assert.equal(room.state.game.history.every((round) => round.answers.length === 8), true);
  }
});
