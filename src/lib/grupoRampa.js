// Anúncio com VÁRIOS itens tratado como UM anúncio (plano de 14/10/2026,
// schema v54) — conta ÚNICA de:
// • Ads do anúncio inteiro (Crescimento → Ads): UMA linha "Anúncio: X";
//   ROAS de equilíbrio pelo MIX de vendas das opções (Vendas do mês /
//   importação da Shopee); sem vendas, o da opção com o pior equilíbrio.
// • Rampa do anúncio inteiro: degraus em % do preço salvo de CADA opção
//   (ex.: 90 → 95 → 100); todas as opções sobem juntas, só pela promo (o
//   riscado fica fixo), e a opção mais barata nunca fica abaixo do que a
//   regra de 4× da Shopee permite. Os portões usam as vendas e avaliações do
//   anúncio inteiro. Por dentro, a rampa "vira" um produto com preço = ticket
//   médio do anúncio (pct × ticket no alvo) e lucro = lucro médio por venda,
//   e a mesma `estadoRampa` (rampa.js) decide.
// • Itens que só existem dentro de um anúncio (`itensSoNoGrupo`) saem dos
//   avisos individuais de rampa e da lista de Ads (entram pelo anúncio).
import { calcularAnuncio, descontoDoItem, lucroNoPreco } from "./escada.js";
import { anuncioFixo, riscadoFixoDe, anuncioNoRiscado } from "./rampaAnuncio.js";
import { idDoItemOpcao, opcoesDoGrupo, vendasPorOpcao, vitrineDaOpcao, gruposPorItem, RAZAO_MAX_SHOPEE } from "./anunciosGrupo.js";
import { estadoRampa } from "./rampa.js";
import { itemTipoDoId } from "./variacoes.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const centavoAcima = (x) => Math.ceil(x * 100 - 1e-6) / 100;

// "+ Rampa de anúncio com vários itens" (topo do Crescimento e o diálogo da
// rampa de produto) abre o diálogo de RampaGrupo.jsx por este evento.
export const EVENTO_INICIAR_GRUPO = "ohra:iniciar-rampa-grupo";
export const iniciarRampaGrupo = () => window.dispatchEvent(new Event(EVENTO_INICIAR_GRUPO));

export const PCT_INICIO_GRUPO = 90; // degrau inicial sugerido (% do preço salvo)
export const PASSO_GRUPO = 5; // +5 pontos por degrau

// Itens que só existem dentro de anúncio(s) com vários itens: estão numa
// opção e NÃO têm anúncio próprio fora (produto com variações de quantidade
// soltas, com preço salvo, continua tendo o anúncio dele — mesma regra da Anunciar).
export function itensSoNoGrupo({ grupos, itens, precos }) {
  const mapa = gruposPorItem(grupos);
  const out = new Set();
  for (const id of mapa.keys()) {
    const item = itens.find((i) => i.id === id);
    if (!item) continue;
    if (id.startsWith("p:")) {
      const pid = id.slice(2);
      const soltas = itens.some((v) => v.id.startsWith("v:") && v.produtoId === pid && !mapa.has(v.id) && (precos || []).some((p) => p.item_tipo === "variacao" && p.item_id === v.id.slice(2)));
      if (soltas) continue;
    }
    out.add(id);
  }
  return out;
}

// Opções do grupo num canal, com o que é preciso pra conta (preço base =
// vitrine deste anúncio, senão o preço salvo do item no canal).
export function opcoesNoCanal({ grupo, canal, itens, precos, cfgDoProduto }) {
  const out = [];
  opcoesDoGrupo(grupo).forEach((o, idx) => {
    const id = idDoItemOpcao(o);
    const item = itens.find((i) => i.id === id) || null;
    if (!item || !canal) return;
    const tipo = itemTipoDoId(id);
    const salvo = (precos || []).find((p) => p.item_tipo === tipo && p.item_id === id.slice(2) && p.canal_id === canal.id);
    const vitrine = vitrineDaOpcao(o, canal);
    const base = vitrine || (salvo && num(salvo.preco) > 0 ? num(salvo.preco) : null);
    if (!base) return;
    const cfg = cfgDoProduto ? cfgDoProduto(item.produtoId || (tipo === "produto" ? id.slice(2) : null)) : null;
    const lucroEm = (p) => lucroNoPreco(canal, p, num(item.custoTotal), num(item.peso), cfg);
    out.push({ idx, opcao: o, rotulo: o.rotulo || item.nome, item, itemId: id, base, salvo: salvo ? num(salvo.preco) : null, vitrine, lucroEm });
  });
  return out;
}

// Peso de cada opção pelo mix de vendas dos últimos 30 dias (vendas do
// anúncio importadas, vendas_organicas.grupo_id). Sem vendas → null.
export function mixDoGrupo({ grupo, organicas, itens, hoje, ops }) {
  const v = vendasPorOpcao({ grupo, registros: organicas, itens, hoje, dias: 30, lucroDe: () => 0 });
  if (!v || !(v.total > 0)) return null;
  const pesos = new Map();
  for (const l of v.linhas) pesos.set(l.idx, l.unidades / v.total);
  const soma = ops.reduce((t, o) => t + (pesos.get(o.idx) || 0), 0);
  if (!(soma > 0)) return null;
  return { pesos: new Map(ops.map((o) => [o.idx, (pesos.get(o.idx) || 0) / soma])), total: v.total };
}

// Preço de CADA opção num degrau (pct do preço base), respeitando a regra de
// 4×: o cliente da opção mais barata paga pelo menos o riscado da mais cara ÷ 4.
// O riscado de cada opção é o FIXO (já anunciado) ou o do alvo (preço base).
export function precosDoDegrau({ ops, pct, canal, itens, produtos, kits, publicacoes }) {
  const f = num(pct) / 100;
  const linhas = ops.map((o) => {
    const { desconto } = descontoDoItem(o.item.id, canal, { itens, produtos, kits });
    const fixo = o.vitrine ? null : riscadoFixoDe(o.item.id, canal.id, publicacoes);
    const riscado = fixo || calcularAnuncio(o.base, desconto)?.original || o.base;
    return { ...o, desconto, fixo, riscado };
  });
  const maisCaro = Math.max(...linhas.map((l) => l.riscado));
  const shopee = canal?.tipo === "shopee" || canal?.tipo === "tiktok";
  const piso4x = shopee && linhas.length > 1 ? centavoAcima(maisCaro / RAZAO_MAX_SHOPEE) : 0;
  return linhas.map((l) => {
    let real = cent(l.base * f);
    const pelo4x = real < piso4x - 0.004;
    if (pelo4x) real = piso4x;
    const an = l.fixo ? anuncioNoRiscado(real, l.fixo) : anuncioFixo(real, l.base, l.desconto);
    return { ...l, real, pelo4x, an: an ? { ...an, emRampa: f < 0.9995, vitrine: !!l.vitrine } : null, lucro: l.lucroEm(real) };
  });
}

// Ticket médio e lucro médio por venda do anúncio num degrau (pct).
// pesos null = todas iguais. → { ticket, lucro, empate, linhas }
export function economiaDoGrupo({ ops, pct, pesos, canal, itens, produtos, kits, publicacoes }) {
  const linhas = precosDoDegrau({ ops, pct, canal, itens, produtos, kits, publicacoes });
  if (!linhas.length) return null;
  const w = (l) => (pesos ? pesos.get(l.idx) || 0 : 1 / linhas.length);
  const ticket = linhas.reduce((t, l) => t + w(l) * l.real, 0);
  const lucro = linhas.reduce((t, l) => t + w(l) * (l.lucro ?? 0), 0);
  return { ticket, lucro, empate: lucro > 0 ? ticket / lucro : null, linhas };
}

// Equilíbrio do anúncio pro Ads: pelo mix; sem vendas, o da opção com o PIOR
// equilíbrio (mais exigente). → { preco, lucro, empate, pior, mix, lucroEm }
export function equilibrioDoGrupo({ ops, pct = 100, mix, canal, itens, produtos, kits, publicacoes }) {
  const e = economiaDoGrupo({ ops, pct, pesos: mix?.pesos || null, canal, itens, produtos, kits, publicacoes });
  if (!e) return null;
  let preco = e.ticket;
  let lucro = e.lucro;
  let pior = null;
  if (!mix) {
    for (const l of e.linhas) {
      const eq = l.lucro > 0 ? l.real / l.lucro : Infinity;
      if (!pior || eq > pior.eq) pior = { eq, l };
    }
    if (pior) {
      preco = pior.l.real;
      lucro = pior.l.lucro;
    }
  }
  // lucroEm(preço "do anúncio") — escala todas as opções juntas.
  const t100 = economiaDoGrupo({ ops, pct: 100, pesos: mix?.pesos || null, canal, itens, produtos, kits, publicacoes })?.ticket || preco;
  const lucroEm = (p) => economiaDoGrupo({ ops, pct: (p / t100) * 100, pesos: mix?.pesos || null, canal, itens, produtos, kits, publicacoes })?.lucro ?? null;
  return { preco, lucro, empate: lucro > 0 ? preco / lucro : null, pior: pior ? pior.l : null, mix, lucroEm, linhas: e.linhas };
}

// Degraus sugeridos (% do preço salvo): 90 → 95 → 100 (início editável).
export function sugerirDegrausGrupo(inicio = PCT_INICIO_GRUPO, passo = PASSO_GRUPO) {
  const a = Math.max(50, Math.min(100, Math.round(num(inicio))));
  const out = [];
  for (let p = a; p < 100; p += passo) out.push(p);
  out.push(100);
  return out;
}

/**
 * Estado da rampa do anúncio: converte os degraus (pct) em "preço do anúncio"
 * (pct × ticket no alvo) e chama a MESMA estadoRampa com o lucro médio por
 * venda. Registros guardam o pct em `preco`. → { est, pct, ticket100, ops, linhas (preços por opção no degrau atual) }
 */
export function estadoRampaGrupo({ rampa, registros, regras, grupo, canal, itens, produtos, kits, precos, publicacoes, cfgDoProduto, organicas, hoje, sazonal = null, funilLoja = null, adsAtivo = null, proximaCampanha = null }) {
  const ops = opcoesNoCanal({ grupo, canal, itens, precos, cfgDoProduto });
  if (!ops.length) return null;
  const mix = mixDoGrupo({ grupo, organicas, itens, hoje, ops });
  const pesos = mix?.pesos || null;
  const econ = (pct) => economiaDoGrupo({ ops, pct, pesos, canal, itens, produtos, kits, publicacoes });
  const t100 = econ(100)?.ticket || 0;
  if (!(t100 > 0)) return null;
  const paraPreco = (pct) => (pct != null ? cent((num(pct) / 100) * t100) : null);
  const rampaV = { ...rampa, degraus: (rampa.degraus || []).map((d) => paraPreco(d)) };
  const regsV = (registros || []).map((g) => (g.preco != null ? { ...g, preco: paraPreco(g.preco) } : g));
  const lucroEm = (p) => (p > 0 ? econ((p / t100) * 100)?.lucro ?? null : null);
  const ctx = { canal, lucroEm, alvo: t100, funilLoja, adsAtivo, sazonal, proximaCampanha, grupo: true };
  const est = estadoRampa(rampaV, regsV, regras, ctx, hoje);
  const pctDe = (p) => (p != null && t100 > 0 ? Math.round((p / t100) * 1000) / 10 : null);
  const pctAtual = num((rampa.degraus || [])[est.i]);
  return { est, ops, mix, ticket100: t100, pctDe, pctAtual, linhas: precosDoDegrau({ ops, pct: pctAtual, canal, itens, produtos, kits, publicacoes }) };
}

/**
 * "O que digitar" das opções dos anúncios em rampa (degrau < 100%), no mesmo
 * formato do mapaAnuncioRampa: chave "itemId|canalId" (opções sem vitrine)
 * e "g:<grupoId>|<idx>|<canalId>" (opção vitrine — o preço é só do anúncio).
 */
export function mapaAnuncioGrupos({ rampasGrupo, grupos, canais, itens, produtos, kits, precos, publicacoes, cfgDoProduto }) {
  const out = new Map();
  for (const r of rampasGrupo || []) {
    const grupo = (grupos || []).find((g) => g.id === r.grupo_id);
    const canal = (canais || []).find((c) => c.id === r.canal_id);
    if (!grupo || !canal) continue;
    const d = (r.degraus || []).map(num);
    const pct = d[Math.max(0, Math.min(d.length - 1, r.degrau_atual ?? 0))];
    if (!(pct > 0) || Math.abs(pct - 100) < 0.05) continue;
    const ops = opcoesNoCanal({ grupo, canal, itens, precos, cfgDoProduto });
    for (const l of precosDoDegrau({ ops, pct, canal, itens, produtos, kits, publicacoes })) {
      if (!l.an) continue;
      const linha = { ...l.an, itemId: l.itemId, nome: l.rotulo, lucro: l.lucro, acima: pct > 100, degrau: l.real, alvo: l.base, grupo: grupo.nome, grupoId: grupo.id, pct };
      const chave = l.vitrine ? `g:${grupo.id}|${l.idx}|${canal.id}` : `${l.itemId}|${canal.id}`;
      if (!out.has(chave)) out.set(chave, linha);
      // Opção vitrine: o item sozinho (linha solta na Anunciar) segue o MESMO
      // preço do anúncio enquanto ele está em rampa — o anúncio inteiro decide.
      if (l.vitrine && !out.has(`${l.itemId}|${canal.id}`)) out.set(`${l.itemId}|${canal.id}`, linha);
    }
  }
  return out;
}
