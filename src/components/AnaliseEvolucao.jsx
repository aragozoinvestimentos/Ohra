import { useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { agruparPorItem, evolucaoSemanal, metricas, porDiaDaSemana, precoVsVendas, ultimasSemanas, PLATAFORMAS, somarDias } from "../lib/pedidos.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import { adsNaJanela } from "../lib/ads.js";

// Análise → 3 · Evolução e métricas. Só leitura e só informativo: nenhuma
// regra de Rampa/Ads lê daqui (o "dia que mais vende" não sobe degrau nem
// mexe em Ads). Preço = o pago no pedido; lucro com custo e taxas de hoje.
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d })}%`);
const nomePlat = (p) => (p === "fisico" ? "Venda física" : PLATAFORMAS.find((x) => x.id === p)?.nome || p);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const PREF = { produto: "p", variacao: "v", kit: "k" };

function Spark({ v }) {
  const max = Math.max(...v, 1);
  const w = 110;
  const h = 26;
  const pts = v.map((n, i) => `${(i * w) / Math.max(1, v.length - 1)},${h - 3 - (n / max) * (h - 6)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
const Variacao = ({ v }) => {
  if (v == null || !isFinite(v)) return null;
  const cls = v > 0.05 ? "ana-sobe" : v < -0.05 ? "ana-desce" : "faint";
  return <span className={cls}>{v > 0 ? "+" : ""}{pct(v, 0)}</span>;
};

export default function AnaliseEvolucao({ esc, cres, linhas, hoje }) {
  const [f, setF] = useState({ periodo: "30", plat: "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const plats = [...new Set(linhas.map((l) => (l.origem === "fisico" ? "fisico" : l.plataforma)).filter(Boolean))];
  const daPlat = (l) => !f.plat || (l.origem === "fisico" ? "fisico" : l.plataforma) === f.plat;
  const n = f.periodo === "mes" ? Number(hoje.slice(8, 10)) : Number(f.periodo);
  const de = somarDias(hoje, -n + 1);
  const deAnt = somarDias(de, -n);
  const atual = useMemo(() => linhas.filter((l) => l.data >= de && l.data <= hoje && daPlat(l)), [linhas, de, hoje, f.plat]); // eslint-disable-line react-hooks/exhaustive-deps
  const antes = useMemo(() => linhas.filter((l) => l.data >= deAnt && l.data < de && daPlat(l)), [linhas, deAnt, de, f.plat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preço alvo (salvo) do item no canal: separa o desconto de preço (promo/rampa/campanha) do cupom.
  const precoAlvoDe = useMemo(() => {
    const m = new Map((esc.precos || []).map((p) => [`${PREF[p.item_tipo] || "p"}:${p.item_id}|${p.canal_id}`, Number(p.preco) || null]));
    return (l) => (l.id_item && l.canal_id ? m.get(`${l.id_item}|${l.canal_id}`) || null : null);
  }, [esc.precos]);
  const m = useMemo(() => metricas(atual, { precoAlvoDe }), [atual, precoAlvoDe]);
  const mA = useMemo(() => metricas(antes, { precoAlvoDe }), [antes, precoAlvoDe]);
  const lucro = atual.filter((l) => l.valido).reduce((t, l) => t + (l.lucro || 0), 0);

  // Ads do período AO VIVO (16/10/2026): por período, o andamento do CSV ou as
  // semanas, o maior — a mesma conta do teto (lib/ads.js adsNaJanela), inclui
  // o anúncio com vários itens e a GMV Max da Loja.
  const ads = useMemo(() => {
    if (f.plat === "fisico") return 0;
    let t = 0;
    const L = cres.linhasAds;
    for (const l of [...(L?.lojaLinha ? [L.lojaLinha] : []), ...(L?.linhas || [])]) {
      if (f.plat && PLATAFORMAS.find((p) => p.id === f.plat)?.tipo !== l.canal?.tipo) continue;
      t += adsNaJanela(l.periodos, l.semanas, de, hoje).gasto;
    }
    return t;
  }, [cres.linhasAds, f.plat, de, hoje]);

  const semanas = useMemo(() => ultimasSemanas(somarDias(hoje, -7), 8), [hoje]); // 8 semanas COMPLETAS (seg–dom)
  const evo = useMemo(() => {
    const g = agruparPorItem(
      linhas.filter((l) => l.data >= semanas[0] && daPlat(l)),
      { itens: esc.itens, porPai: true }
    );
    return evolucaoSemanal(g, semanas);
  }, [linhas, semanas, esc.itens, f.plat]); // eslint-disable-line react-hooks/exhaustive-deps
  const dias = useMemo(() => porDiaDaSemana(atual), [atual]);
  const maxD = Math.max(1, ...dias.map((d) => d.n));
  const elas = useMemo(() => precoVsVendas(cres.linhas), [cres.linhas]);

  return (
    <>
      <div className="panel">
        <div className="ana-filtros">
          <div className="field">
            <label>Período</label>
            <select value={f.periodo} onChange={set("periodo")}>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="mes">Este mês</option>
            </select>
          </div>
          <div className="field">
            <label>Plataforma</label>
            <select value={f.plat} onChange={set("plat")}>
              <option value="">Todas</option>
              {plats.map((p) => (
                <option key={p} value={p}>{nomePlat(p)}</option>
              ))}
            </select>
          </div>
          <div className="faint" style={{ alignSelf: "end", paddingBottom: 8 }}>
            {dm(de)} a {dm(hoje)} · comparado com {dm(deAnt)} a {dm(somarDias(de, -1))}
          </div>
        </div>
      </div>

      <div className="kpis ana-kpis-7">
        <div className="kpi">
          <div className="l">Ticket médio</div>
          <div className="v">{m.ticket != null ? BRL(m.ticket) : "—"}</div>
          <div className="s">
            por pedido · <Variacao v={m.ticket && mA.ticket ? m.ticket / mA.ticket - 1 : null} /> vs antes
          </div>
        </div>
        <div className="kpi">
          <div className="l">Itens por pedido</div>
          <div className="v">{m.itensPorPedido != null ? m.itensPorPedido.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}</div>
          <div className="s">{pct(m.pctMulti, 0)} dos pedidos com 2+ peças</div>
        </div>
        <div className="kpi">
          <div className="l">
            Desconto efetivo <Ajuda texto="Quanto ficou abaixo do preço alvo (salvo) de cada item no canal. Promo/rampa/campanha = preço do item abaixo do alvo; cupom da loja = desconto do item/pedido no relatório (2%, 1ª compra…). Os cupons só aparecem aqui — não precisa cadastrar promoção." />
          </div>
          <div className="v">{pct(m.descontoTotal)}</div>
          <div className="s">
            promo/rampa/campanha {pct(m.descontoPreco)} · cupom da loja {pct(m.descontoCupom)}
          </div>
        </div>
        <div className="kpi">
          <div className="l">Recompra</div>
          <div className="v">{pct(m.recompra, 0)}</div>
          <div className="s">{m.clientes ? `${m.voltaram} de ${m.clientes} clientes compraram de novo` : "sem ID do cliente"}</div>
        </div>
        <div className={`kpi${m.pctCancel >= 0.05 ? " warn" : ""}`}>
          <div className="l">Cancelamentos</div>
          <div className="v">{pct(m.pctCancel)}</div>
          <div className="s">
            {m.cancelados} de {m.pedidos + m.cancelados} pedidos
          </div>
        </div>
        <div className="kpi">
          <div className="l">
            TACoS <Ajuda texto="Ads ÷ faturamento TOTAL (orgânico + Ads). Mostra quanto do que entra vai pro Ads. Ads = gasto ao vivo (CSV do Shopee Ads ou semanas registradas, o maior), igual ao teto do Ads." />
          </div>
          <div className="v">{m.faturamento > 0 ? pct(ads / m.faturamento) : "—"}</div>
          <div className="s">
            Ads {BRL(ads)} ÷ faturamento {BRL(m.faturamento)}
          </div>
        </div>
        <div className={`kpi${lucro - ads < 0 ? " bad" : ""}`}>
          <div className="l">Lucro real</div>
          <div className="v">{BRL(lucro - ads)}</div>
          <div className="s">
            lucro {BRL(lucro)} − Ads {BRL(ads)}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>
          Por produto — semana a semana <span className="dir">unidades por semana completa (seg–dom) · tendência = 2 últimas semanas × 2 anteriores</span>
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                {semanas.map((s) => (
                  <th key={s} className="num">{dm(s)}</th>
                ))}
                <th>8 semanas</th>
                <th className="num">Tendência</th>
                <th className="num">Lucro na semana</th>
              </tr>
            </thead>
            <tbody>
              {evo.map((e) => {
                const t = e.tendencia;
                const cls = t == null ? "faint" : t > 0.15 ? "ana-sobe" : t < -0.15 ? "ana-desce" : "faint";
                const txt = t == null ? "—" : t > 0.15 ? `↑ ${pct(t, 0)}` : t < -0.15 ? `↓ ${pct(-t, 0)}` : "≈ estável";
                return (
                  <tr key={e.chave}>
                    <td>
                      <b>{e.nome}</b>
                      <span className="ana-tags" style={{ marginLeft: 6 }}>
                        {[...e.plataformas].map((p) => (
                          <CanalTag key={p} tipo={p === "fisico" ? "custom" : PLATAFORMAS.find((x) => x.id === p)?.tipo || "custom"} nome={nomePlat(p)} />
                        ))}
                      </span>
                    </td>
                    {e.v.map((x, i) => (
                      <td key={i} className="num">{x || <span className="faint">0</span>}</td>
                    ))}
                    <td>
                      <Spark v={e.v} />
                    </td>
                    <td className={`num ${cls}`}>{txt}</td>
                    <td className="num">{BRL(e.lucroSem[e.lucroSem.length - 1] || 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ana-grid2">
        <div className="panel">
          <h3>
            Dia que mais vende <span className="dir">só informativo — não mexe em Rampa nem Ads</span>
          </h3>
          <div className="ana-dias">
            {dias.map((d) => (
              <div key={d.dia} className="dia">
                <b>{d.n}</b>
                <div className="b" style={{ height: (d.n / maxD) * 90, opacity: d.n === maxD ? 1 : 0.6 }} />
                {d.dia}
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>
            Preço × vendas na Rampa
            <Ajuda texto="Cada subida de degrau com semanas completas antes e depois: quanto o preço subiu, quanto as vendas mudaram e o lucro por semana. Aguenta = o lucro manteve ou subiu. Só pra entender o produto — as decisões continuam no Crescimento." />
          </h3>
          {elas.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Preço</th>
                    <th className="num">Vendas/sem</th>
                    <th className="num">Lucro/sem</th>
                    <th>Leitura</th>
                  </tr>
                </thead>
                <tbody>
                  {elas.map((e, i) => (
                    <tr key={i}>
                      <td>
                        <b>{e.nome}</b> <CanalTag canal={e.canal} />
                      </td>
                      <td className="num">
                        {BRL(e.de)} → {BRL(e.para)} <span className="faint">(+{pct(e.dPreco, 0)})</span>
                      </td>
                      <td className="num">
                        {e.vA.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} → {e.vB.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} <Variacao v={e.dVendas} />
                      </td>
                      <td className="num">
                        {BRL(e.lA)} → {BRL(e.lB)}
                      </td>
                      <td>
                        {e.leitura === "aguenta" ? (
                          <span className="ana-chip op">aguenta o preço</span>
                        ) : e.leitura === "sensivel" ? (
                          <span className="ana-chip at">sensível ao preço</span>
                        ) : (
                          <span className="ana-chip">lucrou menos</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">Aparece depois da 1ª subida de degrau com semanas completas antes e depois.</div>
          )}
        </div>
      </div>
    </>
  );
}
