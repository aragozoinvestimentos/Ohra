// Comissão da LOJA pra afiliados (29/10/2026, aprovado pela prévia "Afiliados da Shopee").
// PURO. Na Shopee o vendedor põe UM % que vale pra qualquer produto da loja; o app
// confere todos de uma vez em vez de "ativar item por item".
// Regra do Gustavo: o afiliado fica com NO MÁXIMO METADE do lucro da venda, pelo
// PREÇO DE AGORA (degrau da rampa) e no pior caso com o cupom ativo da loja.
// Base da comissão = o que o cliente paga pelo produto, sem frete e sem o cupom;
// a taxa da Shopee continua por cima (o lucro já tem ela descontada).
import { comCupomAtivo } from "./cupomLoja.js";

export const FRACAO_AFILIADO = 0.5; // o afiliado leva no máximo metade do lucro
export const COBERTURA_AFILIADO = 0.8; // os itens que somam 80% das vendas decidem
export const PCT_MAX_SIM = 40;
export const DIAS_VENDAS = 90;

const num = (v) => Number(v) || 0;
const cent = (v) => Math.round(v * 100) / 100;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Unidades vendidas nos últimos 90 dias por `id_item|canal_id` (pedidos válidos). */
export function vendasPorItemCanal(pedidos, hoje, dias = DIAS_VENDAS) {
  const de = somarDias(hoje, -(dias - 1));
  const m = new Map();
  for (const p of pedidos || []) {
    if (!p.valido || !p.id_item || !p.canal) continue;
    const d = String(p.data || "").slice(0, 10);
    if (d < de || d > hoje) continue;
    const k = `${p.id_item}|${p.canal.id}`;
    m.set(k, (m.get(k) || 0) + (num(p.q) || 1));
  }
  return m;
}

/**
 * Linhas da comissão da loja num canal, a partir das linhas de comissão (`linhasComissao`,
 * que já trazem o preço de agora e o lucro): no pior caso com o cupom ativo (1 un.).
 * → [{ chave, item, tipo, id, canal, preco, base, lucro, lucroMin, emRampa, vendas, cupom }]
 */
export function linhasDaLoja({ linhasAf = [], canalId, faixasCupom = [], vendas = new Map() }) {
  const out = [];
  for (const l of linhasAf) {
    if (l.canal?.id !== canalId || l.lucro == null) continue;
    const it = l.item;
    const x = { canal: l.canal, preco: l.preco, custo: num(it.custoTotal), peso: num(it.peso), cfg: l.cfg };
    const c = comCupomAtivo(x, faixasCupom);
    const comCupom = c && c.lucro != null && c.desconto > 0;
    const base = comCupom ? c.clientePaga : l.preco;
    const lucro = comCupom ? c.lucro : l.lucro;
    out.push({
      chave: l.chave,
      item: it,
      tipo: l.tipo,
      id: l.id,
      canal: l.canal,
      preco: l.preco,
      base,
      lucro,
      lucroMin: comCupom ? num(c.minimo) : num(l.lucroMin),
      emRampa: !!l.emRampa,
      cupom: comCupom ? c.desconto : 0,
      vendas: vendas.get(`${it.id}|${canalId}`) || 0,
    });
  }
  return out.sort((a, b) => b.vendas - a.vendas || a.item.nome.localeCompare(b.item.nome));
}

/** Lucro de uma linha se um afiliado vender com `pct` (fração). */
export function comComissao(l, pct) {
  const comissao = cent(num(l.base) * pct);
  const lucroCom = cent(num(l.lucro) - comissao);
  const situacao = lucroCom < 0 ? "prejuizo" : lucroCom < num(l.lucroMin) - 0.004 ? "abaixo" : lucroCom < num(l.lucro) * FRACAO_AFILIADO - 0.004 ? "menos-metade" : "ok";
  return { comissao, lucroCom, situacao };
}

/** Os itens que somam ≥ 80% das vendas (sem venda nenhuma = todos). → Set de chaves */
export function maisVendidos(linhas, cobertura = COBERTURA_AFILIADO) {
  const temVenda = linhas.some((l) => l.vendas > 0);
  if (!temVenda) return new Set(linhas.map((l) => l.chave));
  const ord = [...linhas].filter((l) => l.vendas > 0).sort((a, b) => b.vendas - a.vendas);
  const total = ord.reduce((t, l) => t + l.vendas, 0);
  const s = new Set();
  let acc = 0;
  for (const l of ord) {
    if (acc >= cobertura * total - 1e-9) break;
    s.add(l.chave);
    acc += l.vendas;
  }
  return s;
}

/**
 * Comissão sugerida e teto (em % inteiro): sugerida = maior % em que TODOS os mais vendidos
 * ficam com ≥ metade do lucro; teto = maior % em que todos eles ficam ≥ o lucro mínimo.
 * Item que já não tem lucro (≤ 0) não entra (não há metade a dividir).
 */
export function sugestaoComissaoLoja(linhas) {
  const top = maisVendidos(linhas);
  const decide = linhas.filter((l) => top.has(l.chave) && num(l.lucro) > 0);
  if (!decide.length) return { sugerida: null, teto: null, decide: 0 };
  const maior = (cond) => {
    let r = 0;
    for (let p = 1; p <= PCT_MAX_SIM; p++) {
      if (decide.every((l) => cond(comComissao(l, p / 100), l))) r = p;
      else break;
    }
    return r;
  };
  // sugerida nunca passa do teto (produto de lucro pequeno: metade dele já fica abaixo do mínimo)
  const teto = maior((c, l) => c.lucroCom >= num(l.lucroMin) - 0.004);
  return { sugerida: Math.min(maior((c, l) => c.lucroCom >= num(l.lucro) * FRACAO_AFILIADO - 0.004), teto), teto, decide: decide.length };
}

/** Simulador: contagem por situação no % (fração). */
export function simularComissaoLoja(linhas, pct) {
  const r = { ok: 0, menosMetade: 0, abaixo: 0, prejuizo: 0, linhas: [] };
  for (const l of linhas) {
    const c = comComissao(l, pct);
    r.linhas.push({ ...l, ...c });
    if (c.situacao === "ok") r.ok++;
    else if (c.situacao === "menos-metade") r.menosMetade++;
    else if (c.situacao === "abaixo") r.abaixo++;
    else r.prejuizo++;
  }
  return r;
}

/** Proposta pra um afiliado: produtos escolhidos × % → lucro médio e vendas pra pagar a amostra. */
export function resumoProposta(linhas, chaves, pct, custoAmostra = 0) {
  const sel = linhas.filter((l) => chaves.includes(l.chave)).map((l) => ({ ...l, ...comComissao(l, pct) }));
  if (!sel.length) return { n: 0, media: null, vendasParaPagar: null, ruins: 0, linhas: [] };
  const media = cent(sel.reduce((t, l) => t + l.lucroCom, 0) / sel.length);
  return {
    n: sel.length,
    media,
    ruins: sel.filter((l) => l.situacao === "abaixo" || l.situacao === "prejuizo").length,
    vendasParaPagar: custoAmostra > 0 && media > 0 ? Math.ceil(custoAmostra / media) : null,
    linhas: sel,
  };
}

/**
 * Resultado do afiliado nos últimos `dias` (registros de vendas via afiliado — hoje os
 * antigos à mão; depois o arquivo da Shopee): vendas, comissão, lucro depois → veredito.
 * registros = afiliado_registros; lucroPorVenda(reg) = lucro da venda antes da comissão.
 */
export function resultadoAfiliados(registros, { hoje, dias = 30, lucroPorVenda }) {
  const de = somarDias(hoje, -(dias - 1));
  let vendas = 0;
  let comissao = 0;
  let lucro = 0;
  for (const r of registros || []) {
    const d = String(r.data || "").slice(0, 10);
    if (d < de || d > hoje || !(num(r.vendas) > 0)) continue;
    vendas += num(r.vendas);
    comissao += num(r.comissao);
    lucro += num(r.vendas) * num(lucroPorVenda ? lucroPorVenda(r) : 0);
  }
  const depois = cent(lucro - comissao);
  return { vendas, comissao: cent(comissao), lucro: cent(lucro), depois, temDados: vendas > 0, veredito: !vendas ? null : depois < 0 ? "prejuizo" : "valeu" };
}


/**
 * Avisos do Início (só leem; decisão aqui): resultado dos 30 dias no prejuízo (Resolver),
 * mais vendidos abaixo do mínimo com a comissão registrada (Atenção), dá pra subir (Oportunidade).
 * → pendências no formato do montarPendencias.
 */
export function avisosComissaoLoja({ linhas, canal, comissao, resultado }) {
  const out = [];
  const ir = { aba: "crescimento", pedido: { sub: "afiliados" } };
  if (resultado?.temDados && resultado.veredito === "prejuizo")
    out.push({ id: "af|prejuizo", grupo: "resolver", ordem: 2, tom: "bad", titulo: "Afiliados te deram prejuízo nos últimos 30 dias", texto: `${canal?.nome || ""} · comissão ${resultado.comissao.toFixed(2).replace(".", ",")} → lucro depois ${resultado.depois.toFixed(2).replace(".", ",")} — baixe a comissão da loja ou desligue`, ir, rotulo: "Abrir Afiliados" });
  if (!canal || !comissao || !linhas?.length) return out;
  const top = maisVendidos(linhas);
  const ruins = linhas.filter((l) => top.has(l.chave) && ["abaixo", "prejuizo"].includes(comComissao(l, comissao).situacao));
  if (ruins.length)
    out.push({ id: `af|loja-abaixo|${canal.id}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `Comissão da loja de ${Math.round(comissao * 100)}%: ${ruins.length} ${ruins.length === 1 ? "dos mais vendidos fica" : "dos mais vendidos ficam"} abaixo do mínimo`, texto: `${canal.nome} · ${ruins.slice(0, 3).map((l) => l.item.nome).join(", ")}${ruins.length > 3 ? ` e mais ${ruins.length - 3}` : ""} — se um afiliado vender, sobra menos que o seu mínimo`, ir, rotulo: "Ver no simulador" });
  const sug = sugestaoComissaoLoja(linhas);
  if (!ruins.length && sug.sugerida && sug.sugerida >= Math.round(comissao * 100) + 2)
    out.push({ id: `af|loja-subir|${canal.id}`, grupo: "oportunidade", ordem: 4, tom: "good", titulo: `Dá pra subir a comissão da loja pra ${sug.sugerida}%`, texto: `${canal.nome} · hoje ${Math.round(comissao * 100)}% — os que mais vendem continuam com metade do lucro`, ir, rotulo: "Simular" });
  return out;
}
