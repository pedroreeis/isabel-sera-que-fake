import { motion } from "motion/react";

const POSES = {
  saudacao: "saudacao",
  fala: "fala",
  alerta: "alerta",
  feliz: "feliz",
  triste: "triste",
  comemorando: "comemorando",
};

export default function Isabel({ pose = "saudacao", className = "", priority = false, alt = "Isabel" }) {
  const slug = POSES[pose] || POSES.saudacao;
  return (
    <motion.picture
      className={`isabel-picture isabel-${slug} ${className}`}
      initial={{ opacity: 0, y: 22, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 210, damping: 22 }}
    >
      <source
        type="image/avif"
        srcSet={`/isabel/${slug}-480.avif 480w, /isabel/${slug}-900.avif 900w, /isabel/${slug}-1254.avif 1254w`}
        sizes="(max-width: 700px) 78vw, 520px"
      />
      <source
        type="image/webp"
        srcSet={`/isabel/${slug}-480.webp 480w, /isabel/${slug}-900.webp 900w, /isabel/${slug}-1254.webp 1254w`}
        sizes="(max-width: 700px) 78vw, 520px"
      />
      <img
        src={`/isabel/${slug}-900.webp`}
        alt={alt}
        width="900"
        height="900"
        fetchPriority={priority ? "high" : "auto"}
        loading={priority ? "eager" : "lazy"}
        draggable="false"
      />
    </motion.picture>
  );
}
