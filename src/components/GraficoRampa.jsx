import { useState } from "react";
import { BRL } from "../lib/format.js";

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const dataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const virgula = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Evolução da rampa: preço vendido (degraus, área + linha em degrau), alvo
// tracejado, vendas da semana em barras na faixa de baixo e avaliações
// acumuladas numa linha suave (eixo próprio à direita). Marca as subidas
// e descidas de degrau. Passar o mouse/tocar mostra os números do dia.
export default function GraficoRampa({ est }) {
  const [hover, setHover] = useState(null);
  const regs = est.registros || [];
  const datas = [...new Set(regs.map((r) => r.data))].sort();
  if (datas.length < 2)
    return (
      <div className="empty">
        {datas.length === 0
          ? "Registre a primeira semana pra ver a evolução (preço, vendas e avaliações)."
          : "Registre mais uma semana pra ver a evolução (o gráfico precisa de pelo menos duas datas)."}
      </div>
    );

  // Série por data
  const pontos = [];
  for (const d of datas) {
    const ant = pontos[pontos.length - 1] || { preco: null, aval: null };
    const doDia = regs.filter((r) => r.data === d);
    const ultPreco = [...doDia].reverse().find((r) => r.preco != null);
    const ultAval = [...doDia].reverse().find((r) => r.avaliacoes != null);
    const vendas = doDia.filter((r) => r.tipo === "semana").reduce((s, r) => s + num(r.vendas), 0);
    const mudanca = doDia.find((r) => r.tipo === "subida" || r.tipo === "descida") || null;
    pontos.push({
      data: d,
      preco: ultPreco ? num(ultPreco.preco) : ant.preco,
      aval: ultAval ? num(ultAval.avaliacoes) : ant.aval,
      vendas,
      temSemana: doDia.some((r) => r.tipo === "semana"),
      mudanca,
    });
  }

  const W = 960;
  const H = 240;
  const padL = 52;
  const padR = 44;
  const padT = 18;
  const padB = 26;
  const baseVendas = H - padB;
  const altVendas = 52;
  const topoPreco = padT;
  const fundoPreco = baseVendas - altVendas - 14;
  const precos = [...est.degraus, ...pontos.map((p) => p.preco).filter((v) => v != null)];
  let pMin = Math.min(...precos);
  let pMax = Math.max(...precos, est.alvo || 0);
  const folga = Math.max(0.5, (pMax - pMin) * 0.12);
  pMin = Math.max(0, pMin - folga);
  pMax += folga;
  const yP = (v) => fundoPreco - ((v - pMin) / (pMax - pMin)) * (fundoPreco - topoPreco);
  const maxV = Math.max(1, ...pontos.map((p) => p.vendas));
  const hV = (v) => (v / maxV) * altVendas;
  const avals = pontos.map((p) => p.aval).filter((v) => v != null);
  const aMin = avals.length ? Math.min(...avals) : 0;
  const aMax = avals.length ? Math.max(...avals, aMin + 1) : 1;
  const yA = (v) => fundoPreco - ((v - aMin) / (aMax - aMin)) * (fundoPreco - topoPreco) * 0.9;
  const larg = (W - padL - padR) / pontos.length;
  const cx = (i) => padL + larg * i + larg / 2;

  // Linha do preço em degrau (horizontal até a próxima data)
  const comPreco = pontos.map((p, i) => ({ ...p, i })).filter((p) => p.preco != null);
  let degrau = "";
  comPreco.forEach((p, k) => {
    const x0 = k === 0 ? cx(p.i) : cx(p.i);
    degrau += k === 0 ? `M${x0},${yP(p.preco)}` : ` H${x0} V${yP(p.preco)}`;
  });
  if (comPreco.length) degrau += ` H${cx(pontos.length - 1)}`;
  const area = comPreco.length ? `${degrau} V${fundoPreco} H${cx(comPreco[0].i)} Z` : "";

  // Avaliações: curva suave (Catmull-Rom → Bézier)
  const ptsA = pontos.map((p, i) => (p.aval != null ? [cx(i), yA(p.aval)] : null)).filter(Boolean);
  let curva = "";
  ptsA.forEach((pt, k) => {
    if (k === 0) return (curva = `M${pt[0]},${pt[1]}`);
    const p0 = ptsA[k - 2] || ptsA[k - 1];
    const p1 = ptsA[k - 1];
    const p3 = ptsA[k + 1] || pt;
    const c1 = [p1[0] + (pt[0] - p0[0]) / 6, p1[1] + (pt[1] - p0[1]) / 6];
    const c2 = [pt[0] - (p3[0] - p1[0]) / 6, pt[1] - (p3[1] - p1[1]) / 6];
    curva += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${pt[0]},${pt[1]}`;
  });

  const ticksP = [pMin, (pMin + pMax) / 2, pMax].map((v) => Math.round(v * 2) / 2);
  const h = hover != null ? pontos[hover] : null;

  return (
    <div className="grafico-rampa">
      <div className="grafico-legenda">
        <span><i className="leg-preco" />Preço vendido</span>
        <span><i className="leg-vendas" />Vendas/semana</span>
        <span><i className="leg-aval" />Avaliações</span>
        <span><i className="leg-alvo" />Alvo</span>
        <span className="grafico-hover">
          {h ? (
            <>
              <strong>{dataBR(h.data)}</strong>
              {h.preco != null ? ` · ${BRL(h.preco)}` : ""}
              {h.temSemana ? ` · ${h.vendas} venda${h.vendas === 1 ? "" : "s"}` : ""}
              {h.aval != null ? ` · ${h.aval} avaliações` : ""}
              {h.mudanca ? ` · ${h.mudanca.tipo === "subida" ? "subiu" : "voltou"} de degrau` : ""}
            </>
          ) : (
            <span className="muted-cel">passe o mouse numa data</span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolução do preço, vendas e avaliações" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="gr-preco" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="gr-preco-a" />
            <stop offset="100%" className="gr-preco-b" />
          </linearGradient>
        </defs>
        {ticksP.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yP(t)} y2={yP(t)} className="grade" />
            <text x={padL - 8} y={yP(t) + 4} textAnchor="end" className="eixo">{virgula(t)}</text>
          </g>
        ))}
        {avals.length > 0 && (
          <>
            <text x={W - padR + 6} y={yA(aMax) + 4} className="eixo eixo-aval">{aMax}</text>
            <text x={W - padR + 6} y={yA(aMin) + 4} className="eixo eixo-aval">{aMin}</text>
          </>
        )}
        <line x1={padL} x2={W - padR} y1={baseVendas} y2={baseVendas} className="grade" />
        {hover != null && <rect x={padL + larg * hover} y={padT - 6} width={larg} height={H - padT - padB + 6} rx="6" className="faixa-hover" />}
        {est.alvo != null && (
          <>
            <line x1={padL} x2={W - padR} y1={yP(est.alvo)} y2={yP(est.alvo)} className="linha-alvo" />
            <text x={W - padR - 4} y={yP(est.alvo) - 6} textAnchor="end" className="eixo eixo-alvo">alvo {virgula(est.alvo)}</text>
          </>
        )}
        {pontos.map((p, i) =>
          p.vendas > 0 ? (
            <g key={`v${p.data}`}>
              <rect x={cx(i) - Math.min(14, larg * 0.22)} y={baseVendas - hV(p.vendas)} width={Math.min(28, larg * 0.44)} height={hV(p.vendas)} rx="4" className="barra-vendas" />
              <text x={cx(i)} y={baseVendas - hV(p.vendas) - 4} textAnchor="middle" className="eixo rotulo-vendas">{p.vendas}</text>
            </g>
          ) : null
        )}
        {area && <path d={area} fill="url(#gr-preco)" />}
        {degrau && <path d={degrau} className="linha-preco" />}
        {curva && <path d={curva} className="linha-aval" />}
        {pontos.map((p, i) => (p.aval != null ? <circle key={`a${p.data}`} cx={cx(i)} cy={yA(p.aval)} r={hover === i ? 4 : 2.5} className="ponto-aval" /> : null))}
        {pontos.map((p, i) =>
          p.mudanca ? (
            <g key={`m${p.data}`}>
              <circle cx={cx(i)} cy={yP(num(p.mudanca.preco))} r="5" className={p.mudanca.tipo === "subida" ? "ponto-subida" : "ponto-descida"} />
              <text x={cx(i)} y={yP(num(p.mudanca.preco)) - 10} textAnchor="middle" className="rotulo-mudanca">
                {p.mudanca.tipo === "subida" ? "↑" : "↓"} {virgula(p.mudanca.preco)}
              </text>
            </g>
          ) : null
        )}
        {pontos.map((p, i) => (
          <text key={`x${p.data}`} x={cx(i)} y={H - 8} textAnchor="middle" className="eixo">{i === pontos.length - 1 && p.data === new Date().toISOString().slice(0, 10) ? "hoje" : dataBR(p.data)}</text>
        ))}
        {pontos.map((p, i) => (
          <rect key={`h${p.data}`} x={padL + larg * i} y={0} width={larg} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
    </div>
  );
}
