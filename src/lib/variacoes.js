// Variações de quantidade de um produto (kit 2, kit 3…) — funções puras.
// Regra geral: tudo que a variação não personalizou (null/false no banco)
// é HERDADO do produto pai na hora do cálculo, então mudar o produto (ou o
// preço do filamento/embalagem) atualiza as variações sozinho.
import { custoProdutoPorPeca } from "./calc.js";
import { DEFAULTS_PRODUCAO } from "./calc.js";
import { totalItens } from "../components/SeletorItens.jsx";

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

// "p:<id>" | "k:<id>" | "v:<id>" → valor de precos_canal.item_tipo
export function itemTipoDoPrefixo(prefixo) {
  if (prefixo === "k") return "kit";
  if (prefixo === "v") return "variacao";
  return "produto";
}

export function itemTipoDoId(idPrefixado) {
  return itemTipoDoPrefixo(String(idPrefixado || "").split(":")[0]);
}

export const catalogoEmbalagens = (embalagens) =>
  (embalagens || []).map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade, peso_g: m.peso_g }));

export function pesoItens(embalagens, itens) {
  return (itens || []).reduce((s, it) => {
    const emb = (embalagens || []).find((e) => e.id === it.itemId);
    return s + num(emb?.peso_g) * num(it.quantidade);
  }, 0);
}

// Itens de embalagem do produto no formato do SeletorItens ({itemId, quantidade}).
export function embalagemItensDoProduto(produtoId, produtoEmbalagens) {
  return (produtoEmbalagens || [])
    .filter((r) => r.produto_id === produtoId)
    .map((r) => ({ itemId: r.embalagem_id, quantidade: num(r.quantidade) }));
}

// Custo e peso de envio de 1 unidade do produto (sem variação).
export function resumoProduto(produto, { embalagens, produtoEmbalagens }) {
  const itens = embalagemItensDoProduto(produto.id, produtoEmbalagens);
  const embalagem = itens.length ? totalItens(catalogoEmbalagens(embalagens), itens) : num(produto.embalagem_padrao);
  const pesoEmbalagem = pesoItens(embalagens, itens);
  const pesoPeca = num(produto.peso_g);
  return {
    producao: num(produto.custo_producao),
    embalagem,
    frete: num(produto.frete_padrao),
    pesoPeca,
    pesoEmbalagem,
    peso: pesoPeca + pesoEmbalagem,
    embalagemItens: itens,
  };
}

// Custo de produção por peça da variação, conforme o modo escolhido.
// Retorna { porPeca, modoEfetivo } — cai pra 'multiplicar' quando o produto
// não tem detalhamento de produção salvo (não dá pra recalcular a chapa).
export function producaoPorPeca(variacao, produto, materiais) {
  const base = num(produto.custo_producao);
  const modo = variacao.producao_modo || "multiplicar";
  if (modo === "chapa" && num(variacao.pecas_por_chapa) > 0 && produto.producao_detalhe) {
    const r = custoProdutoPorPeca({ ...produto, pecas_por_impressao: num(variacao.pecas_por_chapa) }, materiais);
    if (r) return { porPeca: r.total, modoEfetivo: "chapa" };
  }
  if (modo === "fatiador" && variacao.producao_detalhe) {
    const d = variacao.producao_detalhe;
    const detalhe = {
      ...DEFAULTS_PRODUCAO,
      ...(produto.producao_detalhe || {}),
      comprimento: num(d.comprimento),
      tempo: num(d.tempo),
      ...(d.materialNome ? { materialNome: d.materialNome } : {}),
    };
    const r = custoProdutoPorPeca({ producao_detalhe: detalhe, pecas_por_impressao: num(d.pecas) || 1 }, materiais);
    if (r) return { porPeca: r.total, modoEfetivo: "fatiador" };
  }
  return { porPeca: base, modoEfetivo: "multiplicar" };
}

// Cálculo completo de uma variação.
export function calcVariacao(variacao, produto, { materiais, embalagens, produtoEmbalagens }) {
  const qtd = Math.max(1, num(variacao.quantidade) || 1);
  const pai = resumoProduto(produto, { embalagens, produtoEmbalagens });
  const { porPeca, modoEfetivo } = producaoPorPeca(variacao, produto, materiais);
  const producao = porPeca * qtd;

  const embPersonalizada = Array.isArray(variacao.embalagem_itens);
  const embItens = embPersonalizada ? variacao.embalagem_itens : pai.embalagemItens;
  const embalagem = embPersonalizada ? totalItens(catalogoEmbalagens(embalagens), embItens) : pai.embalagem;
  const pesoEmbalagem = embPersonalizada ? pesoItens(embalagens, embItens) : pai.pesoEmbalagem;

  const fretePersonalizado = variacao.frete != null && variacao.frete !== "";
  const frete = fretePersonalizado ? num(variacao.frete) : pai.frete;
  const ajuste = num(variacao.ajuste);
  const custoTotal = producao + embalagem + frete + ajuste;

  const pesoCalculado = pai.pesoPeca * qtd + pesoEmbalagem;
  const pesoReal = variacao.peso_real_g != null && variacao.peso_real_g !== "" ? num(variacao.peso_real_g) : null;

  // Comparação com "N vezes o produto" (produção × N + embalagem/frete 1×).
  const referencia = pai.producao * qtd + pai.embalagem + pai.frete;

  return {
    quantidade: qtd,
    porPeca,
    producao,
    embalagem,
    embalagemItens: embItens,
    frete,
    ajuste,
    custoTotal,
    porUnidade: custoTotal / qtd,
    pesoCalculado,
    peso: pesoReal ?? pesoCalculado,
    pesoReal,
    referencia,
    diferenca: custoTotal - referencia,
    modoEfetivo,
    personalizado: {
      producao: modoEfetivo !== "multiplicar",
      embalagem: embPersonalizada,
      frete: fretePersonalizado,
      peso: pesoReal != null,
      ajuste: ajuste !== 0,
    },
  };
}

export function formatarPeso(g) {
  const v = num(g);
  if (!v) return "—";
  return v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg` : `${Math.round(v)} g`;
}

// Agrupa a lista unificada de itens (produtos, variações, kits) pra um
// <select> com <optgroup>: produto com variações vira um grupo próprio
// ("1 unidade" + cada variação); produtos sem variação ficam em "Produtos";
// kits em "Kits".
export function gruposDoSeletor(itens) {
  const produtos = itens.filter((i) => i.tipo === "Produto");
  const variacoes = itens.filter((i) => i.tipo === "Variação");
  const kits = itens.filter((i) => i.tipo === "Kit");
  const sku = (i) => (i.sku ? ` · ${i.sku}` : "");
  const grupos = [];
  const simples = [];
  for (const p of produtos) {
    const pid = p.id.split(":")[1];
    const vars = variacoes.filter((v) => v.produtoId === pid).sort((a, b) => a.quantidade - b.quantidade);
    if (vars.length) {
      grupos.push({
        label: p.nome,
        itens: [{ id: p.id, rotulo: `1 unidade${sku(p)}` }, ...vars.map((v) => ({ id: v.id, rotulo: `${v.nomeVariacao}${sku(v)}` }))],
      });
    } else {
      simples.push({ id: p.id, rotulo: `${p.nome}${sku(p)}` });
    }
  }
  const out = [];
  if (simples.length) out.push({ label: "Produtos", itens: simples });
  out.push(...grupos);
  if (kits.length) out.push({ label: "Kits", itens: kits.map((k) => ({ id: k.id, rotulo: `${k.nome}${sku(k)}` })) });
  return out;
}
