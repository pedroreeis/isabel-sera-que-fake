import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Toast from "./components/Toast.jsx";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { storage } from "./lib/storage.js";
import FeedingView from "./views/FeedingView.jsx";
import FinishedView from "./views/FinishedView.jsx";
import HomeView from "./views/HomeView.jsx";
import LobbyView from "./views/LobbyView.jsx";
import RoundView from "./views/RoundView.jsx";
import TransitionView from "./views/TransitionView.jsx";
import WaitingView from "./views/WaitingView.jsx";

const AdminView = lazy(() => import("./views/AdminView.jsx"));

function GameApp() {
  const game = useGameSocket();
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState(null);
  const [archivedReport, setArchivedReport] = useState(null);

  function showToast(next) {
    setToast(next);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 4200);
  }

  async function join(nickname) {
    setJoining(true);
    try { await game.join(nickname); }
    catch (error) { showToast({ type: "error", message: error.message }); }
    finally { setJoining(false); }
  }

  useEffect(() => {
    if (game.status === "reconnecting") showToast({ type: "info", message: "A conexão oscilou. A Isabel está reconectando você…" });
  }, [game.status]);

  if (archivedReport && !game.snapshot) {
    return <FinishedView report={archivedReport} archived onCloseArchive={() => setArchivedReport(null)} />;
  }

  if (!game.snapshot) {
    return <>
      <HomeView onJoin={join} busy={joining || game.status === "connecting"} lastReport={storage.getLastReport()} onOpenReport={() => setArchivedReport(storage.getLastReport())} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>;
  }

  const { snapshot } = game;
  const player = snapshot.players?.find((entry) => entry.id === snapshot.self?.playerId);
  let view;
  if (player?.waitingForNextGame || snapshot.phase === "WAITING") {
    view = <WaitingView onLeave={game.leave} />;
  } else if (snapshot.phase === "LOBBY" || snapshot.phase === "lobby") {
    view = <LobbyView snapshot={snapshot} onCommand={game.command} onLeave={game.leave} setToast={showToast} />;
  } else if (["FEEDING_INITIAL", "FEEDING_REFILL", "collecting"].includes(snapshot.phase)) {
    view = <FeedingView snapshot={snapshot} onCommand={game.command} setToast={showToast} />;
  } else if (["ROUND_OPEN", "question"].includes(snapshot.phase)) {
    view = <RoundView snapshot={snapshot} round={game.round} onCommand={game.command} setToast={showToast} />;
  } else if (["FINISHED", "finished"].includes(snapshot.phase)) {
    view = <FinishedView snapshot={snapshot} report={game.report || snapshot.report} onCommand={game.command} onLeave={game.leave} setToast={showToast} />;
  } else {
    view = <TransitionView snapshot={snapshot} />;
  }

  return <>{view}<Toast toast={toast} onClose={() => setToast(null)} />{["reconnecting", "offline"].includes(game.status) && <div className="connection-ribbon">Reconectando à sala…</div>}</>;
}

export default function App() {
  return <Routes><Route path="/superadmin" element={<Suspense fallback={<main className="admin-login"><div className="loading-seal">Abrindo o catálogo…</div></main>}><AdminView /></Suspense>} /><Route path="/*" element={<GameApp />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
