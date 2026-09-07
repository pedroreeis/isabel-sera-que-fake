import { useState } from "react";
import { ArrowRight, History, LockKeyhole, Sparkles, Users } from "lucide-react";
import { motion } from "motion/react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";
import { storage } from "../lib/storage.js";

export default function HomeView({ onJoin, busy, lastReport, onOpenReport }) {
  const [nickname, setNickname] = useState(storage.getProfile()?.username || "");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const clean = nickname.trim().replace(/\s+/g, " ");
    if (clean.length < 2 || clean.length > 20) {
      setError("Use de 2 a 20 caracteres para a Isabel reconhecer você.");
      return;
    }
    setError("");
    await onJoin(clean);
  }

  return (
    <main className="home-shell">
      <div className="home-decor decor-one" />
      <div className="home-decor decor-two" />
      <section className="home-copy">
        <Brand />
        <motion.div className="hero-badge" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <Users size={17} /> De 1 a 8 jogadores
        </motion.div>
        <h1>Nem todo fato é o que parece.</h1>
        <p className="hero-subtitle">Vote, desconfie e tente não cair nos fatos mais improváveis da Isabel.</p>

        <form className="join-card" onSubmit={submit}>
          <label htmlFor="nickname">Como a Isabel pode chamar você?</label>
          <div className="join-row">
            <input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Seu nome ou apelido"
              autoComplete="nickname"
              maxLength={20}
              autoFocus
              aria-describedby={error ? "nickname-error" : undefined}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar na sala"}<ArrowRight size={19} />
            </button>
          </div>
          {error && <p id="nickname-error" className="field-error">{error}</p>}
          <div className="join-assurance"><LockKeyhole size={14} /> Sem conta, sem cadastro e sem ranking permanente.</div>
        </form>

        {lastReport && (
          <button className="last-report-link" type="button" onClick={onOpenReport}>
            <History size={17} /> Seu último relatório está salvo neste aparelho
          </button>
        )}
      </section>

      <section className="home-stage" aria-label="Isabel dá as boas-vindas">
        <motion.div className="speech-card hero-speech" initial={{ opacity: 0, scale: 0.9, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Sparkles size={18} />
          <span>Preparado para duvidar de tudo?</span>
        </motion.div>
        <Isabel pose="saudacao" priority className="hero-isabel" alt="Isabel sorrindo, acenando e segurando uma caneta" />
        <div className="stage-shadow" />
      </section>
    </main>
  );
}
