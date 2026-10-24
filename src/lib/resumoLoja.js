// Início → "Como a loja está" e "Seus produtos" (24/10/2026). Só lê os pedidos
// importados (enriquecer: pago, lucro com custo e taxas de HOJE) e o gasto de
// Ads pela MESMA conta do teto / Resumo do mês (gastoAdsNaJanela).
import { gastoAdsNaJanela } from "./ads.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
const mesAnterior = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Ads de todos os períodos (produtos, anúncios com vários itens, campanha da loja) entre de e ate. */
export function adsNoPeriodo(linhasAds, de, ate) {
  const ls = [...(linhasAds?.linhas || []), ...(linhasAds?.lojaLinha ? [linhasAds.lojaLinha] : [])];
  let t = 0;
  for (const l of ls) t += gastoAdsNaJanela(l.periodos || [], l.semanas || [], de, ate);
  return Math.round(t * 100) / 100;
}

/** Pedidos válidos de de a ate → { pedidos, unidades, vendas (pago), lucro (antes do Ads), semCusto }. */
export function somaPedidos(linhas, de, ate) {
  const ped = new Set();
  const t = { unidades: 0, vendas: 0, lucro: 0, semCusto: 0 };
  for (const p of linhas || []) {
    if (!p.valido) continue;
    const d = String(p.data).slice(0, 10);
    if (d < de || d > ate) continue;
    ped.add(p.pedido);
    t.unidades += num(p.q);
    t.vendas += num(p.pago);
    if (p.lucro == null) t.semCusto++;
    t.lucro += num(p.lucro);
  }
  return { ...t, pedidos: ped.size };
}

/**
 * Mês até hoje × o mesmo pedaço do mês anterior (dia 1 até o mesmo dia).
 * → { de, ate, atual, antes, ads, adsAntes, ritmo (vendas projetadas no mês) }
 */
export function comoEstaALoja({ pedidos, linhasAds, hoje }) {
  const mes = hoje.slice(0, 7);
  const de = `${mes}-01`;
  const dia = Number(hoje.slice(8, 10));
  const ma = mesAnterior(mes);
  const fimAnt = fimDoMes(ma);
  const ateAnt = `${ma}-${String(dia).padStart(2, "0")}` > fimAnt ? fimAnt : `${ma}-${String(dia).padStart(2, "0")}`;
  const atual = somaPedidos(pedidos, de, hoje);
  const antes = somaPedidos(pedidos, `${ma}-01`, ateAnt);
  const ads = adsNoPeriodo(linhasAds, de, hoje);
  const adsAntes = adsNoPeriodo(linhasAds, `${ma}-01`, ateAnt);
  const diasMes = Number(fimDoMes(mes).slice(8, 10));
  return {
    de,
    ate: hoje,
    deAntes: `${ma}-01`,
    ateAntes: ateAnt,
    atual: { ...atual, ads, depoisAds: atual.lucro - ads },
    antes: { ...antes, ads: adsAntes, depoisAds: antes.lucro - adsAntes },
    ritmo: dia ? (atual.vendas / dia) * diasMes : 0,
  };
}

/** Variação em % (null sem base). */
export const variacao = (agora, antes) => (antes > 0 ? (agora - antes) / antes : null);

/**
 * Produtos dos últimos 7 dias × os 7 antes, pelo PRODUTO (variações somam no pai;
 * kit e anúncio com vários itens pelo item vendido). → [{ chave, itemId, nome, canais, vendas, lucro, vendasAntes }]
 */
export function produtosDaSemana(pedidos, hoje, n = 6) {
  const ini = somarDias(hoje, -6);
  const iniAnt = somarDias(hoje, -13);
  const fimAnt = somarDias(hoje, -7);
  const m = new Map();
  for (const p of pedidos || []) {
    if (!p.valido || !p.item) continue;
    const d = String(p.data).slice(0, 10);
    if (d < iniAnt || d > hoje) continue;
    const itemId = p.item.produtoId ? `p:${p.item.produtoId}` : p.id_item;
    const nome = p.item.produtoId ? String(p.item.nome).split(" — ")[0] : p.item.nome;
    const x = m.get(itemId) || { chave: itemId, itemId, nome, canais: new Map(), vendas: 0, lucro: 0, vendasAntes: 0, semCusto: false };
    if (d >= ini) {
      x.vendas += num(p.q);
      x.lucro += num(p.lucro);
      if (p.lucro == null) x.semCusto = true;
      if (p.canal) x.canais.set(p.canal.id, p.canal);
    } else if (d <= fimAnt) x.vendasAntes += num(p.q);
    m.set(itemId, x);
  }
  return [...m.values()]
    .map((x) => ({ ...x, canais: [...x.canais.values()] }))
    .filter((x) => x.vendas > 0 || x.vendasAntes > 0)
    .sort((a, b) => b.vendas - a.vendas || b.lucro - a.lucro || b.vendasAntes - a.vendasAntes)
    .slice(0, n);
}

// ---- Análise → Diagnóstico (24/10/2026) ----

const CATS_FORA_FIXAS = ["anuncios", "filamento", "mercadoria", "embalagem", "retirada", "aporte", "saldo_inicial"];
/**
 * Despesas FIXAS do mês = contas recorrentes (Dinheiro → Contas fixas) de saída
 * ativas no mês. Ads (vem dos CSVs), material/embalagem (já no custo) e
 * retirada ficam fora — senão contaria duas vezes. → { total, itens: [{ descricao, valor }] }
 */
export function despesasFixasDoMes(lancamentos, mes) {
  const ini = `${mes}-01`;
  const fim = fimDoMes(mes);
  const itens = [];
  for (const l of lancamentos || []) {
    if (l.recorrencia !== "mensal" || l.tipo !== "saida" || CATS_FORA_FIXAS.includes(l.categoria)) continue;
    if (String(l.data_prevista).slice(0, 10) > fim) continue;
    if (l.recorrencia_ate && String(l.recorrencia_ate).slice(0, 10) < ini) continue;
    itens.push({ descricao: l.descricao || l.categoria || "conta fixa", valor: num(l.valor) });
  }
  return { total: itens.reduce((t, x) => t + x.valor, 0), itens };
}

/** Lucro líquido do mês: margem de contribuição (lucro dos pedidos) − Ads − despesas fixas. */
export function lucroLiquidoDoMes({ pedidos, linhasAds, lancamentos, mes, hoje }) {
  const de = `${mes}-01`;
  const fim = fimDoMes(mes);
  const ate = fim < hoje ? fim : hoje;
  const p = somaPedidos(pedidos, de, ate);
  const ads = adsNoPeriodo(linhasAds, de, ate);
  const fixas = despesasFixasDoMes(lancamentos, mes);
  return { mes, de, ate, ...p, ads, fixas, contribuicao: p.lucro, depoisAds: p.lucro - ads, liquido: fixas.itens.length ? p.lucro - ads - fixas.total : null, fechado: fim < hoje };
}
export { mesAnterior };

/** Pedidos válidos agrupados (total pago e lucro por pedido). canalId null = todos. */
export function pedidosAgrupados(linhas, de, ate, canalId = null) {
  const m = new Map();
  for (const p of linhas || []) {
    if (!p.valido || p.origem === "fisico") continue;
    if (canalId && p.canal_id !== canalId) continue;
    const d = String(p.data).slice(0, 10);
    if (d < de || d > ate) continue;
    const x = m.get(p.pedido) || { pedido: p.pedido, total: 0, lucro: 0, itens: 0 };
    x.total += num(p.pago);
    x.lucro += num(p.lucro);
    x.itens += num(p.q);
    m.set(p.pedido, x);
  }
  return [...m.values()];
}

/**
 * Compra mínima de cupom pelos PEDIDOS REAIS. Pra cada mínimo: quantos pedidos
 * JÁ passam (o cupom vira só desconto pra eles), quantos estão logo abaixo
 * (até R$ 10 — os que o cupom pode puxar), o custo do cupom no período e
 * quantos pedidos a mais (ou clientes que sobem o carrinho) pagariam esse custo.
 * desconto = fração (0,05) ou valor fixo em R$ (tipo "valor"). Projeção, não garantia.
 */
export function analiseCompraMinima(peds, minimos, { tipo = "pct", desconto = 0.05, teto = null } = {}) {
  const n = peds.length;
  if (!n) return { n: 0, ticket: null, linhas: [] };
  const total = peds.reduce((t, p) => t + p.total, 0);
  const lucro = peds.reduce((t, p) => t + p.lucro, 0);
  const ticket = total / n;
  const lucroMedio = lucro / n;
  const margem = total ? lucro / total : 0;
  const desc = (v) => (tipo === "valor" ? Math.min(desconto, v) : Math.min(v * desconto, teto || Infinity));
  const linhas = minimos.map((min) => {
    const acima = peds.filter((p) => p.total >= min);
    const abaixo = peds.filter((p) => p.total < min && p.total >= min - 10);
    const custo = acima.reduce((t, p) => t + desc(p.total), 0);
    const falta = abaixo.length ? abaixo.reduce((t, p) => t + (min - p.total), 0) / abaixo.length : null;
    // Um pedido logo abaixo que sobe até o mínimo rende: (mínimo − total) × margem − desconto no mínimo.
    const ganhoSubir = falta != null ? falta * margem - desc(min) : null;
    return {
      minimo: min,
      acima: acima.length,
      pctAcima: acima.length / n,
      abaixo: abaixo.length,
      faltaMedia: falta,
      adicionar: Math.max(0, min - ticket),
      custo,
      empateNovos: lucroMedio > 0 ? custo / lucroMedio : null,
      ganhoSubir,
    };
  });
  return { n, ticket, lucroMedio, margem, total, lucro, linhas };
}

/** Ticket médio maior com os MESMOS pedidos (projeção): faturamento e margem de contribuição pela margem atual. */
export function simularTicket(peds, tickets) {
  const n = peds.length;
  if (!n) return [];
  const total = peds.reduce((t, p) => t + p.total, 0);
  const lucro = peds.reduce((t, p) => t + p.lucro, 0);
  const margem = total ? lucro / total : 0;
  return tickets.map((tk) => ({ ticket: tk, faturamento: tk * n, contribuicao: tk * n * margem, dif: tk * n * margem - lucro }));
}
