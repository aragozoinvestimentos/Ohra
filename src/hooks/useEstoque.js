import { useMemo } from "react";
import { useRevenda } from "./useRevenda.js";
import { useRankingData } from "./useRankingData.js";
import { useCrescimento } from "./useCrescimento.js";
import { ehRevenda, temEstoquePronto, estoqueDoProduto, faltasDoCadastro, situacaoEstoque, vendasPorProduto } from "../lib/revenda.js";
import { hojeSP } from "../lib/datas.js";
import { useCatalogo } from "./useCatalogo.js";
import { coresDoProduto, corDaVenda, estoquePorCor, piorCor } from "../lib/estoqueCor.js";

// Estoque de cada produto de revenda e de cada FABRICADO marcado "tenho estoque pronto"
// (conta ÚNICA em lib/revenda.js): movimentos gravados (nota, impressão, ajuste, inventário)
// + vendas AO VIVO dos pedidos importados (só Enviado/Entregue tira do físico; pago e
// ainda não enviado fica "a enviar").
// Usado em Estoque e compras, no cadastro do produto e no Início.
export function useEstoque() {
  const rev = useRevenda();
  const { produtos, itens, precos } = useRankingData();
  const { pedidosValidos } = useCrescimento();
  const { kits = [] } = useCatalogo();
  const hoje = hojeSP();
  const linhas = useMemo(() => {
    const revenda = (produtos || []).filter((p) => ehRevenda(p) || temEstoquePronto(p));
    const ids = new Set(revenda.map((p) => p.id));
    const porIdP = new Map(revenda.map((p) => [p.id, p]));
    const porIdK = new Map((kits || []).map((k) => [k.id, k]));
    // estoque por cor (v74): a cor de cada venda pelo sufixo do SKU
    const corDe = (l, pid, kitId) => corDaVenda(l, porIdP.get(pid), { kit: kitId ? porIdK.get(kitId) : null });
    const vendas = vendasPorProduto(pedidosValidos || [], itens || [], ids, { corDe });
    return revenda
      .map((p) => {
        const movimentos = rev.movimentos.filter((m) => m.produto_id === p.id);
        const vds = vendas.get(p.id) || [];
        const est = estoqueDoProduto({ movimentos, vendas: vds, hoje });
        const forn = rev.fornecedores.find((f) => f.id === p.fornecedor_id) || null;
        const fabricado = !ehRevenda(p);
        const cfg = { prazo: p.estoque_cfg?.prazo ?? forn?.prazo_dias, folga: p.estoque_cfg?.folga, fabricado };
        let sit = situacaoEstoque(est, cfg, hoje);
        const cores = coresDoProduto(p);
        const porCor = cores.length ? estoquePorCor({ movimentos, vendas: vds, hoje, cores, inicio: est.inicio, cfg }) : [];
        // com cores: a situação mostra a pior cor ("Preto: acabou") quando o total esconde
        // enquanto o "sem cor" ainda tem peças (não distribuídas), as cores ficam negativas de mentira: não acusa
        const semCorPendente = porCor.some((x) => x.semCor && x.est.saldo > 0);
        const pior = semCorPendente ? null : piorCor(porCor);
        if (pior && (pior.sit.tipo !== sit.tipo || sit.tipo === "ok")) sit = { ...pior.sit, texto: `${pior.cor}: ${pior.sit.texto}` };
        const custo = Number(p.custo_producao) || 0;
        // cadastro incompleto (produto criado pela nota): SKU, peso, preço salvo, NCM
        const faltas = fabricado ? [] : faltasDoCadastro(p, { temPreco: (precos || []).some((x) => x.item_tipo === "produto" && x.item_id === p.id) });
        return { produto: p, fabricado, fornecedor: forn, movimentos, vendas: vds, est, sit, custo, valor: Math.max(0, est.saldo) * custo, faltas, cores, porCor, semCorPendente };
      })
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome));
  }, [produtos, kits, itens, precos, pedidosValidos, rev.movimentos, rev.fornecedores, hoje]);
  return { ...rev, linhas, hoje };
}
