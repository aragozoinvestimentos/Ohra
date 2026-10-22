// Ficha do anúncio — etapa 2: anúncio com VÁRIOS itens (schema v46,
// tabela anuncios_grupo). Ex.: Kit de Natal com a variação "Conjunto"
// (Letreiro / Kit Básico / Kit Completo) ou "Tamanho" (Vaso P/M/G como
// produtos separados). Cada opção aponta pra um item cadastrado (produto,
// variação ou kit); o preço de cada linha vem do PREÇO SALVO desse item no
// canal (riscado fixo se já anunciado; Rampa = preço de agora) — nada aqui
// grava preço. Funções puras: a Ficha, a Anunciar e o Lançamento usam estas.
import { calcularAnuncio, descontoDoItem } from "./escada.js";
import { anuncioDoItem } from "./rampaAnuncio.js";
import { alertaPreco } from "./estrategia.js";

export const LIMITE_NOME_OPCAO = 30; // Shopee: nome de cada opção de variação
export const RAZAO_MAX_SHOPEE = 4;
const PREFIXO = { produto: "p", variacao: "v", kit: "k" };

export const idGrupo = (id) => `g:${id}`;
export const ehIdGrupo = (id) => typeof id === "string" && id.startsWith("g:");
export const idDoItemOpcao = (o) => (o?.item_tipo && o?.item_id ? `${PREFIXO[o.item_tipo] || "p"}:${o.item_id}` : null);

// Opções gravadas (jsonb) → lista limpa, na ordem do anúncio.
export function opcoesDoGrupo(grupo) {
  return (Array.isArray(grupo?.opcoes) ? grupo.opcoes : [])
    .filter((o) => o && o.item_id)
    .map((o) => ({
      rotulo: String(o.rotulo || "").trim(),
      item_tipo: o.item_tipo || "produto",
      item_id: o.item_id,
      sufixo_sku: String(o.sufixo_sku || "").trim(),
      vitrine: o.vitrine && o.vitrine.canal_id && Number(o.vitrine.preco) > 0 ? { canal_id: o.vitrine.canal_id, preco: Number(o.vitrine.preco) } : null,
    }));
}
// Preço VITRINE (Montar combinações): preço só desta opção neste anúncio e
// canal — o preço salvo do item, o anúncio dele sozinho e a rampa não mudam.
export function vitrineDaOpcao(o, canal) {
  return o?.vitrine && canal && o.vitrine.canal_id === canal.id && Number(o.vitrine.preco) > 0 ? Number(o.vitrine.preco) : null;
}

// Variação própria que combina com todas as opções (ex.: Cor).
export function variacao2DoGrupo(grupo) {
  const v = grupo?.variacao2;
  if (!v || !String(v.nome || "").trim()) return null;
  const opcoes = (Array.isArray(v.opcoes) ? v.opcoes : []).filter((o) => o && String(o.nome || "").trim());
  return opcoes.length ? { nome: String(v.nome).trim(), opcoes } : null;
}

// Item × canal: o que digitar (Rampa › riscado fixo › sugestão) e o mesmo
// no preço SALVO (pra regra de 4×, que nunca usa a promo da rampa).
export function anuncioNoCanal({ item, canal, precos, itens, produtos, kits, mapaRampa, publicacoes }) {
  if (!item || !canal) return { an: null, anSalvo: null };
  const tipo = item.id.startsWith("k:") ? "kit" : item.id.startsWith("v:") ? "variacao" : "produto";
  const s = precos.find((p) => p.item_tipo === tipo && p.item_id === item.id.slice(2) && p.canal_id === canal.id);
  const { desconto } = descontoDoItem(item.id, canal, { itens, produtos, kits });
  const anSalvo = s && Number(s.preco) > 0 ? anuncioDoItem({ itemId: item.id, canal, real: Number(s.preco), desconto, publicacoes }) : null;
  const ra = mapaRampa?.get(`${item.id}|${canal.id}`) || null;
  const an = ra
    ? { original: ra.original, promo: ra.promo, clientePaga: ra.clientePaga, real: ra.real, emRampa: true, acima: ra.acima, riscadoFixo: ra.riscadoFixo, acimaDoRiscado: ra.acimaDoRiscado }
    : anSalvo;
  return { an, anSalvo: anSalvo || an, salvo: s || null };
}

// SKU de cada opção (como a Ficha gera: SKU do item + sufixos) → opção.
// Vendas do mês/pedidos: a venda feita pelo SKU de uma opção vai pro ITEM
// daquela opção (19/10/2026: "Letreiro + 2 tigelas" caía no Letreiro pela
// regra de prefixo do SKU) e fica marcada com o anúncio.
export function skusDosGrupos(grupos, itens) {
  const m = new Map();
  const norm = (x) => String(x || "").trim().toUpperCase();
  for (const g of grupos || []) {
    const v2 = variacao2DoGrupo(g);
    for (const o of opcoesDoGrupo(g)) {
      const item = (itens || []).find((i) => i.id === idDoItemOpcao(o));
      if (!item?.sku) continue;
      for (const c of v2 ? v2.opcoes : [null]) {
        const suf = `${o.sufixo_sku || ""}${c?.sufixo || ""}`;
        const k = norm(`${item.sku}${suf}`);
        if (!m.has(k)) m.set(k, { grupoId: g.id, grupoNome: g.nome, itemId: item.id, rotulo: o.rotulo || item.nome, comSufixo: !!suf });
      }
    }
  }
  return m;
}

// A ficha do grupo num canal: uma linha por opção (× opção da variação 2).
export function fichaDoGrupo({ grupo, canal, itens, precos, produtos, kits, mapaRampa, publicacoes, clientePagaHoje }) {
  if (!grupo || !canal) return null;
  const opcoes = opcoesDoGrupo(grupo);
  const v2 = variacao2DoGrupo(grupo);
  const varNome = String(grupo.variacao_nome || "Conjunto").trim() || "Conjunto";
  const combos2 = v2 ? v2.opcoes : [null];
  const linhas = [];
  for (const [idx, o] of opcoes.entries()) {
    const item = itens.find((i) => i.id === idDoItemOpcao(o)) || null;
    const rotulo = o.rotulo || item?.nome || "—";
    const vitrine = vitrineDaOpcao(o, canal);
    let { an, anSalvo } = anuncioNoCanal({ item, canal, precos, itens, produtos, kits, mapaRampa, publicacoes });
    if (vitrine && item) {
      an = { ...calcularAnuncio(vitrine, descontoDoItem(item.id, canal, { itens, produtos, kits }).desconto), vitrine: true };
      anSalvo = an;
      // Anúncio inteiro em rampa (grupoRampa.js): a vitrine também desce/sobe no degrau.
      const ra = mapaRampa?.get(`g:${grupo.id}|${idx}|${canal.id}`);
      if (ra) an = { original: ra.original, promo: ra.promo, clientePaga: ra.clientePaga, real: ra.real, emRampa: true, vitrine: true, riscadoFixo: ra.riscadoFixo };
    }
    const valorCliente = item && an ? (vitrine ? an.clientePaga : clientePagaHoje?.(item, canal) ?? an.clientePaga) : null;
    const frete = item && an ? alertaPreco({ preco: an.real, canal, valorCliente }).frete : null;
    for (const c of combos2) {
      const sufixos = `${o.sufixo_sku || ""}${c?.sufixo || ""}`;
      linhas.push({
        chave: `${o.item_id}|${o.sufixo_sku}|${c?.sufixo || ""}`,
        opcao: o,
        rotulo,
        cor: c?.nome || null,
        item,
        sku: item?.sku ? `${item.sku}${sufixos}` : "",
        sufixos,
        semSku: !item?.sku,
        an: item ? an : null,
        anSalvo: item ? anSalvo : null,
        vitrine,
        frete,
      });
    }
  }
  const tabelaVar = [{ nome: varNome, opcoes: opcoes.map((o, i) => linhas.find((l) => l.opcao === opcoes[i])?.rotulo || o.rotulo) }];
  if (v2) tabelaVar.push({ nome: v2.nome, opcoes: v2.opcoes.map((x) => x.nome) });

  // Conferências
  const porOpcao = opcoes.map((o) => linhas.find((l) => l.opcao === o));
  const semItem = porOpcao.filter((l) => !l?.item);
  const semPreco = porOpcao.filter((l) => l?.item && !l.an);
  const semSku = porOpcao.filter((l) => l?.item && l.semSku);
  const nomesLongos = [...new Set(tabelaVar.flatMap((t) => t.opcoes))].filter((n) => String(n).length > LIMITE_NOME_OPCAO);
  const comPreco = porOpcao.filter((l) => l?.anSalvo);
  let regra4x = null;
  if (comPreco.length > 1) {
    const maisCara = comPreco.reduce((m, l) => (!m || l.anSalvo.original > m.anSalvo.original ? l : m), null);
    const maisBarata = comPreco.reduce((m, l) => (!m || l.anSalvo.clientePaga < m.anSalvo.clientePaga ? l : m), null);
    const razao = maisCara.anSalvo.original / maisBarata.anSalvo.clientePaga;
    regra4x = { razao, ok: razao <= RAZAO_MAX_SHOPEE + 1e-9, maisCara, maisBarata };
  }
  const freteAbaixo = porOpcao.filter((l) => l?.frete);
  const mlShein = canal.tipo === "ml" || canal.tipo === "shein";
  const nomesForaML = mlShein ? [varNome, v2?.nome].filter((n) => n && !["cor", "tamanho"].includes(n.toLowerCase())) : [];
  return { linhas, tabelaVar, varNome, v2, opcoes, semItem, semPreco, semSku, nomesLongos, regra4x, freteAbaixo, nomesForaML };
}

// Todos os ids de item (p:/v:/k:) que estão em algum grupo → [{ grupo, rotulo }].
export function gruposPorItem(grupos) {
  const m = new Map();
  for (const g of grupos || [])
    for (const o of opcoesDoGrupo(g)) {
      const id = idDoItemOpcao(o);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push({ grupo: g, rotulo: o.rotulo });
    }
  return m;
}

// "Qual opção vende" (3º Ficha): vendas do anúncio com vários itens importadas
// da Shopee (vendas_organicas.grupo_id, schema v53), por opção, nos últimos
// `dias` (pela data "Até" de cada importação). lucroDe(item, canalId, preco) =
// lucro de UMA unidade naquele preço (custo e taxas de hoje).
export const MIN_VENDAS_SUGESTAO = 10;
export function vendasPorOpcao({ grupo, registros, itens, hoje, dias = 30, lucroDe }) {
  if (!grupo) return null;
  const opcoes = opcoesDoGrupo(grupo);
  const corte = new Date(`${hoje}T12:00:00`);
  corte.setDate(corte.getDate() - dias);
  const desde = corte.toISOString().slice(0, 10);
  const doGrupo = (registros || []).filter((r) => r.grupo_id === grupo.id && String(r.data).slice(0, 10) > desde);
  const linhas = opcoes.map((o, idx) => {
    const id = idDoItemOpcao(o);
    const item = itens.find((i) => i.id === id) || null;
    const rs = doGrupo.filter((r) => `${PREFIXO[r.item_tipo] || "p"}:${r.item_id}` === id);
    const unidades = rs.reduce((t, r) => t + Number(r.unidades || 0), 0);
    const faturamento = rs.reduce((t, r) => t + Number(r.unidades || 0) * Number(r.preco || 0), 0);
    const lucro = item ? rs.reduce((t, r) => t + Number(r.unidades || 0) * (lucroDe(item, r.canal_id, Number(r.preco)) ?? 0), 0) : null;
    return { idx, rotulo: o.rotulo || item?.nome || "—", item, unidades, faturamento, lucro, vitrine: !!o.vitrine };
  });
  const total = linhas.reduce((t, l) => t + l.unidades, 0);
  for (const l of linhas) l.parte = total > 0 ? l.unidades / total : 0;
  const sugestoes = [];
  if (total >= MIN_VENDAS_SUGESTAO) {
    const top = linhas.reduce((m, l) => (!m || l.unidades > m.unidades ? l : m), null);
    for (const l of linhas)
      if (l.unidades === 0) sugestoes.push({ tipo: "atencao", texto: `${l.rotulo}: nenhuma venda em ${dias} dias — tire do anúncio ou mude o preço dessa opção.` });
    if (top && top.vitrine && top.parte >= 0.6)
      sugestoes.push({ tipo: "atencao", texto: `${Math.round(top.parte * 100)}% levam só ${top.rotulo} (a vitrine): o preço de entrada atrai, mas os kits não estão convencendo — destaque nas fotos a economia do kit.` });
    else if (top && !top.vitrine && top.parte >= 0.5)
      sugestoes.push({ tipo: "oportunidade", texto: `${top.rotulo} é a mais vendida (${Math.round(top.parte * 100)}%) — dá pra testar uma promo menor nela (preço uns 5% maior).` });
  }
  const datas = doGrupo.map((r) => String(r.data).slice(0, 10)).sort();
  return { linhas, total, dias, ultima: datas[datas.length - 1] || null, sugestoes, temRegistros: doGrupo.length > 0 };
}

// Sugestão pra 2ª variação (ex.: Cor) a partir dos SKUs que a plataforma mostra
// (variações do relatório de Desempenho e SKUs dos pedidos): quando o SKU vendido é
// o SKU do item da opção + (meio) + "-XX" e o anúncio no app não monta esse SKU, a
// venda só cai no item certo pela regra do "começo do SKU". Com a Cor (e o meio como
// sufixo da opção) o app passa a reconhecer o SKU EXATO.
// opcoes = [{ itemId, sufixo }] (como no formulário); observados = [{ sku, nome? }].
// → { cores: [{ nome, sufixo }], sufixos: [{ i, de, para }] } ou null.
export function sugestaoVariacao2({ opcoes, itens, observados, v2opcoes = [] }) {
  const norm = (x) => String(x || "").trim().toUpperCase();
  const bases = (opcoes || []).map((o, i) => ({ i, sku: norm((itens || []).find((x) => x.id === o.itemId)?.sku), suf: norm(o.sufixo) })).filter((b) => b.sku);
  if (bases.length < 1) return null;
  const cores = new Map();
  const mids = new Map();
  for (const ob of observados || []) {
    const s = norm(ob.sku);
    if (!s) continue;
    let b = null;
    for (const x of bases) if (s.startsWith(x.sku) && (!b || x.sku.length > b.sku.length)) b = x;
    if (!b) continue;
    const m = s.slice(b.sku.length).match(/^([A-Z0-9+]*)(-[A-Z0-9]{1,4})$/);
    if (!m) continue;
    const [, meio, cor] = m;
    const nome = String(ob.nome || "").includes(",") ? String(ob.nome).split(",").pop().trim() : "";
    const c = cores.get(cor) || { sufixo: cor, nomes: new Map() };
    if (nome) c.nomes.set(nome, (c.nomes.get(nome) || 0) + 1);
    cores.set(cor, c);
    if (!mids.has(b.i)) mids.set(b.i, new Set());
    mids.get(b.i).add(meio);
  }
  const ja = new Set((v2opcoes || []).map((o) => norm(o.sufixo)));
  const listaCores = [...cores.values()]
    .filter((c) => !ja.has(c.sufixo))
    .map((c) => ({ sufixo: c.sufixo, nome: [...c.nomes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || c.sufixo.slice(1) }));
  const sufixos = [];
  for (const [i, set] of mids) {
    if (set.size !== 1) continue;
    const para = [...set][0];
    const b = bases.find((x) => x.i === i);
    if (para !== b.suf) sufixos.push({ i, de: b.suf, para });
  }
  return listaCores.length || sufixos.length ? { cores: listaCores, sufixos } : null;
}
