import { motion } from "motion/react";
import { LockKeyhole, LogOut } from "lucide-react";
import Isabel from "../components/Isabel.jsx";

export default function TransitionView({ snapshot, onLeave }) {
  const isCountdown = snapshot.phase === "COUNTDOWN";
  return (
    <main className="center-stage-page">
      <button type="button" className="icon-button transition-leave-button" onClick={onLeave} aria-label="Sair da partida" title="Sair da partida"><LogOut size={19} /></button>
      <motion.div className="transition-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="eyebrow">{isCountdown ? "Aquecendo" : "Segredo guardado"}</span>
        <h1>{isCountdown ? "Prepare o seu palpite" : "A Isabel anotou tudo"}</h1>
        <p>{isCountdown ? "A primeira afirmação aparece em instantes." : "Nada de espiar o gabarito. O próximo fato já está chegando."}</p>
        {!isCountdown && <div className="sealed-chip"><LockKeyhole size={16} /> Resultado lacrado</div>}
        <span className="waiting-dots large"><i /><i /><i /></span>
      </motion.div>
      <Isabel pose={isCountdown ? "saudacao" : "feliz"} className="transition-isabel" />
    </main>
  );
}
