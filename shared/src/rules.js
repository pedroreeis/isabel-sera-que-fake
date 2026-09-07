import { MAX_PLAYERS, MIN_PLAYERS, ROOM_ID } from './contracts.js';

export const MAX_POINTS_PER_ROUND = 225;

export function calculateScoreBreakdown({ correct, remainingMs, totalMs, newStreak }) {
  if (!correct) return { base: 0, speedBonus: 0, streakBonus: 0, total: 0 };
  const safeTotal = Math.max(1, Number(totalMs) || 1);
  const safeRemaining = Math.min(safeTotal, Math.max(0, Number(remainingMs) || 0));
  const safeStreak = Math.max(1, Math.trunc(Number(newStreak) || 1));
  const speedBonus = Math.floor((25 * safeRemaining) / safeTotal);
  const streakBonus = 20 * Math.min(safeStreak - 1, 5);
  return { base: 100, speedBonus, streakBonus, total: 100 + speedBonus + streakBonus };
}

export function calculateScore(input) {
  return calculateScoreBreakdown(input).total;
}

export function effectiveRoundLimit(requestedLimit, playerCount, mode = 'classic') {
  const limit = Math.max(0, Math.trunc(Number(requestedLimit) || 0));
  if (mode !== 'community') return limit;
  const count = Math.max(1, Math.trunc(Number(playerCount) || 1));
  return Math.floor(limit / count) * count;
}

export function canStartGame({ mode, playerCount, roundLimit }) {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) return false;
  if (mode === 'community') return playerCount >= 2 && effectiveRoundLimit(roundLimit, playerCount, mode) > 0;
  if (playerCount === 1) return roundLimit === 10;
  return true;
}

export function averageCorrectResponseMs(player) {
  const count = Number(player.correctCount) || 0;
  if (count <= 0) return Number.POSITIVE_INFINITY;
  return (Number(player.correctResponseMs) || 0) / count;
}

export function rankPlayers(players) {
  return [...players].sort((left, right) => {
    const scoreDifference = (Number(right.score) || 0) - (Number(left.score) || 0);
    if (scoreDifference !== 0) return scoreDifference;
    const leftAverage = averageCorrectResponseMs(left);
    const rightAverage = averageCorrectResponseMs(right);
    if (leftAverage !== rightAverage) {
      if (!Number.isFinite(leftAverage)) return 1;
      if (!Number.isFinite(rightAverage)) return -1;
      return leftAverage - rightAverage;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

export function findUnbeatableLeader(players, remainingRounds) {
  if (players.length <= 1) return null;
  const ranked = rankPlayers(players);
  const leader = ranked[0];
  const maxRemaining = Math.max(0, Math.trunc(Number(remainingRounds) || 0)) * MAX_POINTS_PER_ROUND;
  return ranked.slice(1).every((player) => leader.score > player.score + maxRemaining) ? leader.id : null;
}

export function nextDifficulty({ completedRounds, totalRounds, recentCorrectRate = 0, currentDifficulty = 1 }) {
  const completed = Math.max(0, Math.trunc(Number(completedRounds) || 0));
  const total = Math.max(1, Math.trunc(Number(totalRounds) || 1));
  const baseDifficulty = Math.min(5, Math.floor((completed * 5) / total) + 1);
  const earnedAdvance = completed > 0
    && completed % 2 === 0
    && Math.max(0, Math.min(1, Number(recentCorrectRate) || 0)) >= 0.75;
  const candidate = Math.min(5, baseDifficulty + (earnedAdvance ? 1 : 0));
  const ceiling = Math.min(5, baseDifficulty + 1);
  return Math.max(1, Math.min(ceiling, Math.max(candidate, Math.trunc(currentDifficulty) || 1)));
}

export function chooseAdaptiveFact(facts, context, usedIds = new Set()) {
  const available = facts.filter((fact) => fact.active && fact.reviewStatus !== 'archived' && !usedIds.has(fact.id));
  if (available.length === 0) return null;
  const target = nextDifficulty(context);
  const selectedFacts = Array.isArray(context.selectedFacts) ? context.selectedFacts : [];
  const trueCount = selectedFacts.filter((fact) => fact.verdict).length;
  const falseCount = selectedFacts.length - trueCount;
  const categoryCounts = selectedFacts.reduce((counts, fact) => {
    counts[fact.category] = (counts[fact.category] || 0) + 1;
    return counts;
  }, {});
  const lastVerdict = selectedFacts.at(-1)?.verdict;
  return [...available].sort((left, right) => {
    const distance = Math.abs(left.difficulty - target) - Math.abs(right.difficulty - target);
    if (distance) return distance;
    const verdictPenalty = (fact) => {
      if (trueCount < falseCount) return fact.verdict ? 0 : 2;
      if (falseCount < trueCount) return fact.verdict ? 2 : 0;
      return fact.verdict === lastVerdict ? 1 : 0;
    };
    const verdictBalance = verdictPenalty(left) - verdictPenalty(right);
    if (verdictBalance) return verdictBalance;
    const categoryBalance = (categoryCounts[left.category] || 0) - (categoryCounts[right.category] || 0);
    return categoryBalance || left.id.localeCompare(right.id);
  })[0];
}

export function isFixedRoomId(roomId) {
  return roomId === ROOM_ID;
}
