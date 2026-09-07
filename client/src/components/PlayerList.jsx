import { Check, Crown, Hourglass, WifiOff } from "lucide-react";

export default function PlayerList({ players = [], selfId, compact = false, showVotes = false }) {
  return (
    <div className={`player-list ${compact ? "player-list-compact" : ""}`}>
      {players.map((player, index) => (
        <div className={`player-chip ${player.id === selfId ? "is-self" : ""}`} key={player.id || player.playerId || index}>
          <span className="avatar" style={{ "--avatar-hue": (index * 47 + 335) % 360 }}>
            {(player.nickname || player.username || "?").trim().slice(0, 1).toUpperCase()}
          </span>
          <span className="player-name">{player.nickname || player.username}{player.id === selfId ? " (você)" : ""}</span>
          {player.isHost && <Crown size={16} className="player-icon crown-icon" aria-label="Host" />}
          {!player.connected && <WifiOff size={16} className="player-icon offline-icon" aria-label="Desconectado" />}
          {showVotes && player.hasVoted && <Check size={17} className="player-icon vote-icon" aria-label="Votou" />}
          {showVotes && !player.hasVoted && player.eligible !== false && <Hourglass size={15} className="player-icon wait-icon" aria-label="Pensando" />}
        </div>
      ))}
    </div>
  );
}
