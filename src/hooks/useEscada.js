import { useCallback, useMemo } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "./useRankingData.js";
import { useRampas } from "./useRampas.js";
import { configEscada, escadaDoProduto, precoMinimoAceitavel } from "../lib/escada.js";
import { alertaPreco, estrategiaEfetiva, produtosEmRampa } from "../lib/estrategia.js";

// Tudo que as telas de preço por quantidade/Anunciar/Produtos precificados
// precisam, em cima do catálogo AO VIVO (mudou custo, preço salvo, taxa,
// acréscimo ou a config da escada → recalcula sozinho).
// Também a ESTRATÉGIA do preço (estrategia.js): `estrategiaDe(item, canal)` e
// `alertaDe(item, canal)` são o único jeito das telas saberem se um preço
// salvo está em alerta (prejuízo / abaixo do mínimo) — nada de conta paralela.
export function useEscada() {
  const { lojas, lojaId } = useLoja();
  const dados = useRankingData();
  const { rampas } = useRampas();
  const cfgLoja = useMemo(() => lojas.find((l) => l.id === lojaId)?.config_escada || null, [lojas, lojaId]);
  const produtosPorId = useMemo(() => new Map(dados.produtos.map((p) => [p.id, p])), [dados.produtos]);

  const cfgDoProduto = useCallback((produtoId) => configEscada(cfgLoja, produtosPorId.get(produtoId)?.escada_config || null), [cfgLoja, produtosPorId]);

  const { itens, precos, concorrentes } = dados;
  // Produtos em rampa abaixo do alvo ("produtoId|canalId").
  const emRampa = useMemo(() => produtosEmRampa(rampas, precos), [rampas, precos]);
  const escada = useCallback(
    (produtoId, canal, opcoes = {}) =>
      escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg: cfgDoProduto(produtoId), emRampa: !!canal && emRampa.has(`${produtoId}|${canal.id}`), ...opcoes }),
    [itens, precos, concorrentes, cfgDoProduto, emRampa]
  );

  const estrategiaDe = useCallback((item, canal, opcoes = {}) => estrategiaEfetiva(item, canal, { precos, emRampa, ...opcoes }), [precos, emRampa]);

  // Alerta do preço SALVO do item no canal (com custo, taxas e estratégia de hoje).
  const alertaDe = useCallback(
    (item, canal) => {
      if (!item || !canal) return null;
      const tipo = { p: "produto", v: "variacao", k: "kit" }[item.id[0]];
      const linha = precos.find((p) => p.item_tipo === tipo && p.item_id === item.id.slice(2) && p.canal_id === canal.id);
      if (!linha) return null;
      const cfg = cfgDoProduto(item.produtoId || (tipo === "produto" ? item.id.slice(2) : null));
      const minimo = precoMinimoAceitavel(canal, Number(item.custoTotal) || 0, Number(item.peso) || 0, cfg);
      const estrategia = estrategiaEfetiva(item, canal, { precos, emRampa });
      return { linha, minimo, estrategia, ...alertaPreco({ lucro: linha.lucro, preco: Number(linha.preco), minimo, estrategia, canal }) };
    },
    [precos, cfgDoProduto, emRampa]
  );

  return { ...dados, cfgLoja, cfgDoProduto, escada, rampas, emRampa, estrategiaDe, alertaDe };
}
