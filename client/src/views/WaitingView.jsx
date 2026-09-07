import { Hourglass, Users } from "lucide-react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";

export default function WaitingView({ onLeave }) {
  return (
    <main className="app-shell waiting-page">
      <header className="topbar"><Brand compact /><button className="ghost-button" onClick={onLeave}>Sair</button></header>
      <section className="waiting-card panel-card">
        <div><span className="eyebrow"><Hourglass size={15} /> Partida em andamento</span><h1>Sua cadeira está reservada</h1><p>Você entra automaticamente no lobby quando esta partida terminar. Aproveite para chamar mais alguém.</p><div className="sealed-chip"><Users size={16} /> Aguardando a próxima</div></div>
        <Isabel pose="saudacao" />
      </section>
    </main>
  );
}
