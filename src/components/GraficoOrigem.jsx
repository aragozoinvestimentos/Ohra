// Vendas por origem por semana (orgânico / Ads / afiliado / conhecidos) —
// barras empilhadas. Usado em Crescimento → Afiliados e no Início.
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

const COR = { organico: "var(--af-org)", ads: "var(--af-ads)", afiliado: "var(--af-af)", conhecidos: "var(--af-con)" };

export default function GraficoOrigem({ semanas }) {
  const max = Math.max(4, ...semanas.map((w) => w.total));
  const passo = max <= 10 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50;
  const topo = Math.ceil(max / passo) * passo;
  const W = 900;
  const H = 190;
  const x0 = 40;
  const y0 = 150;
  const y1 = 18;
  const y = (v) => y0 - (v / topo) * (y0 - y1);
  const larg = (W - x0 - 10) / semanas.length;
  const bw = Math.min(64, larg * 0.5);
  const vazio = semanas.every((w) => !w.total);
  const ticks = [];
  for (let v = 0; v <= topo; v += passo) ticks.push(v);
  return (
    <div className="grafico-origem">
      <div className="leg-origem">
        <span><i style={{ background: COR.organico }} />Orgânico</span>
        <span><i style={{ background: COR.ads }} />Ads</span>
        <span><i style={{ background: COR.afiliado }} />Afiliado</span>
        <span title="Vendas de amigos/família: contam no caixa, não no orgânico"><i style={{ background: COR.conhecidos }} />Conhecidos</span>
      </div>
      {vazio ? (
        <div className="empty">Sem semanas registradas ainda — use “Registrar semana”.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vendas por origem por semana">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={x0} x2={W - 10} y1={y(v)} y2={y(v)} className="go-grade" />
              <text x={x0 - 8} y={y(v) + 4} textAnchor="end" className="go-eixo">{v}</text>
            </g>
          ))}
          {semanas.map((w, k) => {
            const cx = x0 + larg * k + larg / 2;
            const partes = [
              ["afiliado", w.afiliado],
              ["ads", w.ads],
              ["organico", w.organico],
              ["conhecidos", w.conhecidos],
            ];
            let base = 0;
            return (
              <g key={w.semana}>
                <title>{`Semana de ${dataBR(w.semana)}: ${w.total} vendas — orgânico ${w.organico}, Ads ${w.ads}, afiliado ${w.afiliado}${w.conhecidos ? `, conhecidos ${w.conhecidos}` : ""}`}</title>
                {partes.map(([k2, v]) => {
                  if (!v) return null;
                  const yTop = y(base + v);
                  const h = y(base) - yTop;
                  base += v;
                  return <rect key={k2} x={cx - bw / 2} y={yTop} width={bw} height={Math.max(0, h)} fill={COR[k2]} />;
                })}
                <text x={cx} y={H - 22 + 14} textAnchor="middle" className="go-eixo">{dataBR(w.semana)}</text>
                {w.total > 0 && (
                  <text x={cx} y={y(w.total) - 5} textAnchor="middle" className="go-total">{w.total}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
