import { useMemo } from "react";
import { useEscada } from "./useEscada.js";
import { useRampas } from "./useRampas.js";
import { useAfiliados } from "./useAfiliados.js";
import { estadoRampa, metricasFunil, referenciaFunilLoja, regrasDaLoja } from "../lib/rampa.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { useAdsPeriodos } from "./useAdsPeriodos.js";
import { adsDaLoja, avaliarAds, avaliarAdsLoja, capacidadeDoItem, faseAdsSazonal, gastoAdsNaJanela, periodoAtivo, periodosDoItem, regrasAds, roasEmpate, tetoDaLoja } from "../lib/ads.js";
import { useLembretes } from "./useLembretes.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { equilibrioDoGrupo, estadoRampaGrupo, itensSoNoGrupo, mixDoGrupo, opcoesNoCanal } from "../lib/grupoRampa.js";
import { idGrupo, idDoItemOpcao, opcoesDoGrupo } from "../lib/anunciosGrupo.js";
import { useCatalogo } from "./useCatalogo.js";
import { lucroNoPreco } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import { canalDireto } from "../lib/canais.js";
import { useVendasReais } from "./useVendasReais.js";
import { somarDias } from "../lib/pedidos.js";
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
  const { itens, produtos, kits, canais, precos, cfgDoProduto, cfgLoja, publicacoesCanal, gruposAnuncio: grupos } = dados;
  const rampasH = useRampas({ comRegistros: true });
  const { rampas, rampasGrupo, registros } = rampasH;
  const { impressoras, farmConfig } = useCatalogo();
  // Itens que só existem dentro de um anúncio com vários itens: saem dos avisos
  // individuais de rampa e da lista de Ads (entram pelo anúncio inteiro).
  const soNoGrupo = useMemo(() => itensSoNoGrupo({ grupos, itens, precos }), [grupos, itens, precos]);
  const af = useAfiliados();
  const regras = useMemo(() => regrasDaLoja(cfgLoja), [cfgLoja]);
  const hoje = hojeISO();
  // Períodos de Ads (lib/adsAcoes.js grava; ads.js decide): a Rampa só fica
  // sabendo que há Ads ligado no produto (teste "ads-ligado").
  const adsH = useAdsPeriodos();
  // Vendas orgânicas lançadas à mão (v52): entram no faturamento do teto de Ads.
  const organicasH = useVendasOrganicas();
  // Pedidos reais (aba Análise, v55): no teto do Ads, o faturamento dos dias
  // com pedidos importados vem deles (a estimativa das semanas sai).
  const reais = useVendasReais({ itens, canais, cfgDoProduto });
  // "Não usar Ads por enquanto" (16/10/2026): lembretes chave ads-nao|<chave da linha>.
  const lembretesH = useLembretes();
  const { lojaId } = useLoja();

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
        return { r, produto, canal, item, cfg, ctx, est, soNoGrupo: soNoGrupo.has(item.id) };
      })
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, registros, produtos, canais, itens, precos, cfgDoProduto, regras, hoje, funilLoja, adsH.periodos, calendario, campanha, soNoGrupo]);

  // Rampa do ANÚNCIO com vários itens (v54, grupoRampa.js): degraus em % do
  // preço salvo de cada opção; mesma estadoRampa por dentro.
  const linhasGrupo = useMemo(() => {
    const out = [];
    for (const r of rampasGrupo || []) {
      const grupo = (grupos || []).find((g) => g.id === r.grupo_id);
      const canal = canais.find((c) => c.id === r.canal_id);
      if (!grupo || !canal) continue;
      // Sazonal: o 1º produto das opções que é "só na época de…".
      let sazonal = null;
      for (const o of opcoesDoGrupo(grupo)) {
        const it = itens.find((i) => i.id === idDoItemOpcao(o));
        const pid = it ? (it.id.startsWith("p:") ? it.id.slice(2) : it.produtoId || (it.componentes || [])[0]?.produtoId) : null;
        const prod = pid ? produtos.find((p) => p.id === pid) : null;
        const sz = prod ? infoSazonal(quandoVendeDe(prod), calendario, hoje) : null;
        if (sz && sz.tipo === "epoca") {
          sazonal = sz;
          break;
        }
      }
      const adsAtivo = periodoAtivo(periodosDoItem(adsH.periodos, "grupo", grupo.id, canal.id), hoje);
      const regs = registros.filter((g) => g.rampa_id === r.id);
      const g = estadoRampaGrupo({ rampa: r, registros: regs, regras, grupo, canal, itens, produtos, kits, precos, publicacoes: publicacoesCanal, cfgDoProduto, organicas: organicasH.registros, hoje, sazonal, funilLoja, adsAtivo, proximaCampanha: campanha });
      if (!g) continue;
      out.push({ r, grupo, canal, produto: { id: null, nome: `Anúncio: ${grupo.nome}`, sku: "" }, item: null, ehGrupo: true, g, est: g.est, regs });
    }
    return out.sort((a, b) => a.grupo.nome.localeCompare(b.grupo.nome));
  }, [rampasGrupo, grupos, canais, itens, produtos, kits, precos, publicacoesCanal, cfgDoProduto, registros, regras, organicasH.registros, hoje, calendario, funilLoja, adsH.periodos, campanha]);

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
      if (soNoGrupo.has(it.id)) continue; // entra pela linha do anúncio com vários itens
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
        base.push({ chave: `${tipo}|${id}|${canal.id}`, item: it, tipo, id, canal, rampa, preco, lucroEm, lucro: lucroEm(preco), semanas: semanasDe(tipo, id, canal.id, rampa), periodos: periodosDoItem(adsH.periodos, tipo, id, canal.id), sazonal, capacidadeDia: capacidadeDoItem(it, produtos, impressoras, farmConfig) });
      }
    }
    // Anúncio com vários itens = UMA linha de Ads (plano 14/10/2026). Equilíbrio
    // pelo mix de vendas das opções (sem vendas: a opção mais exigente). Os
    // períodos e semanas de Ads das opções que só existem no anúncio aparecem aqui.
    for (const grupo of grupos || []) {
      for (const canal of canais) {
        if (canalDireto(canal)) continue;
        const ops = opcoesNoCanal({ grupo, canal, itens, precos, cfgDoProduto });
        if (!ops.length) continue;
        const rampaG = linhasGrupo.find((l) => l.grupo.id === grupo.id && l.canal.id === canal.id) || null;
        const pct = rampaG ? rampaG.g.pctAtual : 100;
        const mix = mixDoGrupo({ grupo, organicas: organicasH.registros, itens, hoje, ops });
        const eq = equilibrioDoGrupo({ ops, pct, mix, canal, itens, produtos, kits, publicacoes: publicacoesCanal });
        if (!eq) continue;
        const ticket100 = rampaG?.g.ticket100 || eq.preco;
        const opsSo = ops.filter((o) => soNoGrupo.has(o.itemId));
        const semanas = rampaG
          ? rampaG.regs.filter((g) => g.tipo === "semana").map((g) => ({ ...g, preco: g.preco != null ? (Number(g.preco) / 100) * ticket100 : null }))
          : (af.registros || []).filter((g) => g.item_tipo === "grupo" && g.item_id === grupo.id && g.canal_id === canal.id && g.vendas_total != null).map((g) => ({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas }));
        // histórico de Ads das opções (antes do anúncio virar uma linha só)
        for (const o of opsSo) {
          const t = itemTipoDoId(o.itemId);
          for (const g of af.registros || [])
            if (g.item_tipo === t && g.item_id === o.itemId.slice(2) && g.canal_id === canal.id && g.vendas_total != null && Number(g.ads_gasto) > 0 && !semanas.some((x) => String(x.data).slice(0, 10) === String(g.data).slice(0, 10)))
              semanas.push({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas });
        }
        semanas.sort((a, b) => String(a.data).localeCompare(String(b.data)));
        // Os do próprio anúncio vêm primeiro; das opções, o que mais gastou (o
        // anúncio com Ads de verdade) antes — o 1º ligado é o "período atual".
        const gastoDe = (p) => Number(p.parcial?.gasto) || 0;
        const periodos = [
          ...periodosDoItem(adsH.periodos, "grupo", grupo.id, canal.id),
          ...opsSo.flatMap((o) => periodosDoItem(adsH.periodos, itemTipoDoId(o.itemId), o.itemId.slice(2), canal.id)).sort((a, b) => gastoDe(b) - gastoDe(a) || String(b.inicio).localeCompare(String(a.inicio))),
        ];
        const caps = ops.map((o) => capacidadeDoItem(o.item, produtos, impressoras, farmConfig));
        const item = { id: idGrupo(grupo.id), nome: `Anúncio: ${grupo.nome}`, sku: "", grupo: true };
        base.push({
          chave: `grupo|${grupo.id}|${canal.id}`,
          item,
          tipo: "grupo",
          id: grupo.id,
          canal,
          grupo,
          ops,
          mix,
          pior: eq.pior,
          rampa: null,
          rampaGrupo: rampaG,
          preco: eq.preco,
          lucroEm: eq.lucroEm,
          lucro: eq.lucro,
          semanas,
          periodos,
          sazonal: rampaG?.est.sazonal ? faseAdsSazonal(rampaG.est.sazonal, hoje, regrasA) : null,
          capacidadeDia: caps.every((c) => c != null) ? Math.min(...caps) : null,
          semFaturamento: true, // vendas do anúncio já entram pelas vendas_organicas (grupo_id)
        });
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
    for (const b of base) {
      for (const s of b.semanas) {
        if (!(String(s.data).slice(0, 10) > desde30)) continue;
        if (b.semFaturamento || reais.cobertura.cobre(b.canal, somarDias(String(s.data).slice(0, 10), -1))) continue;
        const p = num(s.preco) || b.preco;
        fat30 += num(s.vendas) * p;
        lucro30 += num(s.vendas) * (b.lucroEm(p) ?? 0);
      }
      // Gasto AO VIVO (16/10/2026): semanas registradas ou o andamento (CSV), o maior.
      gasto30 += gastoAdsNaJanela(b.periodos, b.semanas, somarDias(desde30, 1), hoje);
    }
    // + vendas orgânicas lançadas à mão em Vendas do mês (faturamento TOTAL da loja).
    const PRE = { produto: "p", variacao: "v", kit: "k" };
    for (const o of organicasH.registros || []) {
      if (!(String(o.data).slice(0, 10) > desde30)) continue;
      const it = itens.find((i) => i.id === `${PRE[o.item_tipo] || "p"}:${o.item_id}`);
      const canal = canais.find((c) => c.id === o.canal_id);
      if (!it || !canal || reais.cobertura.cobre(canal, String(o.data).slice(0, 10))) continue;
      const un = num(o.unidades);
      const p = num(o.preco);
      fat30 += un * p;
      lucro30 += un * (lucroNoPreco(canal, p, it.custoTotal, it.peso, cfgDoProduto(it.produtoId || (o.item_tipo === "produto" ? o.item_id : null))) ?? 0);
    }
    for (const p of reais.linhas) {
      if (!p.valido || !(String(p.data) > desde30) || String(p.data) > hoje) continue;
      fat30 += p.pago;
      lucro30 += p.lucro ?? 0;
    }
    // GMV Max da Loja (v57, item_tipo 'loja'): linha fixa no topo da aba Ads.
    // Equilíbrio da loja = faturamento ÷ lucro antes do Ads dos pedidos dos
    // últimos 30 dias (sem pedidos: mediana do equilíbrio das linhas).
    const canalLoja = canais.find((c) => c.tipo === "shopee") || null;
    let lojaLinha = null;
    if (canalLoja && lojaId) {
      let fatP = 0;
      let lucP = 0;
      for (const p of reais.linhas) {
        if (!p.valido || p.origem === "fisico" || !(String(p.data) > desde30) || String(p.data) > hoje) continue;
        fatP += p.pago;
        lucP += p.lucro ?? 0;
      }
      let equilibrio = roasEmpate(fatP, lucP);
      let origemEq = "pedidos dos últimos 30 dias";
      if (!equilibrio) {
        const eqs = base.map((b) => roasEmpate(b.preco, b.lucro)).filter((x) => x != null).sort((a, b) => a - b);
        equilibrio = eqs.length ? eqs[Math.floor(eqs.length / 2)] : null;
        origemEq = "média dos produtos (sem pedidos importados)";
      }
      const periodosL = periodosDoItem(adsH.periodos, "loja", lojaId, canalLoja.id);
      gasto30 += gastoAdsNaJanela(periodosL, [], somarDias(desde30, 1), hoje);
      lojaLinha = { chave: `loja|${lojaId}|${canalLoja.id}`, tipo: "loja", id: lojaId, canal: canalLoja, item: { id: `loja:${lojaId}`, nome: "Loja inteira · GMV Max da Loja" }, periodos: periodosL, semanas: [], equilibrio, origemEq, av: avaliarAdsLoja({ periodos: periodosL, equilibrio, hoje, regras: regrasA }) };
    }
    const teto = tetoDaLoja({ faturamento: fat30, lucro: lucro30, gasto: gasto30, regras: regrasA });
    const linhasA = base.map((b) => ({
      ...b,
      av: avaliarAds({ preco: b.preco, lucro: b.lucro, lucroEm: b.lucroEm, semanas: b.semanas, periodos: b.periodos, anuncio: (b.rampa || b.rampaGrupo)?.est.anuncio || null, hoje, regras: regrasA, tetoLoja: teto, sazonal: b.sazonal, capacidadeDia: b.capacidadeDia }),
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
    // "Não usar Ads por enquanto": vai pra Sem Ads e sai de Oportunidade/Início.
    for (const l of linhasA) {
      const lb = (lembretesH.lembretes || []).find((x) => x.chave === `ads-nao|${l.chave}`);
      if (lb && !l.av.ativo) l.semAds = { desde: lb.adiado_ate || null };
    }
    return { loja, teto, sazonal, linhas: linhasA, lojaLinha, lembretesOk: lembretesH.disponivel };
  }, [lembretesH, lojaId, itens, canais, precos, produtos, kits, linhas, linhasGrupo, grupos, soNoGrupo, cfgDoProduto, registros, af.registros, adsH.periodos, regrasA, hoje, calendario, organicasH.registros, publicacoesCanal, impressoras, farmConfig, reais.linhas, reais.cobertura]);

  return { dados, rampasH, af, regras, hoje, funilLoja, calendario, linhas, linhasGrupo, soNoGrupo, linhasAf, mapaAf, semanaAf, adsH, regrasA, linhasAds, organicasH };
}
