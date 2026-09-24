// Linha de indicadores do topo das telas (os números que mais importam,
// grandes e lado a lado). `tom`: "destaque" | "good" | "bad" | "warn".
export default function Kpis({ itens }) {
  return (
    <div className="kpis">
      {itens.filter(Boolean).map((i) => (
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
