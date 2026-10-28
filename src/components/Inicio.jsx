import { comCupomAtivo, cuponsAtivos } from "../lib/cupomLoja.js";
import { vendasPeloComeco } from "../lib/vinculoSku.js";
import { useVendasReais } from "../hooks/useVendasReais.js";
import { PLATAFORMAS } from "../lib/pedidos.js";
import { revisoesPrecoDireto } from "../lib/revisarPreco.js";
import { marcarPrecoRevisado } from "../lib/revisarPrecoAcoes.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLembretes } from "../hooks/useLembretes.js";
import { pausaAtiva, pausasDeRampa } from "../lib/pausaRampa.js";
import { infoSazonal, proximaCampanha, quandoVendeDe } from "../lib/calendario.js";
import { dataSP } from "../lib/datas.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { vendeuSemAvaliacao } from "../lib/semanasAuto.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { useBackup } from "../hooks/useBackup.js";
import { bomDia } from "../lib/bomDia.js";
import BomDia from "./BomDia.jsx";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { hojeISO, loadEstimativas, resumoCaixa } from "../lib/fluxoCaixa.js";
import { linhasAnunciar } from "../lib/anunciar.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useFarmAlteracoes } from "../hooks/useFarmAlteracoes.js";
import { avisosDesgaste } from "../lib/farm.js";
import { avisosManutencao } from "../lib/manutencao.js";
import { useManutencoes } from "../hooks/useManutencoes.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { sugestoesAfiliado } from "../lib/afiliados.js";
import { agruparPorProduto, ehAvisoDeDados, montarPendencias, notaDoAviso, produtoDoAviso, situacaoDados } from "../lib/inicio.js";
import { produtosParados } from "../lib/relatorios.js";
import { comoEstaALoja, produtosDaSemana, variacao } from "../lib/resumoLoja.js";
import { abrirAnuncio, abrirProduto, montarAnuncios } from "../lib/anuncios.js";
import { useEscada } from "../hooks/useEscada.js";
import { publicarUrgentes } from "../lib/urgentes.js";
import { contarMarcas, publicarMarcas } from "../lib/marcas.js";
import { publicarSede } from "../lib/sedeDados.js";
import { irParaAba } from "../lib/navegar.js";
import { BRL } from "../lib/format.js";
import Kpis from "./Kpis.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import { estadoDoTom } from "../lib/estados.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { LinhaTarefa, TarefaDialog } from "./Tarefas.jsx";
import { useTarefas } from "../hooks/useTarefas.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { useEstoque } from "../hooks/useEstoque.js";
import { limiteMei, regimeDaLoja } from "../lib/revenda.js";
import { saldoAds } from "../lib/saldoAds.js";
import { concluidasRecentes, repartirTarefas } from "../lib/tarefas.js";
import { abrirTarefa, concluirTarefa, desfazerConclusao, excluirTarefa, rotuloLink } from "../lib/tarefasAcoes.js";

const VISIVEIS = 6; // cartões de produto (urgentes sempre aparecem)
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");

// Lançamentos do caixa e meta do mês — só leitura.
function useDadosGestao() {
  const { lojaId } = useLoja();
  const [d, setD] = useState({ lancamentos: [], meta: null, carregando: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const q = (t) => (lojaId ? supabase.from(t).select("*").eq("loja_id", lojaId) : supabase.from(t).select("*"));
        const [rl, rm] = await Promise.all([q("lancamentos_caixa"), q("metas_mensais").eq("mes", hojeISO().slice(0, 7))]);
        if (!ativo) return;
        setD({ lancamentos: rl.error ? [] : rl.data || [], meta: rm.error ? null : (rm.data || [])[0] || null, carregando: false });
      } catch {
        if (ativo) setD((p) => ({ ...p, carregando: false }));
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`inicio-gestao-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lancamentos_caixa" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "metas_mensais" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
    };
  }, [lojaId]);
  return d;
}

// Regra única de cores (lib/estados.js): a pendência do grupo Oportunidades é
// verde (dá pra agir e ganhar).
const Bolinha = ({ tipo }) => (tipo ? <i className={`bolinha-status st-${tipo}`} aria-hidden="true" /> : null);
const estadoPendencia = (p) => (p.semCor ? null : p.grupo === "oportunidade" ? (p.tom === "neu" ? "info" : "oportunidade") : estadoDoTom(p.tom) || "info");
const ROTULO_GRUPO = { resolver: ["resolver", "resolver"], rotina: ["atencao", "atenção"], oportunidade: ["oportunidade", "oportunidade"] };
const FILTROS = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "produtos", rotulo: "Produtos" },
  { chave: "loja", rotulo: "Loja" },
  { chave: "tarefas", rotulo: "Minhas tarefas" },
];
const pct = (v) => `${v >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(v * 100))}%`;
const Variacao = ({ v, inverso = false }) => (v == null ? null : <span className={(v >= 0) !== inverso ? "pos-forte" : "neg-forte"}>{pct(v)}</span>);
const semPrefixo = (p) => {
  const t = String(p.titulo || "").replace(/^(?:Anúncio:\s)?.+?:\s/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const textoSemCanal = (p) => {
  const t = String(p.texto || "");
  return p._canal && t.startsWith(`${p._canal} · `) ? t.slice(p._canal.length + 3) : t;
};

// Início — SÓ LÊ (redesenho 24/10/2026, prévia inicio-novo-v1): 1 Como a loja
// está → 2 Seus dados → 3 Pra fazer POR PRODUTO (+ Loja e Minhas tarefas) →
// 4 Seus produtos. Cada pendência vem da aba que decide e o botão leva pra lá.
// Única coisa gravada aqui: as tarefas manuais (schema v42, tabela tarefas).
export default function Inicio({ onIrPara, onToast }) {
  const { lojaId, lojas } = useLoja();
  const nomeLoja = (lojas || []).find((l) => l.id === lojaId)?.nome || "loja";
  const { dados, rampasH, af, regras, hoje, linhas: linhasTodas, linhasGrupo, linhasAf, linhasAds, calendario, avalH, pedidosValidos, anuncioDoPedido } = useCrescimento();
  // Rampas de produtos que só existem dentro de um anúncio com vários itens
  // saem dos avisos (decide a rampa do anúncio inteiro, que entra no lugar).
  const linhas = useMemo(() => [...linhasTodas.filter((l) => !l.soNoGrupo), ...(linhasGrupo || [])], [linhasTodas, linhasGrupo]);
  const campanhaProx = useMemo(() => proximaCampanha(calendario, hoje), [calendario, hoje]);
  const cfgDoProduto = dados.cfgDoProduto;
  const reais = useVendasReais({ itens: dados.itens, canais: dados.canais, cfgDoProduto });
  // Central da aba Análise: plataformas com canal cadastrado (aviso de pedidos atrasados).
  // Avaliações (v58): anúncio que vendeu há mais de 7 dias sem atualizar as avaliações.
  const avaliacoesPend = useMemo(() => {
    if (!avalH?.disponivel || avalH.carregando) return [];
    const out = [];
    for (const c of dados.canais || []) {
      if (!PLATAFORMAS.some((p) => p.tipo === c.tipo)) continue;
      for (const v of vendeuSemAvaliacao({ pedidos: pedidosValidos, canalId: c.id, anuncioDoPedido, avaliacoes: avalH.registros, hoje })) if (v.dias > 7) out.push({ ...v, canal: c });
    }
    return out;
  }, [avalH, dados.canais, pedidosValidos, anuncioDoPedido, hoje]);
  // Cupons ativos da loja (Configuração → Regras): anúncio (já anunciado) que numa
  // compra de 1 un. fica no prejuízo/abaixo do mínimo com o cupom da faixa.
  const cupomRuins = useMemo(() => {
    const out = [];
    for (const c of dados.canais || []) {
      const faixas = cuponsAtivos(dados.cfgLoja, c.id);
      if (!faixas.length) continue;
      for (const p of dados.precos || []) {
        if (p.canal_id !== c.id) continue;
        const pre = { produto: "p", variacao: "v", kit: "k" }[p.item_tipo];
        const it = (dados.itens || []).find((i) => i.id === `${pre}:${p.item_id}`);
        if (!it || (dados.cobraNoCanal && !dados.cobraNoCanal(it, c))) continue;
        if (!(dados.publicacoesCanal || []).some((x) => x.item_id === p.item_id && x.canal_id === c.id)) continue;
        const preco = dados.agoraDe?.(it, c)?.agora?.preco || Number(p.preco);
        const cfg = dados.cfgDoProduto(it.produtoId || (pre === "p" ? p.item_id : null));
        const r = comCupomAtivo({ canal: c, preco, custo: Number((dados.itemNoCanal ? dados.itemNoCanal(it, c) : it)?.custoTotal) || 0, peso: Number(it.peso) || 0, cfg }, faixas);
        if (r && (r.estado === "prejuizo" || r.estado === "abaixo")) out.push({ item: it, canal: c, ...r });
      }
    }
    return out;
  }, [dados]);
  const peloComeco = useMemo(() => vendasPeloComeco(reais.linhas, { produtos: dados.produtos, kits: dados.kits, hoje }), [reais.linhas, dados.produtos, dados.kits, hoje]);
  const impCentral = useMemo(
    () => (reais.carregando ? null : { disponivel: reais.disponivel, lista: reais.importacoes, plataformas: PLATAFORMAS.filter((p) => (dados.canais || []).some((c) => c.tipo === p.tipo)), avaliacoes: avaliacoesPend, peloComeco }),
    [reais.carregando, reais.disponivel, reais.importacoes, dados.canais, avaliacoesPend, peloComeco]
  );
  // Lembrete de temporada (Quando vende = pico/época): 60 dias antes da data.
  const temporadas = useMemo(
    () =>
      (dados.produtos || [])
        .map((produto) => ({ produto, info: infoSazonal(quandoVendeDe(produto), calendario, hoje) }))
        .filter((x) => x.info?.lembrete),
    [dados.produtos, calendario, hoje]
  );
  const { itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje, alertaDe, pareceAtracaoDe, cobraNoCanal } = dados;
  // Itens de anúncio com vários itens (Ficha etapa 2) contam como anunciados.
  const { grupos: gruposAnuncio } = useAnunciosGrupo();
  const mapaGrupos = useMemo(() => gruposPorItem(gruposAnuncio), [gruposAnuncio]);
  // Minha farm (v47): custo que subiu (farm_alteracoes) e desgaste das impressoras.
  const { impressoras, farmConfig } = useCatalogo();
  const { alteracoes: farmAlteracoes } = useFarmAlteracoes();
  const manutH = useManutencoes();
  const farm = useMemo(
    () => ({
      alteracoes: farmAlteracoes,
      desgaste: avisosDesgaste(impressoras, farmConfig, hoje),
      // Manutenção (v50): só depois da tabela existir.
      manutencao: manutH.disponivel && !manutH.carregando ? avisosManutencao(impressoras, manutH.registros, farmConfig, hoje) : [],
    }),
    [farmAlteracoes, impressoras, farmConfig, hoje, manutH.disponivel, manutH.carregando, manutH.registros]
  );
  async function ciente(c) {
    const { error } = await supabase.from("impressoras").update({ [c.campo]: true }).eq("id", c.impressoraId);
    if (error) onToast?.(`Não foi possível marcar: ${error.message}`);
    else recarregarCatalogo();
  }
  const gestao = useDadosGestao();
  const [verTodos, setVerTodos] = useState(false);
  // Filtro do "Pra fazer" por área (lembrado neste aparelho). Urgentes aparecem sempre.
  const [filtro, setFiltroEstado] = useState(() => {
    try {
      return localStorage.getItem("ohra:inicio:filtro") || "todos";
    } catch {
      return "todos";
    }
  });
  const setFiltro = (v) => {
    setFiltroEstado(v);
    try {
      localStorage.setItem("ohra:inicio:filtro", v);
    } catch {
      // sem localStorage — só não lembra
    }
  };
  const tarefasH = useTarefas();
  const [dialogTarefa, setDialogTarefa] = useState(null); // { tarefa? }
  const [excluir, setExcluir] = useState(null);
  const [desfazer, setDesfazer] = useState(null); // { tarefa, proximaId, prox }
  const [verConcluidas, setVerConcluidas] = useState(false);
  const [verTodasTarefas, setVerTodasTarefas] = useState(false);
  const timerDesfazer = useRef(null);
  useEffect(() => () => clearTimeout(timerDesfazer.current), []);

  async function concluir(t) {
    const r = await concluirTarefa(t, hoje);
    if (r.error) return onToast?.(`Não deu pra concluir: ${r.error.message}`);
    clearTimeout(timerDesfazer.current);
    setDesfazer({ tarefa: t, proximaId: r.proximaId, prox: r.prox });
    timerDesfazer.current = setTimeout(() => setDesfazer(null), 5000);
  }
  async function voltarConclusao() {
    const d = desfazer;
    clearTimeout(timerDesfazer.current);
    setDesfazer(null);
    if (d) await desfazerConclusao(d);
  }

  // --- Dinheiro (mesmas contas do Fluxo de Caixa e de Metas) ---
  const [estimativasCaixa] = usePreferencia("caixa:estimativas", { vendas: "", custos: "" }, { legado: () => loadEstimativas(lojaId), legadoPorLoja: true });
  const caixa = useMemo(
    () => (gestao.lancamentos.length ? resumoCaixa(gestao.lancamentos, { hoje, estimativas: estimativasCaixa, meses: 3, dias: 7 }) : null),
    [gestao.lancamentos, hoje, estimativasCaixa]
  );
  const metaFat = Number(gestao.meta?.faturamento_objetivo) || 0;

  // --- Catálogo: só itens ANUNCIADOS (marcados "feito" na Anunciar) ---
  const anunciar = useMemo(
    () => linhasAnunciar({ itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje, anunciadoNoCanal: (it, c) => cobraNoCanal(it, c) || mapaGrupos.has(it.id) }),
    [itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje, cobraNoCanal, mapaGrupos]
  );
  const anunciados = useMemo(() => {
    const out = [];
    for (const l of anunciar)
      for (const c of canais) {
        const x = l.porCanal[c.id];
        if (x && x.salvo) out.push({ item: l.item, canal: c, x });
      }
    return out;
  }, [anunciar, canais]);
  const precosAlerta = useMemo(
    () =>
      anunciados
        .map((a) => ({ ...a, al: alertaDe(a.item, a.canal) }))
        .filter((a) => a.al && (a.al.tipo === "prejuizo" || a.al.tipo === "abaixo-minimo")),
    [anunciados, alertaDe]
  );
  const anunciosAtualizar = useMemo(() => anunciados.filter((a) => a.x.mudou), [anunciados]);
  // Desconto acima do que a plataforma aceita (TikTok > 80%, lib/limitePromo.js).
  const promosAcima = useMemo(() => {
    const out = [];
    for (const l of anunciar) for (const c of canais) if (l.porCanal[c.id]?.limitePromo?.nivel === "resolver") out.push({ item: l.item, canal: c, x: l.porCanal[c.id] });
    return out;
  }, [anunciar, canais]);
  const atracao = useMemo(() => precosAlerta.filter((a) => a.al.tipo === "abaixo-minimo" && pareceAtracaoDe(a.item, a.canal, a.al)), [precosAlerta, pareceAtracaoDe]);

  // --- Afiliados (só com campanha configurada) ---
  const afAtivo = af.config.length > 0;
  const afSugestoes = useMemo(
    () =>
      afAtivo
        ? sugestoesAfiliado({ linhas: linhasAf, parceiros: af.parceiros, afRegistros: af.registros, regras, itens, hoje }).filter((s) => s.chave !== "pode-mais")
        : [],
    [afAtivo, linhasAf, af.parceiros, af.registros, regras, itens, hoje]
  );

  // --- Pra fazer + status ---
  // Venda direta (Orgânico): preço velho ou custo subiu → "vale revisar o preço?"
  const revisoes = useMemo(() => revisoesPrecoDireto({ itens, canais, precos, hoje, itemNoCanal: dados.itemNoCanal }), [itens, canais, precos, hoje, dados.itemNoCanal]);
  const adsP = useAdsPeriodos();
  const [baseAds] = usePreferencia("caixa:saldo-ads-base", null);
  const backup = useBackup(onToast);
  const saldoDeAds = useMemo(() => (adsP.disponivel ? saldoAds({ lancamentos: gestao.lancamentos, periodos: adsP.periodos, hoje, base: baseAds }) : null), [adsP.disponivel, adsP.periodos, gestao.lancamentos, hoje, baseAds]);
  // Diagnóstico comercial por anúncio (lib/diagnostico.js, via montarAnuncios):
  // entram atenção e oportunidade; vitrine/página de quem está em rampa com
  // "Revisar anúncio" já aparece pelo aviso da Rampa (não repete).
  const esc = useEscada();
  const cresTodo = useCrescimento();
  const diagnosticos = useMemo(() => {
    const out = [];
    for (const l of montarAnuncios({ esc, cres: cresTodo, pedidos: pedidosValidos, hoje }))
      for (const d of l.diagnosticos || []) {
        if (d.estado !== "atencao" && d.estado !== "oportunidade") continue;
        if ((d.chave === "vitrine" || d.chave === "pagina") && l.rampa?.est?.anuncio) continue;
        out.push({ l, d });
      }
    return out;
  }, [esc, cresTodo, pedidosValidos, hoje]);
  // unidades por semana de cada item × canal (pedidos das últimas 4 semanas) — valor em R$ dos avisos
  const vendasSemana = useMemo(() => {
    const de = new Date(`${hoje}T12:00:00`);
    de.setDate(de.getDate() - 27);
    const ini = de.toISOString().slice(0, 10);
    const m = new Map();
    for (const p of pedidosValidos || []) {
      if (String(p.data).slice(0, 10) < ini || !p.canal?.id) continue;
      const k = `${p.id_item}|${p.canal.id}`;
      m.set(k, (m.get(k) || 0) + (Number(p.q) || 0));
    }
    return (itemId, canalId) => (m.get(`${itemId}|${canalId}`) || 0) / 4;
  }, [pedidosValidos, hoje]);
  // Revenda (v66): estoque a repor/negativo e o limite do MEI
  const estoqueRev = useEstoque();
  const regime = regimeDaLoja(dados.cfgLoja);
  const limMei = useMemo(() => (regime.regime === "mei" ? limiteMei({ pedidos: pedidosValidos || [], limite: regime.limiteAnual, hoje }) : null), [regime.regime, regime.limiteAnual, pedidosValidos, hoje]);
  const todasPendencias = useMemo(
    () => montarPendencias({ vendasSemana, precosAlerta, caixa, rampas: linhas, anunciosAtualizar, promosAcima, afSugestoes, atracao, tarefas: tarefasH.tarefas, ads: linhasAds, farm, temporadas, campanha: campanhaProx, revisoes, adsSazonal: linhasAds?.sazonal || [], importacoes: impCentral, saldoDeAds, cupomRuins, diagnosticos, estoque: estoqueRev.linhas, limiteMei: limMei, hoje }),
    [vendasSemana, cupomRuins, precosAlerta, caixa, linhas, anunciosAtualizar, promosAcima, afSugestoes, atracao, tarefasH.tarefas, linhasAds, farm, temporadas, campanhaProx, revisoes, impCentral, saldoDeAds, diagnosticos, estoqueRev.linhas, limMei, hoje]
  );
  // "Lembrar em 30 dias" (tabela lembretes, v40): aviso automático que não é
  // urgente some por 30 dias e volta sozinho se ainda valer. Urgente nunca some.
  const { lembretes, disponivel: lembretesOk } = useLembretes();
  const adiadoAte = useMemo(() => new Map(lembretes.filter((l) => String(l.chave).startsWith("inicio|")).map((l) => [l.chave.slice(7), l.adiado_ate])), [lembretes]);
  const podeAdiar = (p) => !p.tarefa && p.grupo !== "resolver";
  // Rampa marcada "não acompanhar por enquanto" (Crescimento → Rampa): os
  // avisos dela (menos os urgentes) saem até vender ou o prazo acabar.
  const rampasPausadas = useMemo(() => {
    const pausas = pausasDeRampa(lembretes);
    return new Set(linhas.filter((l) => pausaAtiva(pausas.get(l.r.id), l.est, hoje)).map((l) => l.r.id));
  }, [lembretes, linhas, hoje]);
  const pausadaRampa = (p) => p.grupo !== "resolver" && rampasPausadas.has(p.ir?.pedido?.rampaId);
  const pendencias = todasPendencias.filter((p) => !pausadaRampa(p) && !(podeAdiar(p) && adiadoAte.get(p.id) > hoje));
  const adiados = todasPendencias.filter((p) => !pausadaRampa(p) && podeAdiar(p) && adiadoAte.get(p.id) > hoje);
  const [verAdiados, setVerAdiados] = useState(false);
  async function adiar30(p) {
    if (!lembretesOk) return onToast?.("Falta rodar o supabase/schema_v40.sql no Supabase");
    const d = new Date(`${hoje}T12:00:00`);
    d.setDate(d.getDate() + 30);
    const { error } = await supabase.from("lembretes").upsert({ loja_id: lojaId || null, chave: `inicio|${p.id}`, adiado_ate: d.toISOString().slice(0, 10), tipo: "adiar30" }, { onConflict: "loja_id,chave" });
    if (error) return onToast?.(`Não foi possível adiar: ${error.message}`);
    window.dispatchEvent(new Event("ohra:lembretes"));
    onToast?.(`Ok — “${p.titulo}” volta em 30 dias (se ainda valer)`);
  }
  async function voltarAviso(p) {
    let q = supabase.from("lembretes").delete().eq("chave", `inicio|${p.id}`);
    q = lojaId ? q.eq("loja_id", lojaId) : q.is("loja_id", null);
    const { error } = await q;
    if (error) return onToast?.(`Não foi possível desfazer: ${error.message}`);
    window.dispatchEvent(new Event("ohra:lembretes"));
  }
  const ir = (p) => {
    if (p.pedido) irParaAba(p.aba, p.pedido);
    else onIrPara?.(p.aba);
  };
  const concluidas = concluidasRecentes(tarefasH.tarefas, hoje);
  const carregando = gestao.carregando || rampasH.carregando || dados.carregando;

  // --- 1 · Como a loja está (pedidos importados + Ads, mesma conta do Resumo do mês) ---
  const loja = useMemo(() => comoEstaALoja({ pedidos: pedidosValidos, linhasAds, hoje }), [pedidosValidos, linhasAds, hoje]);
  const temPedidos = loja.atual.pedidos > 0 || loja.antes.pedidos > 0;
  const aPagar7 = caixa ? caixa.proximos.filter((l) => l.tipo === "saida").reduce((t, l) => t + Number(l.valor || 0), 0) : 0;

  // --- 2 · Seus dados ---
  const temAdsLigado = [...(linhasAds?.linhas || []), ...(linhasAds?.lojaLinha ? [linhasAds.lojaLinha] : [])].some((l) => l.av?.ativo);
  const situacao = useMemo(() => situacaoDados({ importacoes: impCentral, avaliacoesPend, temAdsLigado, hoje }), [impCentral, avaliacoesPend, temAdsLigado, hoje]);
  const avisosDados = pendencias.filter(ehAvisoDeDados);

  // --- 3 · Pra fazer: por produto, Loja e Minhas tarefas ---
  const nomesCanais = (dados.canais || []).map((c) => c.nome);
  const avisosTodos = pendencias.filter((p) => !p.tarefa && !ehAvisoDeDados(p));
  // As 3 coisas que mais valem dinheiro hoje (prévia aprovada em 24/10/2026):
  // pelo valor em R$ do aviso (ou o peso do grupo); saem das listas de baixo.
  const top3 = [...avisosTodos].sort((a, b) => notaDoAviso(b) - notaDoAviso(a)).slice(0, 3);
  const idsTop = new Set(top3.map((p) => p.id));
  const avisos = avisosTodos.filter((p) => !idsTop.has(p.id));
  // Só vira cartão de produto o que tem nome de produto, kit ou anúncio com vários
  // itens (impressora, parceiro de afiliado… ficam em Loja).
  const nomesItens = new Set([...(produtos || []), ...(kits || []), ...(gruposAnuncio || [])].map((x) => String(x.nome || "").toLowerCase()));
  // produtos parados SEM gastar Ads saem do Início (vão pro relatório); com Ads continuam como aviso
  const parados = useMemo(() => produtosParados({ pedidos: pedidosValidos, produtos, kits, precos, linhasAds, hoje }).filter((x) => !(x.adsGasto > 0)), [pedidosValidos, produtos, kits, precos, linhasAds, hoje]);
  const { produtos: cartoes, loja: avisosLoja } = agruparPorProduto(avisos, nomesCanais, (nome) => nomesItens.has(nome.toLowerCase()));
  const tf = repartirTarefas(
    pendencias.filter((p) => p.tarefa),
    { todas: verTodasTarefas }
  );
  const tarefasLista = [...tf.resolver, ...tf.topo, ...tf.minhas];
  const filtroAtivo = FILTROS.some((f) => f.chave === filtro) ? filtro : "todos";
  const verProdutos = filtroAtivo === "todos" || filtroAtivo === "produtos";
  const verLoja = filtroAtivo === "todos" || filtroAtivo === "loja";
  const verTarefas = filtroAtivo === "todos" || filtroAtivo === "tarefas";
  // Urgentes (Resolver) aparecem sempre; o resto dos cartões até VISIVEIS + "ver todos".
  const cartoesUrg = cartoes.filter((g) => g.grupo === "resolver");
  const cartoesResto = cartoes.filter((g) => g.grupo !== "resolver");
  const cartoesVis = verProdutos ? [...cartoesUrg, ...(verTodos || filtroAtivo === "produtos" ? cartoesResto : cartoesResto.slice(0, Math.max(0, VISIVEIS - cartoesUrg.length)))] : cartoesUrg;
  const escondidos = verProdutos ? cartoes.length - cartoesVis.length : 0;
  const lojaVis = verLoja ? avisosLoja : avisosLoja.filter((p) => p.grupo === "resolver");
  const contagem = (g) => avisosTodos.filter((p) => p.grupo === g).length + (g === "resolver" ? tf.n.resolver : 0);
  const nFiltro = { todos: pendencias.length - avisosDados.length, produtos: cartoes.length, loja: avisosLoja.length, tarefas: tf.total };

  const urgentes = [...avisosTodos.filter((p) => p.grupo === "resolver"), ...pendencias.filter((p) => p.tarefa && p.grupo === "resolver")];
  const nUrgentes = urgentes.length;
  useEffect(() => {
    if (!carregando) publicarUrgentes(nUrgentes);
  }, [nUrgentes, carregando]);
  // Marcas do menu e das sub-abas (vermelha/âmbar/verde): os mesmos avisos do Pra fazer.
  const marcas = contarMarcas(pendencias);
  useEffect(() => {
    if (!carregando) publicarMarcas(marcas);
  }, [marcas, carregando]);

  // O que a Sede mostra (avisos por sala + KPIs do topo): os mesmos números daqui.
  const kpisSede = {
    vendas: loja.atual.vendas,
    pedidos: loja.atual.pedidos,
    depoisAds: loja.atual.depoisAds,
    temPedidos,
    caixa: caixa ? caixa.saldoHoje : null,
    metaPct: metaFat > 0 && temPedidos ? loja.atual.vendas / metaFat : null,
    meta: metaFat,
    ritmo: loja.ritmo,
    // revenda (v66): estoque e limite do MEI pro consultor
    estoque: estoqueRev.linhas.length
      ? {
          valor: estoqueRev.linhas.reduce((t, l) => t + (l.est.semControle ? 0 : l.valor), 0),
          itens: estoqueRev.linhas.filter((l) => !l.est.semControle).length,
          repor: estoqueRev.linhas.filter((l) => ["repor", "zerado", "negativo"].includes(l.sit.tipo)).map((l) => ({ nome: l.produto.nome, texto: l.sit.texto })),
        }
      : null,
    limiteMei: limMei,
    // contas a pagar (atrasadas + próximos 7 dias) pro consultor da Sede
    aPagar: caixa
      ? [...(caixa.atrasados || []), ...(caixa.proximos || [])]
          .filter((l) => l.tipo === "saida")
          .map((l) => ({ descricao: l.descricao || l.categoria || "conta", valor: Number(l.valor) || 0, data: l.data_prevista }))
      : null,
  };
  // ☀️ Bom dia: ontem, depois de conferir os arquivos (também vai pro consultor da Sede)
  const bom = useMemo(
    () => (reais.carregando ? null : bomDia({ importacoes: reais.importacoes, pedidos: pedidosValidos, linhasAds, periodosAds: adsP.periodos, aPagar: kpisSede.aPagar, hoje })),
    [reais.carregando, reais.importacoes, pedidosValidos, linhasAds, adsP.periodos, kpisSede.aPagar, hoje]
  );
  useEffect(() => {
    if (!carregando) publicarSede({ pendencias, kpis: { ...kpisSede, bomDia: bom, top3: top3.map((p) => (typeof p.titulo === "string" ? p.titulo : "")).filter(Boolean) } });
  });

  // --- 4 · Seus produtos (últimos 7 dias) ---
  const semana = useMemo(() => produtosDaSemana(pedidosValidos, hoje, 6), [pedidosValidos, hoje]);
  const cartaoDoNome = new Map(cartoes.map((g) => [g.nome.toLowerCase(), g]));
  const itemDoNome = (nome) => {
    const n = String(nome || "").toLowerCase();
    const p = (produtos || []).find((x) => String(x.nome).toLowerCase() === n);
    if (p) return `p:${p.id}`;
    const k = (kits || []).find((x) => String(x.nome).toLowerCase() === n);
    if (k) return `k:${k.id}`;
    const g = (gruposAnuncio || []).find((x) => String(x.nome).toLowerCase() === n);
    return g ? `g:${g.id}` : null;
  };
  // aba do Painel do anúncio que o aviso pede (pelo tipo do aviso)
  const abaDoAviso = (p) => {
    const t = String(p.id).split("|")[0];
    if (t === "ads") return "ads";
    if (["subir", "anuncio", "alvo", "acima", "acima-ok", "acima-volta", "nota", "teste-rec", "lucro-menos", "teste-acabando", "teste-acabou"].includes(t) || t.startsWith("rampa-")) return "rampa";
    if (["prejuizo", "minimo", "atracao", "revisar"].includes(t)) return "preco";
    if (["anunciar", "promo-limite"].includes(t)) return "anuncio";
    return "resumo";
  };
  // aviso de um anúncio (item × canal) → abre o Painel do anúncio; senão o destino dele
  const anuncioDoAviso = (p) => {
    const k = produtoDoAviso(p, nomesCanais);
    const itemId = k ? itemDoNome(k.nome) : null;
    const canal = k?.canal ? canalDoNome(k.canal) : null;
    return itemId && canal ? { itemId, canalId: canal.id } : null;
  };
  const canalDoNome = (nome) => (dados.canais || []).find((c) => c.nome === nome) || null;

  // Um aviso dentro do cartão do produto (ou da Loja).
  const linhaAviso = (p, noCartao) => (
    <div key={p.id} className="inicio-aviso">
      <div className="inicio-aviso-txt">
        <b>{noCartao ? semPrefixo(p) : p.titulo}</b>
        <span>
          {noCartao && p._canal && canalDoNome(p._canal) && <CanalTag canal={canalDoNome(p._canal)} />} {noCartao ? textoSemCanal(p) : p.texto}
        </span>
      </div>
      <div className="inicio-aviso-acoes">
        {podeAdiar(p) && (
          <button type="button" className="link-btn" onClick={() => adiar30(p)} title="Some do Pra fazer por 30 dias e volta sozinho se ainda valer. Nada mais muda.">
            lembrar em 30 dias
          </button>
        )}
        {p.revisado && (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              const { error } = await marcarPrecoRevisado(p.revisado);
              onToast?.(error ? `Não foi possível marcar: ${error.message}` : "Preço mantido — o custo de hoje vira a referência.");
            }}
            title="O preço salvo continua o mesmo. O custo de hoje vira a referência: o aviso só volta se o custo subir mais 10% ou daqui a 12 meses."
          >
            ✓ revisado, manter o preço
          </button>
        )}
        {p.ciente && (
          <button type="button" className="link-btn" onClick={() => ciente(p.ciente)} title="Esse aviso não volta mais pra esta impressora.">
            ok, ciente
          </button>
        )}
        <button type="button" className={`btn btn-mini${p.grupo === "resolver" ? " primary" : ""}`} onClick={() => ir(p.ir)}>
          {p.rotulo}
        </button>
      </div>
    </div>
  );

  const cartaoProduto = (g) => {
    const est = estadoPendencia(g.itens[0]);
    const [tipoG, rotG] = ROTULO_GRUPO[g.grupo] || ["info", ""];
    const itemId = itemDoNome(g.nome);
    const canalCartao = g.canal ? canalDoNome(g.canal) : null;
    return (
      <div key={g.id} className={`inicio-cartao${est ? ` st-${est}` : ""}`}>
        <div className="inicio-cartao-cab">
          <Bolinha tipo={est} />
          <b className="inicio-cartao-nome">{g.anuncio ? `Anúncio: ${g.nome}` : g.nome}</b>
          {g.canais.map((c) => (canalDoNome(c) ? <CanalTag key={c} canal={canalDoNome(c)} /> : null))}
          <Estado tipo={tipoG}>{rotG}</Estado>
          {g.itens.length > 1 && <span className="muted-cel">{g.itens.length} avisos</span>}
          {itemId && canalCartao ? (
            <button type="button" className="btn btn-mini inicio-cartao-abrir" onClick={() => abrirAnuncio(itemId, canalCartao.id, abaDoAviso(g.itens[0]))}>
              Abrir no Painel do anúncio →
            </button>
          ) : itemId ? (
            <button type="button" className="btn btn-mini inicio-cartao-abrir" onClick={() => abrirProduto(itemId)}>
              Abrir produto →
            </button>
          ) : null}
        </div>
        {g.itens.map((p) => linhaAviso(p, true))}
      </div>
    );
  };

  const cartaoLoja = (p) => {
    const est = estadoPendencia(p);
    const [tipoG, rotG] = ROTULO_GRUPO[p.grupo] || ["info", ""];
    return (
      <div key={p.id} className={`inicio-cartao inicio-cartao-loja${est ? ` st-${est}` : ""}`}>
        <div className="inicio-cartao-cab">
          <Bolinha tipo={est} />
          <b className="inicio-cartao-nome">{p.titulo}</b>
          <Estado tipo={tipoG}>{rotG}</Estado>
        </div>
        {linhaAviso({ ...p, titulo: "" }, false)}
      </div>
    );
  };

  return (
    <div className="inicio">
      <button type="button" className="inicio-sede" onClick={() => onIrPara?.("sede")}>
        <span aria-hidden="true">🏢</span> Entrar na Sede da {nomeLoja}
        <small>o escritório da loja, ao vivo</small>
      </button>
      <BomDia d={bom} onAtualizar={() => onIrPara?.("importar")} />
      {/* 1 · Como a loja está */}
      <div className="panel">
        <h3 className="section-title">
          <span>
            Como a loja está{" "}
            <span className="h3-contagem">
              {diaMes(loja.de)} a {diaMes(loja.ate)} · comparado com {diaMes(loja.deAntes)} a {diaMes(loja.ateAntes)}
            </span>
          </span>
          <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => onIrPara?.("resumoMes")}>
            Resumo do mês →
          </button>
        </h3>
        <Kpis
          itens={[
            {
              label: "Vendas",
              valor: temPedidos ? BRL(loja.atual.vendas) : "—",
              sub: temPedidos ? (
                <>
                  {loja.atual.pedidos} pedido{loja.atual.pedidos === 1 ? "" : "s"} · <Variacao v={variacao(loja.atual.vendas, loja.antes.vendas)} />
                </>
              ) : (
                "importe os pedidos em Atualizar dados"
              ),
            },
            {
              label: "Lucro depois do Ads",
              valor: temPedidos ? BRL(loja.atual.depoisAds) : "—",
              tom: temPedidos && loja.atual.depoisAds < 0 ? "bad" : undefined,
              sub: temPedidos ? (
                <>
                  Ads {BRL(loja.atual.ads)} · <Variacao v={loja.antes.depoisAds > 0 ? variacao(loja.atual.depoisAds, loja.antes.depoisAds) : null} />
                </>
              ) : (
                "pelos pedidos importados"
              ),
            },
            {
              label: "Caixa hoje",
              valor: caixa ? BRL(caixa.saldoHoje) : "—",
              tom: caixa && caixa.saldoHoje < 0 ? "bad" : undefined,
              sub: caixa ? (aPagar7 > 0 ? `a pagar em 7 dias: ${BRL(aPagar7)}` : "nada a pagar nos próximos 7 dias") : "sem lançamentos no Caixa",
            },
            {
              label: "Meta do mês",
              valor: metaFat > 0 && temPedidos ? `${Math.round((loja.atual.vendas / metaFat) * 100)}%` : "—",
              sub: metaFat > 0 ? `${BRL(loja.atual.vendas)} de ${BRL(metaFat)}${temPedidos ? ` · no ritmo: ${BRL(loja.ritmo)}` : ""}` : "sem meta (Dinheiro → Metas)",
              extra:
                metaFat > 0 && temPedidos ? (
                  <div className="inicio-barra">
                    <i style={{ width: `${Math.min(100, Math.round((loja.atual.vendas / metaFat) * 100))}%` }} />
                  </div>
                ) : null,
            },
          ]}
        />
        {loja.atual.semCusto > 0 && <p className="hint" style={{ margin: "6px 0 0" }}>{loja.atual.semCusto} venda(s) sem custo cadastrado ficam fora do lucro.</p>}
      </div>

      {/* 2 · Seus dados */}
      {situacao.length > 0 && (
        <div className="panel inicio-dados">
          <h3 className="section-title">
            <span>
              Seus dados <span className="h3-contagem">o app só acerta com os arquivos em dia</span>
            </span>
            <button type="button" className="btn btn-sm primary" style={{ marginLeft: "auto" }} onClick={() => onIrPara?.("importar")}>
              Atualizar dados
            </button>
          </h3>
          <div className="inicio-dados-chips">
            {situacao.map((d) => (
              <span key={d.chave} className={`inicio-dado st-${d.estado === "ok" ? "oportunidade" : "atencao"}`}>
                <Bolinha tipo={d.estado === "ok" ? "oportunidade" : "atencao"} /> <b>{d.rotulo}</b> {d.texto}
              </span>
            ))}
            <span className={`inicio-dado st-${backup.estado.vencido ? "atencao" : "oportunidade"}`}>
              <Bolinha tipo={backup.estado.vencido ? "atencao" : "oportunidade"} /> <b>Backup</b> {backup.estado.texto}
              {backup.estado.vencido && (
                <button type="button" className="btn btn-sm primary inicio-dado-btn" onClick={backup.gerar} disabled={backup.gerando}>
                  {backup.gerando ? "Gerando…" : "Gerar e baixar"}
                </button>
              )}
            </span>
          </div>
          {avisosDados.length > 0 && (
            <ul className="inicio-dados-avisos">
              {avisosDados.map((p) => (
                <li key={p.id}>
                  <b>{p.titulo}</b> <span className="muted-cel">{p.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* As 3 coisas que mais valem dinheiro hoje */}
      {!carregando && top3.length > 0 && (
        <div className="panel inicio-top3">
          <h3 className="section-title">
            <span>
              As {top3.length === 1 ? "coisa" : `${top3.length} coisas`} que mais valem dinheiro hoje <span className="h3-contagem">pelo quanto valem em R$ — o resto está embaixo</span>
            </span>
          </h3>
          <div className="inicio-top3-grade">
            {top3.map((p) => {
              const est = estadoPendencia(p);
              const [tipoG, rotG] = ROTULO_GRUPO[p.grupo] || ["info", ""];
              const an = anuncioDoAviso(p);
              const emJogo = p.valor > 0 ? (String(p.id).startsWith("caixa|") ? `${BRL(p.valor)} em jogo` : `vale ~${BRL(p.valor)}/semana`) : null;
              return (
                <div key={p.id} className={`inicio-top3-cartao${est ? ` st-${est}` : ""}`}>
                  <span className="inicio-top3-rot">
                    <Estado tipo={tipoG}>{rotG}</Estado>
                    {emJogo && <b>{emJogo}</b>}
                  </span>
                  <b className="inicio-top3-tit">{p.titulo}</b>
                  <span className="inicio-top3-txt">{p.texto}</span>
                  {an ? (
                    <button type="button" className={`btn btn-sm${p.grupo === "resolver" ? " primary" : ""}`} onClick={() => abrirAnuncio(an.itemId, an.canalId, abaDoAviso(p))}>
                      Abrir anúncio →
                    </button>
                  ) : (
                    <button type="button" className={`btn btn-sm${p.grupo === "resolver" ? " primary" : ""}`} onClick={() => ir(p.ir)}>
                      {p.rotulo || "Abrir"} →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* 3 · Pra fazer */}
      <div className="panel inicio-fazer">
        <h3 className="section-title">
          <span className="inicio-fazer-tit">
            Pra fazer
            {contagem("resolver") > 0 && <Estado tipo="resolver">{`${contagem("resolver")} resolver`}</Estado>}
            {contagem("rotina") > 0 && <Estado tipo="atencao">{`${contagem("rotina")} atenção`}</Estado>}
            {contagem("oportunidade") > 0 && <Estado tipo="oportunidade">{`${contagem("oportunidade")} oportunidade${contagem("oportunidade") > 1 ? "s" : ""}`}</Estado>}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => (tarefasH.disponivel ? setDialogTarefa({}) : onToast?.("Rode o supabase/schema_v42.sql no Supabase pra usar as tarefas"))}
          >
            + Tarefa
          </button>
        </h3>
        <div className="inicio-filtros" role="group" aria-label="Filtrar o Pra fazer">
          {FILTROS.map((f) => (
            <button key={f.chave} type="button" className={`chip-filtro-area${filtroAtivo === f.chave ? " ativo" : ""}`} onClick={() => setFiltro(f.chave)}>
              {f.rotulo} <span>{nFiltro[f.chave]}</span>
            </button>
          ))}
        </div>
        {filtroAtivo !== "todos" && nUrgentes > 0 && <p className="hint" style={{ margin: "0 0 6px" }}>Os urgentes (resolver) aparecem com qualquer filtro.</p>}
        {desfazer && (
          <div className="tarefa-desfazer" role="status">
            ✓ “{desfazer.tarefa.descricao}” concluída{desfazer.prox ? ` · próxima em ${diaMes(desfazer.prox)}` : ""}
            <button type="button" className="link-btn" onClick={voltarConclusao}>
              desfazer
            </button>
          </div>
        )}
        {carregando && !pendencias.length ? (
          <div className="empty">Carregando…</div>
        ) : !avisos.length && !tf.total ? (
          <div className="empty inicio-vazio">Nada pendente hoje ✓</div>
        ) : (
          <>
            {cartoesVis.length > 0 && (
              <>
                <div className="inicio-sec">Produtos</div>
                {cartoesVis.map(cartaoProduto)}
                {escondidos > 0 && (
                  <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodos(true)}>
                    ver todos os produtos ({cartoes.length})
                  </button>
                )}
                {verTodos && filtroAtivo === "todos" && cartoesResto.length > VISIVEIS && (
                  <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodos(false)}>
                    ver menos
                  </button>
                )}
              </>
            )}
            {lojaVis.length > 0 && (
              <>
                <div className="inicio-sec">Loja</div>
                {lojaVis.map(cartaoLoja)}
              </>
            )}
            {parados.length > 0 && verLoja && (
              <div className="inicio-fora">
                <b>Fora do Início (só informação)</b>
                <span>
                  {parados.slice(0, 3).map((x) => x.nome).join(", ")}
                  {parados.length > 3 ? ` e mais ${parados.length - 3}` : ""}: sem venda há 30+ dias, sem gastar Ads. Ficam no relatório <b>Produtos parados</b> e na Reunião da semana (consultor da Sede).
                </span>
              </div>
            )}
            {(verTarefas ? tarefasLista : tf.resolver).length > 0 && (
              <>
                <div className="inicio-sec">Minhas tarefas</div>
                <ul className="inicio-lista">
                  {(verTarefas ? tarefasLista : tf.resolver).map((p) => (
                    <li key={p.id} className={`inicio-item inicio-tarefa${estadoPendencia(p) ? ` st-${estadoPendencia(p)}` : ""}`}>
                      <Bolinha tipo={estadoPendencia(p)} />
                      <LinhaTarefa p={p} itens={itens} onEditar={(t) => setDialogTarefa({ tarefa: t })} onConcluir={concluir} onExcluir={setExcluir} onAbrir={(t) => abrirTarefa(t, itens, onIrPara)} />
                    </li>
                  ))}
                </ul>
                {verTarefas && tf.total > tarefasLista.length && (
                  <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodasTarefas(true)}>
                    ver todas as tarefas ({tf.total})
                  </button>
                )}
              </>
            )}
          </>
        )}
        {adiados.length > 0 && (
          <div className="tarefas-concluidas">
            <button type="button" className={`variacoes-toggle${verAdiados ? " aberto" : ""}`} onClick={() => setVerAdiados((v) => !v)} aria-expanded={verAdiados}>
              <span className="seta">▸</span> Adiados por 30 dias ({adiados.length})
            </button>
            {verAdiados && (
              <ul className="inicio-mini">
                {adiados.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.titulo}
                      <span className="sub-num-inline"> · volta em {diaMes(adiadoAte.get(p.id))}</span>
                    </span>
                    <button type="button" className="link-btn" onClick={() => voltarAviso(p)}>
                      mostrar agora
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {concluidas.length > 0 && (
          <div className="tarefas-concluidas">
            <button type="button" className={`variacoes-toggle${verConcluidas ? " aberto" : ""}`} onClick={() => setVerConcluidas((v) => !v)} aria-expanded={verConcluidas}>
              <span className="seta">▸</span> Concluídas recentemente ({concluidas.length})
            </button>
            {verConcluidas && (
              <ul className="inicio-mini">
                {concluidas.map((t) => (
                  <li key={t.id}>
                    <span>
                      <s>{t.descricao}</s>
                      {rotuloLink(t, itens) && <span className="sub-num-inline"> · {rotuloLink(t, itens)}</span>}
                    </span>
                    <span className="sub-num-inline">✓ {diaMes(dataSP(t.concluida_em))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 4 · Seus produtos */}
      <div className="panel">
        <h3 className="section-title">
          <span>
            Seus produtos <span className="h3-contagem">últimos 7 dias × os 7 antes · pelos pedidos importados</span>
          </span>
          <button type="button" className="link-btn" style={{ marginLeft: "auto" }} onClick={() => onIrPara?.("anuncios")}>
            ver todos em Anúncios →
          </button>
        </h3>
        {!semana.length ? (
          <div className="empty">Sem vendas nos últimos 14 dias nos pedidos importados.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Vendas</th>
                  <th className="num">Lucro</th>
                  <th className="num">vs antes</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {semana.map((x) => {
                  const g = cartaoDoNome.get(String(x.nome).toLowerCase());
                  const dif = x.vendas - x.vendasAntes;
                  const est = g ? estadoPendencia(g.itens[0]) : null;
                  return (
                    <tr key={x.chave} className="linha-clicavel" onClick={() => abrirProduto(x.itemId)}>
                      <td>
                        <b>{x.nome}</b> {x.canais.map((c) => <CanalTag key={c.id} canal={c} />)}
                      </td>
                      <td className="num">{x.vendas}</td>
                      <td className={`num${x.lucro < 0 ? " neg" : ""}`}>{x.vendas ? BRL(x.lucro) : "—"}</td>
                      <td className={`num${dif > 0 ? " pos-forte" : dif < 0 ? " neg-forte" : ""}`}>{dif > 0 ? `↑ ${dif}` : dif < 0 ? `↓ ${-dif}` : "="}</td>
                      <td>{g ? <Estado tipo={est || "info"}>{semPrefixo(g.itens[0])}</Estado> : <span className="muted-cel">✓ sem aviso</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialogTarefa && <TarefaDialog tarefa={dialogTarefa.tarefa || null} itens={itens} lojaId={lojaId} onToast={onToast} onClose={() => setDialogTarefa(null)} />}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir tarefa"
          mensagem={`Excluir “${excluir.descricao}”?${excluir.repetir ? " Ela repete — as próximas não serão criadas." : ""}`}
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setExcluir(null)}
          onConfirm={async () => {
            const t = excluir;
            setExcluir(null);
            const err = await excluirTarefa(t);
            onToast?.(err ? `Não deu pra excluir: ${err.message}` : "Tarefa excluída");
          }}
        />
      )}
    </div>
  );
}
