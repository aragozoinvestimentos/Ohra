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
export const comissaoEm = (l, pctLoja) => (l.desligado ? 0 : l.propria != null ? l.propria : pctLoja);

/** Lucro de uma linha se um afiliado vender com `pct` (fração). Anúncio (com `variacoes`) = média pelo mix. */
export function comComissao(l, pct) {
  if (l?.variacoes) return comComissaoAnuncio(l, pct);
  const comissao = cent(num(l.base) * pct);
  const lucroCom = cent(num(l.lucro) - comissao);
  const situacao = l.insuficiente ? "insuficiente" : lucroCom < 0 ? "prejuizo" : lucroCom < num(l.lucroMin) - 0.004 ? "abaixo" : lucroCom < num(l.lucro) * FRACAO_AFILIADO - 0.004 ? "menos-metade" : "ok";
  return { comissao, lucroCom, situacao };
}

/** Maior % inteiro em que ESTE anúncio fica com ≥ metade do lucro (e ≥ o mínimo). 0 = nenhum. */
export function maxSeguroDoItem(l) {
  if (l?.variacoes) return l._max ?? 0;
  if (l.insuficiente || !(num(l.lucro) > 0)) return 0;
  let r = 0;
  for (let p = 1; p <= PCT_MAX_SIM; p++) {
    if (["ok"].includes(comComissao(l, p / 100).situacao)) r = p;
    else break;
  }
  return r;
}

/** Maior % inteiro em que a linha fica com lucro ≥ o lucro mínimo da loja (a trava). */
export function maxTravaDoItem(l) {
  if (l?.variacoes) return l._trava ?? 0;
  if (l.insuficiente || !(num(l.lucro) > 0)) return 0;
  let r = 0;
  for (let p = 1; p <= PCT_MAX_SIM; p++) {
    if (comComissao(l, p / 100).lucroCom >= num(l.lucroMin) - 0.004) r = p;
    else break;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Por ANÚNCIO (30/10/2026, aprovado pelo Gustavo): a Shopee põe o % no anúncio inteiro —
// não separa por variação. Uma linha = produto com as variações anunciadas no canal · kit
// com anúncio próprio · anúncio com vários itens. O "% deste anúncio" vale pra todas.
// Máximo seguro do anúncio: com ≥ 10 vendas em 90 dias, a média do máximo de cada
// variação pelo mix real; sem isso, a média das 2 variações mais apertadas. Trava sempre:
// nenhuma variação fica no prejuízo nem abaixo do lucro mínimo da loja.
// Variação que já não tem lucro antes do afiliado fica fora da conta (é assunto de preço).
export const MIN_VENDAS_MIX = 10;

const valida = (v) => !v.insuficiente && num(v.lucro) > 0;
const pesoDe = (a, v) => (a._porVendas ? num(v.vendas) : 1);

function comComissaoAnuncio(a, pct) {
  const vars = a.variacoes.map((v) => ({ ...v, ...comComissao(v, pct) }));
  const ok = vars.filter(valida);
  if (!ok.length) return { comissao: 0, lucroCom: 0, situacao: "insuficiente", vars };
  const tw = ok.reduce((t, v) => t + pesoDe(a, v), 0) || 1;
  const media = (f) => cent(ok.reduce((t, v) => t + f(v) * pesoDe(a, v), 0) / tw);
  const situacao = ok.some((v) => v.situacao === "prejuizo") ? "prejuizo" : ok.some((v) => v.situacao === "abaixo") ? "abaixo" : Math.round(pct * 100) > num(a._max) ? "menos-metade" : "ok";
  return { comissao: media((v) => v.comissao), lucroCom: media((v) => v.lucroCom), situacao, vars };
}

/** Máximo seguro e trava de um anúncio (ver acima). → { max, trava, regra: vendas|apertadas|unica|null } */
export function maxDoAnuncio(variacoes) {
  const ok = (variacoes || []).filter(valida);
  if (!ok.length) return { max: 0, trava: 0, regra: null, porVendas: false };
  const trava = Math.min(...ok.map(maxTravaDoItem));
  const vendas = ok.reduce((t, v) => t + num(v.vendas), 0);
  const porVendas = vendas >= MIN_VENDAS_MIX;
  let media;
  let regra;
  if (ok.length === 1) {
    media = maxSeguroDoItem(ok[0]);
    regra = "unica";
  } else if (porVendas) {
    media = ok.reduce((t, v) => t + maxSeguroDoItem(v) * num(v.vendas), 0) / vendas;
    regra = "vendas";
  } else {
    const dois = ok.map(maxSeguroDoItem).sort((x, y) => x - y).slice(0, 2);
    media = (dois[0] + dois[1]) / 2;
    regra = "apertadas";
  }
  return { max: Math.min(Math.floor(media + 1e-9), trava), trava, regra, porVendas };
}

/**
 * Agrupa as linhas por item (`linhasDaLoja`) em ANÚNCIOS no canal.
 * anunciado(item) = a variação está anunciada no canal (`cobraNoCanal`); soNoGrupo = Set dos
 * ids que só existem dentro de um anúncio com vários itens; grupos = anuncios_grupo.
 * → [{ chave, tipo produto|kit|grupo, id, item {id, nome, custoTotal}, canal, variacoes, vendas,
 *      preco (menor), precoMax, lucro (média), lucroMin, emRampa, cupom, propria, propriaRow,
 *      antigas [{ row, nome, pct, linha }], insuficiente, _max, _trava, _regra, _porVendas }]
 */
export function anunciosDaLoja({ linhas = [], itens = [], canalId, config = [], grupos = [], soNoGrupo = new Set(), anunciado = () => true }) {
  const grupoDoItem = new Map();
  for (const g of grupos || [])
    for (const o of Array.isArray(g.opcoes) ? g.opcoes : []) {
      if (!o?.item_id) continue;
      const id = `${o.item_tipo === "variacao" ? "v" : o.item_tipo === "kit" ? "k" : "p"}:${o.item_id}`;
      if (soNoGrupo.has(id) && !grupoDoItem.has(id)) grupoDoItem.set(id, g);
    }
  const mapa = new Map();
  const pegar = (tipo, id, nome) => {
    const k = `${tipo}|${id}|${canalId}`;
    if (!mapa.has(k)) mapa.set(k, { chave: k, tipo, id, nome, variacoes: [] });
    return mapa.get(k);
  };
  for (const l of linhas) {
    const it = l.item;
    const g = grupoDoItem.get(it.id);
    if (g) {
      pegar("grupo", g.id, `Anúncio: ${g.nome}`).variacoes.push(l);
      continue;
    }
    if (l.tipo === "kit") {
      pegar("kit", l.id, it.nome).variacoes.push(l);
      continue;
    }
    if (l.tipo === "variacao") {
      if (!it.produtoId || !anunciado(it)) continue;
      const pai = itens.find((x) => x.id === `p:${it.produtoId}`);
      pegar("produto", it.produtoId, pai?.nome || it.nome).variacoes.push(l);
      continue;
    }
    pegar("produto", l.id, it.nome).variacoes.push(l);
  }
  const out = [];
  for (const a of mapa.values()) {
    const vars = [...a.variacoes].sort((x, y) => num(x.preco) - num(y.preco));
    if (!vars.length) continue;
    const propriaRow =
      a.tipo === "grupo"
        ? (config || []).find((r) => r.canal_id === canalId && r.item_tipo === "grupo" && r.item_id === a.id && r.ativo !== false && num(r.comissao) > 0) || null
        : vars.find((v) => v.tipo === a.tipo && v.id === a.id)?.propriaRow || null;
    // Afiliado DESLIGADO neste anúncio (30/10/2026): linha do anúncio em afiliado_config com
    // ativo = false — você tirou ele da campanha na Shopee ("Remover"). Guarda a comissão própria
    // (se havia) pra voltar igual ao religar.
    const tipoRow = a.tipo === "grupo" ? "grupo" : a.tipo;
    const linhaAnuncio = (config || []).find((r) => r.canal_id === canalId && r.item_tipo === tipoRow && r.item_id === a.id) || null;
    const desligado = !!linhaAnuncio && linhaAnuncio.ativo === false;
    const antigas = vars.filter((v) => v.propriaRow && v.propriaRow !== propriaRow).map((v) => ({ row: v.propriaRow, nome: v.item.nome, pct: num(v.propriaRow.comissao), linha: v }));
    const m = maxDoAnuncio(vars);
    const ok = vars.filter(valida);
    const base = { _porVendas: m.porVendas };
    const tw = ok.reduce((t, v) => t + pesoDe(base, v), 0);
    const lucro = ok.length ? cent(ok.reduce((t, v) => t + num(v.lucro) * pesoDe(base, v), 0) / (tw || 1)) : null;
    const primeira = vars[0];
    out.push({
      chave: a.chave,
      tipo: a.tipo,
      id: a.id,
      item: { id: a.tipo === "grupo" ? `g:${a.id}` : `${a.tipo === "kit" ? "k" : "p"}:${a.id}`, nome: a.nome, custoTotal: num(primeira.item.custoTotal) },
      canal: primeira.canal,
      variacoes: vars,
      vendas: vars.reduce((t, v) => t + num(v.vendas), 0),
      preco: num(primeira.preco),
      base: num(primeira.preco),
      precoMax: num(vars[vars.length - 1].preco),
      lucro,
      lucroMin: Math.max(0, ...ok.map((v) => num(v.lucroMin))),
      emRampa: vars.some((v) => v.emRampa),
      cupom: Math.max(0, ...vars.map((v) => num(v.cupom))),
      propria: desligado ? null : propriaRow ? num(propriaRow.comissao) : null,
      propriaRow: desligado ? null : propriaRow,
      desligado,
      linhaAnuncio,
      antigas,
      insuficiente: !ok.length && vars.every((v) => v.insuficiente),
      _max: m.max,
      _trava: m.trava,
      _regra: m.regra,
      _porVendas: m.porVendas,
    });
  }
  return out.sort((x, y) => y.vendas - x.vendas || x.item.nome.localeCompare(y.item.nome));
}

/** Variação de um anúncio com a comissão: quanto do lucro o afiliado leva. */
export function parteDoAfiliado(v, pct) {
  const c = comComissao(v, pct);
  const leva = num(v.lucro) > 0 ? c.comissao / num(v.lucro) : null;
  return { ...c, leva, passaMetade: leva != null && leva > FRACAO_AFILIADO + 1e-9, semLucro: !(num(v.lucro) > 0) };
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
 * Comissão sugerida e teto (em % inteiro): sugerida = o menor máximo seguro entre os mais
 * vendidos (anúncio: pela regra do mix/2 mais apertadas); teto = o menor máximo da trava (≥ o lucro mínimo).
 * Item que já não tem lucro (≤ 0) não entra (não há metade a dividir).
 */
export function sugestaoComissaoLoja(linhas) {
  const top = maisVendidos(linhas);
  const temLucro = (l) => (l.variacoes ? l.variacoes.some(valida) : num(l.lucro) > 0 && !l.insuficiente);
  const decide = linhas.filter((l) => top.has(l.chave) && temLucro(l) && l.propria == null && !l.desligado);
  if (!decide.length) return { sugerida: null, teto: null, decide: 0 };
  // sugerida nunca passa do teto (produto de lucro pequeno: metade dele já fica abaixo do mínimo)
  const teto = Math.min(...decide.map(maxTravaDoItem));
  return { sugerida: Math.min(...decide.map(maxSeguroDoItem), teto), teto, decide: decide.length };
}

/** Simulador: contagem por situação no % (fração). */
export function simularComissaoLoja(linhas, pct) {
  const r = { ok: 0, menosMetade: 0, abaixo: 0, prejuizo: 0, insuficiente: 0, desligado: 0, linhas: [] };
  for (const l of linhas) {
    const em = comissaoEm(l, pct);
    if (l.desligado) {
      // sem afiliado: mostra o que aconteceria com o % da loja, mas a situação é "desligado"
      const seLigar = num(l.linhaAnuncio?.comissao) > 0 ? num(l.linhaAnuncio.comissao) : pct;
      const se = comComissao(l, seLigar);
      r.linhas.push({ ...l, ...se, em: 0, emSeLigar: seLigar, comissao: 0, lucroCom: l.lucro, situacaoSeLigar: se.situacao, situacao: "desligado", maxSeguro: maxSeguroDoItem(l) });
      r.desligado++;
      continue;
    }
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
  const comAf = linhas.filter((l) => !l.desligado && (l.propria ?? comissao) > 0 && !l.insuficiente).map((l) => ({ ...l, em: l.propria ?? comissao, ...comComissao(l, l.propria ?? comissao) }));
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
