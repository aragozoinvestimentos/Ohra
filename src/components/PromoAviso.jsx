import { avisoPromo } from "../lib/limitePromo.js";

// Etiqueta do limite de desconto da plataforma (lib/limitePromo.js):
// âmbar acima de 40% no TikTok, vermelha acima de 80% (não aceita).
export default function PromoAviso({ canal, promo, texto = false }) {
  const a = avisoPromo(canal, promo);
  if (!a) return null;
  return (
    <span className={`promo-aviso promo-aviso-${a.nivel}`} title={a.texto}>
      {a.nivel === "resolver" ? "!" : "⚠"} {texto ? a.texto : a.curto}
    </span>
  );
}
