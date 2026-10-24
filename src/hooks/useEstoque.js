import { useMemo } from "react";
import { useRevenda } from "./useRevenda.js";
import { useRankingData } from "./useRankingData.js";
import { useCrescimento } from "./useCrescimento.js";
import { ehRevenda, estoqueDoProduto, situacaoEstoque, vendasPorProduto } from "../lib/revenda.js";
import { hojeSP } from "../lib/datas.js";

// Estoque de cada produto de revenda (conta ÚNICA em lib/revenda.js): movimentos
// gravados (nota, ajuste, inventário) + vendas AO VIVO dos pedidos importados.
// Usado em Estoque e compras, no cadastro do produto e no Início.
export function useEstoque() {
  const rev = useRevenda();
  const { produtos, itens } = useRankingData();
  const { pedidosValidos } = useCrescimento();
  const hoje = hojeSP();
  const linhas = useMemo(() => {
    const revenda = (produtos || []).filter(ehRevenda);
    const ids = new Set(revenda.map((p) => p.id));
    const vendas = vendasPorProduto(pedidosValidos || [], itens || [], ids);
    return revenda
      .map((p) => {
        const movimentos = rev.movimentos.filter((m) => m.produto_id === p.id);
        const vds = vendas.get(p.id) || [];
        const est = estoqueDoProduto({ movimentos, vendas: vds, hoje });
        const forn = rev.fornecedores.find((f) => f.id === p.fornecedor_id) || null;
        const cfg = { prazo: p.estoque_cfg?.prazo ?? forn?.prazo_dias, folga: p.estoque_cfg?.folga };
        const sit = situacaoEstoque(est, cfg, hoje);
        const custo = Number(p.custo_producao) || 0;
        return { produto: p, fornecedor: forn, movimentos, vendas: vds, est, sit, custo, valor: Math.max(0, est.saldo) * custo };
      })
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome));
  }, [produtos, itens, pedidosValidos, rev.movimentos, rev.fornecedores, hoje]);
  return { ...rev, linhas, hoje };
}
