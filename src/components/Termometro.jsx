// Barra de "termômetro" pra visualizar rápido se a margem líquida está
// dentro da meta. Compacta o suficiente pra caber dentro de uma célula
// de tabela (Comparativo) ou sozinha embaixo de um resultado (Precificação).
export default function Termometro({ valor, meta, label, compact = false }) {
  const v = isFinite(valor) ? valor : 0;
  const m = isFinite(meta) ? meta : 0;
  const max = Math.max(0.4, m * 1.5, v * 1.15) || 0.4;
  const pctFill = Math.max(0, Math.min(1, v / max)) * 100;
  const pctMeta = Math.max(0, Math.min(1, m / max)) * 100;
  const cor = v >= m ? "good" : v >= m * 0.6 ? "warn" : "bad";

  return (
    <div className={`termometro ${compact ? "compact" : ""}`}>
      {label && <div className="termometro-label">{label}</div>}
      <div className="termometro-track" title={`Meta: ${(m * 100).toFixed(0)}%`}>
        <div className={`termometro-fill ${cor}`} style={{ width: `${pctFill}%` }} />
        <div className="termometro-meta" style={{ left: `${pctMeta}%` }} />
      </div>
    </div>
  );
}
