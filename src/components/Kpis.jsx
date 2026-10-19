// Linha de indicadores do topo das telas (os números que mais importam,
// grandes e lado a lado). `tom`: "destaque" | "good" | "bad" | "warn".
export default function Kpis({ itens }) {
  const lista = itens.filter(Boolean);
  // 5 indicadores cabem numa linha só no PC (antes ficavam 4 + 1 sozinho).
  return (
    <div className={`kpis${lista.length === 5 ? " kpis-5" : ""}`}>
      {lista.map((i) => (
        <div className={`kpi${i.tom ? ` ${i.tom}` : ""}`} key={i.label}>
          <div className="l">{i.label}</div>
          <div className="v">{i.valor}</div>
          {i.sub && <div className="s">{i.sub}</div>}
          {i.extra}
        </div>
      ))}
    </div>
  );
}
