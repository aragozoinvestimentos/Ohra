import { useMemo } from "react";
import { usePedidos } from "./usePedidos.js";
import { coberturaPedidos, enriquecer } from "../lib/pedidos.js";
import { useRankingData } from "./useRankingData.js";
import { useAnunciosGrupo } from "./useAnunciosGrupo.js";
import { skusDosGrupos } from "../lib/anunciosGrupo.js";
import { itensSoNoGrupo } from "../lib/grupoRampa.js";

// Vendas REAIS (aba Análise, v55) prontas pras outras contas: pedidos com
// valor pago e lucro (custo e taxas de HOJE) + em que dias cada plataforma já
// tem pedidos importados (`cobertura.cobre(canal, de, ate)`).
export function useVendasReais({ itens, canais, cfgDoProduto }) {
  const ped = usePedidos();
  // venda física / canal orgânico: custo com a embalagem dele (v56)
  const { itemNoCanal, precos } = useRankingData();
  const opcaoDoSku = useOpcaoDoSku(itens, precos);
  const linhas = useMemo(() => enriquecer(ped.pedidos, { itens, canais, cfgDoProduto, itemNoCanal, opcaoDoSku }), [ped.pedidos, itens, canais, cfgDoProduto, itemNoCanal, opcaoDoSku]);
  const cobertura = useMemo(() => coberturaPedidos(ped.importacoes), [ped.importacoes]);
  return { ...ped, linhas, cobertura };
}

// Opções dos anúncios com vários itens: SKU da opção → item da opção. Conta
// como venda DO ANÚNCIO quando o SKU tem sufixo ou o item só existe nele.
// Mesma regra em Vendas do mês, Análise e Live.
export function useOpcaoDoSku(itens, precos) {
  const { grupos } = useAnunciosGrupo();
  return useMemo(() => {
    const m = skusDosGrupos(grupos, itens);
    if (!m.size) return null;
    const so = itensSoNoGrupo({ grupos, itens, precos });
    return (sku) => {
      const o = m.get(String(sku || "").trim().toUpperCase());
      return o ? { ...o, doGrupo: o.comSufixo || so.has(o.itemId) } : null;
    };
  }, [grupos, itens, precos]);
}
