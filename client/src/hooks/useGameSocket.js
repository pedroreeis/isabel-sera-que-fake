import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL } from "../lib/api.js";
import { createRequestId, storage } from "../lib/storage.js";

const ERROR_MESSAGES = {
  ROOM_FULL: "A sala já está com oito jogadores.",
  NICKNAME_TAKEN: "Esse nome já está sendo usado na sala.",
  INVALID_NICKNAME: "Escolha um nome entre 2 e 20 caracteres.",
  NOT_HOST: "Só o host pode fazer isso.",
  HOST_ONLY: "Só o host pode fazer isso.",
  WRONG_PHASE: "Essa ação não está disponível agora.",
  ALREADY_ANSWERED: "Seu voto já foi lacrado.",
  ROUND_CLOSED: "O tempo desta rodada acabou.",
  COMMUNITY_REQUIRES_PLAYERS: "Fatos da Galera precisa de pelo menos duas pessoas.",
  STALE_VERSION: "A sala avançou. Atualizamos sua tela.",
  RATE_LIMITED: "Muitas tentativas. Respire e tente de novo em instantes.",
};

export function useGameSocket() {
  const socketRef = useRef(null);
  const sessionRef = useRef(storage.getSession());
  const snapshotRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [round, setRound] = useState(null);
  const [report, setReport] = useState(storage.getLastReport());
  const [status, setStatus] = useState("idle");

  const acceptSnapshot = useCallback((next) => {
    if (!next) return;
    const received = { ...next, __receivedAt: Date.now() };
    setSnapshot((current) => {
      const accepted = !current || (received.version ?? 0) >= (current.version ?? 0) ? received : current;
      snapshotRef.current = accepted;
      return accepted;
    });
    if (next.phase !== "ROUND_OPEN") setRound(null);
  }, []);

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const socket = io(API_URL, {
      autoConnect: false,
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", async () => {
      setStatus("connected");
      const session = sessionRef.current;
      if (session?.reconnectToken && snapshotRef.current) {
        try {
          const data = await emitRaw("room:resume", { reconnectToken: session.reconnectToken }, 0);
          const resumedSession = { ...session, reconnectToken: data.reconnectToken || session.reconnectToken };
          sessionRef.current = resumedSession;
          storage.setSession(resumedSession);
        } catch {
          // The current screen will offer a clean re-entry if the token expired.
        }
      }
    });
    socket.on("disconnect", () => setStatus("reconnecting"));
    socket.on("connect_error", () => setStatus("offline"));
    socket.on("room:snapshot", acceptSnapshot);
    socket.on("round:opened", (payload) => {
      setRound(payload.round || payload);
      setSnapshot((current) => current ? {
        ...current,
        phase: "ROUND_OPEN",
        version: payload.version ?? current.version,
        gameId: payload.gameId ?? current.gameId,
        phaseId: payload.phaseId ?? current.phaseId,
        serverNow: payload.serverNow ?? current.serverNow,
        __receivedAt: Date.now(),
      } : current);
    });
    socket.on("game:finished", (payload) => {
      setReport(payload);
      storage.setLastReport(payload);
      setSnapshot((current) => current ? { ...current, phase: "FINISHED", version: payload.version ?? current.version, gameId: payload.gameId ?? current.gameId, phaseId: payload.phaseId ?? current.phaseId } : current);
    });
    socket.on("phase:changed", (payload) => payload.snapshot ? acceptSnapshot(payload.snapshot) : null);
    socket.on("host:changed", (payload) => payload.snapshot ? acceptSnapshot(payload.snapshot) : null);
    socket.on("community:progress", (payload) => payload.snapshot ? acceptSnapshot(payload.snapshot) : null);
    socket.on("round:voteStatus", (payload) => payload.snapshot ? acceptSnapshot(payload.snapshot) : null);
    return socket;
  }, [acceptSnapshot]);

  function emitRaw(event, payload = {}, forcedVersion) {
    const socket = ensureSocket();
    if (!socket.connected) socket.connect();
    const requestId = createRequestId();
    const command = {
      requestId,
      version: forcedVersion ?? snapshotRef.current?.version ?? 0,
      gameId: snapshotRef.current?.gameId ?? null,
      phaseId: snapshotRef.current?.phaseId ?? null,
      payload,
    };
    return new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, command, (timeoutError, ack) => {
        if (timeoutError) {
          reject(new Error("A Isabel não conseguiu falar com a sala. Tente novamente."));
          return;
        }
        if (!ack?.ok) {
          const code = ack?.error?.code;
          const error = new Error(ERROR_MESSAGES[code] || ack?.error?.message || "Não foi possível concluir essa ação.");
          error.code = code;
          reject(error);
          return;
        }
        if (ack.data?.snapshot) acceptSnapshot(ack.data.snapshot);
        resolve(ack.data || {});
      });
    });
  }

  const join = useCallback(async (nickname) => {
    setStatus("connecting");
    const oldSession = storage.getSession();
    const data = await emitRaw("room:join", {
      nickname,
      reconnectToken: oldSession?.reconnectToken,
    }, 0);
    const session = { playerId: data.playerId, reconnectToken: data.reconnectToken, nickname };
    sessionRef.current = session;
    storage.setSession(session);
    storage.setProfile({ username: nickname });
    acceptSnapshot(data.snapshot);
    setStatus("connected");
    return data;
  }, [acceptSnapshot]);

  const reconnect = useCallback(async () => {
    const session = storage.getSession();
    if (!session?.reconnectToken) throw new Error("Não há partida para continuar.");
    setStatus("connecting");
    const data = await emitRaw("room:resume", { reconnectToken: session.reconnectToken }, 0);
    const resumedSession = { ...session, playerId: data.playerId || session.playerId, reconnectToken: data.reconnectToken || session.reconnectToken };
    sessionRef.current = resumedSession;
    storage.setSession(resumedSession);
    acceptSnapshot(data.snapshot);
    setStatus("connected");
    return data;
  }, [acceptSnapshot]);

  const command = useCallback((event, payload) => emitRaw(event, payload), []);

  const leave = useCallback(async () => {
    try { await emitRaw("room:leave", {}); } catch { /* local exit still works */ }
    socketRef.current?.disconnect();
    socketRef.current = null;
    sessionRef.current = null;
    storage.clearSession();
    setSnapshot(null);
    snapshotRef.current = null;
    setRound(null);
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (!sessionRef.current?.reconnectToken) return;
    reconnect().catch(() => {
      sessionRef.current = null;
      storage.clearSession();
      setStatus("idle");
    });
  }, [reconnect]);

  useEffect(() => () => socketRef.current?.disconnect(), []);

  return { snapshot, round, report, status, join, reconnect, command, leave };
}
