// Montar combinações (out/2026) — Ficha do anúncio → Anúncio com vários
// itens → "Montar combinações": um item BASE (ex.: Letreiro) + ADICIONAIS que
// podem entrar junto (Suporte ×1, Tigela ×2). O app lista todas as
// combinações (só a base, base + cada adicional, base + todos…), calcula o
// custo e o preço sugerido de cada uma no canal (a MESMA conta de kit de
// produtos diferentes: sugestaoKit, curva sobre as peças separadas) e confere
// a regra da plataforma (Shopee/TikTok: 4×; ML/Shein: nome da variação).
// Ao usar, cada combinação com mais de uma peça vira um KIT cadastrado
// (kits + kit_produtos + kit_embalagens) — reaproveita um kit que já tenha a
// mesma composição. Funções puras; quem grava é o MontarCombinacoes.jsx.
import { calcularAnuncio, descontoDoItem, sugestaoKit, lucroNoPreco, r90up } from "./escada.js";
import { skuDoKit } from "./skuKit.js";
import { anuncioDoItem, riscadoFixoDe } from "./rampaAnuncio.js";
import { RAZAO_MAX_SHOPEE } from "./anunciosGrupo.js";

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
export const MAX_ADICIONAIS = 4;
// Recomendação entre vitrine e desconto (ajustes4x).
export const VITRINE_SUBIDA_MAX = 0.25; // vitrine sobe o "a partir de" mais que isso → considera o desconto
export const PROMO_MIN = 0.15; // desconto novo abaixo disso = promo pouco atrativa
const brl = (v) => `R$ ${num(v).toFixed(2).replace(".", ",")}`;

/** Item do catálogo (p:/v:/k:) → peças { produtoId, quantidade } (kit = as peças dele). */
export function pecasDoItem(itemId, itens) {
  const it = itens.find((i) => i.id === itemId);
  if (!it) return [];
  if (itemId.startsWith("p:")) return [{ produtoId: itemId.slice(2), quantidade: 1 }];
  if (itemId.startsWith("v:")) return it.produtoId ? [{ produtoId: it.produtoId, quantidade: num(it.quantidade) || 1 }] : [];
  if (itemId.startsWith("k:")) return (it.componentes || []).map((c) => ({ produtoId: c.produtoId, quantidade: num(c.quantidade) }));
  return [];
}

function somarPecas(listas) {
  const m = new Map();
  for (const l of listas) for (const p of l) m.set(p.produtoId, (m.get(p.produtoId) || 0) + num(p.quantidade));
  return [...m.entries()].map(([produtoId, quantidade]) => ({ produtoId, quantidade })).filter((p) => p.quantidade > 0);
}
const chaveComposicao = (pecas) =>
  [...pecas]
    .sort((a, b) => a.produtoId.localeCompare(b.produtoId))
    .map((p) => `${p.produtoId}×${p.quantidade}`)
    .join("|");

/** Kit cadastrado com exatamente essas peças (ou null). */
export function kitComComposicao(pecas, itens) {
  const alvo = chaveComposicao(pecas);
  return itens.find((i) => i.id.startsWith("k:") && (i.componentes || []).length && chaveComposicao(i.componentes) === alvo) || null;
}

/** 1ª palavra do nome (rótulo curto da opção: "Letreiro + Suporte"). */
export function palavraCurta(nome) {
  return String(nome || "").trim().split(/[\s—–-]+/)[0] || "Item";
}

// Custo/peso de um kit que ainda não existe: peças (custo de UMA peça ao vivo
// × qtd, igual ao kit cadastrado) + a receita de embalagem do item base (ponto
// de partida — dá pra ajustar depois em Produtos → Kits).
export function kitHipotetico({ pecas, produtos, embalagens, produtoEmbalagens, embalagemDe }) {
  let custo = 0;
  let peso = 0;
  for (const p of pecas) {
    const prod = produtos.find((x) => x.id === p.produtoId);
    custo += num(prod?.custo_producao) * p.quantidade;
    peso += num(prod?.peso_g) * p.quantidade;
  }
  const receita = (produtoEmbalagens || []).filter((r) => r.produto_id === embalagemDe);
  for (const r of receita) {
    const e = embalagens.find((x) => x.id === r.embalagem_id);
    custo += num(e?.preco) * num(r.quantidade);
    peso += num(e?.peso_g) * num(r.quantidade);
  }
  return { custoTotal: cent(custo), peso, componentes: pecas, pecas: pecas.reduce((s, p) => s + p.quantidade, 0), receita };
}

/** Todas as combinações: base sozinha + base com cada subconjunto dos adicionais. */
export function subconjuntos(n) {
  const out = [];
  for (let m = 0; m < 1 << n; m++) out.push([...Array(n).keys()].filter((i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

/**
 * base = { itemId }, adicionais = [{ itemId, quantidade }] → combinações com
 * preço no canal: { chave, indices, pecas, rotulo, nomeKit, sku, item (existente) | null,
 *   novo, custo, peso, preco, origemPreco 'salvo'|'sugerido'|null, lucro, separado, economiaPct, an (anúncio) }
 */
export function montarCombinacoes({ base, adicionais, canal, itens, produtos, kits, embalagens, produtoEmbalagens, precos, publicacoes, cfgDoProduto }) {
  const itemBase = itens.find((i) => i.id === base?.itemId);
  if (!itemBase || !canal) return [];
  const pecasBase = pecasDoItem(itemBase.id, itens);
  const embalagemDe = pecasBase[0]?.produtoId || null;
  const extras = (adicionais || [])
    .map((a) => {
      const it = itens.find((i) => i.id === a.itemId);
      const q = Math.max(1, Math.round(num(a.quantidade) || 1));
      const pecas = pecasDoItem(a.itemId, itens).map((p) => ({ ...p, quantidade: p.quantidade * q }));
      return it && pecas.length ? { item: it, quantidade: q, pecas } : null;
    })
    .filter(Boolean);
  const cfg = cfgDoProduto(embalagemDe);
  const precoSalvo = (id) => {
    const tipo = id.startsWith("k:") ? "kit" : id.startsWith("v:") ? "variacao" : "produto";
    const s = precos.find((p) => p.item_tipo === tipo && p.item_id === id.slice(2) && p.canal_id === canal.id);
    return s && num(s.preco) > 0 ? s : null;
  };
  return subconjuntos(extras.length).map((indices) => {
    const escolhidos = indices.map((i) => extras[i]);
    const pecas = somarPecas([pecasBase, ...escolhidos.map((e) => e.pecas)]);
    const rotulo = [palavraCurta(itemBase.nome), ...escolhidos.map((e) => `${e.quantidade > 1 ? `${e.quantidade}× ` : ""}${palavraCurta(e.item.nome)}`)].join(" + ");
    const nomeKit = [itemBase.nome, ...escolhidos.map((e) => `${e.quantidade > 1 ? `${e.quantidade}× ` : ""}${e.item.nome}`)].join(" + ");
    const sku = escolhidos.length
      ? skuDoKit(
          pecas.map((pc) => {
            const pr = produtos.find((x) => x.id === pc.produtoId);
            return { sku: pr?.sku, nome: pr?.nome, quantidade: pc.quantidade };
          }),
          [...(kits || []).map((k) => k.sku), ...(produtos || []).map((p) => p.sku)],
        )
      : itemBase.sku || "";
    // Item que já existe: a própria base (sozinha) ou um kit com a mesma composição.
    const existente = !escolhidos.length ? itemBase : kitComComposicao(pecas, itens);
    const kitItem = existente?.id.startsWith("k:") ? existente : existente ? null : { ...kitHipotetico({ pecas, produtos, embalagens, produtoEmbalagens, embalagemDe }), id: null };
    const sug = kitItem && kitItem.componentes?.length ? sugestaoKit({ canal, kitItem, itens, precos, cfg }) : null;
    const salvo = existente ? precoSalvo(existente.id) : null;
    const preco = salvo ? num(salvo.preco) : sug?.sugerido || null;
    const custo = existente ? num(existente.custoTotal) : num(kitItem?.custoTotal);
    const peso = existente ? num(existente.peso) : num(kitItem?.peso);
    const lucro = preco ? lucroNoPreco(canal, preco, custo, peso, cfg) : null;
    const { desconto } = descontoDoItem(existente?.id || "k:novo", canal, { itens, produtos, kits });
    const an = preco ? anuncioDoItem({ itemId: existente?.id || null, canal, real: preco, desconto, publicacoes }) : null;
    const fixo = !!(existente && riscadoFixoDe(existente.id, canal.id, publicacoes));
    return {
      chave: indices.join(",") || "base",
      indices,
      pecas,
      rotulo,
      nomeKit,
      sku,
      item: existente || null,
      novo: !existente,
      receita: kitItem?.receita || [],
      custo,
      peso,
      preco,
      origemPreco: salvo ? "salvo" : sug ? "sugerido" : null,
      sugerido: sug?.sugerido ?? null,
      lucro,
      margem: preco && lucro != null ? lucro / preco : null,
      separado: sug?.separado ?? null,
      economiaPct: sug?.economiaPct ?? null,
      naoVale: !!sug?.naoVale,
      an,
      desconto,
      fixo,
    };
  });
}

/**
 * Regra da plataforma pras combinações marcadas. Shopee/TikTok: o preço
 * original da mais cara ≤ 4× o que o cliente paga na mais barata (devolve
 * quais cabem junto com a mais barata). ML/Shein: nome da variação Cor/Tamanho.
 */
export function regraDaPlataforma(combos, canal, nomeVariacao = "Conjunto") {
  const tipo = canal?.tipo;
  const comPreco = combos.filter((c) => c.an);
  const res = { tipo, quatroX: null, nomeVariacao: null };
  if ((tipo === "shopee" || tipo === "tiktok") && comPreco.length > 1) {
    const maisBarata = comPreco.reduce((m, c) => (!m || c.an.clientePaga < m.an.clientePaga ? c : m), null);
    const limite = maisBarata.an.clientePaga * RAZAO_MAX_SHOPEE;
    const foraDaRegra = comPreco.filter((c) => c.an.original > limite + 1e-9);
    const maisCara = comPreco.reduce((m, c) => (!m || c.an.original > m.an.original ? c : m), null);
    res.quatroX = { ok: !foraDaRegra.length, limite, maisBarata, maisCara, razao: maisCara.an.original / maisBarata.an.clientePaga, fora: foraDaRegra.map((c) => c.chave) };
  }
  if ((tipo === "ml" || tipo === "shein") && !["cor", "tamanho"].includes(String(nomeVariacao).trim().toLowerCase()))
    res.nomeVariacao = "No Mercado Livre e na Shein a variação precisa se chamar Cor ou Tamanho — use “Tamanho” no nome da variação.";
  return res;
}

// ---------------------------------------------------------------------------
// Quando a regra de 4× não fecha, duas saídas — NADA é cadastrado:
// 1) VITRINE: a(s) opção(ões) abaixo do limite passam a um preço só deste
//    anúncio (o menor ,90 ≥ original da mais cara ÷ 4). O preço salvo do item,
//    o anúncio dele sozinho e a rampa não mudam; o preço fica guardado na
//    opção do anúncio (anuncios_grupo.opcoes[].vitrine = { canal_id, preco }).
// 2) DESCONTO: baixar o desconto do anúncio (riscado) das opções que passam,
//    até o original caber em 4× o que o cliente paga na mais barata. Só pra
//    opção ainda não anunciada (riscado fixo não muda) e que não seja
//    variação (o desconto dela é o do produto pai).
export function ajustes4x({ combos, canal, cfg }) {
  const comPreco = combos.filter((c) => c.an);
  if (comPreco.length < 2 || !canal) return null;
  const maxOriginal = Math.max(...comPreco.map((c) => c.an.original));
  const minPaga = Math.min(...comPreco.map((c) => c.an.clientePaga));
  if (maxOriginal <= minPaga * 4 + 1e-9) return null;
  // 1) vitrine
  const limite = maxOriginal / 4;
  const vitrine = comPreco
    .filter((c) => c.an.clientePaga < limite - 1e-9)
    .map((c) => {
      const para = r90up(limite);
      const lucroPara = lucroNoPreco(canal, para, c.custo, c.peso, cfg);
      return { chave: c.chave, rotulo: c.rotulo, de: c.preco, para, lucroDe: c.lucro, lucroPara };
    });
  const aPartirDeVitrine = Math.min(...comPreco.map((c) => vitrine.find((v) => v.chave === c.chave)?.para ?? c.an.clientePaga));
  // 2) desconto: novo desconto (% inteiro pra baixo) que faz o original ≤ 4 × minPaga
  const teto = minPaga * 4;
  const desconto = comPreco
    .filter((c) => c.an.original > teto + 1e-9)
    .map((c) => {
      const dMax = 1 - c.preco / teto;
      const para = Math.floor(dMax * 100 + 1e-9) / 100;
      const bloqueio = c.fixo ? "já anunciado — o preço original fica fixo" : c.item?.id.startsWith("v:") ? "variação usa o desconto do produto" : para < 0 ? "mesmo sem desconto passa de 4×" : null;
      const an = bloqueio ? null : calcularAnuncio(c.preco, para);
      return { chave: c.chave, rotulo: c.rotulo, de: c.desconto, para: Math.max(0, para), originalDe: c.an.original, originalPara: an?.original ?? null, bloqueio };
    });
  // Recomendação automática (decisão do Gustavo: prefere a vitrine). Vitrine,
  // a não ser que ela suba muito o "a partir de" (> VITRINE_SUBIDA_MAX) E o
  // desconto resolva deixando uma promo que ainda chama atenção (≥ PROMO_MIN).
  const subida = minPaga > 0 ? aPartirDeVitrine / minPaga - 1 : 0;
  const descontoPossivel = desconto.length > 0 && desconto.every((d) => !d.bloqueio);
  const menorPromo = descontoPossivel ? Math.min(...desconto.map((d) => d.para)) : 0;
  const ganho = vitrine.reduce((t, v) => t + ((v.lucroPara ?? 0) - (v.lucroDe ?? 0)), 0);
  let recomendado = "vitrine";
  let motivo = `sobe o “a partir de” só ${Math.round(subida * 100)}% e ganha ${brl(ganho)} de lucro em cada venda da opção mais barata`;
  if (!descontoPossivel) motivo = `baixar o desconto não resolve aqui; a vitrine ganha ${brl(ganho)} de lucro em cada venda da opção mais barata`;
  else if (subida > VITRINE_SUBIDA_MAX && menorPromo >= PROMO_MIN) {
    recomendado = "desconto";
    motivo = `a vitrine subiria o “a partir de” ${Math.round(subida * 100)}% (${brl(minPaga)} → ${brl(aPartirDeVitrine)}) e afastaria o clique; baixando o desconto o preço de entrada fica e a promo ainda mostra ${Math.round(menorPromo * 100)}%`;
  } else if (subida > VITRINE_SUBIDA_MAX)
    motivo = `baixar o desconto deixaria a promo em só ${Math.round(menorPromo * 100)}% (pouco atrativa); a vitrine ganha ${brl(ganho)} de lucro em cada venda da opção mais barata, mas sobe o “a partir de” ${Math.round(subida * 100)}%`;
  return {
    recomendado,
    motivo,
    limite,
    aPartirDe: minPaga,
    vitrine: { mudancas: vitrine, aPartirDe: aPartirDeVitrine },
    desconto: { mudancas: desconto, possivel: desconto.length > 0 && desconto.every((d) => !d.bloqueio) },
  };
}

/** Combinações com o ajuste escolhido aplicado (só simulação na tela). */
export function aplicarAjuste(combos, ajustes, tipo) {
  if (!ajustes || !tipo) return combos;
  return combos.map((c) => {
    if (tipo === "vitrine") {
      const m = ajustes.vitrine.mudancas.find((x) => x.chave === c.chave);
      if (!m) return c;
      return { ...c, preco: m.para, origemPreco: "vitrine", lucro: m.lucroPara, margem: m.lucroPara != null ? m.lucroPara / m.para : null, an: calcularAnuncio(m.para, c.desconto), vitrine: m.para };
    }
    if (tipo === "desconto") {
      const m = ajustes.desconto.mudancas.find((x) => x.chave === c.chave && !x.bloqueio);
      if (!m) return c;
      return { ...c, an: calcularAnuncio(c.preco, m.para), desconto: m.para, descontoNovo: m.para };
    }
    return c;
  });
}
