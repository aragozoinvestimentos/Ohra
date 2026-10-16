import { useMemo } from "react";
import { usePedidos } from "./usePedidos.js";
import { coberturaPedidos, enriquecer } from "../lib/pedidos.js";
import { useRankingData } from "./useRankingData.js";

// Vendas REAIS (aba Análise, v55) prontas pras outras contas: pedidos com
// valor pago e lucro (custo e taxas de HOJE) + em que dias cada plataforma já
// tem pedidos importados (`cobertura.cobre(canal, de, ate)`).
export function useVendasReais({ itens, canais, cfgDoProduto }) {
  const ped = usePedidos();
  // venda física / canal orgânico: custo com a embalagem dele (v56)
  const { itemNoCanal } = useRankingData();
  const linhas = useMemo(() => enriquecer(ped.pedidos, { itens, canais, cfgDoProduto, itemNoCanal }), [ped.pedidos, itens, canais, cfgDoProduto, itemNoCanal]);
  const cobertura = useMemo(() => coberturaPedidos(ped.importacoes), [ped.importacoes]);
  return { ...ped, linhas, cobertura };
}
