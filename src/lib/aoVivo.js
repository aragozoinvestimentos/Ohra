// Valores "ao vivo": tudo que depende de preço de material, embalagem,
// detalhamento de produção ou taxa de canal é recalculado na hora com os
// dados ATUAIS — nunca lido de um número congelado no dia em que foi salvo.
// Assim, mudou o preço do filamento/caixa ou o imposto de um canal, todas as
// telas (Produtos precificados, Ranking, Metas, Precificação, Comparativo,
// Promoções, Orçamento) mostram o valor novo sem precisar salvar nada de novo.
import { custoProdutoPorPeca, resultadoNoPreco } from "./calc.js";
import { ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "./constantesCanal.js";

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const centavos = (v) => Math.round(num(v) * 100) / 100;

// Custo de produção por peça do produto com o preço ATUAL do material.
// Produto com detalhamento de produção salvo é recalculado; produto com
// custo digitado na mão (sem detalhamento) usa o valor digitado.
export function custoProducaoAtual(produto, materiais) {
  if (produto?.producao_detalhe && (materiais || []).length) {
    const r = custoProdutoPorPeca(produto, materiais);
    if (r && isFinite(r.total)) return centavos(r.total);
  }
  return centavos(produto?.custo_producao);
}

// Embalagem do produto com o preço ATUAL de cada item da receita (ou o
// valor manual, se o produto não usa receita de itens).
export function embalagemAtual(produto, produtoEmbalagens, embalagens) {
  const itens = (produtoEmbalagens || []).filter((r) => r.produto_id === produto?.id);
  if (!itens.length) return centavos(produto?.embalagem_padrao);
  return centavos(
    itens.reduce((s, r) => {
      const e = (embalagens || []).find((x) => x.id === r.embalagem_id);
      return s + num(e?.preco) * num(r.quantidade);
    }, 0)
  );
}

// Produto com custo_producao / embalagem_padrao trocados pelos valores ao
// vivo — dá pra passar pra qualquer cálculo que já lia esses campos.
export function produtoAoVivo(produto, { materiais, produtoEmbalagens, embalagens }) {
  if (!produto) return produto;
  return {
    ...produto,
    custo_producao: custoProducaoAtual(produto, materiais),
    embalagem_padrao: embalagemAtual(produto, produtoEmbalagens, embalagens),
  };
}

// Preço salvo em Produtos precificados, com lucro/margem atualizados pro
// custo ATUAL do item. As taxas (comissão, taxa fixa, imposto, custos fixos)
// dependem só do PREÇO, que não mudou — então o jeito exato de atualizar é
// descontar do lucro gravado a diferença de custo desde o dia do "Salvar"
// (preserva exatamente o imposto/categoria do ML usados na hora de salvar).
// Linhas antigas sem custo gravado são recalculadas do zero com as taxas
// atuais do canal. `desatualizado` avisa quando o custo mudou desde então.
export function precoSalvoAoVivo(linha, custoTotalAtual, canal) {
  if (!linha) return null;
  const preco = num(linha.preco);
  if (!(preco > 0) || custoTotalAtual == null) return { ...linha, desatualizado: false };
  const custoAtual = centavos(custoTotalAtual);
  if (linha.custo_total != null && linha.lucro != null) {
    const delta = custoAtual - num(linha.custo_total);
    if (Math.abs(delta) < 0.005) return { ...linha, desatualizado: false };
    const lucro = num(linha.lucro) - delta;
    return {
      ...linha,
      custo_total: custoAtual,
      lucro,
      margem: lucro / preco,
      lucro_salvo: linha.lucro,
      margem_salva: linha.margem,
      desatualizado: true,
    };
  }
  if (!canal) return { ...linha, desatualizado: false };
  const r = resultadoNoPreco(
    canal,
    { custoProduto: custoAtual, frete: 0, embalagem: 0, imposto: canal.imposto_pct || 0, custosFixosPct: canal.custos_fixos_pct || 0 },
    preco,
    ML_CATEGORIA_PADRAO,
    ML_TIPO_ANUNCIO_PADRAO
  );
  if (!r) return { ...linha, desatualizado: false };
  return {
    ...linha,
    custo_total: custoAtual,
    lucro: r.lucro,
    margem: r.margem,
    lucro_salvo: linha.lucro,
    margem_salva: linha.margem,
    desatualizado: linha.lucro != null && Math.abs(num(linha.lucro) - r.lucro) >= 0.01,
  };
}
