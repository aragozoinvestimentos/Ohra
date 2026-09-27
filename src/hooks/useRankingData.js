import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  resolverFaixaShopee,
  resolverFaixaML,
  resolverFaixaTikTok,
  resolverFaixaShein,
  calcCanalCustom,
} from "../lib/calc.js";
import { arredondarPreco } from "../lib/format.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { totalItens } from "../components/SeletorItens.jsx";
import { calcVariacao, itemTipoDoId, resumoProduto } from "../lib/variacoes.js";

import { LUCRATIVIDADE_PADRAO, ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "../lib/constantesCanal.js";
import { produtoAoVivo, precoSalvoAoVivo } from "../lib/aoVivo.js";
import { usarCatalogo, assinarCatalogo, lerCatalogo } from "../lib/catalogoStore.js";
export { LUCRATIVIDADE_PADRAO, ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO };


const centavos = (v) => Math.round((Number(v) || 0) * 100) / 100;

function lucroPorCanal(custoTotal, canal, pesoG = null) {
  if (custoTotal <= 0) return null;
  const base = {
    custoProduto: custoTotal,
    frete: 0,
    embalagem: 0,
    lucratividadePct: LUCRATIVIDADE_PADRAO / 100,
    imposto: canal.imposto_pct || 0,
    custosFixosPct: canal.custos_fixos_pct || 0,
  };
  if (canal.tipo === "shopee") return resolverFaixaShopee(base).resultado;
  if (canal.tipo === "ml") return resolverFaixaML(ML_CATEGORIA_PADRAO, base, ML_TIPO_ANUNCIO_PADRAO, pesoG).resultado;
  if (canal.tipo === "tiktok") return resolverFaixaTikTok(base).resultado;
  if (canal.tipo === "shein") return resolverFaixaShein(base).resultado;
  return calcCanalCustom(canal, base);
}

// Acha, dentro da lista de precos_canal já carregada, o preço realmente
// salvo (via Precificação por Canal ou editado na mão em Preços por Canal)
// pra esse item nesse canal — usado pra preferir o valor real ao invés do
// cálculo teórico sempre que ele existir.
function precoRealDe(precos, item, canalObj) {
  const id = item.id.split(":")[1];
  const itemTipo = itemTipoDoId(item.id);
  return precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalObj.id) || null;
}

// Dado o catálogo unificado (produtos + kits, já com custoTotal) e os
// canais ativos, monta o ranking ordenado por lucro — usado tanto pela
// aba Ranking quanto pela tela de descanso, sempre com a mesma lógica.
// Quando existe um preço já salvo em Preços por Canal pra um item+canal, o
// ranking usa o lucro/margem REAL desse preço em vez do cálculo teórico a
// LUCRATIVIDADE_PADRAO — assim o que você edita/salva lá se reflete aqui
// também, e o cálculo teórico só entra pra preencher o que ainda não foi
// precificado de verdade.
export function calcularRanking(itens, canais, { canalFiltro = "melhor", tipoFiltro = "todos", precos = [] } = {}) {
  if (canais.length === 0) return [];
  const canaisAlvo = canalFiltro === "melhor" ? canais : canais.filter((c) => c.id === canalFiltro);
  if (canaisAlvo.length === 0) return [];
  const itensAlvo =
    tipoFiltro === "produtos" ? itens.filter((i) => i.tipo === "Produto") : tipoFiltro === "kits" ? itens.filter((i) => i.tipo === "Kit") : itens;
  return itensAlvo
    .map((item) => {
      let melhor = null;
      for (const c of canaisAlvo) {
        const salvo = precos.length ? precoRealDe(precos, item, c) : null;
        const candidato =
          salvo && salvo.lucro != null
            ? { canal: c, lucro: Number(salvo.lucro), margem: salvo.margem != null ? Number(salvo.margem) : null, origem: "salvo" }
            : (() => {
                const r = lucroPorCanal(item.custoTotal, c, item.peso);
                return r?.lucro != null ? { canal: c, lucro: r.lucro, margem: r.margem, origem: "estimado" } : null;
              })();
        if (candidato && (melhor == null || candidato.lucro > melhor.lucro)) {
          melhor = candidato;
        }
      }
      return melhor ? { item, ...melhor } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.lucro - a.lucro);
}

// Busca produtos, kits e canais da loja atual (com realtime) e monta o
// catálogo unificado de itens com custo total — a mesma base de dados que
// alimenta o Ranking e a tela de descanso.
export function useRankingData() {
  const { lojaId } = useLoja();
  // Dados crus vêm do store compartilhado (uma busca + um realtime pra todas
  // as telas); aqui só se derivam os valores ao vivo.
  const cat = useSyncExternalStore(assinarCatalogo, lerCatalogo, lerCatalogo);
  useEffect(() => usarCatalogo(lojaId), [lojaId]);
  const {
    produtos,
    kits,
    kitProdutos: kitProdutosTodos,
    kitEmbalagens: kitEmbalagensTodos,
    embalagens: embalagensCatalogo,
    canais,
    precos,
    materiais,
    produtoEmbalagens,
    variacoes,
    carregando,
  } = cat;

  // Produtos com custo de produção e embalagem recalculados AO VIVO (preço
  // atual do material e dos itens de embalagem) — é essa lista que todo o
  // resto do app recebe como `produtos`.
  const produtosVivos = useMemo(
    () => produtos.map((p) => produtoAoVivo(p, { materiais, produtoEmbalagens, embalagens: embalagensCatalogo })),
    [produtos, materiais, produtoEmbalagens, embalagensCatalogo]
  );

  const catalogoProdutosBase = useMemo(
    () => produtosVivos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.custo_producao) || 0, unidade: "un" })),
    [produtosVivos]
  );
  const catalogoEmbalagensBase = useMemo(
    () => embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade })),
    [embalagensCatalogo]
  );

  function custoKitTotal(k) {
    const prodItens = kitProdutosTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade }));
    const embItens = kitEmbalagensTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    return totalItens(catalogoProdutosBase, prodItens) + totalItens(catalogoEmbalagensBase, embItens);
  }

  // Detalha um kit item por item — quanto cada produto/embalagem que o
  // compõe pesa no custo total (usado em Precificação por Canal pra
  // estratificar o "custo total do kit" em vez de mostrar só a soma).
  function composicaoDoKit(kitId) {
    const linhaDe = (r, idKey, catalogo, rotuloAusente) => {
      const item = catalogo.find((c) => c.id === r[idKey]);
      const quantidade = Number(r.quantidade) || 0;
      const custoUnit = item?.preco || 0;
      return { nome: item?.nome || rotuloAusente, quantidade, custoUnit, subtotal: custoUnit * quantidade };
    };
    return {
      produtos: kitProdutosTodos
        .filter((r) => r.kit_id === kitId)
        .map((r) => linhaDe(r, "produto_id", catalogoProdutosBase, "Produto removido")),
      embalagens: kitEmbalagensTodos
        .filter((r) => r.kit_id === kitId)
        .map((r) => linhaDe(r, "embalagem_id", catalogoEmbalagensBase, "Embalagem removida")),
    };
  }

  // Lista unificada: cada produto cadastrado com custo total (produção +
  // frete + embalagem) e cada kit cadastrado com seu custo total (produtos
  // + embalagem do kit) num só lugar.
  const itens = useMemo(() => {
    const doProdutos = produtosVivos.map((p) => ({
      id: `p:${p.id}`,
      nome: p.nome,
      sku: p.sku || "",
      tipo: "Produto",
      pecas: 1,
      custoTotal: arredondarPreco((Number(p.custo_producao) || 0) + (Number(p.frete_padrao) || 0) + (Number(p.embalagem_padrao) || 0)),
      custoProducao: Number(p.custo_producao) || 0,
      embalagem: Number(p.embalagem_padrao) || 0,
      freteProduto: Number(p.frete_padrao) || 0,
      peso: resumoProduto(p, { embalagens: embalagensCatalogo, produtoEmbalagens }).peso,
    }));
    const doKits = kits.map((k) => ({
      id: `k:${k.id}`,
      nome: k.nome,
      sku: k.sku || "",
      tipo: "Kit",
      // nº de peças do kit (soma das quantidades dos produtos) — usado no "lucro por peça"
      pecas: kitProdutosTodos.filter((r) => r.kit_id === k.id).reduce((s, r) => s + (Number(r.quantidade) || 0), 0),
      custoTotal: arredondarPreco(custoKitTotal(k)),
    }));
    // Variações de quantidade: cada uma vira um item próprio (id "v:<id>"),
    // com custo já considerando o que foi personalizado nela.
    const doVariacoes = variacoes
      .map((v) => {
        const produto = produtosVivos.find((p) => p.id === v.produto_id);
        if (!produto) return null;
        const calc = calcVariacao(v, produto, { materiais, embalagens: embalagensCatalogo, produtoEmbalagens });
        return {
          id: `v:${v.id}`,
          nome: `${produto.nome} — ${v.nome}`,
          nomeVariacao: v.nome,
          sku: v.sku || "",
          tipo: "Variação",
          produtoId: produto.id,
          quantidade: calc.quantidade,
          pecas: Number(calc.quantidade) || 1,
          custoTotal: centavos(calc.custoTotal),
          custoProducao: centavos(calc.producao),
          embalagem: centavos(calc.embalagem),
          frete: centavos(calc.frete + calc.ajuste),
          peso: calc.peso,
          calc,
        };
      })
      .filter(Boolean);
    return [...doProdutos, ...doKits, ...doVariacoes];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosVivos, kits, kitProdutosTodos, kitEmbalagensTodos, embalagensCatalogo, variacoes, materiais, produtoEmbalagens]);

  // Preços salvos com lucro/margem recalculados pro custo de HOJE de cada
  // item e as taxas atuais do canal (o que foi gravado no dia do "Salvar"
  // fica em lucro_salvo/margem_salva, e `desatualizado` marca a diferença).
  const precosVivos = useMemo(() => {
    const porId = new Map(itens.map((i) => [i.id, i]));
    const prefixo = { produto: "p", kit: "k", variacao: "v" };
    return precos.map((linha) => {
      const item = porId.get(`${prefixo[linha.item_tipo] || "p"}:${linha.item_id}`);
      const canal = canais.find((c) => c.id === linha.canal_id);
      return item ? precoSalvoAoVivo(linha, item.custoTotal, canal, item.peso) : linha;
    });
  }, [precos, itens, canais]);

  return {
    itens,
    canais,
    produtos: produtosVivos,
    kits,
    precos: precosVivos,
    precosBrutos: precos,
    variacoes,
    concorrentes: cat.concorrentes || [],
    publicacoes: cat.publicacoes || [],
    materiais,
    embalagens: embalagensCatalogo,
    produtoEmbalagens,
    carregando,
    contagemProdutos: produtos.length,
    contagemKits: kits.length,
    composicaoDoKit,
  };
}
