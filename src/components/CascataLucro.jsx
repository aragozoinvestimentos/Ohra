import { useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { LINHAS_CASCATA, cascataDoPeriodo } from "../lib/resumoLoja.js";
import { baixarCsvRelatorio, imprimirRelatorio, relatorioDoPeriodo } from "../lib/relatorios.js";
import { BRL, PCT } from "../lib/format.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";

// Dinheiro → Resultado → "Do faturamento ao lucro" (28/10/2026, enxuta pela prévia):
// 8 linhas com % do faturado e o período anterior; cheio/descontos/devoluções numa linha
// pequena; canais recolhidos; o detalhe vai pro relatório (2 folhas, lib/relatorios.js →
// relatorioDoPeriodo). Conta ÚNICA em lib/resumoLoja.js (cascataDoPeriodo).
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
const mesesAtras = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const PERIODOS = [
  { k: "mes", rot: "Mês" },
  { k: "3m", rot: "3 meses" },
  { k: "ano", rot: "Ano" },
  { k: "tudo", rot: "Desde o início" },
];
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function CascataLucro({ pedidos, linhasAds, mes, hoje }) {
  const { lojas, lojaId } = useLoja();
  const nomeLoja = (lojas || []).find((l) => l.id === lojaId)?.nome || "loja";
  const { lancamentos } = useLancamentosCaixa();
  const cat = useCatalogo();
  const [per, setPer] = useState("mes");
  const [verCanais, setVerCanais] = useState(false);
  const p = useMemo(() => {
    const ateM = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
    if (per === "mes") {
      const ma = mesesAtras(mes, 1);
      return { de: `${mes}-01`, ate: ateM, titulo: `Fechamento de ${NOMES_MES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`, aberto: ateM < fimDoMes(mes), deA: `${ma}-01`, ateA: fimDoMes(ma), rotA: NOMES_MES[Number(ma.slice(5, 7)) - 1] };
    }
    let de = `${mesesAtras(mes, 2)}-01`;
    let ate = ateM;
    let titulo = "Últimos 3 meses";
    if (per === "ano") [de, ate, titulo] = [`${hoje.slice(0, 4)}-01-01`, hoje, `Ano de ${hoje.slice(0, 4)}`];
    if (per === "tudo") {
      const datas = (pedidos || []).filter((x) => x.valido).map((x) => String(x.data).slice(0, 10)).sort();
      [de, ate, titulo] = [datas[0] || `${hoje.slice(0, 7)}-01`, hoje, "Desde o início"];
    }
    // período anterior do mesmo tamanho
    const n = diasEntre(de, ate) + 1;
    return { de, ate, titulo, deA: somarDias(de, -n), ateA: somarDias(de, -1), rotA: "o período antes" };
  }, [per, mes, hoje, pedidos]);
  const c = useMemo(() => cascataDoPeriodo({ pedidos, linhasAds, lancamentos: lancamentos || [], de: p.de, ate: p.ate }), [pedidos, linhasAds, lancamentos, p.de, p.ate]);
  const a = useMemo(() => cascataDoPeriodo({ pedidos, linhasAds, lancamentos: lancamentos || [], de: p.deA, ate: p.ateA }), [pedidos, linhasAds, lancamentos, p.deA, p.ateA]);
  const t = c.total;
  const ta = a.total;
  const valor = (x, l) => (x[l.k] == null ? "—" : BRL(l.menos && x[l.k] ? -x[l.k] : x[l.k]));
  const perc = (x, l) => (x[l.k] == null || !(x.pago > 0) ? "" : PCT(x[l.k] / x.pago));
  const variacao = (l) => (ta.pago > 0 && ta[l.k] ? (t[l.k] - ta[l.k]) / Math.abs(ta[l.k]) : null);

  const ctx = () => {
    const nomeDe = (k) => (String(k).startsWith("p:") ? (cat.produtos || []).find((x) => x.id === k.slice(2))?.nome : (cat.kits || []).find((x) => x.id === String(k).slice(2))?.nome);
    return { pedidos, linhasAds, lancamentos: lancamentos || [], hoje, nomeDe };
  };
  const relatorio = () => relatorioDoPeriodo(ctx(), p);
  const partes = t.pago > 0
    ? [
        ["plataformas", t.taxas, "#8a7f75"],
        ["impostos", t.imposto, "#a69a8d"],
        ["custo", t.custo, "#5c6f7d"],
        ["Ads", t.ads, "#b98a2c"],
        ["fixas", t.fixas || 0, "#7a6a9a"],
        ["sobrou", Math.max(0, t.liquido || 0), "#c25a26"],
      ].map(([rot, v, cor]) => ({ rot, v: (100 * v) / t.pago, cor })).filter((x) => x.v >= 0.5)
    : [];

  return (
    <div className="panel">
      <h3>
        Do faturamento ao lucro
        <Ajuda texto="Pelos pedidos importados, com custo e taxas de HOJE. Plataformas = comissão + taxa fixa. Impostos = o imposto (%) de cada canal (MEI = 0; o DAS do MEI entra em Contas fixas). Ads = a mesma conta do teto. Contas fixas = as recorrentes de saída do Caixa (sem Ads, filamento e mercadoria, que já estão nas outras linhas)." />
      </h3>
      <div className="toolbar" style={{ gap: 6 }}>
        <div className="subabas" style={{ marginBottom: 0 }}>
          {PERIODOS.map((x) => (
            <button key={x.k} type="button" className={`btn${per === x.k ? " primary" : ""}`} onClick={() => setPer(x.k)}>
              {x.rot}
            </button>
          ))}
        </div>
        <span className="muted-cel">
          {dmy(p.de)} a {dmy(p.ate)} · {t.nPedidos} pedidos
        </span>
      </div>
      <div className="table-wrap">
        <table className="cascata">
          <thead>
            <tr>
              <th>Conta</th>
              <th className="num">Valor</th>
              <th className="num">% do faturado</th>
              <th className="num">{p.rotA === "o período antes" ? "Período antes" : p.rotA.charAt(0).toUpperCase() + p.rotA.slice(1)}</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS_CASCATA.map((l) => {
              const v = variacao(l);
              return (
                <tr key={l.k} className={`${l.total ? "cascata-total" : ""}${l.forte ? " cascata-forte" : ""}`}>
                  <td>
                    {l.rot}
                    {l.k === "pago" && t.bruto > 0 && (
                      <div className="muted-cel" style={{ fontWeight: 500 }}>
                        cheio {BRL(t.bruto)} − descontos {BRL(t.descontos)} (promo, cupom, rampa)
                        {t.devolvido > 0 ? ` · devolvido ${BRL(t.devolvido)} (${t.nDevolvidos} pedido${t.nDevolvidos === 1 ? "" : "s"}, já fora)` : ""}
                      </div>
                    )}
                  </td>
                  <td className={`num${l.total && t[l.k] < 0 ? " neg" : ""}`}>{valor(t, l)}</td>
                  <td className="num muted-cel">{perc(t, l)}</td>
                  <td className="num muted-cel">
                    {ta.pago > 0 ? valor(ta, l) : "—"}
                    {l.forte && v != null && <span style={{ marginLeft: 6, color: v >= 0 ? "var(--good)" : "var(--bad)" }}>{`${v >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(v * 100))}%`}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {partes.length > 0 && (
        <div className="barra-cem" role="img" aria-label={`De cada R$ 100 faturados: ${partes.map((x) => `${Math.round(x.v)} ${x.rot}`).join(", ")}`}>
          {partes.map((x) => (
            <span key={x.rot} style={{ flex: x.v, background: x.cor }}>
              {x.v >= 7 ? `${x.rot} ${Math.round(x.v)}` : Math.round(x.v)}
            </span>
          ))}
        </div>
      )}
      <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn primary btn-mini" onClick={() => imprimirRelatorio(relatorio(), nomeLoja)}>
          Gerar relatório (PDF)
        </button>
        <button type="button" className="btn btn-mini" onClick={() => baixarCsvRelatorio(relatorio(), `faturamento-ao-lucro-${p.de}-${p.ate}.csv`)}>
          Baixar CSV
        </button>
        {c.canais.length > 1 && (
          <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setVerCanais(!verCanais)}>
            {verCanais ? "esconder canais ▾" : "ver por canal ▸"}
          </button>
        )}
      </div>
      {verCanais && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th className="num">Faturado</th>
                <th className="num">Lucro bruto</th>
                <th className="num">Ads</th>
                <th className="num">Depois do Ads</th>
                <th className="num">Margem</th>
              </tr>
            </thead>
            <tbody>
              {c.canais.map((k) => (
                <tr key={k.nome}>
                  <td>{k.canal ? <CanalTag canal={k.canal} /> : k.nome}</td>
                  <td className="num">{BRL(k.pago)}</td>
                  <td className="num">{BRL(k.lucroBruto)}</td>
                  <td className="num">{BRL(k.ads)}</td>
                  <td className="num">{BRL(k.depoisAds)}</td>
                  <td className="num">{k.pago > 0 ? PCT(k.depoisAds / k.pago) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">As contas fixas não se dividem por canal; entram só no total.</p>
        </div>
      )}
      {t.semCusto > 0 && <p className="hint">{t.semCusto} item(ns) sem produto ligado (SKU não cadastrado) entram no faturado, mas sem custo.</p>}
    </div>
  );
}
