import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Clock3, Copy, Feather, Lock, Play, ShieldCheck, Sparkles, Users } from "lucide-react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";
import PlayerList from "../components/PlayerList.jsx";

const ROUND_OPTIONS = [10, 15, 20, 30, 45, 50];
const TIMER_OPTIONS = [15, 30, 45, 60];

export default function LobbyView({ snapshot, onCommand, onLeave, setToast }) {
  const self = snapshot.self || {};
  const settings = snapshot.settings || { mode: "classic", timerSeconds: 30, roundLimit: 10 };
  const players = snapshot.players || [];
  const activePlayers = players.filter((player) => !player.waitingForNextGame);
  const isSolo = activePlayers.length === 1;
  const isHost = snapshot.hostPlayerId === self.playerId;

  async function update(patch) {
    try {
      await onCommand("lobby:configure", { ...settings, ...patch });
    } catch (error) {
      setToast({ type: "error", message: error.message });
    }
  }

  async function start() {
    try {
      await onCommand("game:start", {});
    } catch (error) {
      setToast({ type: "error", message: error.message });
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setToast({ type: "success", message: "Link da sala copiado!" });
    } catch {
      setToast({ type: "info", message: "Copie o endereço desta página para convidar." });
    }
  }

  return (
    <main className="app-shell lobby-page">
      <header className="topbar">
        <Brand compact />
        <div className="room-pill"><span className="live-dot" /> Sala principal · {players.length}/8</div>
        <button className="ghost-button" type="button" onClick={onLeave}>Sair</button>
      </header>

      <div className="lobby-grid">
        <section className="lobby-stage panel-card">
          <div className="stage-copy">
            <span className="eyebrow"><Sparkles size={15} /> A sala está aberta</span>
            <h1>{isSolo ? "Só falta a plateia!" : "A turma está chegando"}</h1>
            <p>{isHost ? "Você é o host. Ajuste a partida e comece quando todo mundo estiver pronto." : "O host está preparando tudo. Enquanto isso, confira quem já chegou."}</p>
            <button className="secondary-button invite-button" type="button" onClick={copyInvite}><Copy size={17} /> Copiar convite</button>
          </div>
          <Isabel pose={isSolo ? "alerta" : "feliz"} className="lobby-isabel" />
        </section>

        <aside className="players-panel panel-card">
          <div className="section-heading">
            <div><span className="eyebrow">Participantes</span><h2>Na sala</h2></div>
            <span className="count-badge"><Users size={15} /> {activePlayers.length}</span>
          </div>
          <PlayerList players={players} selfId={self.playerId} />
          {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, index) => (
            <div className="empty-seat" key={index}><span>+</span> Lugar esperando alguém</div>
          ))}
        </aside>

        <section className="settings-panel panel-card">
          <div className="section-heading">
            <div><span className="eyebrow">Configuração</span><h2>Escolha o clima</h2></div>
            {!isHost && <span className="locked-label"><Lock size={14} /> Só o host altera</span>}
          </div>

          <fieldset disabled={!isHost}>
            <legend>Modo de jogo</legend>
            <div className="mode-picker">
              <button type="button" className={`mode-card ${settings.mode === "classic" ? "selected" : ""}`} onClick={() => update({ mode: "classic" })}>
                <span className="mode-icon"><ShieldCheck /></span>
                <span><strong>Clássico</strong><small>Fatos verificados pela Isabel</small></span>
                <span className="radio-dot" />
              </button>
              <button type="button" disabled={isSolo || !isHost} className={`mode-card ${settings.mode === "community" ? "selected" : ""}`} onClick={() => update({ mode: "community" })}>
                <span className="mode-icon community"><Feather /></span>
                <span><strong>Fatos da Galera</strong><small>Vocês escrevem e tentam enganar</small></span>
                <span className="radio-dot" />
              </button>
            </div>
          </fieldset>

          <div className="settings-row">
            <fieldset disabled={!isHost}>
              <legend><Clock3 size={16} /> Tempo por fato</legend>
              <div className="segmented-control">
                {TIMER_OPTIONS.map((seconds) => <button type="button" key={seconds} className={settings.timerSeconds === seconds ? "selected" : ""} onClick={() => update({ timerSeconds: seconds })}>{seconds}s</button>)}
              </div>
            </fieldset>
            <fieldset disabled={!isHost}>
              <legend><ArrowRight size={16} /> Limite de rodadas</legend>
              <div className="round-chips">
                {ROUND_OPTIONS.map((rounds) => <button type="button" key={rounds} disabled={isSolo && rounds !== 10} className={settings.roundLimit === rounds ? "selected" : ""} onClick={() => update({ roundLimit: rounds })}>{rounds}</button>)}
              </div>
            </fieldset>
          </div>

          <AnimatePresence>
            {snapshot.notice?.code === "COMMUNITY_CANCELLED" && (
              <motion.div className="info-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Users size={20} />
                <span>{snapshot.notice.message}</span>
              </motion.div>
            )}
            {isSolo && (
              <motion.div className="solo-notice" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <Users size={20} />
                <div><strong>Uma partida só sua</strong><span>Chame mais pessoas para jogar e desbloqueie partidas de até 50 rodadas!</span></div>
              </motion.div>
            )}
            {settings.mode === "community" && settings.effectiveRoundLimit && settings.effectiveRoundLimit !== settings.roundLimit && (
              <motion.div className="info-notice" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                Para dividir as autorias igualmente, esta partida terá <strong>{settings.effectiveRoundLimit} rodadas</strong>.
              </motion.div>
            )}
          </AnimatePresence>

          {isHost ? (
            <button className="primary-button start-button" type="button" onClick={start} disabled={settings.mode === "community" && isSolo}>
              <Play size={20} fill="currentColor" /> Começar a partida
            </button>
          ) : (
            <div className="host-wait"><span className="waiting-dots"><i /><i /><i /></span> Esperando o host começar</div>
          )}
        </section>
      </div>
    </main>
  );
}
