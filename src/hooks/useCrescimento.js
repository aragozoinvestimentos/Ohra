import { useMemo } from "react";
import { useEscada } from "./useEscada.js";
import { useRampas } from "./useRampas.js";
import { useAfiliados } from "./useAfiliados.js";
import { estadoRampa, metricasFunil, referenciaFunilLoja, regrasDaLoja } from "../lib/rampa.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { useAdsPeriodos } from "./useAdsPeriodos.js";
import { adsDaLoja, avaliarAds, periodosDoItem, regrasAds } from "../lib/ads.js";
import { lucroNoPreco } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";

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

  // Ads (schema v44, lib/ads.js): uma linha por produto/kit × canal com preço
  // salvo — situação da semana (usar? aumentar? pausar?). Semanas: as da rampa
  // do produto ou, fora de rampa, os registros semanais do item (afiliado_registros
  // com vendas_total, que também guardam os itens só com Ads).
  const adsH = useAdsPeriodos();
  const regrasA = useMemo(() => regrasAds(cfgLoja), [cfgLoja]);
  const linhasAds = useMemo(() => {
    const semanasDe = (tipo, id, canalId, rampa) =>
      rampa
        ? registros.filter((g) => g.rampa_id === rampa.r.id && g.tipo === "semana")
        : (af.registros || [])
            .filter((g) => g.item_tipo === tipo && g.item_id === id && g.canal_id === canalId && g.vendas_total != null)
            .map((g) => ({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas }));
    const base = [];
    for (const it of itens) {
      const tipo = itemTipoDoId(it.id);
      if (tipo === "variacao") continue; // o Ads é por anúncio (produto pai ou kit)
      const id = it.id.slice(2);
      for (const canal of canais) {
        const salvo = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id);
        if (!salvo || !(num(salvo.preco) > 0)) continue;
        const rampa = tipo === "produto" ? linhas.find((l) => l.r.produto_id === id && l.r.canal_id === canal.id) || null : null;
        const cfg = cfgDoProduto(tipo === "produto" ? id : null);
        const preco = rampa ? num(rampa.est.preco) : num(salvo.preco);
        const lucroEm = (p) => lucroNoPreco(canal, p, it.custoTotal, it.peso, cfg);
        base.push({ chave: `${tipo}|${id}|${canal.id}`, item: it, tipo, id, canal, rampa, preco, lucroEm, lucro: lucroEm(preco), semanas: semanasDe(tipo, id, canal.id, rampa), periodos: periodosDoItem(adsH.periodos, tipo, id, canal.id) });
      }
    }
    const loja = adsDaLoja(base.flatMap((b) => b.semanas.map((s) => ({ ...s, preco: num(s.preco) || b.preco }))), hoje, regrasA);
    return {
      loja,
      linhas: base.map((b) => ({
        ...b,
        av: avaliarAds({ preco: b.preco, lucro: b.lucro, lucroEm: b.lucroEm, semanas: b.semanas, periodos: b.periodos, anuncio: b.rampa?.est.anuncio || null, hoje, regras: regrasA, tetoLoja: loja }),
      })),
    };
  }, [itens, canais, precos, linhas, cfgDoProduto, registros, af.registros, adsH.periodos, regrasA, hoje]);

  return { dados, rampasH, af, regras, hoje, funilLoja, linhas, linhasAf, mapaAf, semanaAf, adsH, regrasA, linhasAds };
}
