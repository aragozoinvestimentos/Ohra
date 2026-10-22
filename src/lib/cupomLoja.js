import { lucroNoPreco, lucroMinimoAceitavel } from "./escada.js";

// Cupom de desconto da loja FORA da live (19/10/2026, decisão do Gustavo): no
// canal sem rampa (ex.: TikTok — canal da live) o produto fica no preço pela
// margem e todo desconto é por CUPOM. Conta ÚNICA aqui:
// - cupomMaximo: maior % inteiro que ainda deixa o lucro ≥ o mínimo aceitável
//   (margem mínima ou lucro mínimo em R$, o maior), com as taxas do canal no
//   preço COM o cupom (a comissão cai junto; a faixa pode mudar);
// - sugestão: fora da live até metade do máximo, na live até 80% — a live
//   precisa ser sempre o melhor negócio;
// - simularCupom: um cupom (% ou R$, pedido mínimo opcional) em UMA unidade do
//   item (o pior caso: pedido de 1 peça paga a taxa fixa inteira).
export const FRACAO_FORA_LIVE = 0.5;
export const FRACAO_LIVE = 0.8;
export const PCT_MAX = 90;
const cent = (v) => Math.round(v * 100) / 100;

function noPreco({ canal, preco, custo, peso, cfg }, desconto) {
  const novo = cent(preco - desconto);
  if (!(novo > 0)) return { novo, lucro: -Infinity, minimo: 0 };
  const lucro = lucroNoPreco(canal, novo, custo, peso, cfg);
  return { novo, lucro: lucro == null ? null : cent(lucro), minimo: cent(lucroMinimoAceitavel(novo, cfg)) };
}

export function cupomMaximo(x) {
  if (!(x?.preco > 0) || !x.canal) return null;
  const sem = noPreco(x, 0);
  if (sem.lucro == null) return null;
  let pct = 0;
  for (let d = 1; d <= PCT_MAX; d++) {
    const r = noPreco(x, (x.preco * d) / 100);
    if (r.lucro == null || r.lucro < r.minimo - 0.004) break;
    pct = d;
  }
  const r = noPreco(x, (x.preco * pct) / 100);
  return {
    pct,
    valor: cent((x.preco * pct) / 100),
    lucroSem: sem.lucro,
    minimoSem: sem.minimo,
    semEspaco: sem.lucro < sem.minimo - 0.004,
    lucroNoMax: r.lucro,
    foraLive: Math.floor(pct * FRACAO_FORA_LIVE),
    live: Math.floor(pct * FRACAO_LIVE),
  };
}

// cupom = { tipo: "pct" | "valor", valor, minimo? (pedido mínimo em R$) }
export function descontoDoCupom(cupom, total) {
  const v = Number(cupom?.valor) || 0;
  if (!(v > 0)) return 0;
  if (Number(cupom.minimo) > 0 && total < Number(cupom.minimo) - 0.004) return 0;
  return cent(cupom.tipo === "valor" ? Math.min(v, total) : (total * v) / 100);
}

export function simularCupom(x, cupom) {
  if (!(x?.preco > 0) || !x.canal) return null;
  const alcanca = !(Number(cupom?.minimo) > 0) || x.preco >= Number(cupom.minimo) - 0.004;
  const desconto = descontoDoCupom(cupom, x.preco);
  const r = noPreco(x, desconto);
  const estado = !alcanca ? "nao-alcanca" : r.lucro == null ? "sem-dado" : r.lucro < 0 ? "prejuizo" : r.lucro < r.minimo - 0.004 ? "abaixo" : "cabe";
  return { alcanca, desconto, clientePaga: r.novo, lucro: r.lucro, minimo: r.minimo, estado };
}

// O cupom de fora da live não pode ser tão bom quanto o da live.
export function comparaComLive(cupom, pctLive) {
  const live = Number(pctLive) || 0;
  if (!(live > 0) || !(Number(cupom?.valor) > 0)) return null;
  if (cupom.tipo === "pct") return Number(cupom.valor) >= live ? "igual-ou-maior" : "menor";
  return null; // R$ fixo × % — a tabela mostra item a item
}

// ---------- Cupons ATIVOS da loja (22/10/2026) ----------
// O que já está ligado na plataforma (ex.: Shopee 2% acima de R$ 5 · 5% acima de
// R$ 20), por canal, em lojas.config_escada.cupons = { canal_id: [faixas] } —
// faixa = { minimo, tipo: "pct" | "valor", valor, teto? } (mesmo formato do cupom
// da live; vale a MAIOR faixa alcançada). Sem SQL. Só informa: nenhum preço muda.
export { descontoNoPedido, textoFaixa } from "./live.js";
import { descontoNoPedido } from "./live.js";

export function cuponsAtivos(cfgLoja, canalId) {
  const l = cfgLoja?.cupons?.[canalId];
  if (!Array.isArray(l)) return [];
  return l
    .map((f) => ({ minimo: Number(f.minimo) || 0, tipo: f.tipo === "valor" ? "valor" : "pct", valor: Number(f.valor) || 0, teto: Number(f.teto) || null }))
    .filter((f) => f.valor > 0)
    .sort((a, b) => a.minimo - b.minimo);
}

/**
 * O cupom ativo num pedido de UMA unidade no preço que o cliente paga (o pior
 * caso: taxa fixa inteira). x = { canal, preco, custo, peso, cfg }.
 * → null (sem cupom no canal) | { faixa, desconto, clientePaga, lucro, minimo, estado: "nao-alcanca"|"cabe"|"abaixo"|"prejuizo" }
 */
export function comCupomAtivo(x, faixas) {
  if (!faixas?.length || !(x?.preco > 0) || !x.canal) return null;
  const { idx, desconto } = descontoNoPedido(faixas, x.preco);
  if (idx < 0) return { faixa: null, desconto: 0, clientePaga: x.preco, lucro: null, minimo: null, estado: "nao-alcanca" };
  const r = noPreco(x, desconto);
  const estado = r.lucro == null ? "nao-alcanca" : r.lucro < 0 ? "prejuizo" : r.lucro < r.minimo - 0.004 ? "abaixo" : "cabe";
  return { faixa: faixas[idx], desconto, clientePaga: r.novo, lucro: r.lucro, minimo: r.minimo, estado };
}

/**
 * Cupom ideal da loja: o MAIOR % em que os itens que somam ≥ `cobertura` (80%) das
 * VENDAS (peso = unidades dos últimos 90 dias) ainda ficam com lucro ≥ o mínimo.
 * Item que não vendeu pesa pouco (0,2) — o catálogo só manda quando não há venda.
 * lista = [{ max (cupomMaximo), vendas }] → { pct, cobertura, porVendas } | null
 */
export const COBERTURA_CUPOM = 0.8;
export function cupomIdeal(lista, cobertura = COBERTURA_CUPOM) {
  const ls = (lista || []).filter((x) => x.max && !x.max.semEspaco);
  if (!ls.length) return null;
  const temVenda = ls.some((x) => x.vendas > 0);
  const peso = (x) => (temVenda ? (x.vendas > 0 ? x.vendas : 0.2) : 1);
  const total = ls.reduce((t, x) => t + peso(x), 0) + (lista || []).filter((x) => x.max?.semEspaco).reduce((t, x) => t + peso(x), 0);
  let pct = 0;
  for (let p = 1; p <= 30; p++) {
    const ok = ls.filter((x) => x.max.pct >= p).reduce((t, x) => t + peso(x), 0);
    if (ok / total >= cobertura - 1e-9) pct = p;
    else break;
  }
  return { pct, cobertura, porVendas: temVenda };
}

/**
 * Cupom REAL dos pedidos importados: desconto do pedido rateado (o cupom/desconto
 * do vendedor — no TikTok é o único que conta) ÷ valor bruto, nos últimos `dias`.
 * linhas = pedidos enriquecidos (valido, canal_id, data, bruto, desconto_pedido).
 */
export function cupomReal(linhas, canalId, hoje, dias = 90) {
  const d = new Date(`${hoje}T12:00:00`);
  d.setDate(d.getDate() - dias);
  const de = d.toISOString().slice(0, 10);
  let bruto = 0;
  let desc = 0;
  const peds = new Set();
  const comCupom = new Set();
  for (const l of linhas || []) {
    if (!l.valido || l.origem === "fisico" || l.canal_id !== canalId || String(l.data) < de) continue;
    bruto += Number(l.bruto) || 0;
    const dp = Number(l.desconto_pedido) || 0;
    desc += dp;
    peds.add(l.pedido);
    if (dp > 0) comCupom.add(l.pedido);
  }
  if (!(bruto > 0)) return null;
  return { pct: desc / bruto, desconto: cent(desc), bruto: cent(bruto), pedidos: peds.size, comCupom: comCupom.size };
}
