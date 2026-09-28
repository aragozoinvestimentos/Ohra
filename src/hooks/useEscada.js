import { useCallback, useMemo } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "./useRankingData.js";
import { configEscada, escadaDoProduto } from "../lib/escada.js";

// Tudo que as telas de preço por quantidade/Anunciar/Produtos precificados
// precisam, em cima do catálogo AO VIVO (mudou custo, preço salvo, taxa,
// acréscimo ou a config da escada → recalcula sozinho).
export function useEscada() {
  const { lojas, lojaId } = useLoja();
  const dados = useRankingData();
  const cfgLoja = useMemo(() => lojas.find((l) => l.id === lojaId)?.config_escada || null, [lojas, lojaId]);
  const produtosPorId = useMemo(() => new Map(dados.produtos.map((p) => [p.id, p])), [dados.produtos]);

  const cfgDoProduto = useCallback((produtoId) => configEscada(cfgLoja, produtosPorId.get(produtoId)?.escada_config || null), [cfgLoja, produtosPorId]);

  const { itens, precos, concorrentes } = dados;
  const escada = useCallback(
    (produtoId, canal, opcoes = {}) =>
      escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg: cfgDoProduto(produtoId), ...opcoes }),
    [itens, precos, concorrentes, cfgDoProduto]
  );

  return { ...dados, cfgLoja, cfgDoProduto, escada };
}
