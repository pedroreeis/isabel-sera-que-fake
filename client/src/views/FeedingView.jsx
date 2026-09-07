import { useEffect, useMemo, useState } from "react";
import { Check, Feather, LogOut, Plus, Send, UserMinus } from "lucide-react";
import { motion } from "motion/react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";

function emptyFact() {
  return { statement: "", verdict: true, explanation: "" };
}

export default function FeedingView({ snapshot, onCommand, onLeave, setToast }) {
  const game = snapshot.game || {};
  const self = snapshot.self || {};
  const players = snapshot.players || [];
  const required = Math.max(1, game.requiredFactsPerPlayer || self.requiredFacts || 2);
  const me = players.find((player) => player.id === self.playerId);
  const alreadySubmitted = self.submittedFactsCount >= required || self.submittedFacts || me?.contributionStatus === "submitted";
  const [facts, setFacts] = useState(() => Array.from({ length: required }, emptyFact));
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const isHost = snapshot.hostPlayerId === self.playerId;
  const estimatedServerNow = clock + ((snapshot.serverNow || clock) - (snapshot.__receivedAt || clock));
  const canRemoveStalled = isHost && Boolean(game.canRemoveStalled || (game.stalledRemovalAt && estimatedServerNow >= game.stalledRemovalAt));
  const submitted = useMemo(() => players.filter((player) => player.contributionStatus === "submitted").length, [players]);

  useEffect(() => {
    if (!isHost || !game.stalledRemovalAt || canRemoveStalled) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isHost, game.stalledRemovalAt, canRemoveStalled]);

  function updateFact(index, patch) {
    setFacts((current) => current.map((fact, factIndex) => factIndex === index ? { ...fact, ...patch } : fact));
  }

  async function submit(event) {
    event.preventDefault();
    const cleaned = facts.map((fact) => ({
      statement: fact.statement.trim(),
      verdict: Boolean(fact.verdict),
      explanation: fact.explanation.trim(),
    }));
    if (cleaned.some((fact) => fact.statement.length < 12 || fact.explanation.length < 12)) {
      setToast({ type: "error", message: "Cada fato e explicação precisa ter pelo menos 12 caracteres." });
      return;
    }
    setBusy(true);
    try {
      await onCommand("community:submit", { facts: cleaned });
      setToast({ type: "success", message: "A Isabel guardou seus fatos a sete chaves." });
    } catch (error) {
      setToast({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(playerId) {
    try {
      await onCommand("host:removePlayer", { playerId });
    } catch (error) {
      setToast({ type: "error", message: error.message });
    }
  }

  return (
    <main className="app-shell feeding-page">
      <header className="topbar"><Brand compact /><div className="feeding-topbar-actions"><div className="room-pill"><Feather size={15} /> Fatos da Galera</div><button type="button" className="icon-button feeding-leave" onClick={onLeave} aria-label="Sair da sala" title="Sair da sala"><LogOut size={18} /></button></div></header>
      <div className="feeding-header">
        <div>
          <span className="eyebrow">{snapshot.phase === "FEEDING_INITIAL" ? "Antes de começar" : "Hora de recarregar"}</span>
          <h1>Alimente a curiosidade da Isabel</h1>
          <p>Escreva algo convincente. Pode ser verdade ou um belo caô — a explicação só aparece no final.</p>
        </div>
        <div className="feeding-progress"><strong>{submitted}/{players.length}</strong><span>jogadores prontos</span></div>
      </div>

      <section className="feeding-mobile-stage panel-card" aria-label="Dica da Isabel">
        <div><span className="eyebrow">Dica da Isabel</span><strong>{alreadySubmitted ? "Segredo guardado. Agora é só esperar a galera." : "Uma mentira boa parece quase verdadeira."}</strong></div>
        <Isabel pose={alreadySubmitted ? "feliz" : "fala"} alt={alreadySubmitted ? "Isabel guardando os fatos enviados" : "Isabel ajudando a escrever fatos convincentes"} />
      </section>

      <div className="feeding-layout">
        <section className="feeding-form-wrap panel-card">
          {alreadySubmitted ? (
            <motion.div className="submitted-state" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <span className="success-orb"><Check size={34} /></span>
              <h2>Seus fatos estão seguros</h2>
              <p>Agora é só esperar o restante da galera. Nem o host consegue espiar seu gabarito.</p>
              <span className="waiting-dots large"><i /><i /><i /></span>
            </motion.div>
          ) : (
            <form onSubmit={submit}>
              {facts.map((fact, index) => (
                <article className="fact-editor" key={index}>
                  <div className="fact-editor-heading"><span>Fato {index + 1}</span><small>{fact.statement.length}/220</small></div>
                  <label>
                    Sua afirmação
                    <textarea value={fact.statement} onChange={(event) => updateFact(index, { statement: event.target.value })} maxLength={220} rows={3} placeholder="Ex.: Polvos têm três corações." required />
                  </label>
                  <fieldset>
                    <legend>Qual é o gabarito?</legend>
                    <div className="truth-toggle">
                      <button type="button" className={fact.verdict ? "selected true" : ""} onClick={() => updateFact(index, { verdict: true })}>É fato</button>
                      <button type="button" className={!fact.verdict ? "selected false" : ""} onClick={() => updateFact(index, { verdict: false })}>É fake</button>
                    </div>
                  </fieldset>
                  <label>
                    Explique sem entregar antes da hora
                    <textarea value={fact.explanation} onChange={(event) => updateFact(index, { explanation: event.target.value })} maxLength={420} rows={3} placeholder="Conte por que a resposta está certa. Isso será revelado no relatório." required />
                  </label>
                </article>
              ))}
              <button className="primary-button submit-facts" type="submit" disabled={busy}><Send size={19} /> {busy ? "Guardando…" : `Entregar ${required === 1 ? "meu fato" : "meus fatos"}`}</button>
            </form>
          )}
        </section>

        <aside className="feeding-aside">
          <div className="mini-stage panel-card"><Isabel pose={alreadySubmitted ? "feliz" : "fala"} /><div className="mini-speech">Capriche: uma mentira boa parece quase verdadeira.</div></div>
          <div className="contribution-list panel-card">
            <h2>Quem já terminou</h2>
            {players.map((player) => (
              <div className="contribution-row" key={player.id}>
                <span className={`status-dot ${player.contributionStatus === "submitted" ? "done" : ""}`} />
                <strong>{player.nickname}</strong>
                <span>{player.contributionStatus === "submitted" ? "Pronto" : "Escrevendo…"}</span>
                {isHost && player.id !== self.playerId && player.contributionStatus !== "submitted" && canRemoveStalled && (
                  <button type="button" className="icon-button danger" onClick={() => remove(player.id)} title="Remover jogador"><UserMinus size={16} /></button>
                )}
              </div>
            ))}
            {isHost && !canRemoveStalled && <p className="removal-hint"><Plus size={14} /> A remoção de ausentes será liberada após 60 segundos.</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
