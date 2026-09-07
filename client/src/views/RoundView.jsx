import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, LockKeyhole, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Isabel from "../components/Isabel.jsx";
import PlayerList from "../components/PlayerList.jsx";

function useCountdown(deadlineAt, serverNow, receivedAt) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, (deadlineAt || 0) - (serverNow || Date.now())));
  useEffect(() => {
    const started = receivedAt || Date.now();
    const baseNow = serverNow || Date.now();
    const update = () => setRemainingMs(Math.max(0, (deadlineAt || 0) - (baseNow + Date.now() - started)));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [deadlineAt, serverNow, receivedAt]);
  return remainingMs;
}

export default function RoundView({ snapshot, round: eventRound, onCommand, setToast }) {
  const current = eventRound || snapshot.game?.currentRound || snapshot.game || {};
  const roundNumber = current.number || snapshot.game?.roundNumber || 1;
  const total = current.total || snapshot.game?.totalRounds || snapshot.settings?.effectiveRoundLimit || snapshot.settings?.roundLimit || 10;
  const deadlineAt = current.deadlineAt || snapshot.game?.deadlineAt;
  const durationMs = current.durationMs || (snapshot.settings?.timerSeconds || 30) * 1000;
  const remainingMs = useCountdown(deadlineAt, snapshot.serverNow, snapshot.__receivedAt);
  const [locked, setLocked] = useState(Boolean(snapshot.self?.hasAnswered));
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 5;
  const progress = Math.max(0, Math.min(1, remainingMs / durationMs));
  const isAuthor = Boolean(current.isAuthor ?? snapshot.self?.isAuthor);
  const canAnswer = !isAuthor && (current.canAnswer ?? snapshot.self?.canAnswer ?? true);
  const players = useMemo(() => (snapshot.players || []).map((player) => ({
    ...player,
    hasVoted: player.contributionStatus === "answered" || player.hasAnswered,
    eligible: player.id !== current.authorPlayerId,
  })), [snapshot.players, current.authorPlayerId]);

  useEffect(() => {
    setLocked(Boolean(snapshot.self?.hasAnswered));
    setChoice(null);
  }, [current.id, snapshot.self?.hasAnswered]);

  async function vote(answer) {
    if (locked || busy || !canAnswer || remainingMs <= 0) return;
    setBusy(true);
    try {
      await onCommand("round:vote", { roundId: current.id, answer });
      setChoice(answer);
      setLocked(true);
    } catch (error) {
      setToast({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`round-page ${urgent ? "is-urgent" : ""}`}>
      <header className="round-topbar">
        <div className="round-label"><span>Rodada</span><strong>{roundNumber}<small>/{total}</small></strong></div>
        <div className={`timer-orb ${urgent ? "urgent" : ""}`} aria-live="polite"><Clock3 size={18} /><strong>{seconds}</strong><span>s</span></div>
        <div className="sealed-score"><LockKeyhole size={16} /><span>Placar lacrado</span></div>
      </header>
      <div className="time-track" aria-hidden="true"><motion.span animate={{ scaleX: progress }} transition={{ ease: "linear", duration: 0.1 }} /></div>

      <div className="round-layout">
        <section className="question-stage">
          <div className="question-card">
            <span className="question-kicker"><Sparkles size={16} /> Isabel ouviu dizer que…</span>
            <motion.h1 key={current.id || roundNumber} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>{current.statement || "A Isabel está escolhendo o próximo fato…"}</motion.h1>
            {current.category && <span className="category-pill">{String(current.category).replaceAll("-", " ")}</span>}
          </div>
          <Isabel pose={urgent ? "alerta" : "fala"} className="round-isabel" alt={urgent ? "Isabel alertando que o tempo está acabando" : "Isabel apresentando o fato"} />
        </section>

        <aside className="vote-panel">
          {isAuthor ? (
            <div className="author-card panel-card">
              <span className="author-orb"><Sparkles size={28} /></span>
              <h2>Você é cúmplice da Isabel</h2>
              <p>Este fato é seu. Observe a galera votar — sua pontuação e seu streak ficam pausados.</p>
            </div>
          ) : !locked ? (
            <div className="vote-card panel-card">
              <span className="eyebrow">Qual é seu palpite?</span>
              <h2>Decida antes do tempo acabar</h2>
              <div className="vote-buttons">
                <button type="button" className="vote-button true" onClick={() => vote(true)} disabled={busy || remainingMs <= 0}><span className="vote-symbol">V</span><span><strong>É fato</strong><small>Isso é verdadeiro</small></span></button>
                <button type="button" className="vote-button false" onClick={() => vote(false)} disabled={busy || remainingMs <= 0}><span className="vote-symbol">F</span><span><strong>É fake</strong><small>Isso é mentira</small></span></button>
              </div>
              <p className="vote-lock-note"><LockKeyhole size={14} /> O primeiro voto fica lacrado.</p>
            </div>
          ) : (
            <motion.div className="vote-confirmed panel-card" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <span className="success-orb"><Check size={32} /></span>
              <h2>Voto lacrado!</h2>
              <p>Você marcou <strong>{choice === null ? "sua resposta" : choice ? "É fato" : "É fake"}</strong>. O mistério continua até o final.</p>
            </motion.div>
          )}

          <div className="round-roster panel-card">
            <div className="roster-heading"><strong>{snapshot.game?.answeredCount || players.filter((player) => player.hasVoted).length}/{snapshot.game?.eligibleCount || players.filter((player) => player.eligible).length}</strong><span>votos recebidos</span></div>
            <PlayerList players={players} selfId={snapshot.self?.playerId} compact showVotes />
          </div>
        </aside>
      </div>
    </main>
  );
}
