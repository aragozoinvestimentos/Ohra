import { vendasDoMes, saldoReserva } from "../lib/vendasMes.js";
import { useVendasOrganicas } from "../hooks/useVendasOrganicas.js";
import { useReservaProducao } from "../hooks/useReservaProducao.js";
import { revisoesPrecoDireto } from "../lib/revisarPreco.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLembretes } from "../hooks/useLembretes.js";
import { infoSazonal, proximaCampanha, quandoVendeDe } from "../lib/calendario.js";
import { dataSP } from "../lib/datas.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useSemanaPendente } from "../hooks/useSemanaPendente.js";
import { hojeISO, loadEstimativas, mesDe, resumoCaixa, rotuloMes } from "../lib/fluxoCaixa.js";
import { linhasAnunciar } from "../lib/anunciar.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useFarmAlteracoes } from "../hooks/useFarmAlteracoes.js";
import { avisosDesgaste } from "../lib/farm.js";
import { avisosManutencao } from "../lib/manutencao.js";
import { useManutencoes } from "../hooks/useManutencoes.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { sugestoesAfiliado, vendasPorOrigem } from "../lib/afiliados.js";
import { calcTaxaFalhaAtual, TAXA_FALHA_PRIOR_PCT } from "../lib/registroImpressao.js";
import { AREAS_PENDENCIA, GRUPOS_PENDENCIA, areaPendencia, montarPendencias, statusInicio } from "../lib/inicio.js";
import { publicarUrgentes } from "../lib/urgentes.js";
import { irParaAba } from "../lib/navegar.js";
import { BRL, PCT } from "../lib/format.js";
import Kpis from "./Kpis.jsx";
import CanalTag from "./CanalTag.jsx";
import GraficoOrigem from "./GraficoOrigem.jsx";
import Estado from "./Estado.jsx";
import { estadoDoTom } from "../lib/estados.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { LinhaTarefa, TarefaDialog } from "./Tarefas.jsx";
import { useTarefas } from "../hooks/useTarefas.js";
import { LIMITE_TAREFAS, concluidasRecentes, repartirTarefas } from "../lib/tarefas.js";
import { abrirTarefa, concluirTarefa, desfazerConclusao, excluirTarefa, rotuloLink } from "../lib/tarefasAcoes.js";

const VISIVEIS = 5;
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");

// Lançamentos do caixa, meta do mês e registros de impressão — só leitura.
function useDadosGestao() {
  const { lojaId } = useLoja();
  const [d, setD] = useState({ lancamentos: [], meta: null, impressoes: [], carregando: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const q = (t) => (lojaId ? supabase.from(t).select("*").eq("loja_id", lojaId) : supabase.from(t).select("*"));
        const [rl, rm, ri] = await Promise.all([q("lancamentos_caixa"), q("metas_mensais").eq("mes", hojeISO().slice(0, 7)), q("registros_impressao")]);
        if (!ativo) return;
        setD({ lancamentos: rl.error ? [] : rl.data || [], meta: rm.error ? null : (rm.data || [])[0] || null, impressoes: ri.error ? [] : ri.data || [], carregando: false });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "registros_impressao" }, agendar)
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

// Regra única de cores (lib/estados.js): good = OK = sem bolinha; a
// pendência do grupo Oportunidades é verde (dá pra agir e ganhar).
const Bolinha = ({ tipo }) => (tipo ? <i className={`bolinha-status st-${tipo}`} aria-hidden="true" /> : null);
const estadoStatus = (tom) => estadoDoTom(tom);
const estadoPendencia = (p) => (p.semCor ? null : p.grupo === "oportunidade" ? (p.tom === "neu" ? "info" : "oportunidade") : estadoDoTom(p.tom) || "info");
const ESTADO_GRUPO = { resolver: ["resolver", "!"], rotina: ["atencao", "↻"], oportunidade: ["oportunidade", "↑"] };

// Área numerada recolhível, com o resumo na linha do título.
function Area({ k, n, titulo, resumo, tom, aberta, onAlternar, children }) {
  return (
    <div className={`panel inicio-area${aberta ? "" : " panel-recolhido"}`} id={`inicio-area-${k}`}>
      <h3 className="section-title">
        <button type="button" className={`variacoes-toggle${aberta ? " aberto" : ""}`} onClick={onAlternar} aria-expanded={aberta}>
          <span className="seta">▸</span> <span className="inicio-num">{n}</span> {titulo}
        </button>
        <span className="h3-contagem inicio-resumo">
          <Bolinha tipo={estadoStatus(tom)} /> {resumo}
        </span>
      </h3>
      {aberta && <div className="inicio-area-corpo">{children}</div>}
    </div>
  );
}

// Início — SÓ LÊ: status no topo → "Pra fazer" por prioridade → áreas
// numeradas. Cada pendência vem da aba que decide e o botão leva pra lá.
// Única coisa gravada aqui: as tarefas manuais (schema v42, tabela tarefas).
export default function Inicio({ onIrPara, onToast }) {
  const { lojaId } = useLoja();
  const { dados, rampasH, af, regras, hoje, linhas: linhasTodas, linhasGrupo, linhasAf, semanaAf, linhasAds, calendario } = useCrescimento();
  // Rampas de produtos que só existem dentro de um anúncio com vários itens
  // saem dos avisos (decide a rampa do anúncio inteiro, que entra no lugar).
  const linhas = useMemo(() => [...linhasTodas.filter((l) => !l.soNoGrupo), ...(linhasGrupo || [])], [linhasTodas, linhasGrupo]);
  const campanhaProx = useMemo(() => proximaCampanha(calendario, hoje), [calendario, hoje]);
  const organicasH = useVendasOrganicas();
  const reservaH = useReservaProducao();
  const cfgDoProduto = dados.cfgDoProduto;
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
  const semana = useSemanaPendente();
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
  const [abertas, setAbertas] = useState({}); // área → aberta (sobrepõe o padrão)
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
  const caixa = useMemo(
    () => (gestao.lancamentos.length ? resumoCaixa(gestao.lancamentos, { hoje, estimativas: loadEstimativas(lojaId), meses: 3, dias: 7 }) : null),
    [gestao.lancamentos, hoje, lojaId]
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

  // --- Vendas ---
  const origem = useMemo(
    () => vendasPorOrigem({ afRegistros: af.registros, rampaRegistros: rampasH.registros, rampas: rampasH.rampas, hoje, n: 6 }),
    [af.registros, rampasH.registros, rampasH.rampas, hoje]
  );
  const semanasComVenda = origem.filter((w) => w.total > 0).length;
  const temSemana = linhas.some((l) => l.est.lucroSemana != null);
  const lucroSemana = temSemana ? linhas.reduce((s, l) => s + (l.est.lucroSemana || 0), 0) - (semanaAf.comissaoRampa || 0) : null;

  // --- Produção ---
  const taxa = useMemo(() => (gestao.impressoes.length ? calcTaxaFalhaAtual(gestao.impressoes) : null), [gestao.impressoes]);
  // Repor a produção do mês = a MESMA conta da Reserva de produção do Fluxo de
  // Caixa (Vendas do mês, lib/vendasMes.js) + o saldo da reserva (v51).
  const reservaMes = useMemo(() => {
    const v = vendasDoMes({ mes: mesDe(hoje), rampas: rampasH.rampas, rampasGrupo: rampasH.rampasGrupo, rampaRegistros: rampasH.registros, afRegistros: af.registros, organicas: organicasH.registros, itens, canais, cfgDoProduto });
    if (!v.total.unidades) return null;
    const res = saldoReserva(reservaH.registros);
    return { repor: v.total.repor, unidades: v.total.unidades, saldo: res.saldo, separado: res.porMes.get(mesDe(hoje)) || 0, temReserva: reservaH.disponivel };
  }, [hoje, rampasH.rampas, rampasH.rampasGrupo, rampasH.registros, af.registros, organicasH.registros, itens, canais, cfgDoProduto, reservaH.registros, reservaH.disponivel]);

  // --- Pra fazer + status ---
  // Venda direta (Orgânico): preço velho ou custo subiu → "vale revisar o preço?"
  const revisoes = useMemo(() => revisoesPrecoDireto({ itens, canais, precos, hoje }), [itens, canais, precos, hoje]);
  const todasPendencias = useMemo(
    () => montarPendencias({ precosAlerta, caixa, rampas: linhas, semana: semana.pendentes, anunciosAtualizar, afSugestoes, atracao, tarefas: tarefasH.tarefas, ads: linhasAds, farm, temporadas, campanha: campanhaProx, revisoes, adsSazonal: linhasAds?.sazonal || [], hoje }),
    [precosAlerta, caixa, linhas, semana.pendentes, anunciosAtualizar, afSugestoes, atracao, tarefasH.tarefas, linhasAds, farm, temporadas, campanhaProx, revisoes, hoje]
  );
  // "Lembrar em 30 dias" (tabela lembretes, v40): aviso automático que não é
  // urgente some por 30 dias e volta sozinho se ainda valer. Urgente nunca some.
  const { lembretes, disponivel: lembretesOk } = useLembretes();
  const adiadoAte = useMemo(() => new Map(lembretes.filter((l) => String(l.chave).startsWith("inicio|")).map((l) => [l.chave.slice(7), l.adiado_ate])), [lembretes]);
  const podeAdiar = (p) => !p.tarefa && !p.semana && p.grupo !== "resolver";
  const pendencias = todasPendencias.filter((p) => !(podeAdiar(p) && adiadoAte.get(p.id) > hoje));
  const adiados = todasPendencias.filter((p) => podeAdiar(p) && adiadoAte.get(p.id) > hoje);
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
  const status = statusInicio({
    caixa,
    rampas: linhas,
    semana: semana.pendentes,
    afAtivo,
    precosAlerta,
    anunciosAtualizar,
    anunciados: anunciados.length,
    taxa,
    taxaRef: TAXA_FALHA_PRIOR_PCT / 100,
    lucroSemana,
  });

  const ir = (p) => {
    if (p.pedido) irParaAba(p.aba, p.pedido);
    else onIrPara?.(p.aba);
  };
  const aberta = (k) => (abertas[k] != null ? abertas[k] : status[k].tom === "bad" || status[k].tom === "warn");
  const alternar = (k) => setAbertas((a) => ({ ...a, [k]: !aberta(k) }));
  const rolar = (k) => {
    setAbertas((a) => ({ ...a, [k]: true }));
    setTimeout(() => document.getElementById(`inicio-area-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const concluidas = concluidasRecentes(tarefasH.tarefas, hoje);

  const carregando = gestao.carregando || rampasH.carregando || dados.carregando;
  // Avisos automáticos: limite de 5 + "ver todos". Tarefas manuais fora do
  // limite (repartirTarefas): Resolver / topo de Atenção e rotina / Minhas tarefas.
  // Urgentes (Resolver) ficam fora do limite e de qualquer filtro.
  const avisos = pendencias.filter((p) => !p.tarefa);
  const urgAvisos = avisos.filter((p) => p.grupo === "resolver");
  const contagemArea = AREAS_PENDENCIA.map((a) => ({ ...a, n: pendencias.filter((p) => areaPendencia(p) === a.chave).length })).filter((a) => a.n > 0);
  const filtroAtivo = filtro !== "todos" && contagemArea.some((a) => a.chave === filtro) ? filtro : "todos";
  const resto = avisos.filter((p) => p.grupo !== "resolver" && (filtroAtivo === "todos" || areaPendencia(p) === filtroAtivo));
  const restoVis = filtroAtivo !== "todos" || verTodos ? resto : resto.slice(0, VISIVEIS);
  const avisosVis = [...urgAvisos, ...restoVis];
  const tf = repartirTarefas(
    pendencias.filter((p) => p.tarefa),
    { todas: verTodasTarefas }
  );
  const mostraTarefas = filtroAtivo === "todos" || filtroAtivo === "tarefas";
  const urgentes = [...urgAvisos, ...pendencias.filter((p) => p.tarefa && p.grupo === "resolver")];
  const doGrupoVis = (g) => {
    const av = avisosVis.filter((p) => p.grupo === g);
    return g === "resolver" ? [...av, ...tf.resolver] : g === "rotina" ? [...(mostraTarefas ? tf.topo : []), ...av] : av;
  };
  const nUrgentes = urgentes.length;
  useEffect(() => {
    if (!carregando) publicarUrgentes(nUrgentes);
  }, [nUrgentes, carregando]);
  const totalGrupo = (g) => [...urgAvisos, ...resto].filter((p) => p.grupo === g).length + (g === "resolver" ? tf.n.resolver : g === "rotina" && mostraTarefas ? tf.n.topo : 0);

  const CARDS = [
    { k: "dinheiro", n: 1, titulo: "Dinheiro" },
    { k: "vendas", n: 2, titulo: "Vendas" },
    { k: "catalogo", n: 3, titulo: "Catálogo" },
    { k: "producao", n: 4, titulo: "Produção" },
  ];


  // Uma linha do "Pra fazer" (aviso automático ou tarefa manual).
  const linhaPendencia = (p) => (
    <li key={p.id} className={`inicio-item${estadoPendencia(p) ? ` st-${estadoPendencia(p)}` : ""}${p.tarefa ? " inicio-tarefa" : ""}`}>
      <Bolinha tipo={estadoPendencia(p)} />
      {p.tarefa ? (
        <LinhaTarefa
          p={p}
          itens={itens}
          onEditar={(t) => setDialogTarefa({ tarefa: t })}
          onConcluir={concluir}
          onExcluir={setExcluir}
          onAbrir={(t) => abrirTarefa(t, itens, onIrPara)}
        />
      ) : (
      <>
      <div className="inicio-item-txt">
        <b>{p.titulo}</b>
        <span>{p.texto}</span>
        {p.semana && (
          <span className="inicio-item-sec">
            <button type="button" className="link-btn" onClick={() => semana.adiar(p.semana, "pular")} title="Some até a semana que vem. Nada é gravado: o período fica em aberto e entra no próximo registro.">
              não registrar esta semana
            </button>
            <button type="button" className="link-btn" onClick={() => semana.adiar(p.semana, "amanha")}>
              lembrar amanhã
            </button>
          </span>
        )}
        {podeAdiar(p) && (
          <span className="inicio-item-sec">
            <button type="button" className="link-btn" onClick={() => adiar30(p)} title="Some do Pra fazer por 30 dias e volta sozinho se ainda valer. Nada mais muda.">
              lembrar em 30 dias
            </button>
          </span>
        )}
        {p.ciente && (
          <span className="inicio-item-sec">
            <button type="button" className="link-btn" onClick={() => ciente(p.ciente)} title="Esse aviso não volta mais pra esta impressora.">
              ok, ciente
            </button>
          </span>
        )}
      </div>
      <button type="button" className={`btn btn-mini${p.grupo === "resolver" ? " primary" : ""}`} onClick={() => ir(p.ir)}>
        {p.rotulo}
      </button>
      </>
      )}
    </li>
  );

  return (
    <div className="inicio">
      {urgentes.length > 0 && (
        <div className="inicio-urgentes" role="alert">
          <b>
            ! {urgentes.length === 1 ? "1 urgente" : `${urgentes.length} urgentes`}
          </b>
          <span className="inicio-urgentes-lista">
            {urgentes.slice(0, 3).map((p) => (
              <button key={p.id} type="button" className="link-btn" onClick={() => (p.tarefa ? document.querySelector(".inicio-fazer")?.scrollIntoView({ behavior: "smooth" }) : ir(p.ir))}>
                {p.tarefa ? `tarefa vencida: ${p.titulo}` : p.titulo}
              </button>
            ))}
            {urgentes.length > 3 && <span>e mais {urgentes.length - 3}</span>}
          </span>
          <button type="button" className="btn btn-mini" onClick={() => document.querySelector(".inicio-fazer")?.scrollIntoView({ behavior: "smooth" })}>
            ver
          </button>
        </div>
      )}
      <div className="inicio-status">
        {CARDS.map((c) => (
          <button key={c.k} type="button" className={`inicio-card${estadoStatus(status[c.k].tom) ? ` st-${estadoStatus(status[c.k].tom)}` : ""}`} onClick={() => rolar(c.k)}>
            <span className="inicio-card-tit">
              <Bolinha tipo={estadoStatus(status[c.k].tom)} /> {c.titulo}
            </span>
            <span className="inicio-card-frase">{carregando ? "carregando…" : status[c.k].frase}</span>
          </button>
        ))}
      </div>

      <div className="panel inicio-fazer">
        <h3 className="section-title">
          <span>
            Pra fazer <span className="h3-contagem">{pendencias.length ? `${pendencias.length} ${pendencias.length === 1 ? "item" : "itens"}` : ""}</span>
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => (tarefasH.disponivel ? setDialogTarefa({}) : onToast?.("Rode o supabase/schema_v42.sql no Supabase pra usar as tarefas"))}
          >
            + Tarefa
          </button>
        </h3>
        {contagemArea.length > 1 && (
          <div className="inicio-filtros" role="group" aria-label="Filtrar o Pra fazer">
            <button type="button" className={`chip-filtro-area${filtroAtivo === "todos" ? " ativo" : ""}`} onClick={() => setFiltro("todos")}>
              Todos <span>{pendencias.length}</span>
            </button>
            {contagemArea.map((a) => (
              <button key={a.chave} type="button" className={`chip-filtro-area${filtroAtivo === a.chave ? " ativo" : ""}`} onClick={() => setFiltro(a.chave)}>
                {a.rotulo} <span>{a.n}</span>
              </button>
            ))}
          </div>
        )}
        {filtroAtivo !== "todos" && urgentes.length > 0 && <p className="hint" style={{ margin: "0 0 6px" }}>Os urgentes (Resolver) aparecem com qualquer filtro.</p>}
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
        ) : !pendencias.length ? (
          <div className="empty inicio-vazio">Nada pendente hoje ✓</div>
        ) : (
          <>
            {GRUPOS_PENDENCIA.map((g) => {
              const doGrupo = doGrupoVis(g.chave);
              if (!doGrupo.length) return null;
              return (
                <div key={g.chave} className="inicio-grupo">
                  <div className="inicio-grupo-tit">
                    <Estado tipo={(ESTADO_GRUPO[g.chave] || ["info"])[0]} icone={(ESTADO_GRUPO[g.chave] || [])[1]}>
                      {g.titulo}
                    </Estado>{" "}
                    <span className="muted-cel">{totalGrupo(g.chave)}</span>
                  </div>
                  <ul className="inicio-lista">{doGrupo.map(linhaPendencia)}</ul>
                </div>
              );
            })}
            {filtroAtivo === "todos" && resto.length > VISIVEIS && (
              <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodos((v) => !v)}>
                {verTodos ? "ver menos" : `ver todos (${avisos.length})`}
              </button>
            )}
            {mostraTarefas && tf.minhas.length > 0 && (
              <div className="inicio-grupo inicio-minhas">
                <div className="inicio-grupo-tit">
                  <span className="inicio-minhas-tit">Minhas tarefas</span> <span className="muted-cel">{tf.n.minhas}</span>
                </div>
                <ul className="inicio-lista">{tf.minhas.map(linhaPendencia)}</ul>
              </div>
            )}
            {mostraTarefas && tf.total > LIMITE_TAREFAS && (
              <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodasTarefas((v) => !v)}>
                {verTodasTarefas ? "ver menos tarefas" : `ver todas as tarefas (${tf.total})`}
              </button>
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

      <Area k="dinheiro" tom={status.dinheiro.tom} aberta={aberta("dinheiro")} onAlternar={() => alternar("dinheiro")} n={1} titulo="Dinheiro" resumo={status.dinheiro.frase}>
        {!caixa ? (
          <div className="empty">
            Sem lançamentos no Fluxo de Caixa.{" "}
            <button type="button" className="link-btn" onClick={() => onIrPara?.("caixa")}>Abrir Fluxo de Caixa</button>
          </div>
        ) : (
          <>
            <Kpis
              itens={[
                { label: "Saldo hoje", valor: BRL(caixa.saldoHoje), tom: caixa.saldoHoje < 0 ? "bad" : undefined, sub: "realizado até hoje" },
                {
                  label: "Menor saldo em 3 meses",
                  valor: caixa.menor ? BRL(caixa.menor.saldoFinal) : "—",
                  tom: caixa.menor && caixa.menor.saldoFinal < 0 ? "bad" : undefined,
                  sub: caixa.menor ? `fim de ${rotuloMes(caixa.menor.mes, false)} · projeção do Fluxo de Caixa` : "",
                },
                { label: "Faturamento do mês", valor: BRL(caixa.faturamento), sub: metaFat > 0 ? `meta ${BRL(metaFat)} · ${Math.round((caixa.faturamento / metaFat) * 100)}%` : "sem meta (aba Metas)" },
                { label: "Resultado do mês", valor: BRL(caixa.resultado), tom: caixa.resultado < 0 ? "bad" : undefined, sub: "entradas − saídas realizadas" },
              ]}
            />
            <h4 className="sub-h">Próximos 7 dias</h4>
            {caixa.proximos.length ? (
              <ul className="inicio-mini">
                {caixa.proximos.slice(0, 8).map((l) => (
                  <li key={l.id}>
                    <span className="muted-cel">{diaMes(l.data_prevista)}</span> {l.descricao || "—"}
                    <b className={l.tipo === "saida" ? "neg" : "pos"}>{l.tipo === "saida" ? "−" : "+"}{BRL(Number(l.valor || 0))}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted-cel">Nada previsto nos próximos 7 dias.</div>
            )}
          </>
        )}
      </Area>

      <Area k="vendas" tom={status.vendas.tom} aberta={aberta("vendas")} onAlternar={() => alternar("vendas")} n={2} titulo="Vendas e crescimento" resumo={status.vendas.frase}>
        <Kpis
          itens={[
            { label: "Lucro da semana", valor: lucroSemana != null ? BRL(lucroSemana) : "—", sub: lucroSemana != null ? "produtos em rampa (últimos 7 dias)" : "registre a semana no Crescimento" },
            { label: "Ads da semana", valor: semanaAf.adsGasto > 0 ? BRL(semanaAf.adsGasto) : "—", sub: semanaAf.adsGasto > 0 ? `${semanaAf.adsVendas} vendas via Ads` : "sem Ads registrado" },
            { label: "Produtos em rampa", valor: String(linhas.length), sub: linhas.length ? `${linhas.filter((l) => l.est.sugestao?.chave === "subir").length} prontos pra subir` : "nenhum ainda" },
            ...(afAtivo
              ? [{ label: "Afiliados na semana", valor: String(semanaAf.vendasAf), sub: semanaAf.comissao > 0 ? `comissão ${BRL(semanaAf.comissao)}` : "vendas via afiliado" }]
              : []),
          ]}
        />
        <h4 className="sub-h">Vendas por origem</h4>
        {semanasComVenda >= 2 ? <GraficoOrigem semanas={origem} /> : <div className="empty">Registre 2 semanas pra ver o gráfico.</div>}
        {linhas.length > 0 && (
          <ul className="inicio-mini">
            {linhas.map((l) => (
              <li key={l.r.id}>
                <span>
                  {l.produto.nome} <CanalTag canal={l.canal} /> <span className="muted-cel">{l.est.fase.rotulo} · {l.ehGrupo ? `${l.g.pctAtual}% do preço salvo` : `vendendo ${BRL(l.est.preco)}`}</span>
                </span>
                <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: l.r.id })}>
                  {l.est.sugestao.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Area>

      <Area k="catalogo" tom={status.catalogo.tom} aberta={aberta("catalogo")} onAlternar={() => alternar("catalogo")} n={3} titulo="Catálogo" resumo={status.catalogo.frase}>
        {!anunciados.length ? (
          <div className="empty">Nenhum anúncio marcado como feito na Anunciar ainda.</div>
        ) : !precosAlerta.length && !anunciosAtualizar.length ? (
          <div className="inicio-ok">✓ ok — {anunciados.length} {anunciados.length === 1 ? "anúncio" : "anúncios"} sem problema</div>
        ) : (
          <ul className="inicio-mini">
            {[...precosAlerta.map((a) => ({ ...a, problema: a.al.tipo === "prejuizo" ? "prejuízo" : "abaixo do mínimo", tom: a.al.tipo === "prejuizo" ? "bad" : "warn", aba: "historico" })),
              ...anunciosAtualizar.map((a) => ({ ...a, problema: "↻ atualizar anúncio", tom: "warn", aba: "publicar" }))].map((a) => (
              <li key={`${a.item.id}|${a.canal.id}|${a.problema}`}>
                <span>
                  {a.item.nome} <CanalTag canal={a.canal} /> <Estado tipo={a.tom === "bad" ? "resolver" : "atencao"}>{a.problema}</Estado>
                </span>
                <button type="button" className="link-btn" onClick={() => (a.aba === "historico" ? irParaAba("historico", { busca: a.item.nome }) : onIrPara?.("publicar"))}>
                  {a.aba === "historico" ? "ver em Produtos precificados" : "abrir Anunciar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Area>

      <Area k="producao" tom={status.producao.tom} aberta={aberta("producao")} onAlternar={() => alternar("producao")} n={4} titulo="Produção" resumo={status.producao.frase}>
        <Kpis
          itens={[
            { label: "Taxa de falha", valor: taxa ? PCT(taxa.taxa) : "—", sub: taxa ? `${taxa.falhas} falhas em ${taxa.total} impressões · referência 12,5%` : "registre impressões" },
            {
              label: "Repor a produção do mês",
              valor: reservaMes ? BRL(reservaMes.repor) : "—",
              sub: reservaMes
                ? `${reservaMes.unidades} un. vendidas${reservaMes.temReserva ? ` · separado ${BRL(reservaMes.separado)} · reserva ${BRL(reservaMes.saldo)}` : ""}`
                : "aparece com as vendas do mês (Fluxo de Caixa → Vendas do mês)",
            },
          ]}
        />
        <button type="button" className="link-btn" onClick={() => onIrPara?.("registroImpressoes")}>Abrir Registro de Impressões</button>
      </Area>
    </div>
  );
}
