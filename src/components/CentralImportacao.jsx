import { useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { lerXls } from "../lib/lerXls.js";
import { andamentoDoCsv, juntarAds, juntarDesempenho, cruzarGrupos, lembrarIdsShopee, lerRelatorio, lerXlsx, relatorioDoGuardado, relatorioParaGuardar } from "../lib/relatorioShopee.js";
import { PLATAFORMAS, caixaDosPedidos, interpretarPedidosOlist, ligarSku, plataformaDoNumero, tipoEIdDoItem, normSku } from "../lib/pedidos.js";
import { excluirVendaFisica, gravarPedidos, ignorarSku, registrarImportacao, registrarVendaFisica, sincronizarCaixa } from "../lib/pedidosAcoes.js";
import { EmbalagemOrganicoVenda } from "./EmbalagemOrganico.jsx";
import { canalComEmbalagem } from "../lib/embalagemCanal.js";
import { encerrarPeriodoAds, estenderPeriodoAds, iniciarPeriodoAds, pausarPeriodoAds, salvarAndamentoAds } from "../lib/adsAcoes.js";
import { fichaDoGrupo } from "../lib/anunciosGrupo.js";
import { acumuladoDasJanelas, furosDasJanelas, janelaDoRelatorio, janelasDoPeriodo, juntarJanela, textoFuro } from "../lib/gmvLoja.js";
import { recarregarPedidos } from "../hooks/usePedidos.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { irParaAba } from "../lib/navegar.js";
import { trocarSubAba } from "../lib/subAbas.js";
import { canalDireto } from "../lib/canais.js";
import CanalTag from "./CanalTag.jsx";
import BuscaItem from "./BuscaItem.jsx";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import AvaliacoesBloco from "./AvaliacoesBloco.jsx";
import { usePreferencia } from "../hooks/usePreferencia.js";

// Aba Análise → 1 · Importar dados (schema v55): UM lugar pra subir todos os
// arquivos. Um bloco por plataforma (padrão igual pra todas): pedidos da
// Olist + os relatórios de anúncio da plataforma (Shopee: Desempenho e Ads).
// Cada botão mostra de onde puxar, o último envio e ✓/✗; arquivo errado não
// importa nada. Venda física fica no cartão próprio. Pedidos ENTREGUES viram
// entrada no Fluxo de Caixa (uma por plataforma × semana); enviados = a receber.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const diasDesde = (iso, hoje) => (iso ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${String(iso).slice(0, 10)}T12:00:00`)) / 86400000) : null);
const dataDoEnvio = (imp) => (imp?.criado_em ? new Date(imp.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null);
const ICONE = { ok: "✓", erro: "✗", velho: "!", nunca: "–", pend: "?" };
const horaSP = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "");
// Identifica uma lista pelo conteúdo (os nomes dos arquivos da Shopee costumam ser iguais).
const assinatura = (r) => (r.tipo === "ads" ? [...r.porItem.entries()].map(([id, a]) => `${id}:${a.gasto}`).sort().join(",") : (r.itens || []).map((i) => i.itemId).sort().join(","));

async function lerPlanilha(arquivo) {
  const buf = await arquivo.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) return (await lerXlsx(buf))[0]?.linhas || [];
  return lerXls(buf);
}

export default function CentralImportacao({ esc, ped, linhas, linhasAds, cres, hoje, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, produtos, kits, precos, cfgDoProduto, gruposAnuncio: grupos = [] } = esc;
  const [resultado, setResultado] = useState({}); // relatorio → { t, txt }
  const [pend, setPend] = useState(null); // envio da Olist esperando resposta: { passo "plataforma"|"skus", porPlat, grupos, desconhecidos, pendentes, resolvidos, periodo, arquivo }
  const [perguntas, setPerguntas] = useState([]);
  const [avisos, setAvisos] = useState({}); // relatorio → [texto]
  const [ocupado, setOcupado] = useState(null);
  // Avisos de anúncio pausado/excluído que o Gustavo mandou ignorar (chave →
  // "status|gasto"): só voltam se o gasto ou o status mudar.
  const [adsIgnorados, setAdsIgnorados] = usePreferencia("importar:ads-ignorados", {});
  const [infos, setInfos] = useState([]);
  const sigPergunta = (q) => `${q.tipo}|${q.status || ""}|${q.valores?.gasto ?? ""}`;
  const [fisico, setFisico] = useState(null); // form aberto
  const [excluir, setExcluir] = useState(null);
  const ignorados = useMemo(() => new Set((ped.ignorados || []).map((g) => normSku(g.sku))), [ped.ignorados]);
  const okOrdenadas = useMemo(() => (ped.importacoes || []).filter((i) => i.ok).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))), [ped.importacoes]);
  const ultimaImp = (rel) => [...okOrdenadas].reverse().find((i) => i.relatorio === rel) || null;
  const ctx = { itens, canais, cfgDoProduto, itemNoCanal: esc.itemNoCanal };

  // ---------- Pedidos da Olist (um arquivo com TODAS as plataformas) ----------
  // 21/10/2026: a Olist exporta os pedidos de todos os marketplaces juntos — o
  // app separa pelo nº do pedido no marketplace (PLATAFORMAS[].padrao; TikTok
  // conferido com o 1º pedido real). Número que nenhum padrão reconhece = o app
  // pergunta de qual plataforma é. O arquivo cobre o período de TODAS as
  // plataformas com canal (registra pedidos:<plat> em cada uma).
  const platsComCanal = PLATAFORMAS.map((p) => ({ plat: p, canal: canais.find((c) => c.tipo === p.tipo) || null })).filter((x) => x.canal);
  async function enviarOlist(arquivo) {
    const rel = "pedidos:olist";
    setOcupado(rel);
    try {
      const { itens: lidos, periodo } = interpretarPedidosOlist(await lerPlanilha(arquivo));
      if (!lidos.length) throw new Error("Nenhum pedido no arquivo. Nada foi importado.");
      const porPlat = new Map();
      const desconhecidos = [];
      for (const i of lidos) {
        const id = plataformaDoNumero(i.ordem_compra);
        if (!id) desconhecidos.push(i);
        else {
          if (!porPlat.has(id)) porPlat.set(id, []);
          porPlat.get(id).push(i);
        }
      }
      const base = { olist: true, porPlat, periodo, arquivo: arquivo.name };
      if (desconhecidos.length) setPend({ ...base, passo: "plataforma", desconhecidos, escolha: "" });
      else prepararOlist(base);
    } catch (e) {
      setResultado((r) => ({ ...r, [rel]: { t: "erro", txt: e.message || "Não foi possível ler o arquivo." } }));
    }
    setOcupado(null);
  }
  function escolherDesconhecidos(p0, platId) {
    const porPlat = new Map(p0.porPlat);
    if (platId) porPlat.set(platId, [...(porPlat.get(platId) || []), ...p0.desconhecidos]);
    prepararOlist({ olist: true, porPlat, periodo: p0.periodo, arquivo: p0.arquivo, ignorados: platId ? 0 : new Set(p0.desconhecidos.map((i) => i.pedido)).size });
  }
  function prepararOlist(base) {
    const grupos = [];
    const semCanal = [];
    for (const [id, lista] of base.porPlat) {
      const x = platsComCanal.find((y) => y.plat.id === id);
      if (!x) semCanal.push({ nome: PLATAFORMAS.find((p) => p.id === id)?.nome || id, n: new Set(lista.map((i) => i.pedido)).size });
      else grupos.push({ ...x, ligados: lista.map((i) => ({ ...i, it: ligarSku(i.sku, itens) })) });
    }
    const pendMap = new Map();
    for (const g of grupos)
      for (const i of g.ligados)
        if (!i.it && i.sku && !ignorados.has(i.sku)) {
          const x = pendMap.get(i.sku) || { sku: i.sku, descricao: i.descricao, un: 0 };
          x.un += num(i.quantidade);
          pendMap.set(i.sku, x);
        }
    const pronto = { ...base, grupos, semCanal };
    if (pendMap.size) setPend({ ...pronto, passo: "skus", pendentes: [...pendMap.values()], resolvidos: {} });
    else gravarOlist(pronto);
  }
  async function gravarOlist({ grupos, semCanal = [], periodo, arquivo, ignorados: nIgn = 0 }) {
    const rel = "pedidos:olist";
    setOcupado(rel);
    setPend(null);
    const existentes = new Set((ped.pedidos || []).map((p) => p.chave));
    const rows = [];
    let semItem = 0;
    for (const g of grupos) {
      for (const i of g.ligados) {
        if (!i.it) {
          semItem++;
          continue;
        }
        const { it, ...resto } = i;
        rows.push({ ...resto, canal_id: g.canal.id, plataforma: g.plat.id, ...tipoEIdDoItem(it) });
      }
    }
    if (rows.length) {
      const r = await gravarPedidos({ lojaId, linhas: rows });
      if (!r.ok) {
        setResultado((x) => ({ ...x, [rel]: { t: "erro", txt: r.msg } }));
        setOcupado(null);
        return;
      }
    }
    // Caixa com todos os pedidos (os de antes + estes), numa conta só.
    const porChave = new Map((ped.pedidos || []).map((p) => [p.chave, p]));
    for (const x of rows) porChave.set(x.chave, { ...porChave.get(x.chave), ...x });
    const cx = await sincronizarCaixa({ lojaId, pedidos: [...porChave.values()], ctx });
    // O arquivo da Olist cobre o período de todas as plataformas com canal.
    const partes = [];
    for (const { plat } of platsComCanal) {
      const doPlat = rows.filter((x) => x.plataforma === plat.id);
      const pedN = new Set(doPlat.map((x) => x.pedido)).size;
      const novos = doPlat.filter((x) => !existentes.has(x.chave)).length;
      const cancel = new Set(doPlat.filter((x) => /cancel|devolv/i.test(x.situacao)).map((x) => x.pedido)).size;
      const resumo = `${dm(periodo.de)} a ${dm(periodo.ate)} · ${pedN ? `${pedN} pedido${pedN === 1 ? "" : "s"}, ${novos} ite${novos === 1 ? "m novo" : "ns novos"}${cancel ? ` (${cancel} cancelado${cancel > 1 ? "s" : ""})` : ""}` : "nenhum pedido no período"} · pelo arquivo da Olist`;
      await registrarImportacao({ lojaId, relatorio: `pedidos:${plat.id}`, arquivo, periodo, ok: true, resumo });
      if (pedN) partes.push(`${plat.nome} ${pedN}`);
    }
    const resumo = `${dm(periodo.de)} a ${dm(periodo.ate)} · ${partes.length ? partes.join(" · ") : "nenhum pedido"}${semItem ? ` · ${semItem} ite${semItem === 1 ? "m" : "ns"} com SKU fora (pendente/descartado)` : ""}${nIgn ? ` · ${nIgn} pedido${nIgn > 1 ? "s" : ""} de plataforma desconhecida ignorado${nIgn > 1 ? "s" : ""}` : ""}`;
    await registrarImportacao({ lojaId, relatorio: rel, arquivo, periodo, ok: true, resumo });
    setResultado((x) => ({ ...x, [rel]: { t: "ok", txt: `${resumo} · agora` } }));
    const avs = [...(cx.ok ? cx.avisos : [cx.msg]), ...semCanal.map((x) => `${x.n} pedido${x.n > 1 ? "s" : ""} da ${x.nome} ${x.n > 1 ? "ficaram" : "ficou"} de fora — cadastre o canal em Configuração → Canais e reenvie o arquivo.`)];
    setAvisos((a) => ({ ...a, [rel]: avs }));
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    setOcupado(null);
    onToast?.(`Pedidos importados${partes.length ? ` (${partes.join(" · ")})` : ""}${cx.ok ? " · Fluxo de Caixa atualizado (entregues)" : ""}`);
  }
  async function descartarSku(sku) {
    const r = await ignorarSku({ lojaId, sku });
    if (!r.ok) return onToast?.(r.msg);
    setPend((p) => (p ? { ...p, resolvidos: { ...p.resolvidos, [sku]: "desc" } } : p));
  }
  function cadastrarSku(sku) {
    try {
      navigator.clipboard?.writeText(sku);
    } catch {
      // sem área de transferência
    }
    setPend((p) => (p ? { ...p, resolvidos: { ...p.resolvidos, [sku]: "cad" } } : p));
    onToast?.(`SKU ${sku} copiado — cole no cadastro do produto. Depois reenvie o arquivo pra completar.`);
    trocarSubAba("ohra:cadastros-sub", "produtos");
    irParaAba("cadastros");
  }

  // ---------- Shopee: Desempenho e Ads ----------
  const shopee = canais.find((c) => c.tipo === "shopee") || null;
  function aprenderGrupos(lidos) {
    if (!shopee || !lidos.some((r) => r.tipo === "desempenho")) return;
    cruzarGrupos(
      lidos,
      grupos
        .map((g) => ({ g, ficha: fichaDoGrupo({ grupo: g, canal: shopee, itens, precos, produtos, kits, mapaRampa: esc.mapaRampa, publicacoes: esc.publicacoesCanal, clientePagaHoje: esc.clientePagaHoje }) }))
        .filter((x) => x.ficha)
        .map(({ g, ficha }) => ({ id: g.id, nome: g.nome, opcoes: ficha.opcoes.map((o, idx) => ({ idx, skus: ficha.linhas.filter((l) => l.opcao === o).map((l) => l.sku) })) }))
    );
  }
  async function enviarShopee(tipo, arquivos) {
    const rel = `shopee:${tipo}`;
    setOcupado(rel);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      const errado = lidos.find((x) => x.tipo !== tipo);
      if (errado) throw new Error(errado.tipo === "gmv" ? "Isto é o relatório da GMV Max da Loja — suba no botão “GMV Max da Loja”. Nada foi importado." : errado.tipo === "ads" ? "Isto é o CSV do Shopee Ads — suba no botão “Ads (CSV) dos produtos”. Nada foi importado." : "Isto é o relatório de Desempenho — suba no botão “Desempenho do produto”. Nada foi importado.");
      // A Shopee separa os anúncios em listas (melhor desempenho, recém-cadastrados…):
      // os arquivos escolhidos juntos viram um relatório só.
      const juntar = tipo === "ads" ? juntarAds : juntarDesempenho;
      const novo = juntar(lidos);
      if (novo.periodosDiferentes) throw new Error(`Os arquivos têm períodos diferentes — exporte todas as listas com o mesmo período${tipo === "ads" ? " (do início do período de Ads até ontem)" : ""}. Nada foi importado.`);
      // Listas enviadas uma de cada vez: junta com as já enviadas do MESMO período
      // (a mesma lista enviada de novo substitui a anterior, não soma).
      const ant = ultimaImp(rel);
      const mesmoPeriodo = ant?.dados && novo.periodo && String(ant.periodo_de).slice(0, 10) === novo.periodo.de && String(ant.periodo_ate).slice(0, 10) === novo.periodo.ate;
      const partesAnt = mesmoPeriodo ? (ant.dados.partes || [{ ...ant.dados, arquivo: ant.arquivo, em: ant.criado_em }]).map(relatorioDoGuardado).filter(Boolean) : [];
      const agora = new Date().toISOString();
      const novas = lidos.map((x) => ({ ...x, em: agora }));
      const assinNovas = new Set(novas.map(assinatura));
      const partes = [...partesAnt.filter((x) => !assinNovas.has(assinatura(x))), ...novas];
      const r = juntar(partes.map((x, i) => ({ ...x, arquivo: `${i}|${x.arquivo || ""}` })));
      const listas = partes.map((x) => {
        const n = tipo === "ads" ? x.porItem.size : (x.itens || []).length;
        return `${n} anúncio${n === 1 ? "" : "s"} (${horaSP(x.em)})`;
      });
      const txtListas = partes.length > 1 ? ` · ${partes.length} listas: ${listas.join(" + ")}` : "";
      const arquivo = { name: partes.map((x) => x.arquivo).filter(Boolean).join(" + ") || arquivos[0].name };
      lembrarIdsShopee([r]);
      aprenderGrupos([r]);
      let resumo = "";
      if (tipo === "desempenho") {
        const lig = (r.itens || []).filter((i) => ligarSku(i.sku, itens)).length;
        resumo = `${dm(r.periodo?.de)} a ${dm(r.periodo?.ate)}${txtListas} · ${(r.itens || []).length} anúncios no total, ${lig} ligados ao app — funil das semanas da Rampa e do Ads`;
      } else {
        // GMV Max da Loja: com o arquivo próprio já enviado, a linha da loja
        // deste CSV fica de fora (o botão “GMV Max da Loja” manda nela).
        const temGmv = !!ultimaImp("shopee:gmv");
        const res = andamentoDoCsv([r], linhasAds?.linhas || [], temGmv ? null : linhasAds?.lojaLinha || null);
        let n = 0;
        for (const l of (linhasAds?.linhas || []).filter((x) => x.av?.ativo && x.canal?.tipo === "shopee")) {
          const x = res.porChave[l.chave] || (res.zerados.includes(l.chave) ? { gasto: 0, cliques: 0, vendas: 0 } : null);
          if (!x || !res.periodo?.ate) continue;
          const s = await salvarAndamentoAds(l.av.ativo, { ate: res.periodo.ate, gasto: num(x.gasto), cliques: Math.round(num(x.cliques)), vendas: Math.round(num(x.vendas)) });
          if (!s.ok) throw new Error(s.msg);
          n++;
        }
        let txtLoja = "";
        if (res.lojaAndamento) {
          const s = await salvarAndamentoAds(res.lojaAndamento.periodo, { ate: res.lojaAndamento.ate, ...res.lojaAndamento.valores });
          if (!s.ok) throw new Error(s.msg);
          txtLoja = ` + GMV Max da Loja (${BRL(res.lojaAndamento.valores.gasto)})`;
        }
        setPerguntas((res.perguntas || []).filter((q) => adsIgnorados[q.chave] !== sigPergunta(q)));
        setInfos(res.infos || []);
        setAvisos((a) => ({ ...a, [rel]: res.avisos || [] }));
        resumo = `${dm(res.periodo?.de)} a ${dm(res.periodo?.ate)}${txtListas} · andamento atualizado em ${n} anúncio${n === 1 ? "" : "s"} com Ads ligado${txtLoja}`;
        window.dispatchEvent(new Event("focus"));
      }
      const g = await registrarImportacao({ lojaId, relatorio: rel, arquivo: arquivo.name, periodo: r.periodo, ok: true, resumo, dados: { ...relatorioParaGuardar({ ...r, arquivo: arquivo.name }), partes: partes.map(relatorioParaGuardar) } });
      if (!g.ok) throw new Error(g.msg);
      setResultado((x) => ({ ...x, [rel]: { t: "ok", txt: `${resumo} · enviado agora (${horaSP(agora)})${partesAnt.length && partes.length > partesAnt.length ? " — juntou com a lista anterior" : ""}` } }));
      recarregarPedidos();
    } catch (e) {
      setResultado((x) => ({ ...x, [rel]: { t: "erro", txt: e.message || "Não foi possível ler o arquivo." } }));
    }
    setOcupado(null);
  }
  // ---------- Shopee: GMV Max da Loja (arquivo próprio) ----------
  // Cada arquivo = uma janela (o período exportado). As janelas se somam no
  // período ligado da loja; a mesma janela de novo substitui; furo = aviso.
  async function enviarGmv(arquivos) {
    const rel = "shopee:gmv";
    setOcupado(rel);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      const errado = lidos.find((x) => x.tipo !== "gmv");
      if (errado) throw new Error(errado.tipo === "ads" ? "Isto é o CSV de Ads dos produtos — suba no botão “Ads (CSV) dos produtos”. Nada foi importado." : "Isto é o relatório de Desempenho — suba no botão “Desempenho do produto”. Nada foi importado.");
      let janelas = ultimaImp(rel)?.dados?.janelas || [];
      const infosJ = [];
      for (const x of lidos) {
        const j = janelaDoRelatorio(x);
        if (!j) throw new Error(`${x.arquivo}: não achei o período no arquivo. Nada foi importado.`);
        const r = juntarJanela(janelas, j);
        if (r.erro) throw new Error(r.erro);
        janelas = r.janelas;
        if (r.info) infosJ.push(r.info);
      }
      const ll = linhasAds?.lojaLinha || null;
      const ativo = ll?.av?.ativo || null;
      const avs = [];
      let txt = "";
      if (ativo) {
        const doPer = janelasDoPeriodo(janelas, ativo);
        const ac = acumuladoDasJanelas(doPer);
        if (ac) {
          const s = await salvarAndamentoAds(ativo, { ate: ac.ate, gasto: ac.gasto, cliques: ac.cliques, vendas: ac.vendas, receita: ac.receita, historico: ac.historico });
          if (!s.ok) throw new Error(s.msg);
          txt = ` · período da loja desde ${dm(ativo.inicio)}: ${BRL(ac.gasto)} gastos, ${ac.vendas} vendas, até ${dm(ac.ate)}`;
        }
        for (const f of furosDasJanelas(doPer, ativo.inicio)) avs.push(`Furo no período da GMV Max: ${textoFuro(f)} — exporte exatamente esse período e envie aqui (ele se soma sem duplicar).`);
        const antes = janelas.filter((j) => j.ate < ativo.inicio);
        if (antes.length) avs.push(`${antes.length} envio${antes.length === 1 ? "" : "s"} antes de ${dm(ativo.inicio)} (início do período da loja no app) — não entra${antes.length === 1 ? "" : "m"} no andamento.`);
        setPerguntas((p) => p.filter((q) => q.l?.tipo !== "loja"));
      } else if (ll) {
        const ac = acumuladoDasJanelas(janelas);
        if (ac && ac.gasto > 0) {
          setPerguntas((p) => [...p.filter((q) => q.l?.tipo !== "loja"), { chave: ll.chave, l: ll, tipo: "criar", data: ac.de, ate: ac.ate, valores: { gasto: ac.gasto, cliques: ac.cliques, vendas: ac.vendas, receita: ac.receita, historico: ac.historico } }]);
          for (const f of furosDasJanelas(janelas, ac.de)) avs.push(`Furo: ${textoFuro(f)} — exporte esse período e envie aqui.`);
        }
      }
      const nProd = lidos.reduce((n, x) => Math.max(n, (x.lojaPorItem || []).length), 0);
      const resumo = `${lidos.map((x) => `${dm(x.periodo.de)} a ${dm(x.periodo.ate)}`).join(" + ")}: ${BRL(lidos.reduce((a, x) => a + (x.loja?.gasto || 0), 0))} gastos · ${nProd} produto${nProd === 1 ? "" : "s"} na campanha (só informação — não cria Ads de produto)${txt}${infosJ.length ? ` · ${infosJ.join(" · ")}` : ""}`;
      setAvisos((a) => ({ ...a, [rel]: avs }));
      const per = { de: janelas[0].de, ate: janelas.reduce((m, j) => (j.ate > m ? j.ate : m), "") };
      const g = await registrarImportacao({ lojaId, relatorio: rel, arquivo: arquivos.map((a) => a.name).join(" + "), periodo: per, ok: true, resumo, dados: { janelas } });
      if (!g.ok) throw new Error(g.msg);
      setResultado((x) => ({ ...x, [rel]: { t: "ok", txt: `${resumo} · enviado agora (${horaSP(new Date().toISOString())})` } }));
      recarregarPedidos();
      window.dispatchEvent(new Event("focus"));
    } catch (e) {
      setResultado((x) => ({ ...x, [rel]: { t: "erro", txt: e.message || "Não foi possível ler o arquivo." } }));
    }
    setOcupado(null);
  }

  // acao: "sim" | "nao" | "pausar" (parado) — "nao" em aviso de pausado/excluído = ignorar (lembrado).
  async function responder(q, acao) {
    const nome = q.l.item.nome;
    if (acao !== "nao") {
      let r;
      let msg = "";
      if (q.tipo === "estender") {
        r = await estenderPeriodoAds(q.periodo, q.data);
        msg = `${nome}: fim do período estendido até ${dm(q.data)}`;
      } else if (q.tipo === "criar" || q.tipo === "criar-encerrado") {
        r = await iniciarPeriodoAds({ lojaId, tipo: q.l.tipo, id: q.l.id, canalId: q.l.canal.id, inicio: q.data, nota: "criado pelo CSV do Shopee Ads" });
        if (r.ok && r.periodo) await salvarAndamentoAds(r.periodo, { ate: q.ate, ...q.valores });
        if (r.ok && r.periodo && q.tipo === "criar-encerrado") await encerrarPeriodoAds(r.periodo, { fim: q.ate, motivo: `${q.status.toLowerCase()} na Shopee` });
        msg = q.tipo === "criar-encerrado" ? `${nome}: gasto registrado como período encerrado (${dm(q.data)}–${dm(q.ate)})` : `${nome}: período de Ads criado desde ${dm(q.data)}`;
      } else if (q.tipo === "corrigir") {
        r = await salvarAndamentoAds(q.periodo, { ate: q.data, ...q.valores });
        msg = `${nome}: gasto do período corrigido pra ${BRL(q.valores.gasto)}`;
      } else if (q.tipo === "parado" && acao === "pausar") {
        r = await pausarPeriodoAds(q.periodo, q.data);
        msg = `${nome}: marcado como pausado desde ${dm(q.data)}`;
      } else if (q.tipo === "parado") {
        r = await encerrarPeriodoAds(q.periodo, { fim: q.data, motivo: `${q.status.toLowerCase()} na Shopee` });
        msg = `${nome}: período encerrado em ${dm(q.data)}`;
      }
      if (r && !r.ok) return onToast?.(r.msg);
      window.dispatchEvent(new Event("focus"));
      if (msg) onToast?.(msg);
    } else if (["parado", "corrigir", "criar-encerrado"].includes(q.tipo)) setAdsIgnorados((m) => ({ ...m, [q.chave]: sigPergunta(q) }));
    setPerguntas((p) => p.filter((x) => x.chave !== q.chave));
  }

  // ---------- Status de cada botão ----------
  function status(rel, limiteDias) {
    const r = resultado[rel];
    if (r) return r;
    const u = ultimaImp(rel);
    if (!u) return { t: "nunca", txt: "nunca enviado" };
    const d = diasDesde(dataDoEnvio(u), hoje);
    const quando = (d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`) + (d <= 1 ? ` às ${horaSP(u.criado_em)}` : "");
    return { t: d > limiteDias ? "velho" : "ok", txt: `${u.resumo || ""} · enviado ${quando}${d > limiteDias ? " — hora de atualizar" : ""}` };
  }
  // Chamado como função (não como <Componente/>): definido dentro do render,
  // um componente seria recriado a cada atualização e o <input type=file>
  // remontado — a escolha do arquivo se perdia se a tela atualizasse com a
  // janela de arquivos aberta (era preciso enviar 2 vezes).
  const relat = ({ rel, nome, onde, limite, onArquivo, aceita = ".xls,.xlsx,.csv", multiplo = false }) => {
    const st = status(rel, limite);
    return (
      <div className="ana-relat">
        <div className="ana-relat-nome">{nome}</div>
        <label className={`btn btn-mini${st.t === "velho" || st.t === "nunca" ? " primary" : ""}${ocupado ? " disabled" : ""}`}>
          {ocupado === rel ? "Lendo…" : "Enviar arquivo"}
          <input type="file" accept={aceita} hidden multiple={multiplo} disabled={!!ocupado} onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) onArquivo(multiplo ? fs : fs[0]); }} />
        </label>
        <div className="ana-relat-onde">De onde puxar: {onde}</div>
        <div className={`ana-status ${st.t}`}>
          <span className="ic">{ICONE[st.t]}</span>
          <span>{st.txt}</span>
        </div>
        {(avisos[rel] || []).map((a) => (
          <div key={a} className="ana-aviso">⚠ {a}</div>
        ))}
      </div>
    );
  };

  // ---------- Venda física ----------
  const fisicas = useMemo(() => (ped.pedidos || []).filter((p) => p.origem === "fisico").sort((a, b) => String(b.data).localeCompare(String(a.data))), [ped.pedidos]);
  const mes = hoje.slice(0, 7);
  const fisMes = fisicas.filter((f) => String(f.data).slice(0, 7) === mes);
  const gruposBusca = useMemo(() => gruposDoSeletor(itens), [itens]);
  const precoSugerido = (itemId) => {
    const tipo = { p: "produto", v: "variacao", k: "kit" }[itemId?.[0]];
    const diretos = canais.filter((c) => canalDireto(c));
    const s = precos.find((p) => p.item_tipo === tipo && p.item_id === itemId?.slice(2) && diretos.some((c) => c.id === p.canal_id)) || precos.find((p) => p.item_tipo === tipo && p.item_id === itemId?.slice(2));
    return s ? String(s.preco).replace(".", ",") : "";
  };
  async function salvarFisico() {
    const item = itens.find((i) => i.id === fisico.itemId);
    if (!item) return onToast?.("Escolha o produto");
    if (!(num(fisico.qtd) > 0) || !(num(fisico.preco) > 0)) return onToast?.("Informe quantidade e preço");
    setOcupado("fisico");
    const r = await registrarVendaFisica({ lojaId, item, quantidade: num(fisico.qtd), preco: num(fisico.preco), data: fisico.data, pagamento: fisico.pagamento, observacao: fisico.obs || null });
    if (!r.ok) {
      setOcupado(null);
      return onToast?.(r.msg);
    }
    const nova = r.linha;
    await sincronizarCaixa({ lojaId, pedidos: [...(ped.pedidos || []), nova], ctx });
    setOcupado(null);
    setFisico(null);
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    onToast?.(`Venda física registrada: ${item.nome} × ${fisico.qtd} — entrou nas vendas e no caixa`);
  }
  async function confirmarExcluir() {
    const f = excluir;
    setExcluir(null);
    const r = await excluirVendaFisica(f.id);
    if (!r.ok) return onToast?.(r.msg);
    await sincronizarCaixa({ lojaId, pedidos: (ped.pedidos || []).filter((p) => p.id !== f.id), ctx });
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    onToast?.("Venda física excluída (caixa atualizado)");
  }

  // ---------- Caixa ----------
  const caixa = useMemo(() => caixaDosPedidos(linhas), [linhas]);
  const recentes = (lista) => [...lista].sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, 8);
  const totRec = caixa.lancamentos.reduce((t, x) => t + x.valor, 0);
  const totArec = caixa.aReceber.reduce((t, x) => t + x.valor, 0);

  if (!ped.disponivel)
    return (
      <div className="panel">
        <h3>Importar dados</h3>
        <div className="empty">
          Falta rodar o <b>supabase/schema_v55.sql</b> no SQL Editor do Supabase (tabelas da aba Análise). Depois recarregue a página.
        </div>
      </div>
    );

  const pendentesN = PLATAFORMAS.filter((p) => canais.some((c) => c.tipo === p.tipo)).filter((p) => ["velho", "nunca"].includes(status(`pedidos:${p.id}`, 7).t) && ultimaImp(`pedidos:${p.id}`)).length;
  const cards = PLATAFORMAS.map((p) => {
    const canal = canais.find((c) => c.tipo === p.tipo) || null;
    const stP = canal ? status(`pedidos:${p.id}`, 7) : null;
    return (
      <div key={p.id} className={`panel${p.id === "shopee" ? " alto" : ""}`}>
        <h3>
          <CanalTag tipo={p.tipo} nome={p.nome} /> <span className="dir">pedidos pelo arquivo da Olist{p.id === "shopee" ? " + relatórios de anúncio" : ""}</span>
        </h3>
        {!canal ? (
          <div className="ana-relat"><div className="ana-aviso-cfg">⚠ Canal {p.nome} não cadastrado — cadastre em Configuração → Canais pra os pedidos dele entrarem.</div></div>
        ) : (
          <div className="ana-relat">
            <div className="ana-relat-nome">Pedidos</div>
            <div className={`ana-status ${stP.t}`}>
              <span className="ic">{ICONE[stP.t]}</span>
              <span>{stP.t === "nunca" ? "ainda sem pedidos — vêm do arquivo da Olist (no topo)" : stP.txt}</span>
            </div>
          </div>
        )}
        {canal && cres && <AvaliacoesBloco canal={canal} cres={cres} esc={esc} hoje={hoje} onToast={onToast} />}
        {canal && p.id === "shopee" && (
          <>
            {relat({
              rel: "shopee:desempenho",
              nome: "Desempenho do produto (funil)",
              limite: 7,
              aceita: ".xlsx",
              multiplo: true,
              onde: <>Shopee → Dados → Informações Gerenciais → Produto → Performance do produto → <b>Exportar</b> (Últimos 7 dias). Se aparecer mais de uma lista (ex.: “melhor desempenho” e “recém-cadastrados”), exporte <b>todas com o mesmo período</b> e envie uma depois da outra — elas se juntam</>,
              onArquivo: (fs) => enviarShopee("desempenho", fs),
            })}
            {relat({
              rel: "shopee:ads",
              nome: "Ads (CSV) dos produtos",
              limite: 3,
              aceita: ".csv",
              multiplo: true,
              onde: <>Shopee → Marketing → Shopee Ads → <b>Exportar dados → Dados Gerais de Anúncios</b> (do início do período de Ads até ontem). Se tiver mais de uma lista (ex.: “melhor desempenho” e “recém-cadastrados”), exporte <b>todas com o mesmo período</b> e envie uma depois da outra — elas se juntam. Só os Ads próprios dos produtos — a GMV Max da Loja vai no botão de baixo</>,
              onArquivo: (fs) => enviarShopee("ads", fs),
            })}
            {relat({
              rel: "shopee:gmv",
              nome: "GMV Max da Loja (CSV)",
              limite: 7,
              aceita: ".csv",
              multiplo: true,
              onde: <>Shopee → Marketing → Shopee Ads → <b>GMV Max da Loja → Exportar</b> (“Dados do GMV MAX da Loja”). Pode mandar uma semana de cada vez: os períodos <b>se somam sem duplicar</b> (o mesmo período de novo substitui) e o app avisa se faltar algum dia. Os produtos do arquivo são só informação — não viram Ads próprio</>,
              onArquivo: (fs) => enviarGmv(fs),
            })}
            {perguntas.map((q) => (
              <div key={q.chave} className="ana-pend">
                <b>
                  {q.l.item.nome}: {BRL(q.valores.gasto)} de Ads no CSV{q.status ? ` · ${q.status} na Shopee` : ""}
                </b>
                <div>
                  {q.tipo === "estender"
                    ? `O período terminou em ${dm(q.periodo.fim)} no app, mas o CSV vai até ${dm(q.data)} com gasto e o anúncio está rodando. Estender o fim até ${dm(q.data)}?`
                    : q.tipo === "criar"
                      ? `Não há período de Ads ligado no app. Criar um período a partir de ${dm(q.data)}?`
                      : q.tipo === "criar-encerrado"
                        ? `Não há período desse Ads no app. Registrar o gasto como um período já encerrado (${dm(q.data)}–${dm(q.ate)}), pra entrar no total gasto?`
                        : q.tipo === "corrigir"
                          ? `O período encerrado no app está com ${BRL(q.antes)} de gasto; o CSV diz ${BRL(q.valores.gasto)}. Corrigir pro valor do CSV?`
                          : q.status === "Excluído"
                            ? `No app o período continua ligado. O gasto parou por volta de ${dm(q.data)} — encerrar o período nessa data?`
                            : `No app o período continua ligado. O gasto parou por volta de ${dm(q.data)} — você pausou? Encerre o período ou marque como pausado (pra revisar e voltar).`}
                </div>
                <div className="ana-pend-acoes">
                  {q.tipo === "parado" ? (
                    <>
                      <button type="button" className="btn btn-mini primary" onClick={() => responder(q, "sim")}>Encerrar em {dm(q.data)}</button>
                      {q.status !== "Excluído" && <button type="button" className="btn btn-mini" onClick={() => responder(q, "pausar")}>Marcar como pausado</button>}
                      <button type="button" className="btn btn-mini" onClick={() => responder(q, "nao")}>Ignorar</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-mini primary" onClick={() => responder(q, "sim")}>{q.tipo === "corrigir" ? "Corrigir" : "Sim"}</button>
                      <button type="button" className="btn btn-mini" onClick={() => responder(q, "nao")}>{["corrigir", "criar-encerrado"].includes(q.tipo) ? "Ignorar" : "Não"}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {infos.map((t) => (
              <div key={t} className="ana-info-ok">✓ {t.replace(/ ✓$/, "")}</div>
            ))}
          </>
        )}
      </div>
    );
  });

  const cartaoOlist = (
    <div className="panel ana-olist" key="olist">
      <h3>
        Pedidos (Olist) <span className="dir">um arquivo com todas as plataformas — o app separa pelo número do pedido</span>
      </h3>
      {relat({
        rel: "pedidos:olist",
        nome: "Pedidos de venda (todas as plataformas)",
        limite: 7,
        onde: <>Olist → Vendas → Pedidos de venda → período → <b>Exportar</b> (sem filtrar o e-commerce). Cada pedido vai pra plataforma dele (Shopee, TikTok, Mercado Livre…) e o período conta pra todas</>,
        onArquivo: (f) => enviarOlist(f),
      })}
      {pend?.passo === "plataforma" && (
        <div className="ana-pend">
          <b>
            {new Set(pend.desconhecidos.map((i) => i.pedido)).size} pedido{new Set(pend.desconhecidos.map((i) => i.pedido)).size > 1 ? "s" : ""} com número que o app não reconhece — de qual plataforma {new Set(pend.desconhecidos.map((i) => i.pedido)).size > 1 ? "são" : "é"}?
          </b>
          <div className="faint">Ex.: nº no marketplace {[...new Set(pend.desconhecidos.map((i) => i.ordem_compra || "(vazio)"))].slice(0, 3).join(", ")}.</div>
          <div className="ana-pend-acoes">
            <select value={pend.escolha} onChange={(e) => setPend((x) => ({ ...x, escolha: e.target.value }))}>
              <option value="">— escolha —</option>
              {platsComCanal.map(({ plat }) => (
                <option key={plat.id} value={plat.id}>{plat.nome}</option>
              ))}
            </select>
            <button type="button" className="btn btn-mini primary" disabled={!pend.escolha} onClick={() => escolherDesconhecidos(pend, pend.escolha)}>Usar essa plataforma</button>
            <button type="button" className="btn btn-mini" onClick={() => escolherDesconhecidos(pend, null)}>Deixar esses de fora</button>
            <button type="button" className="btn btn-mini" onClick={() => setPend(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {pend?.passo === "skus" && (
        <div className="ana-pend">
          <b>Antes de gravar: {pend.pendentes.length} SKU{pend.pendentes.length > 1 ? "s não estão cadastrados" : " não está cadastrado"} no app</b>
          {pend.pendentes.map((x) => (
            <div key={x.sku} className="ana-pend-lin">
              <span>
                <b>{x.sku}</b> · {x.descricao.slice(0, 60)} ({x.un} un.)
              </span>
              {pend.resolvidos[x.sku] === "desc" ? (
                <span className="faint">✗ descartado — não entra nas contas</span>
              ) : pend.resolvidos[x.sku] === "cad" ? (
                <span className="faint">↗ cadastrando — reenvie o arquivo depois</span>
              ) : (
                <>
                  <button type="button" className="btn btn-mini primary" onClick={() => cadastrarSku(x.sku)}>Cadastrar agora</button>
                  <button type="button" className="btn btn-mini" onClick={() => descartarSku(x.sku)}>Descartar</button>
                </>
              )}
            </div>
          ))}
          <div className="faint">Os outros pedidos já podem ser gravados. O que ficar pendente entra depois, reenviando o mesmo arquivo (nada duplica).</div>
          <div className="ana-pend-acoes">
            <button type="button" className="btn btn-mini primary" onClick={() => gravarOlist(pend)}>Gravar o resto</button>
            <button type="button" className="btn btn-mini" onClick={() => setPend(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );

  const cartaoFisico = (
    <div className="panel" key="fisico">
      <h3>
        <CanalTag tipo="custom" nome="Venda física" /> <span className="dir">balcão, feira, encomenda fora da Olist · entra nas vendas e no caixa</span>
      </h3>
      <div className="ana-relat">
        <div className="ana-relat-nome">
          Registradas em {new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" })}: {fisMes.length} · {BRL(fisMes.reduce((t, f) => t + num(f.quantidade) * num(f.valor_unitario), 0))}
        </div>
        <button type="button" className="btn btn-mini primary" onClick={() => setFisico(fisico ? null : { itemId: "", qtd: "1", preco: "", data: hoje, pagamento: "Pix", obs: "" })}>
          {fisico ? "Fechar" : "+ Registrar venda física"}
        </button>
        <div className="ana-relat-onde">Também vale pra encomenda paga por Pix. Entra em Vendas do mês, curva ABC, XYZ, comprados juntos e no Fluxo de Caixa (recebido na data).</div>
      </div>
      {fisico && (
        <div className="ana-form-fisico">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Produto (nome ou SKU)</label>
            <BuscaItem grupos={gruposBusca} value={fisico.itemId} onChange={(id) => setFisico((f) => ({ ...f, itemId: id, preco: f.preco || precoSugerido(id) }))} vazio="— escolha o item —" />
          </div>
          {fisico.itemId && (
            <div style={{ gridColumn: "1 / -1" }}>
              <EmbalagemOrganicoVenda
                item={itens.find((i) => i.id === fisico.itemId)}
                canal={canais.find((c) => canalComEmbalagem(c)) || null}
                itemNoCanal={esc.itemNoCanal}
                produtos={produtos}
                kits={kits}
                embalagens={esc.embalagens || []}
                onToast={onToast}
              />
            </div>
          )}
          <div className="field"><label>Quantidade</label><input type="number" min="1" value={fisico.qtd} onChange={(e) => setFisico((f) => ({ ...f, qtd: e.target.value }))} /></div>
          <div className="field">
            <label>Preço de venda (R$)</label>
            <input type="text" inputMode="decimal" value={fisico.preco} onChange={(e) => setFisico((f) => ({ ...f, preco: e.target.value }))} />
            {(() => {
              const it = itens.find((i) => i.id === fisico.itemId);
              const q = num(fisico.qtd) || 1;
              const pc = num(it?.pecas) || 1;
              if (!it) return null;
              return (
                <div className="faint" style={{ marginTop: 3 }}>
                  {pc > 1 ? `do ${it.nomeVariacao || it.nome.split(" — ").pop()} inteiro (${pc} peças)` : "por unidade"}
                  {q > 1 && num(fisico.preco) > 0 ? ` · ${q} × = ${BRL(q * num(fisico.preco))}` : ""}
                </div>
              );
            })()}
          </div>
          <div className="field"><label>Data</label><input type="date" value={fisico.data} max={hoje} onChange={(e) => setFisico((f) => ({ ...f, data: e.target.value }))} /></div>
          <div className="field">
            <label>Recebi por</label>
            <select value={fisico.pagamento} onChange={(e) => setFisico((f) => ({ ...f, pagamento: e.target.value }))}>
              <option>Pix</option>
              <option>Dinheiro</option>
              <option>Cartão</option>
              <option>Outro</option>
            </select>
          </div>
          <div className="field"><label>Observação</label><input type="text" value={fisico.obs} onChange={(e) => setFisico((f) => ({ ...f, obs: e.target.value }))} placeholder="opcional" /></div>
          <div className="field" style={{ alignSelf: "end" }}>
            <button type="button" className="btn primary" disabled={ocupado === "fisico"} onClick={salvarFisico}>{ocupado === "fisico" ? "Salvando…" : "Salvar venda"}</button>
          </div>
        </div>
      )}
      {fisicas.slice(0, 8).map((f) => (
        <div key={f.id} className="ana-fis-lin">
          <span>
            <span className="faint">{dm(f.data)}</span> · {f.descricao} × {num(f.quantidade)}
          </span>
          <span className="faint">{f.pagamento || ""}</span>
          <b>{BRL(num(f.quantidade) * num(f.valor_unitario))}</b>
          <button type="button" className="btn btn-icone" title="Excluir esta venda física" onClick={() => setExcluir(f)}>×</button>
        </div>
      ))}
      {!fisicas.length && <div className="ana-relat-onde" style={{ padding: "0 14px 12px" }}>Nenhuma venda física registrada ainda.</div>}
    </div>
  );

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="l">Pedidos importados</div><div className="v">{new Set((ped.pedidos || []).filter((p) => p.origem === "olist").map((p) => p.pedido)).size}</div><div className="s">{(ped.pedidos || []).length ? `${dm([...ped.pedidos].sort((a, b) => String(a.data).localeCompare(String(b.data)))[0]?.data)} a ${dm([...ped.pedidos].sort((a, b) => String(b.data).localeCompare(String(a.data)))[0]?.data)} · + ${fisicas.length} vendas físicas` : "nenhum ainda"}</div></div>
        <div className="kpi"><div className="l">Último envio</div><div className="v">{(() => { const u = okOrdenadas[okOrdenadas.length - 1]; if (!u) return "—"; const d = diasDesde(dataDoEnvio(u), hoje); return d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`; })()}</div><div className="s">{okOrdenadas[okOrdenadas.length - 1]?.relatorio?.replace("pedidos:", "pedidos · ").replace("shopee:", "Shopee · ") || "nenhum"}</div></div>
        <div className={`kpi${pendentesN ? " warn" : ""}`}><div className="l">Pedidos pendentes</div><div className="v">{pendentesN ? `${pendentesN} plataforma${pendentesN > 1 ? "s" : ""}` : "em dia"}</div><div className="s">último envio há mais de 7 dias</div></div>
        <div className="kpi"><div className="l">Lançado no caixa</div><div className="v">{BRL(totRec)}</div><div className="s">entregues + vendas físicas · a receber {BRL(totArec)} (fora do saldo)</div></div>
      </div>

      {cartaoOlist}
      <div className="ana-fontes">
        {cards[0]}
        {cartaoFisico}
        {cards.slice(1)}
      </div>

      <div className="panel">
        <h3 className="section-title">
          O que foi pro Fluxo de Caixa
          <Ajuda texto="Uma entrada por plataforma × semana com os pedidos ENTREGUES (o que a plataforma repassa = pago pelo cliente − taxas do canal, com as taxas de hoje) e uma por semana das vendas físicas. A receber (enviado, ainda não entregue) só aparece aqui: não soma no saldo nem na projeção. Reenviando o arquivo, o que virou Entregue passa pra recebido e o que foi cancelado/devolvido sai. Se já houver uma entrada de venda lançada à mão na mesma semana e canal, o app avisa (pra não contar duas vezes)." />
          <span className="dir">uma linha por plataforma × semana</span>
        </h3>
        <div className="ana-caixa-resumo">
          <div><span className="faint">Recebido (entra no saldo)</span><b style={{ color: "var(--good)" }}>{BRL(totRec)}</b></div>
          <div><span className="faint">A receber (só aparece — fora do saldo e da projeção)</span><b>{BRL(totArec)}</b></div>
        </div>
        {[...recentes(caixa.lancamentos).map((x) => ({ ...x, arec: false })), ...recentes(caixa.aReceber).map((x) => ({ ...x, arec: true }))]
          .sort((a, b) => b.semana.localeCompare(a.semana))
          .map((x) => (
            <div key={(x.arec ? "a" : "r") + x.origem_import} className={`ana-caixa-lin${x.arec ? " arec" : ""}`}>
              <span><span className="bolinha" style={{ background: x.arec ? "var(--ink-faint)" : "var(--good)" }} />{x.descricao}</span>
              <span className="faint">{x.arec ? "a receber · fora do saldo" : "recebido"}</span>
              <b>{BRL(x.valor)}</b>
            </div>
          ))}
        {!caixa.lancamentos.length && !caixa.aReceber.length && <div className="empty">Nada ainda — importe os pedidos ou registre uma venda física.</div>}
        {Object.values(avisos).flat().filter((a) => /caixa/.test(a)).map((a) => <div key={a} className="ana-aviso" style={{ margin: "0 14px 10px" }}>⚠ {a}</div>)}
      </div>

      <div className="panel">
        <h3>Como fica a semana</h3>
        <div className="ana-guia">
          <div><b>1× por semana (≈ 5 min)</b>O arquivo de pedidos da Olist (um só, com todas as plataformas) + os relatórios de anúncio dela (Shopee: Desempenho e Ads). E as avaliações de quem vendeu (bloco Avaliações). As semanas da Rampa e do Ads se montam sozinhas.</div>
          <div><b>A cada 3 dias</b>Só o relatório de Ads de cada plataforma com Ads ligado (Shopee hoje).</div>
          <div><b>Venda física</b>Quando vender: “+ Registrar venda física”.</div>
          <div><b>O app faz sozinho</b>Ignora pedido repetido, separa cancelados, liga pelo SKU, lança no caixa e calcula o lucro com as taxas e o custo de hoje. Nome, CPF, endereço e telefone do cliente são ignorados.</div>
        </div>
      </div>

      {excluir && (
        <ConfirmDialog
          titulo="Excluir esta venda física?"
          mensagem={`${dm(excluir.data)} · ${excluir.descricao} × ${num(excluir.quantidade)} (${BRL(num(excluir.quantidade) * num(excluir.valor_unitario))}). A entrada no caixa da semana é recalculada.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluir(null)}
        />
      )}
    </>
  );
}
