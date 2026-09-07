import { Sparkles } from "lucide-react";

export default function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Isabel: Será que é Fake?">
      <span className="brand-kicker"><Sparkles size={15} /> O jogo da verdade</span>
      <div className="brand-title">
        <span>Isabel,</span>
        <strong>será que é fake?</strong>
      </div>
    </div>
  );
}
