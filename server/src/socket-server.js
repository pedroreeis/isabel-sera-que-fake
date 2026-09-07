import { z } from 'zod';
import {
  ROOM_ID,
  answerPayloadSchema,
  clientEnvelopeSchema,
  errorAck,
  joinPayloadSchema,
  removePlayerPayloadSchema,
  roomSettingsSchema,
  socketEvents,
  successAck,
} from '@isabel/shared';
import { GameRoom } from './game-room.js';
import { AppError, serializeError } from './errors.js';

const reconnectPayloadSchema = z.object({ reconnectToken: z.string().min(20).max(256) }).strict();
const communityBatchSchema = z.object({ facts: z.array(z.unknown()).min(1).max(2) }).strict();
const emptyPayloadSchema = z.object({}).strict().default({});
const settingsPayloadSchema = roomSettingsSchema.extend({ effectiveRoundLimit: z.number().optional() }).strict();

export class GameCoordinator {
  constructor({ io, database, now = () => Date.now(), sweepIntervalMs = 250 }) {
    this.io = io;
    this.database = database;
    const mainRoom = new GameRoom({
      roomId: ROOM_ID,
      snapshot: database.loadRoom(ROOM_ID),
      factsProvider: () => database.getPlayableFacts(),
      now,
    });
    this.rooms = new Map([[ROOM_ID, mainRoom]]);
    this.room.sweep();
    this.persist();
    this.lastHostPlayerId = this.room.state.hostPlayerId;
    this.lastPhaseId = this.room.state.phaseId;
    this.lastContributionSignature = '';
    this.lastVoteSignature = '';
    this.sweepTimer = setInterval(() => {
      if (this.room.sweep()) {
        this.persist();
        this.broadcast();
      }
    }, sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  get room() {
    return this.rooms.get(ROOM_ID);
  }

  close() {
    clearInterval(this.sweepTimer);
    this.persist();
  }

  persist() {
    this.database.saveRoom(ROOM_ID, this.room.serialize());
  }

  bind(io = this.io) {
    io.on('connection', (socket) => this.bindSocket(socket));
    return this;
  }

  bindSocket(socket) {
    socket.data.requestCache = new Map();
    socket.data.eventWindow = { startedAt: Date.now(), count: 0 };
    socket.use((_packet, next) => {
      const window = socket.data.eventWindow;
      if (Date.now() - window.startedAt >= 10_000) {
        window.startedAt = Date.now();
        window.count = 0;
      }
      window.count += 1;
      if (window.count > 60) return next(new Error('RATE_LIMITED'));
      return next();
    });

    this.on(socket, socketEvents.inbound.JOIN, joinPayloadSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version, { allowZero: true });
      const result = this.room.join(payload);
      this.attachPlayer(socket, result.playerId);
      return {
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
        snapshot: this.room.project(result.playerId),
      };
    }, { playerRequired: false });

    this.on(socket, socketEvents.inbound.RECONNECT, reconnectPayloadSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version, { allowZero: true });
      const result = this.room.reconnect(payload.reconnectToken);
      this.attachPlayer(socket, result.playerId);
      return {
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
        snapshot: this.room.project(result.playerId),
      };
    }, { playerRequired: false });

    this.on(socket, socketEvents.inbound.UPDATE_SETTINGS, settingsPayloadSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.updateSettings(socket.data.playerId, payload);
    });

    this.on(socket, socketEvents.inbound.START, emptyPayloadSchema, (_payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.start(socket.data.playerId);
    });

    this.on(socket, socketEvents.inbound.SUBMIT_COMMUNITY_FACTS, communityBatchSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.submitCommunityFacts(socket.data.playerId, payload);
    });

    this.on(socket, socketEvents.inbound.ANSWER, answerPayloadSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.answer(socket.data.playerId, payload);
    });

    this.on(socket, socketEvents.inbound.REMOVE_STALLED, removePlayerPayloadSchema, (payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.removeStalled(socket.data.playerId, payload.playerId);
    });

    this.on(socket, socketEvents.inbound.LEAVE, emptyPayloadSchema, (_payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.leave(socket.data.playerId);
      socket.data.superseded = true;
      socket.leave(ROOM_ID);
      socket.data.playerId = null;
    }, { validateContext: false });

    this.on(socket, socketEvents.inbound.RESTART, emptyPayloadSchema, (_payload, envelope) => {
      this.room.assertVersion(envelope.version);
      this.room.restart(socket.data.playerId);
    });

    this.on(socket, socketEvents.inbound.REQUEST_STATE, emptyPayloadSchema, () => {
      this.sendState(socket);
      return { snapshot: this.room.project(socket.data.playerId) };
    }, { validateContext: false });

    socket.on('disconnect', () => {
      if (socket.data.playerId && !socket.data.superseded && this.room.disconnect(socket.data.playerId)) {
        this.persist();
        this.broadcast();
      }
    });
  }

  on(socket, eventName, payloadSchema, handler, { playerRequired = true, validateContext = true } = {}) {
    socket.on(eventName, (rawEnvelope, callback = () => {}) => {
      let requestId = typeof rawEnvelope?.requestId === 'string' ? rawEnvelope.requestId : 'unknown';
      try {
        const envelope = clientEnvelopeSchema.parse(rawEnvelope);
        requestId = envelope.requestId;
        const cached = socket.data.requestCache.get(requestId);
        if (cached) {
          callback(cached);
          return;
        }
        const persisted = playerRequired && socket.data.playerId
          ? this.room.getRequestReceipt(socket.data.playerId, requestId)
          : null;
        if (persisted) {
          this.cacheResponse(socket, requestId, persisted);
          callback(persisted);
          return;
        }
        if (playerRequired && !socket.data.playerId) {
          throw new AppError('AUTH_REQUIRED', 'Entre na sala antes de continuar', 401);
        }
        if (playerRequired && validateContext) this.room.assertContext(envelope);
        const payload = payloadSchema.parse(envelope.payload ?? {});
        const data = handler(payload, envelope);
        const response = successAck(requestId, this.room.version, data);
        this.cacheResponse(socket, requestId, response);
        if (playerRequired && socket.data.playerId) this.room.saveRequestReceipt(socket.data.playerId, requestId, response);
        this.persist();
        callback(response);
        this.broadcast();
      } catch (error) {
        const serialized = serializeError(error);
        const response = errorAck(requestId, this.room.version, serialized.code, serialized.message, serialized.details);
        this.cacheResponse(socket, requestId, response);
        if (playerRequired && socket.data.playerId && requestId !== 'unknown') {
          this.room.saveRequestReceipt(socket.data.playerId, requestId, response);
          this.persist();
        }
        callback(response);
        socket.emit(socketEvents.outbound.ERROR, {
          requestId,
          version: this.room.version,
          ...response.error,
        });
      }
    });
  }

  cacheResponse(socket, requestId, response) {
    socket.data.requestCache.set(requestId, response);
    if (socket.data.requestCache.size > 200) {
      const first = socket.data.requestCache.keys().next().value;
      socket.data.requestCache.delete(first);
    }
  }

  attachPlayer(socket, playerId) {
    for (const candidate of this.io.sockets.sockets.values()) {
      if (candidate.id !== socket.id && candidate.data.playerId === playerId) {
        candidate.data.superseded = true;
        candidate.disconnect(true);
      }
    }
    socket.data.playerId = playerId;
    socket.data.superseded = false;
    socket.join(ROOM_ID);
  }

  sendState(socket) {
    socket.emit(socketEvents.outbound.SNAPSHOT, this.room.project(socket.data.playerId));
    const round = this.room.roundProjection(socket.data.playerId);
    if (round) socket.emit(socketEvents.outbound.ROUND_OPENED, round);
    const final = this.room.finalProjection();
    if (final) socket.emit(socketEvents.outbound.GAME_FINISHED, final);
  }

  broadcast() {
    const hostChanged = this.lastHostPlayerId !== this.room.state.hostPlayerId;
    const phaseChanged = this.lastPhaseId !== this.room.state.phaseId;
    const contributionSignature = this.room.phase === 'collecting'
      ? Object.keys(this.room.state.game?.currentBatchSubmissions ?? {}).sort().join('|')
      : '';
    const contributionChanged = contributionSignature !== this.lastContributionSignature;
    const voteSignature = this.room.phase === 'question'
      ? Object.keys(this.room.state.game?.answers ?? {}).sort().join('|')
      : '';
    const votesChanged = voteSignature !== this.lastVoteSignature;

    for (const socket of this.io.sockets.sockets.values()) {
      if (!socket.rooms.has(ROOM_ID)) continue;
      const snapshot = this.room.project(socket.data.playerId);
      socket.emit(socketEvents.outbound.SNAPSHOT, snapshot);
      if (hostChanged) {
        socket.emit(socketEvents.outbound.HOST_CHANGED, {
          roomId: ROOM_ID,
          version: snapshot.version,
          hostPlayerId: snapshot.hostPlayerId,
          snapshot,
        });
      }
      if (phaseChanged) {
        socket.emit(socketEvents.outbound.PHASE_CHANGED, {
          roomId: ROOM_ID,
          version: snapshot.version,
          phase: snapshot.phase,
          snapshot,
        });
      }
      if (this.room.phase === 'collecting' && (contributionChanged || phaseChanged)) {
        socket.emit(socketEvents.outbound.COMMUNITY_PROGRESS, {
          roomId: ROOM_ID,
          version: snapshot.version,
          submittedPlayerIds: snapshot.game?.submittedPlayerIds ?? [],
          snapshot,
        });
      }
      if (this.room.phase === 'question' && (votesChanged || phaseChanged)) {
        socket.emit(socketEvents.outbound.VOTE_STATUS, {
          roomId: ROOM_ID,
          version: snapshot.version,
          answeredCount: snapshot.game?.answeredCount ?? 0,
          eligibleCount: snapshot.game?.eligibleCount ?? 0,
          snapshot,
        });
      }
      const round = this.room.roundProjection(socket.data.playerId);
      if (round) socket.emit(socketEvents.outbound.ROUND_OPENED, round);
      const final = this.room.finalProjection();
      if (final) socket.emit(socketEvents.outbound.GAME_FINISHED, final);
    }
    this.lastHostPlayerId = this.room.state.hostPlayerId;
    this.lastPhaseId = this.room.state.phaseId;
    this.lastContributionSignature = contributionSignature;
    this.lastVoteSignature = voteSignature;
  }
}
