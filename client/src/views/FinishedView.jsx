import { useMemo } from "react";
import { Check, ChevronDown, Clock3, Crown, ExternalLink, Medal, RotateCcw, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";

function formatMs(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value / 1000).toFixed(2).replace(".", ",")}s`;
}

function answerLabel(answer) {
  if (answer === true) return "Fato";
  if (answer === false) return "Fake";
  return "Sem resposta";
}

export default function FinishedView({ snapshot, report, onCommand, onLeave, setToast, archived = false, onCloseArchive }) {
  const leaderboard = report?.leaderboard || [];
  const rounds = report?.rounds || [];
  const selfId = snapshot?.self?.playerId;
  const me = leaderboard.find((player) => player.playerId === selfId);
  const winners = leaderboard.filter((player) => player.rank === 1);
  const isHost = snapshot?.hostPlayerId === selfId;
  const myBestStreak = me?.bestStreak ?? report?.summaryByPlayer?.[selfId]?.bestStreak ?? 0;
  const myAccuracy = me?.eligibleCount ? Math.round((me.correctCount / me.eligibleCount) * 100) : 0;

  async function restart() {
    try { await onCommand("game:rematch", {}); }
    catch (error) { setToast({ type: "error", message: error.message }); }
  }

  return (
    <main id="ultimo-relatorio" className="results-page">
      <div className="confetti" aria-hidden="true">{Array.from({ length: 28 }).map((_, index) => <i key={index} style={{ "--i": index }} />)}</div>
      <header className="topbar results-topbar">
        <Brand compact />
        {archived ? <button className="ghost-button" onClick={onCloseArchive}>Fechar relatório</button> : <button className="ghost-button" onClick={onLeave}>Sair da sala</button>}
      </header>

      <section className="winner-stage">
        <div className="winner-copy">
          <span className="eyebrow"><Sparkles size={15} /> O placar foi aberto</span>
          <h1>{winners.length > 1 ? "Temos campeões!" : "Temos um campeão!"}</h1>
          <p>{winners.length ? winners.map((winner) => winner.nickname).join(" e ") : "A turma toda"} {winners.length > 1 ? "enganaram" : "enganou"} a dúvida e chegaram ao topo.</p>
          {report?.reason === "unreachable_lead" && <div className="sealed-chip"><Crown size={16} /> Liderança matematicamente inalcançável</div>}
        </div>
        <Isabel pose="comemorando" className="winner-isabel" alt="Isabel comemorando com confetes" />
      </section>

      <div className="results-content">
        <section className="podium-section panel-card">
          <div className="section-heading"><div><span className="eyebrow">Classificação final</span><h2>O grande pódio</h2></div><Medal size={27} /></div>
          <div className="leaderboard">
            {leaderboard.map((player, index) => (
              <motion.div className={`leader-row rank-${player.rank} ${player.playerId === selfId ? "is-self" : ""}`} key={player.playerId} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(0.8, index * 0.08) }}>
                <span className="rank-number">{player.rank === 1 ? <Crown size={21} /> : `${player.rank}º`}</span>
                <span className="leader-avatar">{player.nickname?.slice(0, 1).toUpperCase()}</span>
                <span className="leader-name"><strong>{player.nickname}</strong>{player.playerId === selfId && <small>Você</small>}{player.dnf && <small>Desconectado</small>}</span>
                <span className="leader-stat"><strong>{player.score}</strong><small>pontos</small></span>
                <span className="leader-stat desktop-only"><strong>{player.correctCount}</strong><small>acertos</small></span>
                <span className="leader-time"><Clock3 size={14} /> {formatMs(player.averageCorrectResponseMs)}</span>
              </motion.div>
            ))}
          </div>
        </section>

        {me && (
          <section className="personal-summary">
            <article className="summary-tile"><span>Sua posição</span><strong>{me.rank}º</strong><small>de {leaderboard.length}</small></article>
            <article className="summary-tile"><span>Precisão</span><strong>{myAccuracy}%</strong><small>{me.correctCount} acertos</small></article>
            <article className="summary-tile"><span>Melhor streak</span><strong>{myBestStreak}x</strong><small>em sequência</small></article>
            <article className="summary-tile"><span>Reflexo médio</span><strong>{formatMs(me.averageCorrectResponseMs)}</strong><small>nos acertos</small></article>
            <article className="summary-tile"><span>Bônus de rapidez</span><strong>+{me.speedBonusTotal || 0}</strong><small>pontos extras</small></article>
            <article className="summary-tile"><span>Bônus de streak</span><strong>+{me.streakBonusTotal || 0}</strong><small>pontos extras</small></article>
          </section>
        )}

        <section className="report-section panel-card">
          <div className="section-heading"><div><span className="eyebrow">Rodada por rodada</span><h2>Relatório sem segredos</h2></div><span className="count-badge">{rounds.length} fatos</span></div>
          <div className="round-report-list">
            {rounds.map((item) => {
              const myAnswer = item.answers?.find((answer) => answer.playerId === selfId);
              return (
                <details className="report-round" key={item.id || item.number}>
                  <summary>
                    <span className="report-round-number">{item.number}</span>
                    <span className="report-statement">{item.statement}</span>
                    {myAnswer && <span className={`result-mark ${myAnswer.correct ? "correct" : "wrong"}`}>{myAnswer.correct ? <Check size={17} /> : <X size={17} />}</span>}
                    <ChevronDown size={19} className="details-chevron" />
                  </summary>
                  <div className="report-round-body">
                    <div className="truth-reveal"><span>Resposta da Isabel</span><strong className={item.verdict ? "truth" : "fake"}>{item.verdict ? "É FATO" : "É FAKE"}</strong></div>
                    <p>{item.explanation}</p>
                    {!item.verdict && item.correction && <p className="correction"><strong>O correto:</strong> {item.correction}</p>}
                    {item.authorNickname && <p className="author-reveal"><Sparkles size={15} /> Fato escrito por <strong>{item.authorNickname}</strong></p>}
                    {item.sources?.length > 0 && <div className="source-links">{item.sources.map((source, index) => <a key={source.url || index} href={source.url} target="_blank" rel="noreferrer">{source.label || "Consultar fonte"}<ExternalLink size={13} /></a>)}</div>}
                    <div className="answer-table">
                      <div className="answer-table-head"><span>Jogador</span><span>Voto</span><span>Tempo</span><span>Pontos</span></div>
                      {(item.answers || []).map((answer) => {
                        const player = leaderboard.find((entry) => entry.playerId === answer.playerId);
                        return <div className="answer-table-row" key={answer.playerId}><strong>{player?.nickname || answer.nickname || "Jogador"}</strong><span>{answer.isAuthor ? "Autor" : answerLabel(answer.answer)}</span><span>{answer.isAuthor ? "—" : formatMs(answer.responseMs)}</span><span className={`answer-points ${answer.correct ? "positive" : ""}`}><strong>{answer.points || 0}</strong>{answer.correct && <small>+{answer.speedBonus || 0} rápido · +{answer.streakBonus || 0} streak</small>}</span></div>;
                      })}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        {!archived && (
          <section className="results-actions">
            {isHost ? <button className="primary-button" onClick={restart}><RotateCcw size={19} /> Jogar outra vez</button> : <div className="host-wait"><span className="waiting-dots"><i /><i /><i /></span> Esperando o host chamar a revanche</div>}
            <button className="secondary-button" onClick={onLeave}>Sair com meu relatório salvo</button>
          </section>
        )}
      </div>
    </main>
  );
}
