import { useMemo, useState } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useEscada } from "../hooks/useEscada.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import Ajuda from "./Ajuda.jsx";

// Análise → Comparar períodos (remap 21/10/2026, do vídeo "Análise
// comparativa"): dois períodos lado a lado, agrupados por dia, semana ou mês,
// pela loja toda, por canal ou por produto. Só lê os pedidos importados.
const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const inicioMes = (iso) => `${iso.slice(0, 7)}-01`;
const segunda = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const w = (d.getDay() + 6) % 7;
  return somarDias(iso, -w);
};

function presets(hoje) {
  const ontem = somarDias(hoje, -1);
  const im = inicioMes(hoje);
  const imAnt = inicioMes(somarDias(im, -1));
  const diaDoMes = diasEntre(im, hoje);
  const seg = segunda(hoje);
  return [
    { k: "30", rot: "Últimos 30 dias × 30 antes", a: [somarDias(hoje, -29), hoje], b: [somarDias(hoje, -59), somarDias(hoje, -30)] },
    { k: "7", rot: "Últimos 7 dias × 7 antes", a: [somarDias(hoje, -6), hoje], b: [somarDias(hoje, -13), somarDias(hoje, -7)] },
    { k: "mes", rot: "Este mês × mesmo trecho do mês passado", a: [im, hoje], b: [imAnt, somarDias(imAnt, diaDoMes)] },
    { k: "semana", rot: "Esta semana × semana passada (até o mesmo dia)", a: [seg, hoje], b: [somarDias(seg, -7), somarDias(hoje, -7)] },
    { k: "90", rot: "Últimos 3 meses × 3 antes", a: [somarDias(hoje, -89), hoje], b: [somarDias(hoje, -179), somarDias(hoje, -90)] },
    { k: "ontem", rot: "Ontem × mesmo dia da semana passada", a: [ontem, ontem], b: [somarDias(ontem, -7), somarDias(ontem, -7)] },
  ];
}

function resumo(ls) {
  const ped = new Set(ls.map((p) => p.pedido));
  const un = ls.reduce((t, p) => t + num(p.q), 0);
  const fat = ls.reduce((t, p) => t + num(p.pago), 0);
  const lucro = ls.reduce((t, p) => t + num(p.lucro), 0);
  return { pedidos: ped.size, un, fat, lucro, ticket: ped.size ? fat / ped.size : null, margem: fat > 0 ? lucro / fat : null };
}

// Pontos do gráfico: grupos (dia/semana/mês) desde o início de cada período.
function serie(ls, [de, ate], agr, k) {
  const n = diasEntre(de, ate) + 1;
  const passo = agr === "dia" ? 1 : agr === "semana" ? 7 : 30;
  const out = [];
  for (let i = 0; i < n; i += passo) {
    const ini = somarDias(de, i);
    const fim = somarDias(de, Math.min(n - 1, i + passo - 1));
    const v = ls.filter((p) => String(p.data) >= ini && String(p.data) <= fim).reduce((t, p) => t + (k === "un" ? num(p.q) : k === "lucro" ? num(p.lucro) : num(p.pago)), 0);
    out.push({ ini, fim, v });
  }
  return out;
}

const varPct = (a, b) => (b > 0 ? (a - b) / b : null);
function Linha({ rot, a, b, fmt }) {
  const v = varPct(a ?? 0, b ?? 0);
  return (
    <tr>
      <td>{rot}</td>
      <td className="num">
        <b>{a == null ? "—" : fmt(a)}</b>
      </td>
      <td className="num">{b == null ? "—" : fmt(b)}</td>
      <td className={`num${v == null ? "" : v >= 0 ? " pos" : " neg"}`}>{v == null ? "—" : `${v >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(v * 100))}%`}</td>
    </tr>
  );
}

export default function CompararPeriodos() {
  const cres = useCrescimento();
  const esc = useEscada();
  const hoje = hojeSP();
  const ps = presets(hoje);
  const [preset, setPreset] = useLembrado("ohra:comparar:preset", "30");
  const [manual, setManual] = useState(null); // { a: [de, ate], b: [de, ate] }
  const [agr, setAgr] = useLembrado("ohra:comparar:agrupar", "semana");
  const [medida, setMedida] = useLembrado("ohra:comparar:medida", "fat");
  const [canalId, setCanalId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const p0 = ps.find((p) => p.k === preset) || ps[0];
  const per = manual || { a: p0.a, b: p0.b };

  const base = useMemo(
    () =>
      (cres.pedidosValidos || []).filter((p) => {
        if (!p.valido) return false;
        if (canalId === "fisico") {
          if (p.canal_id) return false;
        } else if (canalId && p.canal_id !== canalId) return false;
        if (produtoId && !(p.id_item === produtoId || (p.item?.produtoId && `p:${p.item.produtoId}` === produtoId))) return false;
        return true;
      }),
    [cres.pedidosValidos, canalId, produtoId]
  );
  const dentro = ([de, ate]) => base.filter((p) => String(p.data) >= de && String(p.data) <= ate);
  const la = dentro(per.a);
  const lb = dentro(per.b);
  const ra = resumo(la);
  const rb = resumo(lb);
  const sa = serie(la, per.a, agr, medida);
  const sb = serie(lb, per.b, agr, medida);

  // Produtos com mais diferença entre os dois períodos.
  const porProduto = (() => {
    const m = new Map();
    const somar = (ls, lado) => {
      for (const p of ls) {
        if (!p.item) continue;
        const id = p.item.produtoId ? `p:${p.item.produtoId}` : p.id_item;
        const nome = p.item.produtoId ? p.item.nome.split(" — ")[0] : p.item.nome;
        const x = m.get(id) || { id, nome, a: 0, b: 0, la: 0, lb: 0 };
        x[lado] += num(p.q);
        x[`l${lado}`] += num(p.lucro);
        m.set(id, x);
      }
    };
    somar(la, "a");
    somar(lb, "b");
    return [...m.values()].sort((x, y) => Math.abs(y.la - y.lb) - Math.abs(x.la - x.lb)).slice(0, 15);
  })();

  const produtosVendidos = useMemo(() => {
    const m = new Map();
    for (const p of cres.pedidosValidos || []) {
      if (!p.item) continue;
      const id = p.item.produtoId ? `p:${p.item.produtoId}` : p.id_item;
      if (!m.has(id)) m.set(id, p.item.produtoId ? p.item.nome.split(" — ")[0] : p.item.nome);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cres.pedidosValidos]);

  const setData = (lado, i, v) => setManual({ ...per, [lado]: lado === "a" ? (i === 0 ? [v, per.a[1]] : [per.a[0], v]) : i === 0 ? [v, per.b[1]] : [per.b[0], v] });

  // Gráfico: as duas séries alinhadas pelo número do ponto (dia/semana 1, 2…).
  const W = 560;
  const H = 240;
  const pad = { l: 72, r: 10, t: 10, b: 22 };
  const n = Math.max(sa.length, sb.length, 1);
  const max = Math.max(1, ...sa.map((p) => p.v), ...sb.map((p) => p.v));
  const x = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v) => H - pad.b - (Math.max(0, v) / max) * (H - pad.t - pad.b);
  const fmtM = (v) => (medida === "un" ? String(Math.round(v)) : BRL(v));

  return (
    <div>
      <div className="panel">
        <h3>
          Comparar períodos
          <Ajuda texto="Escolha dois períodos (ou um atalho) e veja lado a lado: pedidos, unidades, faturamento, lucro (antes do Ads, custo e taxas de hoje) e ticket médio. O gráfico alinha os dois pelo 1º dia/semana de cada um. Dá pra filtrar por canal ou produto." />
        </h3>
        <div className="pa-corpo">
          <div className="toolbar">
            <select value={manual ? "" : preset} onChange={(e) => { setManual(null); setPreset(e.target.value); }}>
              {manual && <option value="">Períodos escolhidos à mão</option>}
              {ps.map((p) => (
                <option key={p.k} value={p.k}>{p.rot}</option>
              ))}
            </select>
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
              <option value="">Todos os canais</option>
              {esc.canais.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
              <option value="fisico">Venda física</option>
            </select>
            <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">Todos os produtos</option>
              {produtosVendidos.map(([id, nome]) => (
                <option key={id} value={id}>{nome}</option>
              ))}
            </select>
          </div>
          <div className="cp-datas">
            <label>
              <span className="cp-a">Período A</span>
              <input type="date" value={per.a[0]} onChange={(e) => setData("a", 0, e.target.value)} /> até <input type="date" value={per.a[1]} onChange={(e) => setData("a", 1, e.target.value)} />
            </label>
            <label>
              <span className="cp-b">Período B</span>
              <input type="date" value={per.b[0]} onChange={(e) => setData("b", 0, e.target.value)} /> até <input type="date" value={per.b[1]} onChange={(e) => setData("b", 1, e.target.value)} />
            </label>
          </div>
        </div>
      </div>
      <div className="pa-grid2">
        <div className="panel">
          <h3>
            Lado a lado{" "}
            <span className="dir">
              A {dm(per.a[0])}–{dm(per.a[1])} · B {dm(per.b[0])}–{dm(per.b[1])}
            </span>
          </h3>
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num cp-a">A</th>
                <th className="num cp-b">B</th>
                <th className="num">A vs B</th>
              </tr>
            </thead>
            <tbody>
              <Linha rot="Pedidos" a={ra.pedidos} b={rb.pedidos} fmt={String} />
              <Linha rot="Unidades" a={ra.un} b={rb.un} fmt={String} />
              <Linha rot="Faturamento" a={ra.fat} b={rb.fat} fmt={BRL} />
              <Linha rot="Lucro (antes do Ads)" a={ra.lucro} b={rb.lucro} fmt={BRL} />
              <Linha rot="Ticket médio" a={ra.ticket} b={rb.ticket} fmt={BRL} />
              <tr>
                <td>Margem</td>
                <td className="num">{ra.margem != null ? PCT(ra.margem) : "—"}</td>
                <td className="num">{rb.margem != null ? PCT(rb.margem) : "—"}</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>
            Gráfico
            <span className="dir">
              <select value={medida} onChange={(e) => setMedida(e.target.value)}>
                <option value="fat">Faturamento</option>
                <option value="lucro">Lucro</option>
                <option value="un">Unidades</option>
              </select>{" "}
              <select value={agr} onChange={(e) => setAgr(e.target.value)}>
                <option value="dia">por dia</option>
                <option value="semana">por semana</option>
                <option value="mes">por mês (30 dias)</option>
              </select>
            </span>
          </h3>
          <div className="pa-corpo">
            <svg viewBox={`0 0 ${W} ${H}`} className="pa-grafico" role="img" aria-label="Período A × período B">
              {[0, max / 2, max].map((t, i) => (
                <g key={i}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="pa-grade" />
                  <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" className="pa-eixo">{fmtM(t)}</text>
                </g>
              ))}
              {sb.length > 0 && <polyline points={sb.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} className="cp-linha-b" />}
              {sa.length > 0 && <polyline points={sa.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} className="cp-linha-a" />}
              {sa.map((p, i) => (
                <circle key={`a${i}`} cx={x(i)} cy={y(p.v)} r="3.5" className="cp-ponto-a">
                  <title>{`A ${dm(p.ini)}${p.fim !== p.ini ? `–${dm(p.fim)}` : ""}: ${fmtM(p.v)}${sb[i] ? ` · B ${dm(sb[i].ini)}: ${fmtM(sb[i].v)}` : ""}`}</title>
                </circle>
              ))}
              {Array.from({ length: n }, (_, i) => (n <= 16 || i % Math.ceil(n / 12) === 0 ? <text key={`t${i}`} x={x(i)} y={H - 6} textAnchor="middle" className="pa-eixo">{agr === "dia" ? `dia ${i + 1}` : agr === "semana" ? `sem ${i + 1}` : `mês ${i + 1}`}</text> : null))}
            </svg>
            <div className="cp-leg">
              <span className="cp-a">━ A</span> <span className="cp-b">┅ B</span>
            </div>
          </div>
        </div>
      </div>
      {porProduto.length > 0 && !produtoId && (
        <div className="panel">
          <h3>
            Produtos que mais mudaram <span className="dir">pelo lucro</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num cp-a">Un. A</th>
                  <th className="num cp-b">Un. B</th>
                  <th className="num cp-a">Lucro A</th>
                  <th className="num cp-b">Lucro B</th>
                  <th className="num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {porProduto.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td className="num">{p.a}</td>
                    <td className="num">{p.b}</td>
                    <td className="num">{BRL(p.la)}</td>
                    <td className="num">{BRL(p.lb)}</td>
                    <td className={`num${p.la - p.lb >= 0 ? " pos" : " neg"}`}>{`${p.la - p.lb >= 0 ? "+" : ""}${BRL(p.la - p.lb)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
