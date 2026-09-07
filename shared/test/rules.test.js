import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateScore,
  effectiveRoundLimit,
  findUnbeatableLeader,
  nextDifficulty,
  rankPlayers,
} from '../src/index.js';

test('score rewards speed and caps the streak bonus', () => {
  assert.equal(calculateScore({ correct: true, remainingMs: 30_000, totalMs: 30_000, newStreak: 1 }), 125);
  assert.equal(calculateScore({ correct: true, remainingMs: 15_000, totalMs: 30_000, newStreak: 3 }), 152);
  assert.equal(calculateScore({ correct: true, remainingMs: 30_000, totalMs: 30_000, newStreak: 99 }), 225);
  assert.equal(calculateScore({ correct: false, remainingMs: 30_000, totalMs: 30_000, newStreak: 1 }), 0);
});

test('community round limit is a complete multiple of player count', () => {
  assert.equal(effectiveRoundLimit(20, 3, 'community'), 18);
  assert.equal(effectiveRoundLimit(10, 8, 'community'), 8);
  assert.equal(effectiveRoundLimit(15, 3, 'classic'), 15);
});

test('ranking uses average correct response time after score', () => {
  const ranked = rankPlayers([
    { id: 'slow', score: 300, correctCount: 2, correctResponseMs: 10_000 },
    { id: 'fast', score: 300, correctCount: 2, correctResponseMs: 4_000 },
    { id: 'high', score: 301, correctCount: 1, correctResponseMs: 99_000 },
  ]);
  assert.deepEqual(ranked.map(({ id }) => id), ['high', 'fast', 'slow']);
});

test('early win requires a strict lead larger than all theoretical gains', () => {
  assert.equal(findUnbeatableLeader([{ id: 'a', score: 226 }, { id: 'b', score: 0 }], 1), 'a');
  assert.equal(findUnbeatableLeader([{ id: 'a', score: 225 }, { id: 'b', score: 0 }], 1), null);
  assert.equal(findUnbeatableLeader([{ id: 'a', score: 999 }], 10), null);
});

test('adaptive difficulty follows quintiles, advances after strong pairs, and never recedes', () => {
  assert.equal(nextDifficulty({ completedRounds: 0, totalRounds: 10 }), 1);
  assert.equal(nextDifficulty({ completedRounds: 2, totalRounds: 10, recentCorrectRate: 0.75, currentDifficulty: 1 }), 3);
  assert.equal(nextDifficulty({ completedRounds: 3, totalRounds: 10, recentCorrectRate: 0.2, currentDifficulty: 3 }), 3);
  assert.equal(nextDifficulty({ completedRounds: 8, totalRounds: 10, recentCorrectRate: 1, currentDifficulty: 4 }), 5);
});
