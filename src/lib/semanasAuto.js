// Semanas AUTOMÁTICAS (16/10/2026, "tudo ao vivo pela Atualizar dados
// dados"): a semana de cada produto em rampa / com Ads é montada na hora a
// partir do que foi importado — nada é gravado. O "Registrar semana" saiu.
//
// • Vendas = pedidos importados (Olist) dos dias da semana — a semana só FECHA
//   quando a plataforma tem pedidos em todos os 7 dias.
// • Funil (impressões, cliques, pedidos) = o relatório de Desempenho da Shopee
//   que mais cobre a semana (≥ 4 dias), proporcional a 7 dias.
// • Ads (gasto, cliques, vendas via Ads) = o andamento do CSV do Shopee Ads
//   (acumulado desde o início do período), pela diferença entre o fim e o
//   começo da semana — interpolado entre os envios.
// • Avaliações NÃO entram na semana: cada atualização do bloco Avaliações vira
//   um registro próprio (tipo "avaliacao"), lido pelos portões como antes.
//
// Corrente das semanas: começa em cada registro gravado (início da rampa,
// subida/descida, semana registrada à mão antes) e segue de 7 em 7 dias até o
// próximo registro gravado — nunca passa por cima de um registro de verdade.
// Os dias depois da última semana fechada viram o "parcial" (vendas até hoje),
// que conta nas vendas desde o degrau e no ritmo.

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
export const somarDiasIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// ---------- Ads: acumulado do período em qualquer dia ----------
// Pontos = (véspera do início, 0) + envios do andamento (historico + parcial).
// Depois do último envio: desconhecido (null), a não ser que o período já
// tenha acabado até ali.
function pontosDoPeriodo(p) {
  const par = p?.parcial;
  const m = new Map();
  for (const h of [...(Array.isArray(par?.historico) ? par.historico : []), ...(par?.ate ? [par] : [])])
    if (h?.ate) m.set(h.ate, { ate: h.ate, gasto: num(h.gasto), cliques: num(h.cliques), vendas: num(h.vendas) });
  const lista = [...m.values()].sort((a, b) => a.ate.localeCompare(b.ate));
  // O acumulado nunca diminui: envio antigo MAIOR que um mais novo (ex.: CSV de
  // antes de 19/10, com a campanha antiga contada 2×) fica no valor do mais
  // novo — senão a semana dele ganhava o "pico" e a seguinte não descontava
  // (Ads da semana passava do gasto total, 21/10/2026).
  for (let k = lista.length - 2; k >= 0; k--) {
    const x = lista[k];
    const y = lista[k + 1];
    lista[k] = { ...x, gasto: Math.min(x.gasto, y.gasto), cliques: Math.min(x.cliques, y.cliques), vendas: Math.min(x.vendas, y.vendas) };
  }
  return [{ ate: somarDiasIso(p.inicio, -1), gasto: 0, cliques: 0, vendas: 0 }, ...lista.filter((x) => x.ate >= p.inicio)];
}
export function acumuladoAdsEm(p, dia) {
  if (!p?.inicio || dia < p.inicio) return { gasto: 0, cliques: 0, vendas: 0 };
  const pts = pontosDoPeriodo(p);
  const ult = pts[pts.length - 1];
  if (dia >= ult.ate) {
    const fim = p.fim || null;
    if (dia === ult.ate || (fim && fim <= ult.ate)) return { gasto: ult.gasto, cliques: ult.cliques, vendas: ult.vendas };
    return null;
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    if (dia >= a.ate && dia <= b.ate) {
      const f = diasEntre(a.ate, b.ate) > 0 ? diasEntre(a.ate, dia) / diasEntre(a.ate, b.ate) : 1;
      return { gasto: a.gasto + (b.gasto - a.gasto) * f, cliques: a.cliques + (b.cliques - a.cliques) * f, vendas: a.vendas + (b.vendas - a.vendas) * f };
    }
  }
  return null;
}
/** Ads da semana [de, ate] somando os períodos → { gasto, cliques, vendas } | null (sem Ads ou sem envio cobrindo). */
export function adsDaSemana(periodos, de, ate) {
  const dentro = (periodos || []).filter((p) => p?.inicio && p.inicio <= ate && (!p.fim || p.fim >= de));
  if (!dentro.length) return null;
  const t = { gasto: 0, cliques: 0, vendas: 0 };
  let ate0 = null;
  for (const p of dentro) {
    const fim = acumuladoAdsEm(p, ate);
    const ini = acumuladoAdsEm(p, somarDiasIso(de, -1));
    if (!fim || !ini) return { desconhecido: true };
    t.gasto += Math.max(0, fim.gasto - ini.gasto);
    t.cliques += Math.max(0, fim.cliques - ini.cliques);
    t.vendas += Math.max(0, fim.vendas - ini.vendas);
    const u = p.parcial?.ate || null;
    if (u && (!ate0 || u > ate0)) ate0 = u;
  }
  const r = (x, c = 100) => Math.round(x * c) / c;
  return { gasto: r(t.gasto), cliques: Math.round(t.cliques), vendas: r(t.vendas, 10), ate: ate0 };
}

// ---------- Funil: relatório de Desempenho que mais cobre a semana ----------
// relatorios = [{ de, ate, impressoes, cliques, pedidos }] do item.
export function funilDaSemana(relatorios, de, ate) {
  let melhor = null;
  for (const r of relatorios || []) {
    if (!r?.de || !r?.ate) continue;
    const a = r.de > de ? r.de : de;
    const b = r.ate < ate ? r.ate : ate;
    const sobre = diasEntre(a, b) + 1;
    if (sobre < 4) continue;
    if (!melhor || sobre > melhor.sobre || (sobre === melhor.sobre && r.ate > melhor.r.ate)) melhor = { r, sobre };
  }
  if (!melhor) return null;
  const { r } = melhor;
  const len = Math.max(1, diasEntre(r.de, r.ate) + 1);
  const f = 7 / len;
  const v = (x) => (x == null ? null : Math.round(num(x) * f));
  return { impressoes: v(r.impressoes), cliques: v(r.cliques), pedidos: v(r.pedidos), de: r.de, ate: r.ate };
}

/**
 * Semanas automáticas de UM item × canal.
 * - gravados: registros gravados (rampa_registros do item, ou os semanais do
 *   item fora de rampa) — só a data importa (âncoras da corrente).
 * - inicioMin: âncora quando não há nenhum gravado (ex.: início do 1º período de Ads).
 * - vendasEm(de, ate) → unidades (pedidos válidos) · cobre(de, ate) → bool
 * - precoEm(diaInicio) → preço da semana · periodos (Ads) · funis (Desempenho)
 * → { semanas: [...], parcial: { de, ate, vendas } | null }
 */
export function semanasAutomaticas({ chave, gravados = [], inicioMin = null, hoje, vendasEm, cobre, precoEm, periodos = [], funis = [] }) {
  // Âncora = { data (a corrente começa aqui), ini (1º dia que o gravado cobre:
  // semana registrada = o período dela; marco = o próprio dia) }.
  const mapa = new Map();
  for (const g of gravados || []) {
    const data = String(g.data || "").slice(0, 10);
    if (!data) continue;
    const ini = g.tipo === "semana" ? String(g.periodo_inicio || somarDiasIso(data, -7)).slice(0, 10) : data;
    const x = mapa.get(data);
    if (!x || ini < x.ini) mapa.set(data, { data, ini });
  }
  if (inicioMin && !mapa.has(inicioMin)) mapa.set(inicioMin, { data: inicioMin, ini: inicioMin });
  const ancoras = [...mapa.values()].sort((x, y) => x.data.localeCompare(y.data));
  if (!ancoras.length || !hoje) return { semanas: [], parcial: null };
  const ontem = somarDiasIso(hoje, -1);
  const semanas = [];
  let parcial = null;
  for (let k = 0; k < ancoras.length; k++) {
    // a semana [a, b] não pode entrar no período coberto por um gravado depois
    const limite = ancoras.slice(k + 1).reduce((m, x) => (m == null || x.ini < m ? x.ini : m), null);
    const prox = ancoras[k + 1] || null;
    let a = ancoras[k].data;
    for (let n = 0; n < 200; n++) {
      const b = somarDiasIso(a, 6);
      if (b > ontem || (limite && b >= limite) || !cobre(a, b)) break;
      const ads = adsDaSemana(periodos, a, b);
      const fu = funilDaSemana(funis, a, b);
      semanas.push({
        id: `auto|${chave}|${a}`,
        auto: true,
        tipo: "semana",
        data: somarDiasIso(b, 1),
        periodo_inicio: a,
        criado_em: `${somarDiasIso(b, 1)}T00:00:00`,
        vendas: vendasEm(a, b),
        conhecidos: null,
        preco: precoEm(a),
        visualizacoes: fu?.impressoes ?? null,
        visitas: fu?.cliques ?? null,
        pedidos: fu?.pedidos ?? null,
        ads_gasto: ads && !ads.desconhecido ? ads.gasto : null,
        ads_cliques: ads && !ads.desconhecido ? ads.cliques : null,
        ads_vendas: ads && !ads.desconhecido ? ads.vendas : null,
        fontes: { pedidos: true, desempenho: fu ? `${dm(fu.de)}–${dm(fu.ate)}` : null, ads: ads ? (ads.desconhecido ? "falta CSV" : `CSV até ${dm(ads.ate)}`) : null },
      });
      a = somarDiasIso(b, 1);
    }
    // Dias soltos antes da próxima âncora (24/10/2026 — venda do Kit Leão de
    // 22/10 sumia quando a rampa ganhava um marco em 23/10): viram uma "sobra"
    // — conta nas vendas no total, mas NÃO é semana (fica fora das regras
    // semanais, que não devem extrapolar 1–2 dias pra 7).
    if (prox && limite) {
      const fim = somarDiasIso(limite, -1) < ontem ? somarDiasIso(limite, -1) : ontem;
      if (fim >= a && cobre(a, fim)) {
        const v = vendasEm(a, fim);
        if (v) semanas.push({ id: `auto|${chave}|sobra|${a}`, auto: true, tipo: "sobra", data: somarDiasIso(fim, 1), periodo_inicio: a, criado_em: `${somarDiasIso(fim, 1)}T00:00:00`, vendas: v, conhecidos: null, preco: precoEm(a), fontes: { pedidos: true } });
      }
    }
    // depois da última âncora: dias em aberto até hoje = parcial (ao vivo)
    if (!prox && a <= hoje) parcial = { de: a, ate: hoje, vendas: vendasEm(a, hoje) };
  }
  return { semanas, parcial };
}

/** Junta gravados + automáticos (ordem por data; o gravado vem antes no mesmo dia). */
export function juntarRegistros(gravados, automaticos) {
  return [...(gravados || []), ...(automaticos || [])].sort(
    (x, y) => String(x.data).localeCompare(String(y.data)) || (x.auto ? 1 : 0) - (y.auto ? 1 : 0) || String(x.criado_em || "").localeCompare(String(y.criado_em || ""))
  );
}

// ---------- Avaliações (schema v58) ----------
// Cada linha de `avaliacoes_produto` = o TOTAL que a plataforma mostra naquele
// dia (por estrela, ou só o total no modo simples). Vira um registro
// "avaliacao" pros portões: avaliações (total), nota e 1–2★ NOVAS desde a
// atualização anterior.
export const MODO_SIMPLES_MIN = 30;
export const MODO_SIMPLES_NOTA = 4.7;
export const estrelasDe = (l) => [num(l?.e5), num(l?.e4), num(l?.e3), num(l?.e2), num(l?.e1)];
export const temEstrelas = (l) => ["e5", "e4", "e3", "e2", "e1"].some((k) => l?.[k] != null);
export function notaDasEstrelas(e) {
  const t = e.reduce((s, x) => s + x, 0);
  return t > 0 ? Math.round(((e[0] * 5 + e[1] * 4 + e[2] * 3 + e[3] * 2 + e[4]) / t) * 100) / 100 : null;
}
/** Linhas do item × canal em ordem → registros "avaliacao". */
export function registrosDeAvaliacao(linhas) {
  const ord = [...(linhas || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const out = [];
  let ultE = null; // última contagem por estrela conhecida
  for (const l of ord) {
    const e = temEstrelas(l) ? estrelasDe(l) : null;
    const total = l.total != null ? num(l.total) : e ? e.reduce((s, x) => s + x, 0) : null;
    let ruins = num(l.ruins_novas);
    let novas3 = num(l.ruins_novas) + num(l.tres_novas);
    if (e && ultE) {
      ruins = Math.max(0, e[3] - ultE[3]) + Math.max(0, e[4] - ultE[4]);
      novas3 = ruins + Math.max(0, e[2] - ultE[2]);
    }
    const nota = l.nota != null ? num(l.nota) : e ? notaDasEstrelas(e) : null;
    out.push({ id: `aval|${l.id}`, auto: true, avaliacaoId: l.id, tipo: "avaliacao", data: String(l.data).slice(0, 10), criado_em: l.criado_em || null, avaliacoes: total, nota, avaliacoes_ruins: ruins, ate3: novas3, simples: !e });
    if (e) ultE = e;
  }
  return out;
}
/** Situação do item pro bloco Avaliações: última linha, modo simples? */
export function situacaoAvaliacoes(linhas) {
  const regs = registrosDeAvaliacao(linhas);
  const ult = regs[regs.length - 1] || null;
  const ord = [...(linhas || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const ultCompleta = [...ord].reverse().find(temEstrelas) || null;
  const simples = !!(ult && num(ult.avaliacoes) >= MODO_SIMPLES_MIN && ult.nota != null && ult.nota >= MODO_SIMPLES_NOTA);
  return { ultima: ult, ultimaLinha: ord[ord.length - 1] || null, estrelas: ultCompleta ? estrelasDe(ultCompleta) : null, simples };
}

/**
 * Anúncios que VENDERAM numa plataforma desde a última atualização das
 * avaliações (ou nos últimos 30 dias, se nunca atualizou) — chips do bloco
 * Avaliações e aviso do Início. anuncioDoPedido(l) → { tipo, id } | null.
 * → [{ chave: "tipo|id", tipo, id, vendas, desde, ultima, dias }] (mais vendas primeiro)
 */
export function vendeuSemAvaliacao({ pedidos, canalId, anuncioDoPedido, avaliacoes, hoje }) {
  const ultima = new Map();
  for (const a of avaliacoes || []) {
    if (a.canal_id !== canalId) continue;
    const k = `${a.item_tipo}|${a.item_id}`;
    const d = String(a.data).slice(0, 10);
    if (!ultima.has(k) || d > ultima.get(k)) ultima.set(k, d);
  }
  const padrao = somarDiasIso(hoje, -30);
  const m = new Map();
  for (const l of pedidos || []) {
    if (!l.valido || l.canal_id !== canalId) continue;
    const an = anuncioDoPedido(l);
    if (!an) continue;
    const k = `${an.tipo}|${an.id}`;
    const desde = ultima.get(k) || padrao;
    if (!(l.data > desde)) continue;
    const x = m.get(k) || { chave: k, tipo: an.tipo, id: an.id, vendas: 0, desde, ultima: ultima.get(k) || null, primeiraVenda: l.data };
    x.vendas += l.q || 1;
    if (l.data < x.primeiraVenda) x.primeiraVenda = l.data;
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ ...x, dias: diasEntre(x.primeiraVenda, hoje) })).sort((a, b) => b.vendas - a.vendas);
}
