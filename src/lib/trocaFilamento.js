// "⇄ Filamentos": quanto o item custaria (e o preço/lucro) em cada filamento
// cadastrado. Truque: pra simular o filamento X, todos os filamentos da lista
// passam a custar o preço/kg de X — assim produto, variação (chapa/fatiador)
// e kit recalculam com X sem precisar trocar o nome em cada detalhamento.
// Nada é salvo. A densidade continua a do detalhamento (diferença pequena
// entre PLA/PETG).
import { custoProducaoAtual, produtoAoVivo } from "./aoVivo.js";
import { calcVariacao } from "./variacoes.js";

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

export const ehFilamento = (m) => (m?.tipo || "filamento") === "filamento";

export const materiaisComFilamento = (materiais, fil) => (materiais || []).map((m) => (ehFilamento(m) ? { ...m, preco: fil.preco } : m));

// Base da simulação pra um item do catálogo (p:/v:/k:). Devolve
// { titulo, custoAtual, producaoAtual, producaoCom(mats), materialAtual,
//   peso, produtoId, semDetalhe } ou null.
export function baseTrocaFilamento(itemId, { itens, produtos, variacoes, materiais, embalagens, produtoEmbalagens }) {
  const item = (itens || []).find((i) => i.id === itemId);
  if (!item) return null;
  const prodPorId = new Map((produtos || []).map((p) => [p.id, p]));
  const comum = { titulo: item.nome, custoAtual: num(item.custoTotal), peso: item.peso || 0, itemId };

  if (itemId.startsWith("p:")) {
    const produto = prodPorId.get(itemId.slice(2));
    if (!produto) return null;
    return {
      ...comum,
      produtoId: produto.id,
      producaoAtual: num(produto.custo_producao),
      producaoCom: (mats) => custoProducaoAtual(produto, mats),
      materialAtual: produto.producao_detalhe?.materialNome || produto.material_nome || null,
      semDetalhe: !produto.producao_detalhe,
    };
  }

  if (itemId.startsWith("v:")) {
    const v = (variacoes || []).find((x) => x.id === itemId.slice(2));
    const produto = v && prodPorId.get(v.produto_id);
    if (!produto) return null;
    const calcCom = (mats) =>
      calcVariacao(v, produtoAoVivo(produto, { materiais: mats, produtoEmbalagens, embalagens }), { materiais: mats, embalagens, produtoEmbalagens }).producao;
    return {
      ...comum,
      produtoId: produto.id,
      producaoAtual: calcCom(materiais),
      producaoCom: calcCom,
      materialAtual:
        (v.producao_modo === "fatiador" && v.producao_detalhe?.materialNome) || produto.producao_detalhe?.materialNome || produto.material_nome || null,
      semDetalhe: !produto.producao_detalhe && !(v.producao_modo === "fatiador" && v.producao_detalhe),
    };
  }

  if (itemId.startsWith("k:")) {
    const comps = (item.componentes || []).map((c) => ({ produto: prodPorId.get(c.produtoId), qtd: num(c.quantidade) })).filter((c) => c.produto);
    const somar = (f) => comps.reduce((s, c) => s + c.qtd * f(c.produto), 0);
    const nomes = [...new Set(comps.map((c) => c.produto.producao_detalhe?.materialNome || c.produto.material_nome).filter(Boolean))];
    return {
      ...comum,
      produtoId: null,
      producaoAtual: somar((p) => num(p.custo_producao)),
      producaoCom: (mats) => somar((p) => custoProducaoAtual(p, mats)),
      materialAtual: nomes.length === 1 ? nomes[0] : null,
      materiaisDoKit: nomes,
      semDetalhe: !comps.some((c) => c.produto.producao_detalhe),
    };
  }
  return null;
}
