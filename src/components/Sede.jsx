import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { useLives } from "../hooks/useLives.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { assinarSede, lerSede } from "../lib/sedeDados.js";
import { ELENCO, SALAS_SEDE, avisosDaSede, ehOhra, nomesDaLoja, nomesDasSalas, nomesPadrao, ocultosDaLoja, partesDaLoja, pessoaDoAviso, salaNova, salasDaLoja } from "../lib/sede.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useEstoque } from "../hooks/useEstoque.js";
import { useConsultor } from "../hooks/useConsultor.js";
import { consultoriaVisivel, propostasDaEquipe, sugerirConsultorias } from "../lib/consultor.js";
import { assuntoDe, esperaAgoraNao, ordenarPeloPerfil, perfilDecisoes, resultadosParaGravar } from "../lib/consultorAprende.js";
import { gravarRegistro } from "../lib/consultorAcoes.js";
import { useBackup } from "../hooks/useBackup.js";
import { IDEIAS_MAX, ideiasDaEquipe } from "../lib/consultorIdeias.js";
import { useRelatorios } from "../hooks/useRelatorios.js";
import ConsultorPainel from "./ConsultorPainel.jsx";
import { criarSede, TAMANHO_SEDE } from "../lib/sedeMotor.js";
import { agendaDoDia, agoraDaSede, ataDoBomDia, nomeDoArquivo, novidadeRecente } from "../lib/sedeAgenda.js";
import { NOVIDADES_CONSULTOR } from "../lib/consultorAprende.js";
import { FORA_DA_ESCADA, adiarPromocao, destaqueDaSemana, estrelasDaEquipe, nivelDe, nomeDoNivel, opinioesDosGerentes, prontosPraPromocao, promover, proximoNivel, rankingDoPeriodo } from "../lib/sedeEquipe.js";
import { periodoPadrao } from "../lib/relatorios.js";
import { SETORES_NOTA, comparaSemana, notaTexto, notasDaSemana } from "../lib/sedeNotas.js";
import { gravarNotasDaSemana } from "../lib/sedeNotasAcoes.js";
import { useSedeNotas } from "../hooks/useSedeNotas.js";
import { periodoLigado } from "../lib/ads.js";
import { hojeSP } from "../lib/datas.js";
import { configCalendario, infoSazonal } from "../lib/calendario.js";
import { ehValido } from "../lib/pedidos.js";
import { irParaAba } from "../lib/navegar.js";
import { marcarVoltaSede, pedirTelaSede } from "../lib/sedeTela.js";
import { BRL } from "../lib/format.js";
import Estado from "./Estado.jsx";

// Sede da <loja> (24/10/2026; planta nova em perspectiva 27/10/2026): o escritório da loja, ao vivo.
// SÓ MOSTRA — os avisos vêm do Início (sedeDados.js), as reações vêm do
// realtime das tabelas (produto novo, pedidos, live, Ads, conta paga, meta).
// Único dado gravado: os nomes dos personagens (preferencias_loja `sede:personagens`).
const ESTADO = { resolver: "resolver", rotina: "atencao", oportunidade: "oportunidade" };
const FAZENDO = { sentado: "trabalhando na mesa", trabalhando: "trabalhando", andando: "andando pela empresa", parado: "conversando", live: "na live", fora: "foi pra casa", reuniao: "em reunião", cafe: "no café", almoco: "almoçando", festa: "na festa do fechamento", coleta: "na coleta", agenda: "na agenda" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const agoraHora = () => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date());
const saudacao = () => {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date())) % 24;
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};
const lerVisita = (lojaId) => {
  try {
    return JSON.parse(localStorage.getItem(`ohra:sede:visita:${lojaId}`) || "null");
  } catch {
    return null;
  }
};
const gravarVisita = (lojaId, v) => {
  try {
    localStorage.setItem(`ohra:sede:visita:${lojaId}`, JSON.stringify(v));
  } catch {
    // sem localStorage — só não lembra
  }
};

export default function Sede({ onIrPara, onToast, ativo = true, tela = null, onSairTela }) {
  const { lojaId, lojas } = useLoja();
  const nomeLoja = (lojas || []).find((l) => l.id === lojaId)?.nome || "loja";
  const [salvos, setSalvos] = usePreferencia("sede:personagens", {});
  const nomes = useMemo(() => nomesDaLoja(nomeLoja, salvos), [nomeLoja, salvos]);
  const ocultos = useMemo(() => ocultosDaLoja(nomeLoja, salvos), [nomeLoja, salvos]);
  const sede = useSyncExternalStore(assinarSede, lerSede, lerSede);
  const cat = useCatalogo();
  const ped = usePedidos();
  const { lives, carregando: carregandoLives } = useLives();
  const { periodos, carregando: carregandoAds } = useAdsPeriodos();
  const { lancamentos, carregando: carregandoCaixa } = useLancamentosCaixa();
  const hoje = hojeSP();

  const av = useMemo(() => avisosDaSede(sede.pendencias), [sede.pendencias]);
  const live = (lives || []).some((l) => l.status === "aovivo");
  const adsLigados = useMemo(() => (periodos || []).filter((p) => periodoLigado(p, hoje)), [periodos, hoje]);

  // ---------- consultor: perguntas, consultorias (com o porquê) e propostas da equipe ----------
  const cres = useCrescimento();
  const cons = useConsultor();
  const calLoja = useMemo(() => configCalendario(lojas.find((l) => l.id === lojaId)?.config_escada), [lojas, lojaId]);
  const ctxConsultor = useMemo(
    () => ({ pedidos: cres?.pedidosValidos || [], linhasAds: cres?.linhasAds, hoje, kpis: sede.kpis, pendencias: sede.pendencias, produtos: cat.produtos || [], kits: cat.kits || [], kitProdutos: cat.kitProdutos || [], impressoras: cat.impressoras || [], farmConfig: cat.farmConfig, cal: calLoja }),
    [calLoja, cres?.pedidosValidos, cres?.linhasAds, hoje, sede.kpis, sede.pendencias, cat.produtos, cat.kits, cat.kitProdutos, cat.impressoras, cat.farmConfig]
  );
  const decisao = useMemo(() => new Map(cons.registros.filter((r) => r.tipo === "consultoria").map((r) => [r.chave, r])), [cons.registros]);
  const consultoriasTodas = useMemo(() => sugerirConsultorias(ctxConsultor), [ctxConsultor]);
  // o consultor aprende: o que ele sempre adia volta menos, o que aprova vem na frente
  const perfil = useMemo(() => perfilDecisoes(cons.registros), [cons.registros]);
  const visivel = (c) => consultoriaVisivel(c, decisao.get(c.chave), hoje, esperaAgoraNao(perfil[assuntoDe(c.chave)]));
  const propostasTodas = useMemo(() => propostasDaEquipe(ctxConsultor), [ctxConsultor]);
  const consultorias = ordenarPeloPerfil(consultoriasTodas.filter(visivel), perfil);
  const propostas = ordenarPeloPerfil(propostasTodas.filter(visivel), perfil);
  // ideias da equipe (com crédito): no máximo IDEIAS_MAX por vez, as que você mais aprova primeiro
  const ideiasTodas = useMemo(() => ideiasDaEquipe(ctxConsultor), [ctxConsultor]);
  const atuaisConsultor = useMemo(() => [...consultoriasTodas, ...propostasTodas, ...ideiasTodas], [consultoriasTodas, propostasTodas, ideiasTodas]);
  const ideias = ordenarPeloPerfil(ideiasTodas.filter(visivel), perfil).slice(0, IDEIAS_MAX);
  // resultado do que foi aprovado: o aviso sumiu (resolveu) ou continuou — grava uma vez
  // (só depois de 15 s na Sede: os avisos do Início e os pedidos precisam ter carregado,
  // senão "sumiu" seria só "ainda não carregou")
  const resultadosGravados = useRef(new Set());
  const [maduro, setMaduro] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMaduro(true), 15000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!maduro || !cons.disponivel || cons.carregando || !sede.pronto) return;
    for (const { registro, dados } of resultadosParaGravar(cons.registros, [...consultoriasTodas, ...propostasTodas, ...ideiasTodas], hoje)) {
      if (resultadosGravados.current.has(registro.id)) continue;
      resultadosGravados.current.add(registro.id);
      gravarRegistro(registro.loja_id, "consultoria", registro.chave, dados, registro.status);
    }
  }, [maduro, cons.registros, cons.disponivel, cons.carregando, consultoriasTodas, propostasTodas, ideiasTodas, hoje, sede.pronto]);
  const cheiasNovas = useMemo(() => Object.fromEntries(consultoriasTodas.filter((c) => c.cheia).map((c) => [salaNova(c.sala), true])), [consultoriasTodas]);
  // arquivos que o consultor entrega (backup de 15 em 15 dias) — gera só no clique
  const backup = useBackup(onToast);
  // relatórios exportáveis (montados só no clique)
  const relCtx = useMemo(() => {
    const nomeDe = (k) => (String(k).startsWith("p:") ? (cat.produtos || []).find((x) => x.id === k.slice(2))?.nome : (cat.kits || []).find((x) => x.id === String(k).slice(2))?.nome);
    return { pedidos: cres?.pedidosValidos || [], anuncioDoPedido: cres?.anuncioDoPedido, linhasAds: cres?.linhasAds, lancamentos, produtos: cat.produtos || [], kits: cat.kits || [], precos: cat.precos || [], canais: cat.canais || [], registros: cons.registros, ideias, nomes, funcoes: Object.fromEntries(ELENCO.map((e) => [e.id, e.funcao])), nomeDe };
  }, [cres?.pedidosValidos, cres?.anuncioDoPedido, cres?.linhasAds, lancamentos, cat.produtos, cat.kits, cat.precos, cat.canais, cons.registros, ideias, nomes]);
  const relatorios = useRelatorios({ ctx: relCtx, nomeLoja, onToast });
  // ---------- equipe: estrelas, níveis, promoções (etapa C) ----------
  const [equipe, setEquipe] = usePreferencia("sede:equipe", {});
  const reagirRef = useRef(null);
  // ---------- nota por setor (etapa D, v68): ao vivo + histórico semanal ----------
  const notasH = useSedeNotas();
  const notas = useMemo(
    () => notasDaSemana({ hoje, lancamentos, saldoCaixa: sede.kpis?.caixa ?? null, bom: sede.kpis?.bomDia || null, porSala: av.porSala, pedidos: cres?.pedidosValidos || [], linhasAds: cres?.linhasAds, cheias: cheiasNovas, estoqueRepor: sede.kpis?.estoque ? sede.kpis.estoque.repor || [] : null }),
    [hoje, lancamentos, sede.kpis, av.porSala, cres?.pedidosValidos, cres?.linhasAds, cheiasNovas]
  );
  const notaDe = (k) => {
    const n = notas.setores[k];
    return n ? { ...n, ...comparaSemana(notasH.historico, k, notas.semana, n.nota) } : null;
  };
  const notaGravada = useRef(0);
  useEffect(() => {
    if (!maduro || !lojaId || !sede.pronto || carregandoCaixa || notasH.carregando || !notasH.disponivel) return;
    const atual = Object.fromEntries((notasH.historico || []).filter((h) => h.semana === notas.semana).map((h) => [h.setor, Number(h.nota)]));
    const mudou = Object.entries(notas.setores).some(([k, x]) => x.nota != null && (atual[k] == null || Math.abs(atual[k] - x.nota) >= 0.05));
    if (!mudou || Date.now() - notaGravada.current < 10 * 60000) return;
    notaGravada.current = Date.now();
    gravarNotasDaSemana(lojaId, notas.semana, notas.setores);
  }, [maduro, lojaId, sede.pronto, carregandoCaixa, notasH, notas]);
  const est = useMemo(() => estrelasDaEquipe(cons.registros), [cons.registros]);
  const destaque = useMemo(() => {
    const d = destaqueDaSemana(est, hoje);
    return d ? { ...d, nome: nomes[d.id] || d.id } : null;
  }, [est, hoje, nomes]);
  const idsEquipe = ELENCO.filter((e) => !e.tipo && !FORA_DA_ESCADA.has(e.id) && !ocultos.has(e.id)).map((e) => e.id);
  const prontos = prontosPraPromocao(idsEquipe, est, equipe, hoje);
  const aprovarPromocao = (x) => {
    setEquipe(promover(equipe, x.id, x.nivel, hoje));
    reagirRef.current?.("promocao", { id: x.id, nivel: x.para }, `🎖️ ${nomes[x.id]} promovid${["bia", "celia", "lia", "nina", "duda"].includes(x.id) ? "a" : "o"} a ${x.para}`);
  };
  const nConsultor = consultorias.length + propostas.length + ideias.length + (backup.estado.vencido ? 1 : 0) + relatorios.devidos.length;

  // ---------- motor (canvas) ----------
  const canvasRef = useRef(null);
  const camadaRef = useRef(null);
  const motor = useRef(null);
  const [sel, setSel] = useState({ sala: "diretoria" });
  const [painelTela, setPainelTela] = useState(false);
  // salas abertas pelo que a loja tem (automático) + nomes das salas (✎ Nomes)
  const estoque = useEstoque();
  const fechadas = useMemo(() => salasDaLoja({ impressoras: cat.impressoras, produtos: cat.produtos, canais: cat.canais, lives, fornecedores: estoque.fornecedores, compras: estoque.compras }), [cat.impressoras, cat.produtos, cat.canais, lives, estoque.fornecedores, estoque.compras]);
  const partes = useMemo(() => partesDaLoja({ impressoras: cat.impressoras, produtos: cat.produtos, fornecedores: estoque.fornecedores, compras: estoque.compras }), [cat.impressoras, cat.produtos, estoque.fornecedores, estoque.compras]);
  const nomesSalas = nomesDasSalas(salvos);
  const loja = (lojas || []).find((l) => l.id === lojaId);
  const chaveMotor = `${ehOhra(nomeLoja) ? "ohra" : "outra"}|${partes.impressoras}|${partes.revenda}|${ELENCO.map((e) => nomes[e.id]).join(",")}|${[...ocultos].sort().join(",")}|${Object.keys(fechadas).sort().join(",")}|${Object.values(nomesSalas).join(",")}|${nomeLoja}|${loja?.icone_url || ""}`;
  const [zoomSala, setZoomSala] = useState(null);
  const aoConversar = useRef(null);
  const aoMomento = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !camadaRef.current) return undefined;
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const m = criarSede({
      canvas: canvasRef.current,
      camada: camadaRef.current,
      personagens: { estilo: chaveMotor.split("|")[0], nomes, ocultos, letra: String(nomeLoja).trim().charAt(0), nomeLoja, logoUrl: loja?.icone_url || null },
      salas: { fechadas, nomes: nomesSalas },
      partes,
      onConversa: (c) => aoConversar.current?.(c),
      onMomento: (mo) => aoMomento.current?.(mo),
      onAta: () => {
        setSel({ sala: "reuniao" });
        setPainelTela(true);
      },
      onZoom: setZoomSala,
      reduzir,
      onSala: (k) => {
        setSel(k === "gg" ? { consultor: true } : { sala: k });
        setPainelTela(true);
      },
    });
    motor.current = m;
    return () => {
      m.destruir();
      motor.current = null;
    };
    // nomes/impressoras já estão na chaveMotor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveMotor]);
  useEffect(() => motor.current?.ativo(ativo), [ativo, chaveMotor]);
  // sala que abriu com a Sede aberta (cadastrou a 1ª impressora, criou a 1ª live…) → inauguração
  const fechadasAntes = useRef(null);
  const prontoSalas = !cat.carregando && !carregandoLives;
  useEffect(() => {
    if (!prontoSalas) return;
    const antes = fechadasAntes.current;
    fechadasAntes.current = fechadas;
    if (!antes) return;
    for (const k of Object.keys(antes)) if (!fechadas[k]) setTimeout(() => motor.current?.evento("salaAberta", { k }), 600);
  }, [fechadas, prontoSalas]);
  // quadro RECORDE da Diretoria: o melhor mês fechado de faturamento (pedidos importados) × este mês
  const recorde = useMemo(() => {
    const porMes = {};
    for (const l of cres?.pedidosValidos || []) {
      const m = String(l.data || "").slice(0, 7);
      if (m) porMes[m] = (porMes[m] || 0) + (Number(l.pago) || 0);
    }
    const mesAtual = hoje.slice(0, 7);
    const fechados = Object.entries(porMes).filter(([m]) => m < mesAtual).sort((a, b) => b[1] - a[1]);
    if (!fechados.length) return null;
    const [m, v] = fechados[0];
    return { valor: BRL(v), mes: `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`, pct: `${Math.round(((porMes[mesAtual] || 0) / v) * 100)}%`, frac: (porMes[mesAtual] || 0) / v };
  }, [cres?.pedidosValidos, hoje]);
  // agenda viva: novidade do consultor dos últimos 7 dias vira treinamento às 14h
  const novidade = useMemo(() => novidadeRecente(NOVIDADES_CONSULTOR, hoje), [hoje]);
  // decoração da época: árvore de Natal em dezembro ou com produto de Natal na temporada
  const epoca = useMemo(() => {
    if (hoje.slice(5, 7) === "12") return "natal";
    const natal = (cat.produtos || []).some((p) => {
      const q = p.escada_config?.quandoVende;
      if (!q || !(q.datas || []).includes("natal")) return false;
      const i = infoSazonal(q, calLoja, hoje);
      return i && i.chave === "natal" && (i.fase === "subindo" || i.fase === "pico");
    });
    return natal ? "natal" : null;
  }, [cat.produtos, calLoja, hoje]);
  useEffect(() => {
    motor.current?.dados({ luz: av.luz, porPessoa: av.porPessoa, live, pendentes: nConsultor, cheiasNovas, conversasNovas: propostas, recorde, epoca, agenda: { bom: sede.kpis?.bomDia || null, top3: sede.kpis?.top3 || [], metaPct: sede.kpis?.metaPct || 0, novidade }, estrelas: Object.fromEntries(Object.entries(est).map(([id, x]) => [id, x.estrelas])), destaque });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [av, live, chaveMotor, nConsultor, cheiasNovas, recorde, epoca, novidade, sede.kpis, est, destaque, JSON.stringify(propostas.map((p) => p.chave))]);

  // ---------- "Acontecendo agora" e reações ao vivo ----------
  const [feed, setFeed] = useState(() => [{ hora: agoraHora(), txt: `👋 ${nomes.ceo1} e ${nomes.ceo2} chegaram na Sede` }]);
  const noFeed = (txt) => setFeed((f) => [{ hora: agoraHora(), txt }, ...f].slice(0, 8));
  useEffect(() => {
    aoMomento.current = (mo) => noFeed(`🕘 ${mo.titulo}`);
    aoConversar.current = (c) => noFeed(`💬 ${nomes[c.de] || c.de} → ${nomes[c.para] || c.para}: “${c.fala}” — “${c.resposta}”`);
  });
  const visto = useRef({});
  const reagir = (tipo, info, txt) => {
    motor.current?.evento(tipo, info);
    noFeed(txt);
  };
  reagirRef.current = reagir;
  // produto novo
  useEffect(() => {
    if (cat.carregando) return;
    const ids = new Set((cat.produtos || []).map((p) => p.id));
    const antes = visto.current.produtos;
    visto.current.produtos = ids;
    if (!antes) return;
    const novo = (cat.produtos || []).find((p) => !antes.has(p.id));
    if (novo) reagir("produto", { nome: novo.nome }, `🎁 Produto novo cadastrado: ${novo.nome}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.produtos, cat.carregando]);
  // pedidos importados
  const nPedidos = useMemo(() => new Set((ped.pedidos || []).filter(ehValido).map((l) => l.pedido)).size, [ped.pedidos]);
  useEffect(() => {
    if (ped.carregando) return;
    const antes = visto.current.pedidos;
    visto.current.pedidos = nPedidos;
    if (antes == null || nPedidos <= antes) return;
    reagir("pedidos", { n: nPedidos - antes }, `📦 ${nPedidos - antes} pedido${nPedidos - antes === 1 ? "" : "s"} importado${nPedidos - antes === 1 ? "" : "s"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nPedidos, ped.carregando]);
  // arquivo importado (Desempenho, Ads, GMV, extrato…) → Zé entrega só pra quem usa
  const ultImport = useMemo(() => {
    const l = (ped.importacoes || []).filter((i) => i.ok && !String(i.relatorio || "").startsWith("pedidos"));
    return l.length ? l.reduce((a, b) => (String(a.criado_em) > String(b.criado_em) ? a : b)) : null;
  }, [ped.importacoes]);
  useEffect(() => {
    if (ped.carregando) return;
    const id = ultImport?.id || null;
    const antes = visto.current.importacao;
    visto.current.importacao = id;
    if (antes === undefined || !id || id === antes) return;
    reagir("arquivo", { relatorio: ultImport.relatorio }, `📬 Arquivo importado: ${nomeDoArquivo(ultImport.relatorio)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultImport, ped.carregando]);
  // live começando / acabando
  useEffect(() => {
    if (carregandoLives) return;
    const antes = visto.current.live;
    visto.current.live = live;
    if (antes == null || antes === live) return;
    noFeed(live ? `🔴 Live começando — ${nomes.ceo2} no estúdio` : "⏹ Live encerrada");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, carregandoLives]);
  // Ads ligado
  const nomeDoItem = (tipo, id) => {
    if (tipo === "loja") return "GMV Max da Loja";
    const l = tipo === "kit" ? cat.kits : cat.produtos;
    return (l || []).find((x) => x.id === id)?.nome || "um anúncio";
  };
  useEffect(() => {
    if (carregandoAds) return;
    const ids = new Set(adsLigados.map((p) => p.id));
    const antes = visto.current.ads;
    visto.current.ads = ids;
    if (!antes) return;
    const novo = adsLigados.find((p) => !antes.has(p.id));
    if (novo) {
      const nome = nomeDoItem(novo.item_tipo, novo.item_id);
      reagir("ads", { nome }, `📣 Ads ligado: ${nome}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsLigados, carregandoAds]);
  // conta paga
  useEffect(() => {
    if (carregandoCaixa) return;
    const pagas = new Map((lancamentos || []).filter((l) => l.tipo === "saida" && l.data_realizada).map((l) => [l.id, l]));
    const antes = visto.current.pagas;
    visto.current.pagas = pagas;
    if (!antes) return;
    const nova = [...pagas.values()].find((l) => !antes.has(l.id));
    if (nova) reagir("pago", null, `✅ Conta paga: ${nova.descricao || "saída"} ${BRL(Number(nova.valor) || 0)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lancamentos, carregandoCaixa]);
  // meta batida
  const metaBatida = (sede.kpis?.metaPct || 0) >= 1;
  useEffect(() => {
    const antes = visto.current.meta;
    visto.current.meta = metaBatida;
    if (antes === false && metaBatida) reagir("meta", null, `🎉 Meta do mês batida! ${BRL(sede.kpis?.meta || 0)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaBatida]);

  // ---------- desde a última visita (neste aparelho) ----------
  const [boas, setBoas] = useState(null);
  useEffect(() => {
    if (boas || cat.carregando || ped.carregando || !sede.pronto || !lojaId) return;
    const v = lerVisita(lojaId);
    const nProd = (cat.produtos || []).length;
    const partes = [];
    if (v) {
      if (nProd > v.produtos) partes.push(`${nProd - v.produtos} produto${nProd - v.produtos === 1 ? "" : "s"} novo${nProd - v.produtos === 1 ? "" : "s"}`);
      if (nPedidos > v.pedidos) partes.push(`${nPedidos - v.pedidos} pedido${nPedidos - v.pedidos === 1 ? "" : "s"} importado${nPedidos - v.pedidos === 1 ? "" : "s"}`);
    }
    const decidir = av.porSala.diretoria.length;
    if (decidir) partes.push(`${decidir} decis${decidir === 1 ? "ão esperando" : "ões esperando"} vocês na Diretoria`);
    setBoas({ titulo: `${saudacao()}, ${nomes.ceo1} e ${nomes.ceo2}!`, texto: partes.length ? `${v ? "Desde a última visita: " : ""}${partes.join(", ")}.` : "Tudo em dia por aqui." });
    gravarVisita(lojaId, { em: hoje, produtos: nProd, pedidos: nPedidos });
  }, [boas, cat.carregando, cat.produtos, ped.carregando, sede.pronto, lojaId, nPedidos, av, nomes, hoje]);
  useEffect(() => {
    if (!boas) return undefined;
    const t = setTimeout(() => setBoas((b) => (b ? { ...b, saindo: true } : b)), 9000);
    return () => clearTimeout(t);
  }, [boas]);

  // ---------- clique ----------
  function clicar(e) {
    const b = e.currentTarget.getBoundingClientRect();
    // girada 90° (horário): o eixo x da cena desce na tela e o y vai pra esquerda
    const fx = girado ? (e.clientY - b.top) / b.height : (e.clientX - b.left) / b.width;
    const fy = girado ? (b.right - e.clientX) / b.width : (e.clientY - b.top) / b.height;
    const q = motor.current?.quemEsta(fx, fy);
    if (!q) return;
    if (q.consultor) setSel({ consultor: true });
    else if (q.nome) setSel({ pessoa: q });
    else if (q.sala) {
      // clicar numa sala = entrar nela (zoom); clicar de novo na mesma não muda
      if (motor.current?.sala() !== q.sala) motor.current?.zoom(q.sala);
      setSel(q.sala === "gg" ? { consultor: true } : { sala: q.sala });
    }
    setPainelTela(true);
  }
  const abrir = (p) => {
    if (!p.ir?.aba) return;
    if (tela) onSairTela?.();
    marcarVoltaSede();
    if (p.ir.pedido) irParaAba(p.ir.aba, p.ir.pedido);
    else onIrPara?.(p.ir.aba);
  };

  // ---------- tela cheia ----------
  // Manual: botão (pede tela cheia do navegador junto); sai pelo botão, Esc ou
  // quando o navegador sai da tela cheia. Descanso: sai ao primeiro movimento.
  // Só sai da tela cheia do navegador se foi a Sede que entrou nela (se o
  // navegador já estava em tela cheia antes, continua).
  const pediuTela = useRef(false);
  // Celular = "modo jogo": tela cheia do navegador (com o prefixo webkit) e
  // tenta deitar a tela (Android). Onde o navegador não deixa (iPhone), a Sede
  // cobre a página e, com o celular em pé, gira a cena pra ocupar a tela toda.
  const pedirTelaNavegador = () => {
    const el = document.documentElement;
    const pedir = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement || !pedir) return;
    try {
      Promise.resolve(pedir.call(el, { navigationUI: "hide" }))
        .then(() => {
          pediuTela.current = true;
          if (window.matchMedia("(pointer: coarse)").matches) screen.orientation?.lock?.("landscape").catch(() => {});
        })
        .catch(() => {});
    } catch {
      /* navegador sem tela cheia */
    }
  };
  const entrarTela = () => {
    pedirTelaNavegador();
    pedirTelaSede("manual");
  };
  const sairTela = () => {
    if (pediuTela.current && (document.fullscreenElement || document.webkitFullscreenElement)) {
      try {
        screen.orientation?.unlock?.();
      } catch {
        /* sem trava */
      }
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    }
    pediuTela.current = false;
    setPainelTela(false);
    onSairTela?.();
  };
  // celular em pé com a Sede em tela cheia → gira a cena 90° (como um jogo deitado)
  const [emPe, setEmPe] = useState(() => typeof window !== "undefined" && window.matchMedia("(orientation: portrait) and (max-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (max-width: 900px)");
    const f = () => setEmPe(mq.matches);
    mq.addEventListener?.("change", f);
    return () => mq.removeEventListener?.("change", f);
  }, []);
  const girado = !!tela && emPe;
  const sairTelaRef = useRef(sairTela);
  useEffect(() => {
    sairTelaRef.current = sairTela;
  });
  useEffect(() => {
    if (!tela) return undefined;
    // descanso: tenta a tela cheia do navegador também (o navegador só deixa
    // se ainda valer o último clique; se não deixar, a Sede cobre a página)
    if (tela === "descanso") pedirTelaNavegador();
    const sair = () => sairTelaRef.current();
    const tecla = (e) => {
      if (e.key !== "Escape") return;
      // com zoom numa sala, o Esc volta pra Sede inteira antes de sair da tela cheia
      if (motor.current?.sala()) motor.current.zoom(null);
      else sair();
    };
    const fs = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement && tela === "manual" && pediuTela.current) sair();
    };
    let tirar = () => {};
    // descanso: espera 1 s antes de ouvir (o mesmo movimento que abriu não fecha)
    const t =
      tela === "descanso"
        ? setTimeout(() => {
            const ev = ["mousemove", "keydown", "pointerdown", "touchstart", "wheel"];
            ev.forEach((n) => window.addEventListener(n, sair, { passive: true }));
            tirar = () => ev.forEach((n) => window.removeEventListener(n, sair));
          }, 1000)
        : null;
    window.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", fs);
    document.addEventListener("webkitfullscreenchange", fs);
    return () => {
      document.removeEventListener("webkitfullscreenchange", fs);
      clearTimeout(t);
      tirar();
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", fs);
    };
  }, [tela]);

  // ---------- nomes ----------
  const [editando, setEditando] = useState(null);
  const padrao = nomesPadrao(nomeLoja);

  const k = sede.kpis;
  const nDecidir = av.porSala.diretoria.length;
  const quemNaSala = (s) => {
    const ids = s === "live" ? ["ceo2"] : s === "reuniao" ? [] : ELENCO.filter((e) => e.sala === s && !ocultos.has(e.id)).map((e) => e.id);
    return ids.map((id) => `${nomes[id]} (${ELENCO.find((e) => e.id === id).funcao})`).join(" · ");
  };

  return (
    <div className={`sede${tela ? " sede-tela-cheia" : ""}${girado ? " sede-girada" : ""}`}>
      <div className="sede-topo">
        {tela === "descanso" ? (
          <span className="sede-dica-tela">mexa o mouse ou toque pra voltar</span>
        ) : tela ? (
          <button type="button" className="btn btn-sm" onClick={sairTela}>
            ✕ Sair da tela cheia <small>(Esc)</small>
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => onIrPara?.("inicio")}>
            ← Sair da Sede
          </button>
        )}
        <b className="sede-titulo">Sede da {nomeLoja}</b>
        <div className="sede-kpis">
          <span>
            Vendas do mês <b>{k?.temPedidos ? BRL(k.vendas) : "—"}</b>
          </span>
          <span>
            Lucro depois do Ads <b>{k?.temPedidos ? BRL(k.depoisAds) : "—"}</b>
          </span>
          <span>
            Caixa <b>{k?.caixa != null ? BRL(k.caixa) : "—"}</b>
          </span>
          <span>
            Pra decidir <b className={nDecidir ? "sede-ruim" : ""}>{nDecidir}</b>
          </span>
          <button
            type="button"
            className={`btn btn-sm${nConsultor ? " primary" : ""}`}
            onClick={() => {
              setSel({ consultor: true });
              setPainelTela(true);
            }}
          >
            🤓 {nomes.consultor || "Consultor"}
            {nConsultor > 0 ? ` (${nConsultor})` : ""}
          </button>
          {!tela && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setEditando(editando ? null : { ...nomes, _ocultos: [...ocultos], _salas: { ...nomesSalas } })}>
                ✎ Nomes
              </button>
              <button type="button" className="btn btn-sm" onClick={entrarTela} title="Abrir a Sede na tela inteira">
                ⛶ Tela cheia
              </button>
            </>
          )}
        </div>
      </div>

      {editando && !tela && (
        <div className="panel sede-nomes">
          <h3>Quem trabalha na Sede — só aqui na Sede</h3>
          <div className="sede-nomes-grade">
            {ELENCO.map((e) => {
              const aparece = !(editando._ocultos || []).includes(e.id);
              return (
                <div key={e.id} className={`field sede-nome${aparece ? "" : " desligado"}`}>
                  <span>{e.tipo === "bicho" ? `Bicho · ${e.funcao}` : e.funcao}</span>
                  <div className="sede-nome-linha">
                    <input
                      value={editando[e.id] ?? ""}
                      maxLength={18}
                      placeholder={padrao[e.id]}
                      aria-label={`Nome: ${e.funcao}`}
                      onChange={(ev) => setEditando((x) => ({ ...x, [e.id]: ev.target.value }))}
                    />
                    <label className="sede-nome-liga" title={aparece ? "Aparece na Sede" : "Não aparece na Sede"}>
                      <input
                        type="checkbox"
                        checked={aparece}
                        onChange={(ev) =>
                          setEditando((x) => {
                            const ocs = new Set(x._ocultos || []);
                            if (ev.target.checked) ocs.delete(e.id);
                            else ocs.add(e.id);
                            return { ...x, _ocultos: [...ocs] };
                          })
                        }
                      />
                      {aparece ? "aparece" : "desligado"}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <h3>Salas — nome que aparece na placa</h3>
          <div className="sede-nomes-grade">
            {SALAS_SEDE.map((sl) => (
              <div key={sl.k} className="field sede-nome">
                <span>
                  {sl.nome}
                  {fechadas[sl.k] ? " · 🔒 fechada (abre sozinha)" : ""}
                </span>
                <input
                  value={editando._salas?.[sl.k] ?? ""}
                  maxLength={22}
                  placeholder={sl.nome}
                  aria-label={`Nome da sala ${sl.nome}`}
                  onChange={(ev) => setEditando((x) => ({ ...x, _salas: { ...(x._salas || {}), [sl.k]: ev.target.value } }))}
                />
              </div>
            ))}
          </div>
          <div className="sede-nomes-acoes">
            <button
              type="button"
              className="btn primary btn-sm"
              onClick={() => {
                const salasNovas = {};
                for (const sl of SALAS_SEDE) {
                  const v = String(editando._salas?.[sl.k] ?? "").trim();
                  if (v && v !== sl.nome) salasNovas[sl.k] = v;
                }
                const out = { _ocultos: editando._ocultos || [], ...(Object.keys(salasNovas).length ? { _salas: salasNovas } : {}) };
                for (const e of ELENCO) {
                  const v = String(editando[e.id] ?? "").trim();
                  if (v && v !== (padrao[e.id] || "")) out[e.id] = v;
                }
                setSalvos(out);
                setEditando(null);
              }}
            >
              Salvar nomes
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditando({ ...padrao, _ocultos: [...ocultosDaLoja(nomeLoja, null)], _salas: Object.fromEntries(SALAS_SEDE.map((sl) => [sl.k, sl.nome])) })}>
              Voltar ao padrão
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditando(null)}>
              Cancelar
            </button>
            <span className="hint">Vale só pra esta loja. Os nomes não mudam nada fora da Sede.</span>
          </div>
        </div>
      )}

      <div className={`sede-grade${sel.consultor ? " com-consultor" : ""}`}>
        <div>
          <div className="sede-cena">
            <canvas ref={canvasRef} onClick={clicar} style={{ aspectRatio: `${TAMANHO_SEDE.largura} / ${TAMANHO_SEDE.altura}` }} aria-label={`Sede da ${nomeLoja}: escritório animado`} />
            <div ref={camadaRef} className="sede-camada" />
            {zoomSala && (
              <button type="button" className="btn btn-sm sede-voltar-zoom" onClick={() => motor.current?.zoom(null)}>
                ← Voltar pra Sede <small>(Esc)</small>
              </button>
            )}
            {boas && (
              <div className={`sede-boas ${boas.saindo ? "saindo" : ""}`} onClick={() => setBoas((b) => ({ ...b, saindo: true }))}>
                <b>{boas.titulo}</b>
                {boas.texto}
              </div>
            )}
          </div>
          <div className={`sede-agora${tela ? " sede-agora-flutua" : ""}`}>
            <b>Acontecendo agora</b>
            <ul>
              {(tela ? feed.slice(0, 3) : feed).map((f, i) => (
                <li key={`${f.hora}-${i}`}>
                  <span>{f.hora}</span>
                  {f.txt}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {(!tela || painelTela) && (
        <aside className="panel sede-painel">
          {tela && (
            <button type="button" className="btn btn-sm sede-painel-fechar" onClick={() => setPainelTela(false)} aria-label="Fechar">
              ✕
            </button>
          )}
          {sel.consultor ? (
            <ConsultorPainel
              nome={nomes.consultor || "Consultor"}
              lojaId={lojaId}
              nomeLoja={nomeLoja}
              ctx={ctxConsultor}
              atuais={atuaisConsultor}
              registros={cons.registros}
              disponivel={cons.disponivel}
              consultorias={consultorias}
              propostas={propostas}
              ideias={ideias}
              backup={backup}
              relatorios={relatorios}
              nomes={nomes}
              abrir={abrir}
              onToast={onToast}
              telaAtual="sede"
            />
          ) : sel.pessoa ? (
            <PainelPessoa q={sel.pessoa} nomes={nomes} av={av} pendencias={sede.pendencias} abrir={abrir} est={est} equipe={equipe} destaque={destaque} />
          ) : (
            <PainelSala
              reuniao={{
                ata: ataDoBomDia({ bom: sede.kpis?.bomDia, top3: sede.kpis?.top3 || [], data: hoje }),
                novidade,
                pauta: sede.kpis?.top3 || [],
                opinioes: opinioesDosGerentes(av.porSala, Object.fromEntries(SETORES_NOTA.map((x) => [x.k, notas.setores[x.k]?.nota ?? null]))),
                notas: SETORES_NOTA.map((x) => ({ ...x, ...notaDe(x.k) })),
                semNotasSql: !notasH.disponivel,
                ideias,
                decidir: consultorias.length + propostas.length + ideias.length,
                prontos,
                ranking: rankingDoPeriodo(est, `${hoje.slice(0, 7)}-01`, hoje),
                chamar: () => {
                  motor.current?.reuniaoAgora();
                  motor.current?.zoom("reuniao");
                },
                ataPdf: () => relatorios.gerar("semana", periodoPadrao("semana", hoje)),
                abrirConsultor: () => setSel({ consultor: true }),
                aprovar: aprovarPromocao,
                depois: (x) => setEquipe(adiarPromocao(equipe, x.id, hoje)),
              }}
              nomes={nomes}
              nota={notaDe(sel.sala)}
              semNotasSql={!notasH.disponivel}
              k={sel.sala} nome={nomesSalas[sel.sala]} fechada={fechadas[sel.sala]} quem={fechadas[sel.sala] ? null : quemNaSala(sel.sala)} avisos={av.porSala[sel.sala] || []} abrir={abrir} onIrPara={onIrPara} estoque={estoque.linhas} />
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            Clique nas placas, nas salas e nas pessoas. A Sede só mostra — pra mudar algo, use o botão que leva pra tela certa.
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

function ListaAvisos({ avisos, abrir }) {
  if (!avisos.length) return <div className="sede-ok">✓ Tudo em dia por aqui</div>;
  return (
    <ul className="sede-avisos">
      {avisos.slice(0, 8).map((p) => (
        <li key={p.id}>
          <Estado tipo={ESTADO[p.grupo] || "atencao"}>{p.grupo === "resolver" ? "resolver" : p.grupo === "oportunidade" ? "oportunidade" : "atenção"}</Estado>
          <b>{p.titulo}</b>
          {p.texto && <div className="sede-aviso-txt">{p.texto}</div>}
          {p.ir?.aba && (
            <button type="button" className="btn btn-sm" onClick={() => abrir(p)}>
              {p.rotulo || "Abrir"} →
            </button>
          )}
        </li>
      ))}
      {avisos.length > 8 && <li className="hint">+ {avisos.length - 8} no Início</li>}
    </ul>
  );
}

function PainelSala({ k, nome, fechada, quem, avisos, abrir, onIrPara, estoque, reuniao, nomes, nota, semNotasSql }) {
  const s = SALAS_SEDE.find((x) => x.k === k);
  if (!s) return null;
  if (fechada)
    return (
      <>
        <h3>🔒 {nome || s.nome}</h3>
        <div className="sede-quem">sala fechada · em breve</div>
        <div className="sede-ok">Ainda não tem trabalho aqui: {fechada}. A sala abre sozinha (com festa) quando isso existir na loja.</div>
        {k === "revenda" && s.aba && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onIrPara?.(s.aba)}>
            Importar a 1ª nota (Estoque e compras) →
          </button>
        )}
      </>
    );
  return (
    <>
      <h3>{nome || s.nome}</h3>
      {quem && <div className="sede-quem">{quem}</div>}
      {k === "operacao" && (estoque || []).length > 0 && <ResumoEstoque linhas={estoque || []} />}
      {nota && <NotaSetor n={nota} semSql={semNotasSql} />}
      {k === "reuniao" && <SalaReuniao r={reuniao} nomes={nomes} />}
      <ListaAvisos avisos={avisos} abrir={abrir} />
      {k === "diretoria" && <div className="hint">Na Diretoria ficam os avisos urgentes de todas as salas — só vocês decidem.</div>}
      {s.aba && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onIrPara?.(s.aba)}>
          {s.rotulo} →
        </button>
      )}
    </>
  );
}

// Nota da semana do setor (etapa D): a nota e de onde ela vem — "sem falso 100%".
function NotaSetor({ n, semSql }) {
  return (
    <div className="sede-nota">
      <div className="sede-nota-topo">
        <span className="sede-nota-num">{notaTexto(n.nota)}</span>
        <span>
          nota da semana
          {n.seta && (
            <span className={`sede-seta ${n.seta === "↑" ? "sobe" : n.seta === "↓" ? "desce" : ""}`}>
              {" "}
              · {n.seta} {notaTexto(n.anterior)} na semana passada
            </span>
          )}
        </span>
      </div>
      {n.partes.map((p) => (
        <div key={p.k} className="sede-nota-parte">
          <span>{p.nota == null ? "—" : notaTexto(p.nota)}</span>
          <b>{p.nome}</b> <small>({Math.round(p.peso * 100)}%)</small> — {p.texto}
        </div>
      ))}
      {semSql && <div className="hint">Rode o SQL v68 pra guardar a nota de cada semana.</div>}
    </div>
  );
}

// Sala de reunião (etapa C): pauta (as 3 que mais valem dinheiro), opinião dos gerentes, ideias dos
// analistas, decisões pra vocês, promoções prontas, ranking do mês, agenda do dia e a ata.
function SalaReuniao({ r, nomes }) {
  if (!r) return null;
  const fem = (id) => ["bia", "celia", "lia", "nina", "duda", "ceo2"].includes(id);
  return (
    <div className="sede-reuniao">
      <div className="sede-reuniao-acoes">
        <button type="button" className="btn btn-sm" onClick={r.chamar}>
          📣 Chamar reunião agora
        </button>
        <button type="button" className="btn btn-sm" onClick={r.ataPdf}>
          Baixar a ata da semana (PDF)
        </button>
      </div>
      <div className="sede-reuniao-bloco">
        <div className="sede-ata-sub">Pauta — as que mais valem dinheiro</div>
        {r.pauta.length ? (
          <ol>
            {r.pauta.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ) : (
          <div className="hint">Nada pesando hoje ✓</div>
        )}
      </div>
      <div className="sede-reuniao-bloco">
        <div className="sede-ata-sub">Opinião dos gerentes</div>
        {r.opinioes.map((o) => (
          <div key={o.id} className={`sede-opiniao ${o.grupo || "ok"}`}>
            <b>{nomes[o.id]}</b>
            {o.nota != null && <span className="sede-nota-mini">nota {notaTexto(o.nota)}</span>} “{o.texto}”
          </div>
        ))}
      </div>
      <div className="sede-reuniao-bloco">
        <div className="sede-ata-sub">Nota dos setores — esta semana</div>
        {r.notas.map((n) => (
          <div key={n.k} className="sede-nota-linha">
            <b>{notaTexto(n.nota)}</b> {n.nome}
            {n.seta && (
              <span className={`sede-seta ${n.seta === "↑" ? "sobe" : n.seta === "↓" ? "desce" : ""}`}>
                {" "}
                {n.seta} {notaTexto(n.anterior)} na semana passada
              </span>
            )}
          </div>
        ))}
        {r.semNotasSql && <div className="hint">Rode o SQL v68 pra guardar a nota de cada semana (a seta ↑↓ compara com a semana passada).</div>}
      </div>
      {r.ideias.length > 0 && (
        <div className="sede-reuniao-bloco">
          <div className="sede-ata-sub">Dos analistas</div>
          {r.ideias.map((i) => (
            <div key={i.chave} className="sede-opiniao">
              💡 <b>{nomes[i.de] || i.de}</b> {i.titulo}
            </div>
          ))}
        </div>
      )}
      <div className="sede-reuniao-bloco">
        <div className="sede-ata-sub">Decisões pra vocês</div>
        {r.decidir ? (
          <button type="button" className="btn btn-sm" onClick={r.abrirConsultor}>
            {r.decidir} esperando no Gerente Geral →
          </button>
        ) : (
          <div className="hint">Nenhuma decisão esperando ✓</div>
        )}
      </div>
      {r.prontos.map((x) => (
        <div key={x.id} className="sede-promocao">
          <div>
            🎖️ <b>{nomes[x.id]}</b> está pront{fem(x.id) ? "a" : "o"} pra promoção: {x.de} → <b>{x.para}</b>
          </div>
          <div className="hint">
            ★ {x.est.estrelas} · {x.est.aprovadas} ideia{x.est.aprovadas === 1 ? "" : "s"} aprovada{x.est.aprovadas === 1 ? "" : "s"} · {x.est.deram} deram certo
            {x.est.tentadas ? ` · ${x.est.tentadas} tentada${x.est.tentadas === 1 ? "" : "s"} (não somam, mas mostram que está pensando)` : ""}
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => r.aprovar(x)}>
            Aprovar promoção
          </button>{" "}
          <button type="button" className="btn btn-sm" onClick={() => r.depois(x)}>
            Depois
          </button>
        </div>
      ))}
      <div className="sede-reuniao-bloco">
        <div className="sede-ata-sub">Ranking do mês</div>
        {r.ranking.length ? (
          <ol>
            {r.ranking.slice(0, 5).map((x) => (
              <li key={x.id}>
                {nomes[x.id] || x.id} — ★ {x.pts}
                {x.deram ? ` · ${x.deram} deu certo` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <div className="hint">Ninguém pontuou este mês ainda — as estrelas vêm das ideias e propostas que vocês aprovam (★ +1) e que dão certo (★ +3).</div>
        )}
      </div>
      <AgendaReuniao ata={r.ata} nomes={nomes} novidade={r.novidade} />
    </div>
  );
}

// Sala de reunião: a agenda de hoje (relógio de São Paulo) e a ata do Bom dia (montada na hora).
function AgendaReuniao({ ata, nomes, novidade }) {
  const agora = agoraDaSede();
  const lista = agendaDoDia(agora, { novidade });
  const depoisDas9 = agora.minutos >= 9 * 60 + 20 && agora.dow !== 0 && agora.dow !== 6;
  return (
    <div className="sede-agenda">
      <div className="sede-agenda-lista">
        {lista.length ? (
          lista.map((a) => (
            <div key={a.hora + a.titulo} className={`sede-agenda-item ${a.estado}`}>
              <span>{a.estado === "feito" ? "✓" : a.estado === "agora" ? "●" : "○"}</span>
              <b>{a.hora}</b> {a.titulo}
            </div>
          ))
        ) : (
          <div className="hint">Fim de semana: a equipe descansa. Reunião do Bom dia na segunda às 9h.</div>
        )}
      </div>
      {depoisDas9 && ata && (
        <div className="sede-ata">
          <div className="sede-ata-tit">📝 {ata.titulo}</div>
          <div className="hint">Presentes: {ata.presentes.map((id) => nomes?.[id] || id).join(", ")}</div>
          <ul>
            {ata.ontem.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {ata.prioridades.length > 0 && (
            <>
              <div className="sede-ata-sub">As que mais valem dinheiro hoje</div>
              <ol>
                {ata.prioridades.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </>
          )}
          <div className="hint">Montada com os números de agora (os mesmos do ☀️ Bom dia do Início). Um dia sozinho não decide nada.</div>
        </div>
      )}
    </div>
  );
}

// Sala da Revenda: o estoque de hoje (mesma conta de Estoque e compras — useEstoque).
function ResumoEstoque({ linhas }) {
  const comControle = linhas.filter((l) => !l.est.semControle);
  const valor = comControle.reduce((s, l) => s + l.valor, 0);
  const repor = linhas.filter((l) => ["repor", "zerado", "negativo"].includes(l.sit.tipo)).length;
  const parados = linhas.filter((l) => l.sit.tipo === "parado").length;
  if (!linhas.length) return <div className="sede-ok">Fornecedor ou nota já cadastrados — os produtos de revenda aparecem aqui com o estoque.</div>;
  return (
    <div className="sede-ok">
      {linhas.length} {linhas.length === 1 ? "produto" : "produtos"} com estoque · {BRL(valor)} em estoque
      {repor ? ` · ${repor} pra repor` : ""}
      {parados ? ` · ${parados} parado${parados > 1 ? "s" : ""}` : ""}
      {!comControle.length ? " · o estoque começa na 1ª nota importada" : ""}
    </div>
  );
}

function CartaoEquipe({ q, est, equipe, destaque }) {
  if (q.dono || q.visita) return null;
  const e = est?.[q.id] || { estrelas: 0, ideias: 0, aprovadas: 0, deram: 0, tentadas: 0 };
  const fora = FORA_DA_ESCADA.has(q.id);
  const prox = proximoNivel(q.id, est, equipe);
  return (
    <div className="sede-cartao-equipe">
      <div>
        <b>{fora ? "Gerente Geral" : nomeDoNivel(nivelDe(q.id, equipe))}</b> · ★ {e.estrelas}
        {destaque?.id === q.id && <span className="sede-destaque-tag"> destaque da semana</span>}
      </div>
      <div className="hint">
        {e.ideias} ideia{e.ideias === 1 ? "" : "s"}/proposta{e.ideias === 1 ? "" : "s"} · {e.aprovadas} aprovada{e.aprovadas === 1 ? "" : "s"} · {e.deram} deram certo{e.tentadas ? ` · ${e.tentadas} tentada${e.tentadas === 1 ? "" : "s"}` : ""}
      </div>
      {prox && (
        <div className="hint">
          {prox.pronto ? `Pronto pra ${prox.nome} — aprovem na Sala de reunião` : `Próximo nível: ${prox.nome} — faltam ${prox.faltaEstrelas ? `${prox.faltaEstrelas} ★` : ""}${prox.faltaEstrelas && prox.faltaDeram ? " e " : ""}${prox.faltaDeram ? `${prox.faltaDeram} ideia${prox.faltaDeram === 1 ? "" : "s"} que dê${prox.faltaDeram === 1 ? "" : "em"} certo` : ""}`}
        </div>
      )}
    </div>
  );
}

function PainelPessoa({ q, nomes, av, pendencias, abrir, est, equipe, destaque }) {
  if (q.bicho)
    return (
      <>
        <h3>{q.nome}</h3>
        <div className="sede-quem">{q.funcao} · mascote da Sede</div>
        <div className="sede-ok">Só passeia, ganha carinho e late quando chega coisa boa 🐾</div>
      </>
    );
  const meus = q.dono ? av.porSala.diretoria : (pendencias || []).filter((p) => pessoaDoAviso(p) === q.id);
  return (
    <>
      <h3>
        {nomes[q.id] || q.nome} · {q.funcao}
      </h3>
      <div className="sede-quem">agora: {FAZENDO[q.est] || q.est}</div>
      <CartaoEquipe q={q} est={est} equipe={equipe} destaque={destaque} />
      {q.dono && <div className="sede-quem">Decisões esperando vocês: {meus.length}</div>}
      <ListaAvisos avisos={meus} abrir={abrir} />
    </>
  );
}
