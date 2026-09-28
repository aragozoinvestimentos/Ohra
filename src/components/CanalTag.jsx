import { nomeCanal } from "../lib/canais.js";

// Nome do canal numa etiqueta suave na cor da marca (Shopee laranja, ML
// amarelo, TikTok ciano, Shein grafite; canal próprio neutro) — pra bater o
// olho e saber qual é, sem pintar a tabela inteira. Passe `canal` (objeto
// cadastrado) ou `tipo` + `nome`.
export default function CanalTag({ canal, tipo, nome, children, className = "", title }) {
  const t = canal?.tipo || tipo || "custom";
  const texto = children ?? nome ?? nomeCanal(canal || { tipo: t });
  return (
    <span className={`canal-tag canal-${["shopee", "ml", "tiktok", "shein"].includes(t) ? t : "custom"}${className ? ` ${className}` : ""}`} title={title}>
      <span className="canal-dot" aria-hidden="true" />
      {texto}
    </span>
  );
}
