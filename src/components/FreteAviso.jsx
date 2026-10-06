// Aviso de frete grátis (lib/freteGratis.js): "R$ 9,50 abaixo do frete grátis
// (R$ 10): o cliente paga o frete". compacto = etiqueta curta (tabelas).
export default function FreteAviso({ frete, dica = null, compacto = false, style }) {
  if (!frete) return null;
  if (compacto)
    return (
      <span className="chip-cel atencao chip-frete" title={`${frete.texto}${dica ? ` · ${dica}` : ""}`} style={style}>
        {frete.curto}
      </span>
    );
  return (
    <div className="alerta alerta-warn aviso-frete" style={style}>
      <b>Cliente paga o frete</b>
      {frete.texto}.{dica ? ` Dica: ${dica}.` : ""}
    </div>
  );
}
