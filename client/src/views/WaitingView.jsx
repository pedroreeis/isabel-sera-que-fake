import { Hourglass, RotateCcw, Users } from "lucide-react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";

export default function WaitingView({ snapshot, onCommand, onLeave, setToast }) {
  const canPrepareNextGame = ["FINISHED", "finished"].includes(snapshot?.phase)
    && snapshot?.hostPlayerId === snapshot?.self?.playerId;

  async function prepareNextGame() {
    try {
      await onCommand("game:rematch", {});
    } catch (error) {
      setToast({ type: "error", message: error.message });
    }
  }

  return (
    <main className="app-shell waiting-page">
      <header className="topbar"><Brand compact /><button className="ghost-button" onClick={onLeave}>Sair</button></header>
      <section className="waiting-card panel-card">
        <div><span className="eyebrow"><Hourglass size={15} /> {canPrepareNextGame ? "A sala passou para você" : "Partida em andamento"}</span><h1>{canPrepareNextGame ? "Abra a próxima rodada" : "Sua cadeira está reservada"}</h1><p>{canPrepareNextGame ? "O host anterior saiu e agora você comanda a sala. Leve todos ao lobby para preparar uma nova partida." : "Você entra automaticamente no lobby quando esta partida terminar. Aproveite para chamar mais alguém."}</p>{canPrepareNextGame ? <button className="primary-button waiting-rematch" onClick={prepareNextGame}><RotateCcw size={18} /> Preparar nova partida</button> : <div className="sealed-chip"><Users size={16} /> Aguardando a próxima</div>}</div>
        <Isabel pose="saudacao" />
      </section>
    </main>
  );
}
