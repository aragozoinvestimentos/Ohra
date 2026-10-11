import { useMemo } from "react";
import { useEscada } from "./useEscada.js";
import { useRampas } from "./useRampas.js";
import { useAfiliados } from "./useAfiliados.js";
import { estadoRampa, metricasFunil, referenciaFunilLoja, regrasDaLoja } from "../lib/rampa.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";
import { hojeISO } from "../lib/fluxoCaixa.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// Tudo da aba Crescimento calculado ao vivo (Rampa + Afiliados) — a MESMA
// conta pra aba Crescimento e pro Início (que só lê).
export function useCrescimento() {
  const dados = useEscada();
  const { itens, produtos, canais, precos, cfgDoProduto, cfgLoja } = dados;
  const rampasH = useRampas({ comRegistros: true });
  const { rampas, registros } = rampasH;
  const af = useAfiliados();
  const regras = useMemo(() => regrasDaLoja(cfgLoja), [cfgLoja]);
  const hoje = hojeISO();

  // Referência do funil: mediana de CTR e conversão dos produtos da loja
  // (só com 5+ produtos com funil calculável; senão, referência geral).
  const funilLoja = useMemo(
    () => referenciaFunilLoja(rampas.map((r) => metricasFunil(r, registros.filter((g) => g.rampa_id === r.id), regras, hoje))),
    [rampas, registros, regras, hoje]
  );

  // Uma linha por rampa, com tudo calculado ao vivo.
  const linhas = useMemo(() => {
    return rampas
      .map((r) => {
        const produto = produtos.find((p) => p.id === r.produto_id);
        const canal = canais.find((c) => c.id === r.canal_id);
        const item = itens.find((i) => i.id === `p:${r.produto_id}`);
        if (!produto || !canal || !item) return null;
        const cfg = cfgDoProduto(r.produto_id);
        const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
        const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo: salvo ? num(salvo.preco) : null, funilLoja };
        const regs = registros.filter((g) => g.rampa_id === r.id);
        const est = estadoRampa(r, regs, regras, ctx, hoje);
        return { r, produto, canal, item, cfg, ctx, est };
      })
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, registros, produtos, canais, itens, precos, cfgDoProduto, regras, hoje, funilLoja]);

  // Comissão de afiliado por item × canal (ao vivo).
  const linhasAf = useMemo(
    () => linhasComissao({ itens, canais, precos, cfgDoProduto, config: af.config, linhasRampa: linhas }),
    [itens, canais, precos, cfgDoProduto, af.config, linhas]
  );
  const mapaAf = useMemo(() => new Map(linhasAf.map((l) => [l.chave, l])), [linhasAf]);
  const semanaAf = useMemo(
    () => resumoSemana({ afRegistros: af.registros, rampaRegistros: registros, rampas, mapaLinhas: mapaAf, linhasRampa: linhas, hoje }),
    [af.registros, registros, rampas, mapaAf, linhas, hoje]
  );

  return { dados, rampasH, af, regras, hoje, funilLoja, linhas, linhasAf, mapaAf, semanaAf };
}
