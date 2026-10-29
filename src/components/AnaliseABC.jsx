import { useCallback, useEffect, useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { agruparPorItem, compradosJuntos, origemDaLinha, concentracao, curvaABC, curvaXYZ, ESTOQUE_PADRAO, MIN_PEDIDOS_CESTA, projecaoMes, ultimasSemanas, PLATAFORMAS, somarDias } from "../lib/pedidos.js";
import { infoSazonal, quandoVendeDe } from "../lib/calendario.js";
import { irParaAba } from "../lib/navegar.js";
import { trocarSubAba } from "../lib/subAbas.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import EditarDialog from "./EditarDialog.jsx";

// Análise → 2 · Curva ABC (+ comprados juntos) e 3 · Curva XYZ (estoque sugerido) — `parte`.
// Só leitura: nada aqui muda preço, rampa ou Ads. Vendas = pedidos importados
// + vendas físicas (pago de verdade: rampa, promo e cupom já dentro); lucro com
// o custo e as taxas de hoje.
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: 0 })}%`);
const NOMES = { lucro: "lucro", valor: "valor vendido", qtd: "quantidade", hora: "lucro por hora de impressora" };
const nomePlat = (p) => (p === "fisico" ? "Venda física" : PLATAFORMAS.find((x) => x.id === p)?.nome || p);
const tipoPlat = (p) => (p === "fisico" ? "custom" : PLATAFORMAS.find((x) => x.id === p)?.tipo || "custom");
const TagPlat = ({ p }) => <CanalTag tipo={tipoPlat(p)} nome={nomePlat(p)} />;

function useNumerosDoMes(lojaId, mes) {
  const [n, setN] = useState({ meta: null, fixas: null });
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    (async () => {
      let qm = supabase.from("metas_mensais").select("*").eq("mes", mes);
      let ql = supabase.from("lancamentos_caixa").select("tipo, valor, recorrencia, data_prevista, recorrencia_ate, categoria").eq("recorrencia", "mensal").eq("tipo", "saida");
      if (lojaId) {
        qm = qm.eq("loja_id", lojaId);
        ql = ql.eq("loja_id", lojaId);
      }
      const [rm, rl] = await Promise.all([qm, ql]);
      if (!ativo) return;
      const fim = `${mes}-31`;
      const fixas = rl.error ? null : (rl.data || []).filter((l) => String(l.data_prevista) <= fim && (!l.recorrencia_ate || String(l.recorrencia_ate).slice(0, 7) >= mes)).reduce((t, l) => t + Number(l.valor || 0), 0);
      setN({ meta: rm.error ? null : rm.data?.[0] || null, fixas });
    })();
    return () => {
      ativo = false;
    };
  }, [lojaId, mes]);
  return n;
}

function GraficoABC({ ls }) {
  if (!ls.length) return null;
  const W = 900;
  const H = 240;
  const L = 40;
  const R = 14;
  const T = 12;
  const B = 30;
  const x = (i) => L + ((W - L - R) * i) / ls.length;
  const y = (v) => T + (H - T - B) * (1 - v);
  const cor = { A: "var(--abc-a)", B: "var(--abc-b)", C: "var(--abc-c)" };
  const pts = [[x(0), y(0)], ...ls.map((l, i) => [x(i + 1), y(l.acum)])];
  const mostraNum = ls.length <= 40;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ana-grafico" role="img" aria-label="Curva ABC">
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v === 0 ? "" : "3 4"} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)">{v * 100}%</text>
        </g>
      ))}
      {ls.map((l, i) => {
        const x0 = x(i);
        const x1 = x(i + 1);
        const y0 = y(i === 0 ? 0 : ls[i - 1].acum);
        return (
          <g key={l.chave}>
            <path d={`M${x0},${y(0)} L${x0},${y0} L${x1},${y(l.acum)} L${x1},${y(0)} Z`} fill={cor[l.classe]} opacity=".14" />
            <rect x={x0 + 2} y={y(l.ind)} width={Math.max(1.5, x1 - x0 - 4)} height={y(0) - y(l.ind)} rx="3" fill={cor[l.classe]} opacity=".55">
              <title>{`${i + 1}. ${l.nome}: ${pct(l.ind)} (acumulado ${pct(l.acum)})`}</title>
            </rect>
            {mostraNum && <text x={(x0 + x1) / 2} y={H - 12} textAnchor="middle" fontSize="10.5" fill="var(--ink-soft)">{i + 1}</text>}
          </g>
        );
      })}
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="2" />
      {[
        [0.8, "var(--abc-a)", "80%"],
        [0.95, "var(--abc-b)", "95%"],
      ].map(([v, c, t]) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={c} strokeWidth="1.2" />
          <text x={L + 6} y={y(v) + (t === "95%" ? 13 : -4)} fontSize="11" fill={c}>{t}</text>
        </g>
      ))}
    </svg>
  );
}

const Mini = ({ v }) => {
  const mx = Math.max(...v, 1);
  return (
    <span className="ana-mini">
      {v.map((n, i) => (
        <i key={i} style={{ height: Math.max(2, (n / mx) * 22) }} />
      ))}
    </span>
  );
};

export default function AnaliseABC({ esc, cres, linhas, hoje, farmConfig, onToast, parte = "abc" }) {
  const { lojaId, lojas, atualizar } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const [f, setF] = useState(() => ({ periodo: "30", plat: "", origem: "", crit: "lucro", pai: false, busca: "" }));
  const [regrasDlg, setRegrasDlg] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const mes = hoje.slice(0, 7);
  const numMes = useNumerosDoMes(lojaId, mes);
  const regras = useMemo(() => ({ ...ESTOQUE_PADRAO, ...(loja?.config_escada?.estoque || {}) }), [loja]);

  // Origem (28/10/2026): Todos / Fabricado / Revenda, além da plataforma — a curva é refeita dentro do filtro.
  const produtosPorId = useMemo(() => new Map((esc.produtos || []).map((p) => [p.id, p])), [esc.produtos]);
  const temRevenda = (esc.produtos || []).some((p) => p.origem === "revenda");
  const daOrigem = useCallback((l) => !f.origem || origemDaLinha(l, produtosPorId) === f.origem, [f.origem, produtosPorId]);
  const filtradas = useMemo(() => {
    const de = f.periodo === "mes" ? `${mes}-01` : f.periodo === "tudo" ? "0000" : somarDias(hoje, -Number(f.periodo) + 1);
    return linhas.filter((l) => l.data >= de && l.data <= hoje && (!f.plat || (l.origem === "fisico" ? "fisico" : l.plataforma) === f.plat) && daOrigem(l));
  }, [linhas, f.periodo, f.plat, hoje, mes, daOrigem]);
  const grupos = useMemo(() => agruparPorItem(filtradas, { itens: esc.itens, porPai: f.pai }), [filtradas, esc.itens, f.pai]);
  const abc = useMemo(() => curvaABC(grupos, { crit: f.crit, produtos: esc.produtos }), [grupos, f.crit, esc.produtos]);
  const ls = abc.linhas;
  const vis = ls.filter((l) => !f.busca || `${l.nome} ${l.sku || ""}`.toLowerCase().includes(f.busca.toLowerCase()));
  const cont = { A: ls.filter((l) => l.classe === "A"), B: ls.filter((l) => l.classe === "B"), C: ls.filter((l) => l.classe === "C") };
  const somaLucro = ls.reduce((t, l) => t + l.lucro, 0);
  const somaValor = ls.reduce((t, l) => t + l.valor, 0);
  const plats = [...new Set(linhas.map((l) => (l.origem === "fisico" ? "fisico" : l.plataforma)).filter(Boolean))];

  // KPIs do mês (sempre do mês todo, todas as plataformas)
  const proj = useMemo(() => projecaoMes(linhas, hoje), [linhas, hoje]);
  const metaFat = Number(numMes.meta?.faturamento_objetivo) || null;
  const conc = useMemo(() => concentracao(curvaABC(agruparPorItem(filtradas, { itens: esc.itens, porPai: true }), { crit: "lucro" }).linhas), [filtradas, esc.itens]);

  // XYZ (8 semanas COMPLETAS + a semana em andamento numa coluna à parte; mesma plataforma do filtro, por variação/kit).
  // A/B/C conta até hoje; a coluna "Esta semana" mostra de onde veio a venda de quem ainda não tem semana fechada.
  const semanas = useMemo(() => ultimasSemanas(somarDias(hoje, -7), 8), [hoje]); // 8 semanas COMPLETAS (seg–dom)
  const semanaAtual = useMemo(() => somarDias(semanas[semanas.length - 1], 7), [semanas]);
  const diasAtual = Math.max(1, Math.min(7, Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${semanaAtual}T12:00:00`)) / 86400000) + 1));
  const calendario = cres.calendario;
  const xyz = useMemo(() => {
    const daPlat = (l) => !f.plat || (l.origem === "fisico" ? "fisico" : l.plataforma) === f.plat;
    const doFiltro = linhas.filter((l) => l.data >= semanas[0] && daPlat(l) && daOrigem(l));
    const g = agruparPorItem(doFiltro, { itens: esc.itens, porPai: false });
    const abcP = curvaABC(g, { crit: "lucro", produtos: esc.produtos }); // A/B/C até hoje (com a semana em andamento)
    const mapa = new Map(abcP.linhas.map((l) => [l.chave, l.classe]));
    const primeiraVenda = new Map();
    for (const gg of agruparPorItem(linhas.filter(daPlat), { itens: esc.itens, porPai: false })) primeiraVenda.set(gg.chave, gg.linhas.reduce((m, l) => (!m || l.data < m ? l.data : m), null));
    const sazonalDe = (item) => {
      const pids = item.id.startsWith("k:") ? (item.componentes || []).map((c) => c.produtoId) : [item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId];
      return pids.some((pid) => {
        const p = esc.produtos.find((x) => x.id === pid);
        const s = p ? infoSazonal(quandoVendeDe(p), calendario, hoje) : null;
        return s && s.tipo === "epoca" && (s.fase === "subindo" || s.fase === "pico");
      });
    };
    return curvaXYZ(
      g.filter((x) => x.item),
      { semanas, abcPorChave: mapa, produtos: esc.produtos, farmConfig, regras, sazonalDe, semanaAtual, diasAtual, primeiraVenda }
    );
  }, [linhas, semanas, semanaAtual, diasAtual, f.plat, daOrigem, esc.itens, esc.produtos, calendario, hoje, farmConfig, regras]);

  const cesta = useMemo(() => compradosJuntos(filtradas, { itens: esc.itens }), [filtradas, esc.itens]);
  const pedidosMulti = useMemo(() => {
    const m = new Map();
    for (const l of filtradas) if (l.valido && l.item) m.set(l.pedido, (m.get(l.pedido) || new Set()).add(l.id_item));
    return [...m.values()].filter((s) => s.size >= 2).length;
  }, [filtradas]);

  async function salvarRegras(v) {
    if (!loja) return onToast?.("Escolha a loja");
    const novo = { AX: Number(v.AX) || 0, AY: Number(v.AY) || 0, BX: Number(v.BX) || 0, folgaFila: Number(v.folgaFila) || 0 };
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), estoque: novo } });
    if (r?.error || r?.ok === false) return onToast?.("Não foi possível salvar as regras");
    setRegrasDlg(null);
    onToast?.("Regras do estoque sugerido salvas");
  }

  const valorCol = f.crit === "hora" ? "Lucro/hora" : f.crit === "qtd" ? "Quantidade" : f.crit === "valor" ? "Valor" : "Lucro";
  const critFmt = (l) => (f.crit === "hora" ? `${BRL(l.base)}/h` : f.crit === "qtd" ? l.base : BRL(l.base));
  const lucroMes = proj.lucro;

  return (
    <>
      {parte !== "xyz" && (
      <>
      <div className="kpis">
        <div className="kpi">
          <div className="l">Projeção do mês</div>
          <div className="v">{BRL(proj.projFat)}</div>
          <div className="s">
            no ritmo de {proj.dia} de {proj.diasMes} dias · lucro ≈ {BRL(proj.projLucro)}
            {metaFat ? ` · meta ${BRL(metaFat)} (${pct(proj.projFat / metaFat, 0)})` : ""}
          </div>
        </div>
        <div className={`kpi${numMes.fixas != null ? (lucroMes >= numMes.fixas ? " good" : " warn") : ""}`}>
          <div className="l">Ponto de equilíbrio</div>
          <div className="v">{numMes.fixas == null ? "—" : lucroMes >= numMes.fixas ? "✓ coberto" : `faltam ${BRL(numMes.fixas - lucroMes)}`}</div>
          <div className="s">{numMes.fixas == null ? "sem contas fixas no Fluxo de Caixa" : `contas fixas ${BRL(numMes.fixas)} · lucro do mês até hoje ${BRL(lucroMes)}`}</div>
        </div>
        <div className={`kpi${conc && (conc.pctProduto >= 0.4 || conc.pctPlataforma >= 0.85) ? " warn" : ""}`}>
          <div className="l">Concentração</div>
          <div className="v">{conc ? `${pct(conc.pctProduto, 0)} · ${pct(conc.pctPlataforma, 0)}` : "—"}</div>
          <div className="s">{conc ? `do lucro em ${conc.produto?.nome} · na ${nomePlat(conc.plataforma)}` : "sem lucro no período"}</div>
        </div>
        <div className="kpi">
          <div className="l">No período</div>
          <div className="v">{BRL(somaValor)}</div>
          <div className="s">
            {ls.reduce((t, l) => t + l.qtd, 0)} un. · lucro {BRL(somaLucro)} (margem {pct(somaValor ? somaLucro / somaValor : null, 0)})
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Filtros</h3>
        <div className="ana-filtros">
          <div className="field">
            <label>Período</label>
            <select value={f.periodo} onChange={set("periodo")}>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="mes">Este mês</option>
              <option value="tudo">Tudo importado</option>
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
          {temRevenda && (
            <div className="field">
            <label>Origem</label>
            <select value={f.origem} onChange={set("origem")}>
              <option value="">Todos</option>
              <option value="fabricado">Fabricado</option>
              <option value="revenda">Revenda</option>
            </select>
            </div>
          )}
          <div className="field">
            <label>
              Acumular por <Ajuda texto="Lucro (recomendado): o que sobra de verdade, já sem taxas e custo de hoje. Lucro por hora de impressora: bom pra decidir o que imprimir quando a farm está cheia." />
            </label>
            <select value={f.crit} onChange={set("crit")}>
              <option value="lucro">Lucro (recomendado)</option>
              <option value="valor">Valor vendido</option>
              <option value="qtd">Quantidade</option>
              <option value="hora">Lucro por hora de impressora</option>
            </select>
          </div>
          <div className="field">
            <label>Buscar</label>
            <input type="search" value={f.busca} onChange={set("busca")} placeholder="Nome ou SKU" />
          </div>
          <label className="check-inline" style={{ alignSelf: "end", paddingBottom: 8 }}>
            <input type="checkbox" checked={f.pai} onChange={set("pai")} /> Agrupar por produto pai
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>
          Curva ABC
          <span className="dir">
            <span className="ana-selo A">A</span> até 80% · <span className="ana-selo B">B</span> até 95% · <span className="ana-selo C">C</span> o resto — pelo {NOMES[f.crit]}
          </span>
        </h3>
        <div className="ana-classes">
          {[
            ["A", "Não pode faltar", "prioridade em Ads, fotos, avaliações e produção"],
            ["B", "Pode crescer", "testar rampa, kit e Ads pra virar A"],
            ["C", "Revisar", "preço, usar dentro de kit ou parar de produzir"],
          ].map(([c, t, o]) => (
            <div key={c} className={`ana-classe ${c}`}>
              <div className="letra">
                {c} · {cont[c].length} ite{cont[c].length === 1 ? "m" : "ns"}
              </div>
              <b>{t}</b>
              <div className="o-que">{o}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "4px 14px 10px" }}>
          <GraficoABC ls={ls} />
        </div>
      </div>

      <div className="panel">
        <h3>
          Produtos <span className="dir">valor vendido = o que os clientes pagaram (rampa, promo e cupom já dentro) · lucro com custo e taxas de hoje</span>
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Produto</th>
                <th>Plataforma</th>
                <th className="num">Qtd</th>
                <th className="num">Valor vendido</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
                <th className="num">{valorCol} · % individual</th>
                <th className="num">% acumulado</th>
                <th>Classe</th>
              </tr>
            </thead>
            <tbody>
              {vis.map((l) => {
                const i = ls.indexOf(l) + 1;
                return (
                  <tr key={l.chave}>
                    <td className="faint">{i}</td>
                    <td>
                      <b>{l.nome}</b>
                      {l.cruz === "cuidar-preco" && <span className="ana-chip at" title="Muito vendido, margem baixa: cada R$ no preço rende muito aqui">cuidar do preço</span>}
                      {l.cruz === "falta-divulgar" && <span className="ana-chip op" title="Margem boa, pouca venda: vale Ads, fotos ou kit">falta divulgar</span>}
                      {l.lucro < 0 && <span className="ana-chip at" title="Lucro negativo no preço pago — veja o preço em Produtos precificados">prejuízo</span>}
                      {!l.item && <span className="ana-chip">SKU fora do app</span>}
                      {l.semLucro && l.item && <span className="ana-chip" title="Alguma venda sem canal ligado">lucro parcial</span>}
                      <div className="faint">{l.sku}</div>
                    </td>
                    <td>
                      <span className="ana-tags">
                        {[...l.plataformas].map((p) => (
                          <TagPlat key={p} p={p} />
                        ))}
                      </span>
                    </td>
                    <td className="num">{l.qtd}</td>
                    <td className="num">{BRL(l.valor)}</td>
                    <td className="num">{BRL(l.lucro)}</td>
                    <td className="num">{pct(l.margem, 0)}</td>
                    <td className="num">
                      <span className="ana-barra">
                        <span style={{ width: `${ls[0].ind > 0 ? (l.ind / ls[0].ind) * 100 : 0}%` }} />
                      </span>
                      {critFmt(l)} · {pct(l.ind)}
                    </td>
                    <td className="num">{pct(l.acum)}</td>
                    <td>
                      <span className={`ana-selo ${l.classe}`}>{l.classe}</span>
                    </td>
                  </tr>
                );
              })}
              <tr className="ana-total">
                <td></td>
                <td><b>Total</b></td>
                <td></td>
                <td className="num"><b>{ls.reduce((t, l) => t + l.qtd, 0)}</b></td>
                <td className="num"><b>{BRL(somaValor)}</b></td>
                <td className="num"><b>{BRL(somaLucro)}</b></td>
                <td className="num">{pct(somaValor ? somaLucro / somaValor : null, 0)}</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>
          Comprados juntos <span className="dir">pedidos com 2+ itens diferentes: {pedidosMulti} no período</span>
          <Ajuda texto={`Pra cada item com pelo menos ${MIN_PEDIDOS_CESTA} pedidos no período, o item que mais aparece no mesmo pedido (≥ 20% das vezes). Bom pra montar kit ou anúncio com vários itens.`} />
        </h3>
        {cesta.length ? (
          cesta.map((c) => (
            <div key={c.a + c.b} className="ana-cesta">
              <span>
                Quem compra <b>{c.nomeA}</b> leva junto <b>{c.nomeB}</b> em {pct(c.parte, 0)} dos pedidos ({c.juntos} de {c.pedidosA})
              </span>
              <span className="ana-prog">
                <span style={{ width: `${Math.min(100, c.parte * 100)}%` }} />
              </span>
              {c.mesmoProduto ? (
                <span className="faint">mesmo produto — veja o kit em Por quantidade</span>
              ) : c.kitExiste ? (
                <span className="faint">já existe um kit com os dois</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-mini"
                  onClick={() => {
                    trocarSubAba("ohra:cadastros-sub", "kits");
                    irParaAba("cadastros");
                  }}
                >
                  Montar kit →
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="empty">Ainda não dá pra dizer: precisa de pelo menos {MIN_PEDIDOS_CESTA} pedidos de um item e ele aparecer junto com outro em 20% deles.</div>
        )}
      </div>

      </>
      )}
      {parte === "xyz" && (
      <>
      <div className="panel">
        <h3>Filtro</h3>
        <div className="ana-filtros">
          <div className="field">
            <label>Plataforma</label>
            <select value={f.plat} onChange={set("plat")}>
              <option value="">Todas</option>
              {plats.map((p) => (
                <option key={p} value={p}>{nomePlat(p)}</option>
              ))}
            </select>
          </div>
          {temRevenda && (
            <div className="field">
            <label>Origem</label>
            <select value={f.origem} onChange={set("origem")}>
              <option value="">Todos</option>
              <option value="fabricado">Fabricado</option>
              <option value="revenda">Revenda</option>
            </select>
            </div>
          )}
        </div>
      </div>
      <div className="panel">
        <h3>
          Curva XYZ — regularidade da venda
          <span className="dir">8 semanas completas + esta semana à parte · pedidos + venda física{f.plat ? ` · ${nomePlat(f.plat)}` : ""}</span>
          <button type="button" className="btn btn-mini" onClick={() => setRegrasDlg({ AX: String(regras.AX), AY: String(regras.AY), BX: String(regras.BX), folgaFila: String(regras.folgaFila) })}>
            Regras do estoque
          </button>
        </h3>
        <div className="ana-matriz">
          <div></div>
          <div className="cab">X · regular</div>
          <div className="cab">Y · oscila</div>
          <div className="cab">Z · de vez em quando</div>
          {["A", "B", "C"].map((a) => (
            <FragmentoLinha key={a} a={a} xyz={xyz} />
          ))}
        </div>
        {xyz.some((x) => x.poucoHistorico) && (
          <p className="hint" style={{ margin: "6px 14px" }}>* pouco histórico (menos de 4 semanas completas desde a 1ª venda) — a letra X/Y/Z ainda pode mudar; o estoque sugerido já segue o ritmo recente.</p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Vendas por semana</th>
                <th className="num">
                  Esta semana{" "}
                  <Ajuda texto={`Vendas de segunda até hoje (${diasAtual} de 7 dias). Fica fora da média e da variação (a semana ainda não fechou), mas conta no A/B/C e no estoque sugerido.`} />
                </th>
                <th className="num">Média/sem</th>
                <th className="num">Variação</th>
                <th>ABC·XYZ</th>
                <th>O que fazer</th>
                <th>
                  Estoque sugerido{" "}
                  <Ajuda texto="Sugestão, o app não controla estoque. Vendas/dia = o MAIOR entre a média das 8 semanas, a das 2 últimas e o ritmo desta semana até hoje (acelerou, sobe na hora; esfriou, volta pela média). Manter = vendas/dia × (dias de cobertura da classe + tempo pra reimprimir) + folga pela oscilação, arredondado pra chapa cheia. Reimprimir quando cair pra = o que vende enquanto a próxima chapa fica pronta. A/B “sob pedido” acelerando (≥ 0,5 venda/dia e ≥ 2× a média) e produto de temporada passam a ter estoque." />
                </th>
              </tr>
            </thead>
            <tbody>
              {xyz.map((x) => (
                <tr key={x.chave}>
                  <td>
                    <b>{x.nome}</b>
                    {x.sazonal && <span className="ana-chip">❄ temporada</span>}
                  </td>
                  <td>
                    <span style={{ whiteSpace: "nowrap" }}><Mini v={x.v} /> <span className="faint">{x.v.join(" · ")}</span></span>
                  </td>
                  <td className="num">{x.atual ? <b>{x.atual}</b> : <span className="faint">0</span>}</td>
                  <td className="num">{x.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                  <td className="num">{x.media > 0 ? pct(x.cv, 0) : "—"}</td>
                  <td>
                    <span className={`ana-selo ${x.abc}`}>{x.abc}</span>{" "}
                    <b title={x.poucoHistorico ? `Pouco histórico: 1ª venda em ${x.primeiraVenda?.slice(8, 10)}/${x.primeiraVenda?.slice(5, 7)} — a letra ainda pode mudar` : undefined}>
                      {x.xyz}
                      {x.poucoHistorico && <sup className="faint">*</sup>}
                    </b>
                  </td>
                  <td>
                    <span className={`ana-chip ${x.acao === "estoque" ? "op" : x.acao === "revisar" ? "at" : ""}`}>{x.titulo}</span>
                  </td>
                  <td>
                    {x.manter > 0 ? (
                      <>
                        manter <b>{x.manter}</b> prontos · reimprimir quando cair pra <b>{x.reimprimir}</b>
                        {x.chapa > 1 && <div className="faint">chapa de {x.chapa}</div>}
                      </>
                    ) : (
                      <span className="faint">sob pedido</span>
                    )}
                  </td>
                </tr>
              ))}
              {!xyz.length && (
                <tr>
                  <td colSpan={8} className="faint">Sem vendas nas últimas 8 semanas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}
      {regrasDlg && (
        <EditarDialog titulo="Regras do estoque sugerido" onCancelar={() => setRegrasDlg(null)} onSalvar={() => salvarRegras(regrasDlg)} salvarLabel="Salvar regras">
          <p className="hint" style={{ marginTop: 0 }}>
            Dias de venda que ficam prontos em estoque, por classe. As outras classes ficam sob pedido (0). Folga da fila = dias até a impressora começar a chapa nova.
          </p>
          <div className="grid-auto">
            {[
              ["AX", "AX · vende toda semana e dá lucro (dias)"],
              ["AY", "AY · dá lucro mas oscila (dias)"],
              ["BX", "BX · regular, lucro médio (dias)"],
              ["folgaFila", "Folga da fila (dias)"],
            ].map(([k, rot]) => (
              <div className="field" key={k}>
                <label>{rot}</label>
                <input type="number" min="0" step="1" value={regrasDlg[k]} onChange={(e) => setRegrasDlg((p) => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-mini" onClick={() => setRegrasDlg({ AX: String(ESTOQUE_PADRAO.AX), AY: String(ESTOQUE_PADRAO.AY), BX: String(ESTOQUE_PADRAO.BX), folgaFila: String(ESTOQUE_PADRAO.folgaFila) })}>
            voltar ao padrão
          </button>
        </EditarDialog>
      )}
    </>
  );
}

function FragmentoLinha({ a, xyz }) {
  const ACAO = { AX: "estoque", AY: "estoque", BX: "estoque", AZ: "pedido", BY: "pedido", BZ: "pedido", CX: "pedido", CY: "revisar", CZ: "revisar" };
  const TIT = { AX: "Estoque", AY: "Estoque pequeno", BX: "Estoque pequeno", AZ: "Sob pedido", BY: "Sob pedido", BZ: "Sob pedido", CX: "Sob pedido", CY: "Revisar", CZ: "Revisar ou tirar" };
  return (
    <>
      <div className="rot">
        <span className={`ana-selo ${a}`}>{a}</span>
      </div>
      {["X", "Y", "Z"].map((z) => {
        const ps = xyz.filter((x) => x.abc === a && x.xyz === z);
        return (
          <div key={z} className={`cel ${ACAO[a + z]}`}>
            <b>
              {a}
              {z} · {TIT[a + z]}
            </b>
            {ps.length ? (
              ps.map((x) => {
                // Exceção da tabela (ritmo recente): o quadro mostra o que fazer AGORA junto da classe.
                const exc = x.manter > 0 && ACAO[a + z] !== "estoque" ? (x.titulo.startsWith("Temporada") ? `❄ estoque ${x.manter} (temporada)` : `↑ estoque ${x.manter} (acelerando)`) : null;
                return (
                  <div key={x.chave}>
                    {x.nome + (x.sazonal && !exc ? " ❄" : "")}
                    {exc && <span className="ana-chip op" style={{ marginLeft: 4 }}>{exc}</span>}
                  </div>
                );
              })
            ) : (
              <span className="faint">—</span>
            )}
          </div>
        );
      })}
    </>
  );
}
