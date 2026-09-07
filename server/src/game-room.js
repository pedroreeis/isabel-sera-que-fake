import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  MAX_PLAYERS,
  ROOM_ID,
  canStartGame,
  calculateScoreBreakdown,
  chooseAdaptiveFact,
  communityFactSchema,
  effectiveRoundLimit,
  findUnbeatableLeader,
  nicknameSchema,
  rankPlayers,
  roomSettingsSchema,
} from '@isabel/shared';
import { invariant } from './errors.js';

const HOST_TRANSFER_MS = 30_000;
const SEAT_EXPIRY_MS = 60_000;
const STALLED_CONTRIBUTION_MS = 60_000;
const COUNTDOWN_MS = 3_000;
const ROUND_TRANSITION_MS = 1_800;
const EMPTY_ROOM_RESET_MS = 30 * 60_000;

function tokenHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createReconnectToken() {
  return randomBytes(32).toString('base64url');
}

function initialState(now, roomId = ROOM_ID) {
  return {
    roomId,
    version: 0,
    phase: 'lobby',
    phaseId: randomUUID(),
    settings: { mode: 'classic', timerSeconds: 30, roundLimit: 10 },
    hostPlayerId: null,
    players: {},
    game: null,
    notice: null,
    createdAt: now,
    updatedAt: now,
    emptySince: null,
  };
}

function activeSeats(state) {
  return Object.values(state.players).filter((player) => player.seatActive);
}

function activeContestants(state) {
  if (!state.game) return [];
  return state.game.activePlayerIds
    .map((id) => state.players[id])
    .filter((player) => player && player.seatActive && !player.waitingForNextGame);
}

function rankingAverage(player) {
  return player.correctCount > 0 ? player.correctResponseMs / player.correctCount : Number.POSITIVE_INFINITY;
}

function sharesRank(left, right) {
  if (!left || !right || left.score !== right.score) return false;
  return rankingAverage(left) === rankingAverage(right);
}

function publicPlayer(player, state) {
  const contribution = state.phase === 'collecting' && state.game
    ? (state.game.currentBatchSubmissions[player.id] ? 'submitted' : 'writing')
    : state.phase === 'question' && state.game?.eligiblePlayerIds.includes(player.id)
      ? (state.game.answers[player.id] ? 'answered' : 'answering')
      : state.phase === 'question' && state.game?.currentFact?.authorId === player.id
        ? 'answered'
      : null;
  return {
    id: player.id,
    nickname: player.nickname,
    connected: player.connected,
    isHost: state.hostPlayerId === player.id,
    waitingForNextGame: player.waitingForNextGame,
    contributionStatus: contribution,
    hasAnswered: Boolean(state.phase === 'question'
      && (state.game?.answers[player.id] || state.game?.currentFact?.authorId === player.id)),
  };
}

export class GameRoom {
  constructor({
    roomId = ROOM_ID,
    snapshot = null,
    factsProvider = () => [],
    shownFactIdsProvider = () => [],
    markFactShown = () => {},
    resetShownFacts = () => {},
    now = () => Date.now(),
  } = {}) {
    this.now = now;
    this.factsProvider = factsProvider;
    this.shownFactIdsProvider = shownFactIdsProvider;
    this.markFactShown = markFactShown;
    this.resetShownFacts = resetShownFacts;
    this.roomId = roomId;
    this.state = snapshot ? structuredClone(snapshot) : initialState(this.now(), roomId);
    if (!this.state.phaseId) this.state.phaseId = randomUUID();
    if (this.state.game && !this.state.game.id) this.state.game.id = randomUUID();
    if (snapshot) {
      const restoredAt = this.now();
      for (const player of Object.values(this.state.players || {})) {
        if (!player.seatActive) continue;
        player.connected = false;
        player.disconnectedAt = restoredAt;
        player.seatExpiresAt = restoredAt + SEAT_EXPIRY_MS;
      }
      this.state.emptySince = restoredAt;
    }
    invariant(this.state.roomId === roomId, 'INVALID_ROOM', 'O snapshot pertence a outra sala');
  }

  serialize() {
    return structuredClone(this.state);
  }

  get version() {
    return this.state.version;
  }

  get phase() {
    return this.state.phase;
  }

  assertVersion(version, { allowZero = false } = {}) {
    if (allowZero && version === 0) return;
    invariant(version === this.state.version, 'STALE_VERSION', 'A sala mudou; atualize e tente novamente', 409, {
      expected: this.state.version,
      received: version,
    });
  }

  touch() {
    this.state.version += 1;
    this.state.updatedAt = this.now();
  }

  setPhase(phase) {
    this.state.phase = phase;
    this.state.phaseId = randomUUID();
  }

  assertContext({ gameId, phaseId }) {
    if (gameId != null) {
      invariant(gameId === this.state.game?.id, 'GAME_MISMATCH', 'Esse comando pertence a outra partida', 409);
    }
    if (phaseId != null) {
      invariant(phaseId === this.state.phaseId, 'PHASE_MISMATCH', 'A sala já avançou para outra etapa', 409);
    }
  }

  join({ nickname, reconnectToken }) {
    if (reconnectToken) {
      try {
        return this.reconnect(reconnectToken);
      } catch (error) {
        if (!['INVALID_RECONNECT_TOKEN', 'SEAT_EXPIRED'].includes(error.code)) throw error;
      }
    }
    const cleanNickname = nicknameSchema.parse(nickname);
    this.sweep();
    invariant(activeSeats(this.state).length < MAX_PLAYERS, 'ROOM_FULL', 'A sala já tem oito participantes', 409);
    invariant(
      !activeSeats(this.state).some((player) => player.nickname.localeCompare(cleanNickname, 'pt-BR', { sensitivity: 'base' }) === 0),
      'NICKNAME_TAKEN',
      'Esse nome já está em uso',
      409,
    );

    const rawToken = createReconnectToken();
    const id = randomUUID();
    const late = this.state.phase !== 'lobby';
    this.state.players[id] = {
      id,
      nickname: cleanNickname,
      reconnectTokenHash: tokenHash(rawToken),
      connected: true,
      seatActive: true,
      waitingForNextGame: late,
      joinedAt: this.now(),
      disconnectedAt: null,
      seatExpiresAt: null,
      score: 0,
      streak: 0,
      correctCount: 0,
      correctResponseMs: 0,
      bestStreak: 0,
      eligibleCount: 0,
      speedBonusTotal: 0,
      streakBonusTotal: 0,
    };
    if (!this.state.hostPlayerId) this.state.hostPlayerId = id;
    this.state.emptySince = null;
    this.touch();
    return { playerId: id, reconnectToken: rawToken, late };
  }

  reconnect(reconnectToken) {
    const hash = tokenHash(reconnectToken);
    const player = Object.values(this.state.players).find(
      (candidate) => candidate.seatActive && candidate.reconnectTokenHash === hash,
    );
    invariant(player, 'INVALID_RECONNECT_TOKEN', 'Não foi possível recuperar esse assento', 401);
    invariant(!player.seatExpiresAt || player.seatExpiresAt > this.now(), 'SEAT_EXPIRED', 'O tempo de reconexão terminou', 410);
    const rawToken = createReconnectToken();
    player.reconnectTokenHash = tokenHash(rawToken);
    player.connected = true;
    player.disconnectedAt = null;
    player.seatExpiresAt = null;
    this.state.emptySince = null;
    this.touch();
    return { playerId: player.id, reconnectToken: rawToken, late: player.waitingForNextGame };
  }

  disconnect(playerId) {
    const player = this.state.players[playerId];
    if (!player?.seatActive || !player.connected) return false;
    const now = this.now();
    player.connected = false;
    player.disconnectedAt = now;
    player.seatExpiresAt = now + SEAT_EXPIRY_MS;
    this.touch();
    return true;
  }

  leave(playerId) {
    const player = this.requirePlayer(playerId);
    player.connected = false;
    player.seatActive = false;
    player.seatExpiresAt = this.now();
    if (this.state.game) {
      if (this.state.phase !== 'finished') {
        this.state.game.activePlayerIds = this.state.game.activePlayerIds.filter((id) => id !== playerId);
      }
    } else {
      delete this.state.players[playerId];
    }
    this.transferHostIfNeeded(true);
    if (this.state.game?.mode === 'community' && this.state.phase !== 'finished') {
      this.afterContestantRemoved();
    } else if (this.state.phase === 'question' && this.allEligibleAnswered()) {
      this.completeRound('all_answered');
    }
    this.touch();
  }

  requirePlayer(playerId) {
    const player = this.state.players[playerId];
    invariant(player?.seatActive, 'PLAYER_NOT_FOUND', 'Participante não encontrado', 404);
    return player;
  }

  getRequestReceipt(playerId, requestId) {
    const receipts = this.state.players[playerId]?.requestReceipts;
    return Array.isArray(receipts) ? receipts.find((entry) => entry.requestId === requestId)?.response : null;
  }

  saveRequestReceipt(playerId, requestId, response) {
    const player = this.state.players[playerId];
    if (!player) return;
    if (!Array.isArray(player.requestReceipts)) player.requestReceipts = [];
    player.requestReceipts.push({ requestId, response });
    if (player.requestReceipts.length > 100) player.requestReceipts.splice(0, player.requestReceipts.length - 100);
  }

  requireHost(playerId) {
    this.requirePlayer(playerId);
    invariant(this.state.hostPlayerId === playerId, 'HOST_ONLY', 'Apenas o anfitrião pode fazer isso', 403);
  }

  updateSettings(playerId, input) {
    this.requireHost(playerId);
    invariant(this.state.phase === 'lobby', 'GAME_ALREADY_STARTED', 'As opções só podem mudar no lobby', 409);
    this.state.settings = roomSettingsSchema.parse({
      mode: input.mode,
      timerSeconds: input.timerSeconds,
      roundLimit: input.roundLimit,
    });
    this.state.notice = null;
    this.touch();
  }

  start(playerId) {
    this.requireHost(playerId);
    invariant(this.state.phase === 'lobby', 'GAME_ALREADY_STARTED', 'A partida já começou', 409);
    const contestants = activeSeats(this.state).filter((player) => player.connected && !player.waitingForNextGame);
    const { mode, roundLimit } = this.state.settings;
    invariant(
      canStartGame({ mode, playerCount: contestants.length, roundLimit }),
      'CANNOT_START',
      mode === 'community'
        ? 'O modo comunidade precisa de pelo menos duas pessoas'
        : 'No modo solo, a partida clássica deve ter dez rodadas',
      409,
    );

    for (const player of contestants) {
      player.score = 0;
      player.streak = 0;
      player.correctCount = 0;
      player.correctResponseMs = 0;
      player.bestStreak = 0;
      player.eligibleCount = 0;
      player.speedBonusTotal = 0;
      player.streakBonusTotal = 0;
    }
    this.state.notice = null;
    const totalRounds = effectiveRoundLimit(roundLimit, contestants.length, mode);
    this.state.game = {
      id: randomUUID(),
      mode,
      requestedRoundLimit: roundLimit,
      totalRounds,
      activePlayerIds: contestants.map(({ id }) => id),
      participantIds: contestants.map(({ id }) => id),
      currentRoundIndex: 0,
      currentFact: null,
      currentRoundId: null,
      roundStartedAt: null,
      deadlineAt: null,
      eligiblePlayerIds: [],
      answers: {},
      history: [],
      usedFactIds: [],
      communityQueue: [],
      currentBatchSubmissions: {},
      batchNumber: 0,
      difficultyLevel: 1,
      requiredFactsPerPlayer: 0,
      collectingSince: null,
      transitionDeadlineAt: null,
      startedAt: this.now(),
      finishedAt: null,
      finishReason: null,
    };

    if (mode === 'community') this.beginCommunityCollection();
    else this.beginCountdown();
    this.touch();
  }

  beginCountdown() {
    const game = this.state.game;
    if (!game) return;
    game.transitionDeadlineAt = this.now() + COUNTDOWN_MS;
    this.setPhase('countdown');
  }

  communityFactsRequired() {
    const game = this.state.game;
    const playerCount = activeContestants(this.state).length;
    if (!game || playerCount < 1) return 0;
    const remaining = Math.max(0, game.totalRounds - game.history.length - game.communityQueue.length);
    return Math.max(1, Math.min(2, Math.ceil(remaining / playerCount)));
  }

  beginCommunityCollection() {
    const game = this.state.game;
    game.batchNumber += 1;
    game.currentBatchSubmissions = {};
    game.collectingSince = this.now();
    game.transitionDeadlineAt = null;
    game.requiredFactsPerPlayer = this.communityFactsRequired();
    this.setPhase('collecting');
  }

  submitCommunityFacts(playerId, input) {
    const player = this.requirePlayer(playerId);
    const game = this.state.game;
    invariant(game?.mode === 'community' && this.state.phase === 'collecting', 'NOT_COLLECTING', 'A sala não está coletando frases agora', 409);
    invariant(game.activePlayerIds.includes(playerId) && !player.waitingForNextGame, 'NOT_A_CONTESTANT', 'Você entra apenas na próxima partida', 403);
    invariant(!game.currentBatchSubmissions[playerId], 'ALREADY_SUBMITTED', 'Você já enviou seus fatos deste lote', 409);
    const required = game.requiredFactsPerPlayer || this.communityFactsRequired();
    invariant(Array.isArray(input?.facts) && input.facts.length === required, 'FACT_COUNT_REQUIRED', `Envie exatamente ${required} ${required === 1 ? 'fato' : 'fatos'}`);
    const facts = input.facts.map((fact) => ({
      ...communityFactSchema.parse(fact),
      id: `community:${game.batchNumber}:${playerId}:${randomUUID()}`,
      authorId: playerId,
    }));
    if (facts.length > 1) {
      invariant(
        facts[0].statement.localeCompare(facts[1].statement, 'pt-BR', { sensitivity: 'base' }) !== 0,
        'DUPLICATE_COMMUNITY_FACT',
        'As duas frases precisam ser diferentes',
      );
    }
    game.currentBatchSubmissions[playerId] = facts;
    if (this.everyContestantContributed()) this.finishCommunityCollection();
    this.touch();
  }

  everyContestantContributed() {
    const game = this.state.game;
    return activeContestants(this.state).every(
      (player) => game.currentBatchSubmissions[player.id]?.length >= game.requiredFactsPerPlayer,
    );
  }

  finishCommunityCollection() {
    const game = this.state.game;
    const ids = game.activePlayerIds.filter((id) => this.state.players[id]?.seatActive);
    let lastAuthorId = game.communityQueue.at(-1)?.authorId ?? game.history.at(-1)?.fact?.authorId ?? null;
    for (let factIndex = 0; factIndex < game.requiredFactsPerPlayer; factIndex += 1) {
      const offset = ids.length ? (game.batchNumber + factIndex) % ids.length : 0;
      let cycleIds = ids.length ? [...ids.slice(offset), ...ids.slice(0, offset)] : [];
      if (cycleIds.length > 1 && cycleIds[0] === lastAuthorId) {
        cycleIds = [...cycleIds.slice(1), cycleIds[0]];
      }
      for (const id of cycleIds) {
        const fact = game.currentBatchSubmissions[id]?.[factIndex];
        if (fact) {
          game.communityQueue.push(fact);
          lastAuthorId = id;
        }
      }
    }
    game.currentBatchSubmissions = {};
    game.collectingSince = null;
    game.requiredFactsPerPlayer = 0;
    this.beginCountdown();
  }

  openNextQuestion() {
    const game = this.state.game;
    if (!game || game.history.length >= game.totalRounds) {
      this.finish('round_limit');
      return;
    }
    let fact;
    if (game.mode === 'classic') {
      const catalog = this.factsProvider();
      const playableIds = new Set(
        catalog
          .filter((candidate) => candidate.active && candidate.reviewStatus !== 'archived')
          .map((candidate) => candidate.id),
      );
      let shownIds = new Set(
        this.shownFactIdsProvider().filter((id) => playableIds.has(id)),
      );
      if (playableIds.size > 0 && shownIds.size >= playableIds.size) {
        this.resetShownFacts();
        shownIds = new Set();
      }
      const recentRounds = game.history.slice(-2);
      const recentAnswers = recentRounds.flatMap((round) => round.answers.filter((answer) => !answer.excluded));
      const recentCorrect = recentAnswers.filter((answer) => answer.correct).length;
      const selectionContext = {
        completedRounds: game.history.length,
        totalRounds: game.totalRounds,
        recentCorrectRate: recentAnswers.length ? recentCorrect / recentAnswers.length : 0,
        currentDifficulty: game.difficultyLevel,
        selectedFacts: game.history.map((round) => round.fact),
      };
      const unavailableIds = new Set([...shownIds, ...game.usedFactIds]);
      fact = chooseAdaptiveFact(catalog, selectionContext, unavailableIds);
      if (!fact && shownIds.size > 0) {
        this.resetShownFacts();
        fact = chooseAdaptiveFact(catalog, selectionContext, new Set(game.usedFactIds));
      }
      if (!fact) {
        this.finish('content_exhausted');
        return;
      }
      this.markFactShown(fact.id);
      game.difficultyLevel = fact.difficulty;
    } else {
      fact = game.communityQueue.shift();
      if (!fact) {
        this.beginCommunityCollection();
        return;
      }
    }

    const now = this.now();
    game.currentFact = fact;
    game.currentRoundId = randomUUID();
    game.roundStartedAt = now;
    game.deadlineAt = now + this.state.settings.timerSeconds * 1000;
    game.currentRoundIndex = game.history.length;
    game.answers = {};
    game.transitionDeadlineAt = null;
    game.eligiblePlayerIds = game.activePlayerIds.filter((id) => {
      const candidate = this.state.players[id];
      return candidate?.seatActive && !candidate.waitingForNextGame && id !== fact.authorId;
    });
    game.usedFactIds.push(fact.id);
    this.setPhase('question');
  }

  answer(playerId, input) {
    const player = this.requirePlayer(playerId);
    const game = this.state.game;
    invariant(this.state.phase === 'question' && game?.currentFact, 'NO_OPEN_ROUND', 'Não há uma rodada aberta', 409);
    invariant(game.currentRoundId === input?.roundId, 'ROUND_MISMATCH', 'Essa resposta é de outra rodada', 409);
    invariant(game.eligiblePlayerIds.includes(playerId) && !player.waitingForNextGame, 'ANSWER_NOT_ALLOWED', 'Você não responde nesta rodada', 403);
    invariant(!game.answers[playerId], 'ALREADY_ANSWERED', 'Sua resposta já foi registrada', 409);
    invariant(this.now() < game.deadlineAt, 'ROUND_CLOSED', 'O tempo desta rodada acabou', 409);
    invariant(typeof input.answer === 'boolean', 'INVALID_ANSWER', 'Escolha verdadeiro ou falso');
    game.answers[playerId] = { answer: input.answer, answeredAt: this.now() };
    if (this.allEligibleAnswered()) this.completeRound('all_answered');
    this.touch();
  }

  allEligibleAnswered() {
    const game = this.state.game;
    return Boolean(game) && game.eligiblePlayerIds.every((id) => !this.state.players[id]?.seatActive || game.answers[id]);
  }

  completeRound(reason = 'timeout') {
    const game = this.state.game;
    if (!game?.currentFact) return;
    const totalMs = this.state.settings.timerSeconds * 1000;
    const answers = [];
    for (const playerId of game.activePlayerIds) {
      const player = this.state.players[playerId];
      if (!player) continue;
      if (!game.eligiblePlayerIds.includes(playerId)) {
        answers.push({ playerId, answer: null, correct: null, responseMs: null, points: 0, speedBonus: 0, streakBonus: 0, excluded: true });
        continue;
      }
      const submitted = game.answers[playerId];
      player.eligibleCount += 1;
      const correct = Boolean(submitted && submitted.answer === game.currentFact.verdict);
      const responseMs = submitted ? Math.max(0, submitted.answeredAt - game.roundStartedAt) : null;
      if (correct) {
        player.streak += 1;
        player.bestStreak = Math.max(player.bestStreak ?? 0, player.streak);
        const breakdown = calculateScoreBreakdown({
          correct: true,
          remainingMs: Math.max(0, game.deadlineAt - submitted.answeredAt),
          totalMs,
          newStreak: player.streak,
        });
        const points = breakdown.total;
        player.score += points;
        player.speedBonusTotal = (player.speedBonusTotal ?? 0) + breakdown.speedBonus;
        player.streakBonusTotal = (player.streakBonusTotal ?? 0) + breakdown.streakBonus;
        player.correctCount += 1;
        player.correctResponseMs += responseMs;
        answers.push({
          playerId,
          answer: submitted.answer,
          correct: true,
          responseMs,
          points,
          speedBonus: breakdown.speedBonus,
          streakBonus: breakdown.streakBonus,
          excluded: false,
        });
      } else {
        player.streak = 0;
        answers.push({
          playerId,
          answer: submitted?.answer ?? null,
          correct: false,
          responseMs,
          points: 0,
          speedBonus: 0,
          streakBonus: 0,
          excluded: false,
        });
      }
    }
    game.history.push({
      id: game.currentRoundId,
      number: game.history.length + 1,
      fact: game.currentFact,
      answers,
      closedBy: reason,
    });
    game.currentFact = null;
    game.currentRoundId = null;
    game.roundStartedAt = null;
    game.deadlineAt = null;
    game.eligiblePlayerIds = [];
    game.answers = {};

    if (game.history.length >= game.totalRounds) {
      this.finish('round_limit');
      return;
    }
    const contestants = activeContestants(this.state);
    const earlyWinner = contestants.length > 1
      ? findUnbeatableLeader(contestants, game.totalRounds - game.history.length)
      : null;
    if (earlyWinner) {
      this.finish('unreachable_lead');
      return;
    }
    game.transitionDeadlineAt = this.now() + ROUND_TRANSITION_MS;
    this.setPhase('transition');
  }

  finish(reason) {
    if (!this.state.game) return;
    this.setPhase('finished');
    this.state.game.finishedAt = this.now();
    this.state.game.finishReason = reason;
    this.state.game.currentFact = null;
    this.state.game.deadlineAt = null;
    this.state.game.eligiblePlayerIds = [];
    this.state.game.answers = {};
    this.state.game.transitionDeadlineAt = null;
  }

  restart(playerId) {
    this.requireHost(playerId);
    invariant(this.state.phase === 'finished', 'GAME_NOT_FINISHED', 'A partida ainda não terminou', 409);
    for (const [id, player] of Object.entries(this.state.players)) {
      if (!player.seatActive) {
        delete this.state.players[id];
        continue;
      }
      player.waitingForNextGame = false;
      player.score = 0;
      player.streak = 0;
      player.correctCount = 0;
      player.correctResponseMs = 0;
      player.bestStreak = 0;
      player.eligibleCount = 0;
      player.speedBonusTotal = 0;
      player.streakBonusTotal = 0;
    }
    this.state.game = null;
    this.state.notice = null;
    this.setPhase('lobby');
    this.touch();
  }

  removeStalled(playerId, targetId) {
    this.requireHost(playerId);
    invariant(this.state.phase === 'collecting' && this.state.game?.mode === 'community', 'NOT_COLLECTING', 'A sala não está aguardando contribuições', 409);
    invariant(playerId !== targetId, 'CANNOT_REMOVE_SELF', 'Transfira o comando antes de sair');
    const target = this.requirePlayer(targetId);
    invariant(this.state.game.activePlayerIds.includes(targetId), 'NOT_A_CONTESTANT', 'Essa pessoa não participa da rodada', 409);
    invariant(!this.state.game.currentBatchSubmissions[targetId], 'PLAYER_NOT_STALLED', 'Essa pessoa já enviou suas frases', 409);
    invariant(
      this.now() - this.state.game.collectingSince >= STALLED_CONTRIBUTION_MS,
      'STALL_GRACE_PERIOD',
      'Aguarde 60 segundos antes de remover quem não enviou',
      409,
    );
    target.connected = false;
    target.seatActive = false;
    this.state.game.activePlayerIds = this.state.game.activePlayerIds.filter((id) => id !== targetId);
    delete this.state.game.currentBatchSubmissions[targetId];
    this.afterContestantRemoved();
    this.touch();
  }

  afterContestantRemoved() {
    const game = this.state.game;
    if (!game) return;
    const count = activeContestants(this.state).length;
    if (count === 0) {
      this.cancelCommunityGame();
      return;
    }
    if (game.mode === 'community') {
      if (count < 2) {
        this.cancelCommunityGame();
        return;
      }
      const remainingBudget = Math.max(0, game.requestedRoundLimit - game.history.length);
      game.totalRounds = game.history.length + Math.floor(remainingBudget / count) * count;
      if (game.totalRounds <= game.history.length) {
        this.finish('round_limit');
        return;
      }
      game.requiredFactsPerPlayer = this.communityFactsRequired();
      if (this.state.phase === 'collecting' && this.everyContestantContributed()) this.finishCommunityCollection();
    }
  }

  cancelCommunityGame() {
    for (const player of activeSeats(this.state)) {
      player.waitingForNextGame = false;
      player.score = 0;
      player.streak = 0;
      player.correctCount = 0;
      player.correctResponseMs = 0;
      player.bestStreak = 0;
      player.eligibleCount = 0;
      player.speedBonusTotal = 0;
      player.streakBonusTotal = 0;
    }
    this.state.game = null;
    this.state.notice = {
      code: 'COMMUNITY_CANCELLED',
      message: 'A partida foi cancelada porque o modo Fatos da Galera precisa de pelo menos duas pessoas.',
    };
    this.setPhase('lobby');
  }

  transferHostIfNeeded(force = false) {
    const host = this.state.players[this.state.hostPlayerId];
    const hostUnavailable = !host?.seatActive
      || (!host.connected && (force || this.now() - host.disconnectedAt >= HOST_TRANSFER_MS));
    if (!hostUnavailable) return false;
    const successor = activeSeats(this.state)
      .filter((player) => player.connected && player.id !== host?.id)
      .sort((left, right) => left.joinedAt - right.joinedAt)[0]
      ?? activeSeats(this.state).filter((player) => player.id !== host?.id).sort((left, right) => left.joinedAt - right.joinedAt)[0];
    this.state.hostPlayerId = successor?.id ?? null;
    return true;
  }

  sweep() {
    let changed = this.transferHostIfNeeded(false);
    const now = this.now();
    for (const player of Object.values(this.state.players)) {
      if (player.seatActive && !player.connected && player.seatExpiresAt && player.seatExpiresAt <= now) {
        player.seatActive = false;
        if (this.state.game && this.state.phase !== 'finished') {
          this.state.game.activePlayerIds = this.state.game.activePlayerIds.filter((id) => id !== player.id);
        }
        else delete this.state.players[player.id];
        changed = true;
      }
    }
    if (changed) {
      this.transferHostIfNeeded(true);
      if (this.state.phase === 'question' && this.allEligibleAnswered()) this.completeRound('players_departed');
      if (this.state.phase === 'collecting') this.afterContestantRemoved();
    }
    if (['countdown', 'transition'].includes(this.state.phase)
      && this.state.game?.transitionDeadlineAt <= now) {
      this.openNextQuestion();
      changed = true;
    }
    if (this.state.phase === 'question' && this.state.game.deadlineAt <= now) {
      this.completeRound('timeout');
      changed = true;
    }
    const hasConnectedPlayer = activeSeats(this.state).some((player) => player.connected);
    if (hasConnectedPlayer && this.state.emptySince) {
      this.state.emptySince = null;
      changed = true;
    } else if (!hasConnectedPlayer && !this.state.emptySince) {
      this.state.emptySince = now;
      changed = true;
    } else if (!hasConnectedPlayer && now - this.state.emptySince >= EMPTY_ROOM_RESET_MS) {
      const nextVersion = this.state.version + 1;
      this.state = initialState(now, this.roomId);
      this.state.version = nextVersion;
      return true;
    }
    if (changed) this.touch();
    return changed;
  }

  project(playerId = null) {
    const now = this.now();
    const game = this.state.game;
    const self = playerId ? this.state.players[playerId] : null;
    const currentEligible = Boolean(self && game?.eligiblePlayerIds.includes(playerId));
    const hasAnswered = Boolean(game?.answers[playerId]);
    const playerCount = game ? activeContestants(this.state).length : activeSeats(this.state).length;
    const publicPhase = {
      lobby: 'LOBBY',
      collecting: game?.history.length ? 'FEEDING_REFILL' : 'FEEDING_INITIAL',
      countdown: 'COUNTDOWN',
      question: 'ROUND_OPEN',
      transition: 'ROUND_CLOSED',
      finished: 'FINISHED',
    }[this.state.phase] ?? 'WAITING';
    return {
      roomId: this.roomId,
      version: this.state.version,
      gameId: game?.id ?? null,
      phaseId: this.state.phaseId,
      serverNow: now,
      phase: publicPhase,
      settings: {
        ...this.state.settings,
        effectiveRoundLimit: game?.totalRounds
          ?? effectiveRoundLimit(this.state.settings.roundLimit, playerCount, this.state.settings.mode),
      },
      hostPlayerId: this.state.hostPlayerId,
      players: activeSeats(this.state).map((player) => publicPlayer(player, this.state)),
      capacity: { used: activeSeats(this.state).length, max: MAX_PLAYERS },
      notice: this.state.notice ?? null,
      game: game
        ? {
            roundNumber: Math.min(game.history.length + 1, game.totalRounds),
            totalRounds: game.totalRounds,
            deadlineAt: this.state.phase === 'question' ? game.deadlineAt : null,
            answeredCount: this.state.phase === 'question' ? Object.keys(game.answers).length : 0,
            eligibleCount: this.state.phase === 'question' ? game.eligiblePlayerIds.length : 0,
            waitingReason: this.state.phase === 'collecting' ? 'community_facts' : null,
            requiredFactsPerPlayer: this.state.phase === 'collecting' ? game.requiredFactsPerPlayer : null,
            submittedPlayerIds: this.state.phase === 'collecting'
              ? Object.keys(game.currentBatchSubmissions)
              : [],
            stalledRemovalAt: this.state.phase === 'collecting'
              ? game.collectingSince + STALLED_CONTRIBUTION_MS
              : null,
            canRemoveStalled: this.state.phase === 'collecting'
              && this.state.hostPlayerId === playerId
              && now >= game.collectingSince + STALLED_CONTRIBUTION_MS,
            currentRound: this.state.phase === 'question' && game.currentFact
              ? {
                  id: game.currentRoundId,
                  number: game.history.length + 1,
                  total: game.totalRounds,
                  statement: game.currentFact.statement,
                  category: game.currentFact.category,
                  deadlineAt: game.deadlineAt,
                  durationMs: this.state.settings.timerSeconds * 1000,
                }
              : null,
          }
        : null,
      self: self
        ? {
            playerId: self.id,
            canAnswer: this.state.phase === 'question' && currentEligible && !hasAnswered,
            hasAnswered,
            isAuthor: Boolean(game?.currentFact?.authorId === self.id),
            submittedFactsCount: game?.currentBatchSubmissions[self.id]?.length ?? 0,
            submittedFacts: Boolean(game?.currentBatchSubmissions[self.id]),
            requiredFacts: this.state.phase === 'collecting' ? game.requiredFactsPerPlayer : 0,
          }
        : null,
    };
  }

  roundProjection(playerId = null) {
    const game = this.state.game;
    if (this.state.phase !== 'question' || !game?.currentFact) return null;
    const hasAnswered = Boolean(game.answers[playerId]);
    const isAuthor = game.currentFact.authorId === playerId;
    return {
      roomId: this.roomId,
      version: this.state.version,
      gameId: game.id,
      phaseId: this.state.phaseId,
      serverNow: this.now(),
      round: {
        id: game.currentRoundId,
        number: game.history.length + 1,
        total: game.totalRounds,
        statement: game.currentFact.statement,
        category: game.currentFact.category,
        deadlineAt: game.deadlineAt,
        durationMs: this.state.settings.timerSeconds * 1000,
        canAnswer: game.eligiblePlayerIds.includes(playerId) && !hasAnswered,
        hasAnswered,
        isAuthor,
      },
    };
  }

  finalProjection() {
    const game = this.state.game;
    if (this.state.phase !== 'finished' || !game) return null;
    const contestants = (game.participantIds ?? game.activePlayerIds)
      .map((id) => this.state.players[id])
      .filter(Boolean);
    const ranked = rankPlayers(contestants);
    let lastAssignedRank = 1;
    const leaderboard = ranked.map((player, index) => {
      const previous = ranked[index - 1];
      const rank = index > 0 && !sharesRank(player, previous) ? index + 1 : lastAssignedRank;
      lastAssignedRank = rank;
      return {
        rank,
        playerId: player.id,
        nickname: player.nickname,
        score: player.score,
        correctCount: player.correctCount,
        eligibleCount: player.eligibleCount ?? 0,
        bestStreak: player.bestStreak ?? 0,
        speedBonusTotal: player.speedBonusTotal ?? 0,
        streakBonusTotal: player.streakBonusTotal ?? 0,
        averageCorrectResponseMs: player.correctCount
          ? Math.round(player.correctResponseMs / player.correctCount)
          : null,
        dnf: !player.seatActive,
      };
    });
    return {
      roomId: this.roomId,
      version: this.state.version,
      gameId: game.id,
      phaseId: this.state.phaseId,
      serverNow: this.now(),
      reason: game.finishReason,
      leaderboard,
      summaryByPlayer: Object.fromEntries(ranked.map((player) => [player.id, {
        score: player.score,
        correctCount: player.correctCount,
        eligibleCount: player.eligibleCount ?? 0,
        bestStreak: player.bestStreak ?? 0,
        speedBonusTotal: player.speedBonusTotal ?? 0,
        streakBonusTotal: player.streakBonusTotal ?? 0,
        averageCorrectResponseMs: player.correctCount
          ? Math.round(player.correctResponseMs / player.correctCount)
          : null,
      }])),
      rounds: game.history.map((round) => ({
        id: round.id,
        number: round.number,
        statement: round.fact.statement,
        verdict: round.fact.verdict,
        explanation: round.fact.explanation,
        correction: round.fact.correction ?? null,
        category: round.fact.category,
        sources: round.fact.sources,
        authorNickname: round.fact.authorId ? this.state.players[round.fact.authorId]?.nickname ?? null : null,
        answers: round.answers.map(({ playerId, answer, correct, responseMs, points, speedBonus, streakBonus, excluded }) => ({
          playerId,
          nickname: this.state.players[playerId]?.nickname ?? 'Jogador',
          answer,
          correct,
          responseMs,
          points,
          speedBonus: speedBonus ?? 0,
          streakBonus: streakBonus ?? 0,
          ...(excluded ? { excluded: true, isAuthor: true } : { isAuthor: false }),
        })),
      })),
    };
  }
}

export const timingRules = Object.freeze({
  HOST_TRANSFER_MS,
  SEAT_EXPIRY_MS,
  STALLED_CONTRIBUTION_MS,
  COUNTDOWN_MS,
  ROUND_TRANSITION_MS,
  EMPTY_ROOM_RESET_MS,
});
