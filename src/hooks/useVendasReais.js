import { useMemo } from "react";
import { usePedidos } from "./usePedidos.js";
import { coberturaPedidos, enriquecer } from "../lib/pedidos.js";

// Vendas REAIS (aba Análise, v55) prontas pras outras contas: pedidos com
// valor pago e lucro (custo e taxas de HOJE) + em que dias cada plataforma já
// tem pedidos importados (`cobertura.cobre(canal, de, ate)`).
export function useVendasReais({ itens, canais, cfgDoProduto }) {
  const ped = usePedidos();
  const linhas = useMemo(() => enriquecer(ped.pedidos, { itens, canais, cfgDoProduto }), [ped.pedidos, itens, canais, cfgDoProduto]);
  const cobertura = useMemo(() => coberturaPedidos(ped.importacoes), [ped.importacoes]);
  return { ...ped, linhas, cobertura };
}
