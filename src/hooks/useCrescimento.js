import { useMemo } from "react";
import { useEscada } from "./useEscada.js";
import { useRampas } from "./useRampas.js";
import { useAfiliados } from "./useAfiliados.js";
import { estadoRampa, metricasFunil, referenciaFunilLoja, regrasDaLoja } from "../lib/rampa.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { useAdsPeriodos } from "./useAdsPeriodos.js";
import { adsDaLoja, avaliarAds, faseAdsSazonal, periodoAtivo, periodosDoItem, regrasAds, tetoDaLoja } from "../lib/ads.js";
import { lucroNoPreco } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import { canalDireto } from "../lib/canais.js";
import { useVendasOrganicas } from "./useVendasOrganicas.js";
import { configCalendario, infoSazonal, proximaCampanha, quandoVendeDe } from "../lib/calendario.js";

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
  // Períodos de Ads (lib/adsAcoes.js grava; ads.js decide): a Rampa só fica
  // sabendo que há Ads ligado no produto (teste "ads-ligado").
  const adsH = useAdsPeriodos();
  // Vendas orgânicas lançadas à mão (v52): entram no faturamento do teto de Ads.
  const organicasH = useVendasOrganicas();

  // Referência do funil: mediana de CTR e conversão dos produtos da loja
  // (só com 5+ produtos com funil calculável; senão, referência geral).
  const funilLoja = useMemo(
    () => referenciaFunilLoja(rampas.map((r) => metricasFunil(r, registros.filter((g) => g.rampa_id === r.id), regras, hoje))),
    [rampas, registros, regras, hoje]
  );

  // Uma linha por rampa, com tudo calculado ao vivo.
  // Calendário da loja (Configuração → Lojas): temporada do produto sazonal e
  // aviso da próxima campanha da plataforma.
  const calendario = useMemo(() => configCalendario(cfgLoja), [cfgLoja]);
  const campanha = useMemo(() => proximaCampanha(calendario, hoje), [calendario, hoje]);
  const linhas = useMemo(() => {
    return rampas
      .map((r) => {
        const produto = produtos.find((p) => p.id === r.produto_id);
        const canal = canais.find((c) => c.id === r.canal_id);
        const item = itens.find((i) => i.id === `p:${r.produto_id}`);
        if (!produto || !canal || !item) return null;
        const cfg = cfgDoProduto(r.produto_id);
        const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
        const adsAtivo = periodoAtivo(periodosDoItem(adsH.periodos, "produto", r.produto_id, r.canal_id), hoje);
        const sazonal = infoSazonal(quandoVendeDe(produto), calendario, hoje);
        const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo: salvo ? num(salvo.preco) : null, funilLoja, adsAtivo, sazonal, proximaCampanha: campanha };
        const regs = registros.filter((g) => g.rampa_id === r.id);
        const est = estadoRampa(r, regs, regras, ctx, hoje);
        return { r, produto, canal, item, cfg, ctx, est };
      })
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, registros, produtos, canais, itens, precos, cfgDoProduto, regras, hoje, funilLoja, adsH.periodos, calendario, campanha]);

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
        if (canalDireto(canal)) continue; // venda direta: sem Ads
        const salvo = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id);
        if (!salvo || !(num(salvo.preco) > 0)) continue;
        const rampa = tipo === "produto" ? linhas.find((l) => l.r.produto_id === id && l.r.canal_id === canal.id) || null : null;
        const cfg = cfgDoProduto(tipo === "produto" ? id : null);
        const preco = rampa ? num(rampa.est.preco) : num(salvo.preco);
        const lucroEm = (p) => lucroNoPreco(canal, p, it.custoTotal, it.peso, cfg);
        // Produto "só na época de…": fase do Ads sazonal (Aquecer/Ajustar/Alavancar/Corte).
        const produto = tipo === "produto" ? produtos.find((p) => p.id === id) : null;
        const sazonal = produto ? faseAdsSazonal(infoSazonal(quandoVendeDe(produto), calendario, hoje), hoje, regrasA) : null;
        base.push({ chave: `${tipo}|${id}|${canal.id}`, item: it, tipo, id, canal, rampa, preco, lucroEm, lucro: lucroEm(preco), semanas: semanasDe(tipo, id, canal.id, rampa), periodos: periodosDoItem(adsH.periodos, tipo, id, canal.id), sazonal });
      }
    }
    const loja = adsDaLoja(base.flatMap((b) => b.semanas.map((s) => ({ ...s, preco: num(s.preco) || b.preco }))), hoje, regrasA);
    // Teto de Ads da loja (30 dias): faturamento, lucro (antes do Ads) e gasto
    // dos registros cujo período termina nos últimos 30 dias.
    const desde30 = (() => {
      const d = new Date(`${hoje}T12:00:00`);
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();
    let fat30 = 0;
    let lucro30 = 0;
    let gasto30 = 0;
    for (const b of base)
      for (const s of b.semanas) {
        if (!(String(s.data).slice(0, 10) > desde30)) continue;
        const p = num(s.preco) || b.preco;
        fat30 += num(s.vendas) * p;
        lucro30 += num(s.vendas) * (b.lucroEm(p) ?? 0);
        gasto30 += num(s.ads_gasto);
      }
    // + vendas orgânicas lançadas à mão em Vendas do mês (faturamento TOTAL da loja).
    const PRE = { produto: "p", variacao: "v", kit: "k" };
    for (const o of organicasH.registros || []) {
      if (!(String(o.data).slice(0, 10) > desde30)) continue;
      const it = itens.find((i) => i.id === `${PRE[o.item_tipo] || "p"}:${o.item_id}`);
      const canal = canais.find((c) => c.id === o.canal_id);
      if (!it || !canal) continue;
      const un = num(o.unidades);
      const p = num(o.preco);
      fat30 += un * p;
      lucro30 += un * (lucroNoPreco(canal, p, it.custoTotal, it.peso, cfgDoProduto(it.produtoId || (o.item_tipo === "produto" ? o.item_id : null))) ?? 0);
    }
    const teto = tetoDaLoja({ faturamento: fat30, lucro: lucro30, gasto: gasto30, regras: regrasA });
    const linhasA = base.map((b) => ({
      ...b,
      av: avaliarAds({ preco: b.preco, lucro: b.lucro, lucroEm: b.lucroEm, semanas: b.semanas, periodos: b.periodos, anuncio: b.rampa?.est.anuncio || null, hoje, regras: regrasA, tetoLoja: teto, sazonal: b.sazonal }),
    }));
    // Lembretes de virada de fase do Ads sazonal (Início): na 1ª semana de cada fase.
    const sazonal = [];
    for (const l of linhasA) {
      const z = l.sazonal;
      if (!z || !z.inicio || !["aquecer", "ajustar", "alavancar", "corte"].includes(z.fase)) continue;
      const d = (new Date(`${hoje}T12:00:00`) - new Date(`${z.inicio}T12:00:00`)) / 86400000;
      if (d < 0 || d > 6) continue;
      const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
      sazonal.push({
        chave: l.chave,
        item: l.item,
        canal: l.canal,
        aviso: { id: z.fase, grupo: z.fase === "aquecer" ? "oportunidade" : "rotina", titulo: `Ads ${z.nome} — ${z.titulo}`, texto: `${z.texto}${z.fim ? ` (até ${dm(z.fim)})` : ""}` },
      });
    }
    return { loja, teto, sazonal, linhas: linhasA };
  }, [itens, canais, precos, produtos, linhas, cfgDoProduto, registros, af.registros, adsH.periodos, regrasA, hoje, calendario, organicasH.registros]);

  return { dados, rampasH, af, regras, hoje, funilLoja, calendario, linhas, linhasAf, mapaAf, semanaAf, adsH, regrasA, linhasAds };
}
