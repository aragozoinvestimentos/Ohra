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
export const MINIMO_AFILIADO = 0.04; // mínimo da Shopee (Gustavo, 29/10/2026: tratar 4% como geral; editável em Regras)
export const DIAS_TESTE = 15; // teste de cada comissão: 15 dias → "alguém se afiliou ou vendeu?"

/** Mínimo de comissão da plataforma (fração), da loja (`config_escada.afiliados.minimo`). */
export const minimoAfiliado = (cfgLoja) => {
  const m = Number(cfgLoja?.afiliados?.minimo);
  return m > 0 ? m : MINIMO_AFILIADO;
};

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
export function linhasDaLoja({ linhasAf = [], canalId, faixasCupom = [], vendas = new Map(), config = [] }) {
  const out = [];
  for (const l of linhasAf) {
    if (l.canal?.id !== canalId || l.lucro == null) continue;
    const it = l.item;
    const x = { canal: l.canal, preco: l.preco, custo: num(it.custoTotal), peso: num(it.peso), cfg: l.cfg };
    const c = comCupomAtivo(x, faixasCupom);
    const comCupom = c && c.lucro != null && c.desconto > 0;
    // Pior caso (29/10/2026): a comissão sobre o preço SEM o cupom (não se sabe se a
    // Shopee desconta o cupom da base) e o seu lucro COM o cupom.
    const lucro = comCupom ? c.lucro : l.lucro;
    const row = (config || []).find((r) => r.canal_id === canalId && r.item_tipo === l.tipo && r.item_id === l.id && r.ativo !== false && num(r.comissao) > 0);
    out.push({
      chave: l.chave,
      item: it,
      tipo: l.tipo,
      id: l.id,
      canal: l.canal,
      preco: l.preco,
      base: l.preco,
      lucro,
      lucroMin: comCupom ? num(c.minimo) : num(l.lucroMin),
      emRampa: !!l.emRampa,
      cupom: comCupom ? c.desconto : 0,
      vendas: vendas.get(`${it.id}|${canalId}`) || 0,
      // Comissão própria do anúncio (substitui a da loja, nunca soma).
      propria: row ? num(row.comissao) : null,
      propriaRow: row || null,
      // Sem custo cadastrado não dá pra dizer se aguenta afiliado.
      insuficiente: !(num(it.custoTotal) > 0),
    });
  }
  return out.sort((a, b) => b.vendas - a.vendas || a.item.nome.localeCompare(b.item.nome));
}

/** Comissão em vigor numa linha: a própria do anúncio ou a da loja (fração). */
export const comissaoEm = (l, pctLoja) => (l.propria != null ? l.propria : pctLoja);

/** Lucro de uma linha se um afiliado vender com `pct` (fração). */
export function comComissao(l, pct) {
  const comissao = cent(num(l.base) * pct);
  const lucroCom = cent(num(l.lucro) - comissao);
  const situacao = l.insuficiente ? "insuficiente" : lucroCom < 0 ? "prejuizo" : lucroCom < num(l.lucroMin) - 0.004 ? "abaixo" : lucroCom < num(l.lucro) * FRACAO_AFILIADO - 0.004 ? "menos-metade" : "ok";
  return { comissao, lucroCom, situacao };
}

/** Maior % inteiro em que ESTE anúncio fica com ≥ metade do lucro (e ≥ o mínimo). 0 = nenhum. */
export function maxSeguroDoItem(l) {
  if (l.insuficiente || !(num(l.lucro) > 0)) return 0;
  let r = 0;
  for (let p = 1; p <= PCT_MAX_SIM; p++) {
    if (["ok"].includes(comComissao(l, p / 100).situacao)) r = p;
    else break;
  }
  return r;
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
  const decide = linhas.filter((l) => top.has(l.chave) && num(l.lucro) > 0 && l.propria == null && !l.insuficiente);
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
  const r = { ok: 0, menosMetade: 0, abaixo: 0, prejuizo: 0, insuficiente: 0, linhas: [] };
  for (const l of linhas) {
    const em = comissaoEm(l, pct);
    const c = comComissao(l, em);
    r.linhas.push({ ...l, ...c, em, maxSeguro: maxSeguroDoItem(l) });
    if (c.situacao === "ok") r.ok++;
    else if (c.situacao === "menos-metade") r.menosMetade++;
    else if (c.situacao === "abaixo") r.abaixo++;
    else if (c.situacao === "insuficiente") r.insuficiente++;
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
 * Teste de uma comissão (15 dias): t = { pct, inicio, resposta?: "nao"|"sim", em? }.
 * → { estado: andamento | avaliar | subir | maximo | ok, dias, avaliarEm, proximo }
 * "subir" só quando você respondeu que ninguém se afiliou/vendeu E o próximo ponto
 * cabe no máximo seguro — nunca só porque passaram os dias.
 */
export function estadoTeste(t, hoje, maxSeguro, dias = DIAS_TESTE) {
  if (!t?.inicio) return null;
  const d = Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${t.inicio}T12:00:00`)) / 86400000);
  const avaliarEm = somarDias(t.inicio, dias);
  const pct = Math.round(num(t.pct) * 100);
  const proximo = pct + 1;
  if (d < dias && !t.resposta) return { estado: "andamento", dias: d, avaliarEm, proximo };
  if (!t.resposta) return { estado: "avaliar", dias: d, avaliarEm, proximo };
  if (t.resposta === "sim") return { estado: "ok", dias: d, avaliarEm, proximo };
  return maxSeguro && proximo <= maxSeguro ? { estado: "subir", dias: d, avaliarEm, proximo } : { estado: "maximo", dias: d, avaliarEm, proximo };
}

const brl = (v) => num(v).toFixed(2).replace(".", ",");

/**
 * Avisos do Início (só leem; decisão aqui). Afiliado NÃO mexe em preço (regra do
 * Gustavo): os textos só falam de comissão. Entram:
 * - resultado dos 30 dias no prejuízo (Resolver);
 * - com a comissão EM VIGOR (loja ou própria), anúncios no prejuízo (Resolver) ou com o
 *   afiliado levando mais da metade do lucro / abaixo do mínimo (Atenção) — todos os
 *   anúncios, não só os mais vendidos;
 * - teste de 15 dias: avaliar (Atenção) e "dá pra subir 1 ponto" (Oportunidade).
 */
export function avisosComissaoLoja({ linhas, canal, comissao, resultado, testes = {}, hoje }) {
  const out = [];
  const ir = { aba: "crescimento", pedido: { sub: "afiliados" } };
  if (resultado?.temDados && resultado.veredito === "prejuizo")
    out.push({ id: "af|prejuizo", grupo: "resolver", ordem: 2, tom: "bad", titulo: "Afiliados te deram prejuízo nos últimos 30 dias", texto: `${canal?.nome || ""} · comissão R$ ${brl(resultado.comissao)} → lucro depois R$ ${brl(resultado.depois)} — baixe a comissão ou desligue`, ir, rotulo: "Abrir Afiliados" });
  if (!canal || !linhas?.length) return out;
  const nomes = (ls) => `${ls.slice(0, 3).map((l) => l.item.nome).join(", ")}${ls.length > 3 ? ` e mais ${ls.length - 3}` : ""}`;
  const comAf = linhas.filter((l) => (l.propria ?? comissao) > 0 && !l.insuficiente).map((l) => ({ ...l, em: l.propria ?? comissao, ...comComissao(l, l.propria ?? comissao) }));
  const prej = comAf.filter((l) => l.situacao === "prejuizo");
  const ruins = comAf.filter((l) => l.situacao === "abaixo" || l.situacao === "menos-metade");
  if (prej.length)
    out.push({ id: `af|com-prejuizo|${canal.id}`, grupo: "resolver", ordem: 2, tom: "bad", titulo: `Afiliado: ${prej.length} ${prej.length === 1 ? "anúncio dá" : "anúncios dão"} prejuízo se um afiliado vender`, texto: `${canal.nome} · ${nomes(prej)} — use uma comissão menor só nesse anúncio ou baixe a da loja`, ir, rotulo: "Ver em Afiliados" });
  if (ruins.length)
    out.push({ id: `af|loja-abaixo|${canal.id}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `Afiliado: em ${ruins.length} ${ruins.length === 1 ? "anúncio ele leva" : "anúncios ele leva"} mais da metade do seu lucro`, texto: `${canal.nome} · ${nomes(ruins)} — comissão menor só nesse anúncio, ou baixe a da loja`, ir, rotulo: "Ver em Afiliados" });
  for (const [k, t] of Object.entries(testes || {})) {
    if (!k.endsWith(`|${canal.id}`)) continue;
    const ehLoja = k.startsWith("loja|");
    const l = ehLoja ? null : linhas.find((x) => `item|${x.tipo}|${x.id}|${canal.id}` === k);
    const atual = ehLoja ? comissao : l?.propria;
    if (!atual || Math.round(atual * 100) !== Math.round(num(t.pct) * 100)) continue; // teste de um % que não está mais em vigor
    const max = ehLoja ? sugestaoComissaoLoja(linhas).sugerida : maxSeguroDoItem(l);
    const e = estadoTeste(t, hoje, max);
    const quem = ehLoja ? "Comissão da loja" : `${l.item.nome}`;
    if (e?.estado === "avaliar")
      out.push({ id: `af|teste|${k}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `${quem}: ${e.dias} dias com afiliado a ${Math.round(num(t.pct) * 100)}% — alguém se afiliou ou vendeu?`, texto: `${canal.nome} · confira no painel da Shopee (Afiliados) e responda no app`, ir, rotulo: "Responder" });
    else if (e?.estado === "subir")
      out.push({ id: `af|subir|${k}`, grupo: "oportunidade", ordem: 4, tom: "good", titulo: `${quem}: testar a comissão de afiliado em ${e.proximo}%`, texto: `${canal.nome} · ninguém se afiliou em ${DIAS_TESTE} dias e ${e.proximo}% ainda deixa metade do lucro com você`, ir, rotulo: "Abrir Afiliados" });
  }
  return out;
}
