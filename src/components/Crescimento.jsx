import { trocarSubAba, useSubAba } from "../lib/subAbas.js";
import { canalDireto } from "../lib/canais.js";
import { rampaNoCanal } from "../lib/rampaCanal.js";
import { Fragment, useEffect, useMemo, useState } from "react";
import { alertaPreco } from "../lib/estrategia.js";
import { menorFinalComFreteGratis } from "../lib/freteGratis.js";
import FreteAviso from "./FreteAviso.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { comCupomAtivo, cuponsAtivos, textoFaixa } from "../lib/cupomLoja.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { adsNaJanela } from "../lib/ads.js";
import { numerosAds } from "../lib/anuncios.js";

// "2026-10-03" → "03/10" (sem passar por Date, que no fuso do Brasil voltaria um dia).
// Frete grátis (v38) de um preço no canal — aviso único via alertaPreco.
const freteDe = (valor, canal) => (canal && valor > 0 ? alertaPreco({ preco: valor, canal }).frete : null);
// O que o cliente PAGA num degrau: riscado fixo no alvo + promo do degrau
// (mesma conta do "O que digitar", lib/rampaAnuncio.js) — nunca o riscado.
// Com riscado fixo (já anunciado), só a promo muda — mesma conta (anuncioNoRiscado).
const pagaNoDegrau = (d, alvo, desconto, riscadoFixo = null) => (riscadoFixo ? anuncioNoRiscado(d, riscadoFixo) : anuncioFixo(d, alvo, desconto))?.clientePaga ?? d;
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
import { anuncioDaRampa, anuncioDaRampaKit, anuncioFixo, anuncioNoRiscado, riscadoFixoDe } from "../lib/rampaAnuncio.js";
import { descontoDoItem } from "../lib/escada.js";
import { gravarPrecoNovo } from "../lib/estrategia.js";
import { CHECKLIST_ANUNCIO, REGRAS_PADRAO, ajustarDegrausAoAlvo, conhecidosDe, fmtSemana, finalAcima, normalizarDegraus, sugerirDegraus, sugerirDegrausSazonal, zeroAZero } from "../lib/rampa.js";
import { configCalendario, infoSazonal, quandoVendeDe } from "../lib/calendario.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import BuscaItem from "./BuscaItem.jsx";
import GraficoRampa from "./GraficoRampa.jsx";
import Afiliados from "./Afiliados.jsx";
import AdsCrescimento from "./AdsCrescimento.jsx";
import { PeriodoAdsDialog } from "./AdsPeriodoDialogs.jsx";
import { encerrarPeriodoAds, iniciarPeriodoAds } from "../lib/adsAcoes.js";
import OndeSeDecide from "./OndeSeDecide.jsx";
import RampaGrupo from "./RampaGrupo.jsx";
import { useLembrado } from "../hooks/useLembrado.js";
import { iniciarRampaGrupo } from "../lib/grupoRampa.js";
import { acaoDaRampa, proximaConferencia, sinaisDaRampa } from "../lib/rampaAgora.js";
import { AgoraRampa, MarcaAba, OlhandoRampa } from "./RampaAgora.jsx";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { pegarPedido } from "../lib/navegar.js";
import SemanasFonte from "./SemanasFonte.jsx";
import Estado, { PontoSaude } from "./Estado.jsx";
import { saudeRampa } from "../lib/estados.js";
import { useLembretes } from "../hooks/useLembretes.js";
import { PRAZOS_PAUSA, pausaAtiva, pausarRampa, pausasDeRampa, retomarRampa } from "../lib/pausaRampa.js";
import PromoAviso from "./PromoAviso.jsx";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const virgula = (v, casas = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");


function Copiavel({ valor, texto }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="copiavel"
      title="Copiar"
      onClick={() => {
        try {
          navigator.clipboard?.writeText(texto);
        } catch {
          // sem área de transferência — só mostra
        }
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {valor}
      {ok && <span className="salvo-check">✓</span>}
    </button>
  );
}

// Sub-aba (Rampa de preço / Ads / Afiliados) fica no cabeçalho do App (lib/subAbas.js).

export default function Crescimento({ onToast }) {
  const { dados, rampasH, af, regras, hoje, linhas, linhasGrupo, linhasAf, mapaAf, semanaAf, adsH, regrasA, linhasAds, pedidosValidos } = useCrescimento();
  const [sub, setSub] = useSubAba("ohra:crescimento-sub", "rampa", ["rampa", "ads", "afiliados"]);
  const [selId, setSelId] = useState(null); // rampa aberta no Detalhe
  const [adsChave, setAdsChave] = useState(null); // linha do Ads aberta (pedido do Início)

  // Pedidos vindos do Início (lib/navegar.js): sub-aba, rampa e "Registrar agora".
  useEffect(() => {
    const aplicar = (p) => {
      if (!p) return;
      if (p.sub) trocarSubAba("ohra:crescimento-sub", p.sub);
      if (p.rampaId) setSelId(p.rampaId);
      if (p.adsChave) setAdsChave(p.adsChave);
    };
    aplicar(pegarPedido("crescimento"));
    const ouvir = (e) => e.detail.aba === "crescimento" && aplicar(pegarPedido("crescimento"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);



  return (
    <>
      <OndeSeDecide />
      {sub === "rampa" ? (
        <RampaPreco
          dados={dados}
          linhasAds={linhasAds}
          onVerAds={() => setSub("ads")}
          rampasH={rampasH}
          regras={regras}
          linhas={linhas}
          linhasGrupo={linhasGrupo}
          hoje={hoje}
          comissaoSemana={semanaAf.comissaoRampa}
          onToast={onToast}
          selId={selId}
          setSelId={setSelId}
        />
      ) : sub === "ads" ? (
        <AdsCrescimento
          linhasAds={linhasAds}
          adsH={adsH}
          regrasA={regrasA}
          regras={regras}
          hoje={hoje}
          canais={dados.canais}
          onToast={onToast}
          abrirChave={adsChave}
        />
      ) : (
        <Afiliados
          dados={dados}
          af={af}
          rampasH={rampasH}
          regras={regras}
          linhasAf={linhasAf}
          mapaAf={mapaAf}
          semana={semanaAf}
          hoje={hoje}
          onToast={onToast}
          pedidos={pedidosValidos}
          linhasAds={linhasAds}
        />
      )}
    </>
  );
}

function RampaPreco({ dados, linhasAds, onVerAds, rampasH, regras, linhas, linhasGrupo = [], hoje, comissaoSemana, onToast, selId, setSelId }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const { itens, produtos, kits, precos, concorrentes, cfgDoProduto, publicacoesCanal, anunciadoNoCanal, cfgLoja } = dados;
  const { rampas, disponivel, carregando } = rampasH;
  const [iniciar, setIniciar] = useState(null); // {} novo | { rampa } editar degraus
  const [mudar, setMudar] = useState(null); // { linha, dir: 1 | -1 }
  const [ajusteDeg, setAjusteDeg] = useState(null); // linha: ajustar o preço do degrau atual
  const [encerrar, setEncerrar] = useState(null);
  const [descer, setDescer] = useState(null); // entressafra: descer um degrau
  const [busca, setBusca] = useState("");
  // Detalhe do produto (Evolução, portões, checklist…) pode ser minimizado — lembrado no navegador.
  const [detalheRecolhido, setDetalheRecolhido] = useLembrado("ohra:rampa:detalhe-recolhido", "0");
  const [verRegras, setVerRegras] = useState(false);
  const [acimaConfirma, setAcimaConfirma] = useState(null);
  const [alvoAjuste, setAlvoAjuste] = useState(null); // linha com "alvo mudou" esperando confirmação // { tipo: "testar"|"voltar"|"aprovar", linha, preco }
  const [salvando, setSalvando] = useState(false);

  const selEhGrupo = linhasGrupo.some((g) => g.r.id === selId);
  const sel = selEhGrupo ? null : linhas.find((l) => l.r.id === selId) || (selId ? null : linhas[0]) || null;
  const [filtroLista, setFiltroLista] = useState("todos");
  const [abaPedida, setAbaPedida] = useState(null); // botão da linha que abre uma aba do Detalhe
  // As semanas são montadas sozinhas pelas importações (lib/semanasAuto.js):
  // não existe mais "semana pendente".
  const pendDe = () => null;
  const { lembretes } = useLembretes();
  const pausas = useMemo(() => pausasDeRampa(lembretes), [lembretes]);
  // Lista única "Em rampa" (out/2026): produtos + anúncios com vários itens,
  // separada pelo que pedir ação — a ação vem de lib/rampaAgora.js (só lê o
  // que a rampa decidiu). Semana pendente sem outra ação = "Registrar a semana".
  const itensLista = useMemo(() => {
    const um = (l, grupo) => {
      const acao = acaoDaRampa(l.est, { canal: l.canal.nome, grupo, checklist: l.r.checklist || {}, pctDe: grupo ? l.g?.pctDe : null });
      const pend = pendDe(l);
      const doGrupo = !grupo && l.soNoGrupo;
      let secao = doGrupo ? "acomp" : ["resolver", "atencao"].includes(acao.tipo) ? "fazer" : acao.tipo === "oportunidade" ? "subir" : pend ? "fazer" : "acomp";
      // "Não acompanhar por enquanto": sai das seções de ação até vender ou o
      // prazo acabar (lib/pausaRampa.js). Urgente (resolver) continua aparecendo.
      const pausa = doGrupo ? null : pausaAtiva(pausas.get(l.r.id), l.est, hoje);
      if (pausa && acao.tipo !== "resolver") secao = "pausa";
      return { l, grupo, acao, pend, secao, pausa, podePausar: !doGrupo && secao !== "acomp" && acao.tipo !== "resolver", proxima: proximaConferencia(l.est, { pendente: pend }) };
    };
    return [...linhas.map((l) => um(l, false)), ...linhasGrupo.map((l) => um(l, true))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, linhasGrupo, pausas, hoje]);
  const [verPausadas, setVerPausadas] = useState(false);
  async function pausar(x, dias) {
    const r = await pausarRampa({ lojaId, rampaId: x.l.r.id, dias, vendasTotal: x.l.est.vendasTotal, hoje });
    if (!r.ok) return onToast?.(r.msg);
    onToast?.(`${x.l.produto.nome}: sem acompanhar — volta com a próxima venda${dias ? ` ou em ${dias} dias` : ""}`);
  }
  async function retomar(x) {
    const r = await retomarRampa({ lojaId, rampaId: x.l.r.id });
    if (!r.ok) return onToast?.(r.msg);
    onToast?.(`${x.l.produto.nome}: acompanhando de novo`);
  }
  const itensVis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return itensLista.filter((x) => {
      if (filtroLista === "fazer" && x.secao !== "fazer") return false;
      if (filtroLista === "subir" && x.secao !== "subir") return false;
      if (filtroLista === "produtos" && x.grupo) return false;
      if (filtroLista === "grupos" && !x.grupo) return false;
      if (!t) return true;
      const txt = x.grupo ? [x.l.produto.nome, ...(x.l.g?.ops || []).flatMap((o) => [o.rotulo, o.item?.nome, o.item?.sku])] : [x.l.produto.nome, x.l.produto.sku];
      return txt.filter(Boolean).join(" ").toLowerCase().includes(t);
    });
  }, [itensLista, filtroLista, busca]);

  // Preços "vendendo agora" de todos os produtos em rampa (por canal) — os
  // kits de produtos diferentes usam o degrau de cada peça.
  const precosRampa = useMemo(() => {
    const mapa = new Map(linhas.map((l) => [`${l.r.produto_id}|${l.r.canal_id}`, l.est.preco]));
    return precos.map((p) => (p.item_tipo === "produto" && mapa.has(`${p.item_id}|${p.canal_id}`) ? { ...p, preco: mapa.get(`${p.item_id}|${p.canal_id}`) } : p));
  }, [precos, linhas]);

  // O que digitar no canal pro produto selecionado (avulso, variações, kits)
  // — conta compartilhada com a Anunciar e a Ficha (lib/rampaAnuncio.js).
  const anuncio = useMemo(() => {
    if (!sel) return null;
    const { canal, est, cfg, r } = sel;
    // Cupom ativo da loja no canal (Configuração → Regras): lucro de 1 un. com ele.
    const faixas = cuponsAtivos(cfgLoja, canal.id);
    const comCupom = (l) => {
      if (!faixas.length || !(l.clientePaga > 0)) return l;
      const it = itens.find((i) => i.id === l.itemId);
      if (!it) return l;
      const cfgI = l.itemId?.startsWith("k:") ? cfg : cfgDoProduto(it.produtoId || (l.itemId.startsWith("p:") ? l.itemId.slice(2) : null)) || cfg;
      return { ...l, cupom: comCupomAtivo({ canal, preco: l.clientePaga, custo: Number(it.custoTotal) || 0, peso: Number(it.peso) || 0, cfg: cfgI }, faixas) };
    };
    if (sel.ehKit) {
      const rk = anuncioDaRampaKit({ kitItem: sel.item, canal, preco: est.preco, alvo: est.alvo, cfg, itens, produtos, kits, publicacoes: publicacoesCanal });
      return rk ? { ...rk, faixas, linhas: (rk.linhas || []).map(comCupom) } : rk;
    }
    const res = anuncioDaRampa({ produtoId: r.produto_id, canal, preco: est.preco, alvo: est.alvo, cfg, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoes: publicacoesCanal });
    // Lucro do avulso = o da rampa (mesmo custo/taxas ao vivo). Variação não
    // anunciada no canal (2º Por quantidade → Anunciado em) fica de fora.
    const linhasA = res.linhas.filter((l) => l.id === "avulso" || !l.itemId?.startsWith("v:") || anunciadoNoCanal(itens.find((i) => i.id === l.itemId), canal));
    return { ...res, faixas, linhas: linhasA.map((l) => comCupom(l.id === "avulso" ? { ...l, lucro: est.lucroAtual } : l)) };
  }, [sel, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoesCanal, anunciadoNoCanal, cfgLoja]);

  // --- KPIs ---
  const lucroSemana = linhas.reduce((s, l) => s + (l.est.lucroSemana || 0), 0) - (comissaoSemana || 0);
  const lucroSemanaAds = linhas.reduce((s, l) => s + (l.est.lucroSemanaAds ?? l.est.lucroSemana ?? 0), 0) - (comissaoSemana || 0);
  const lucroSemanaAlvo = linhas.reduce((s, l) => s + (l.est.lucroSemanaAlvo || 0), 0);
  const temSemana = linhas.some((l) => l.est.lucroSemana != null);

  async function aplicarMudanca() {
    const { linha, dir } = mudar;
    const { r, est } = linha;
    const novo = Math.max(0, Math.min(est.degraus.length - 1, est.i + dir));
    setSalvando(true);
    const { error } = await supabase
      .from("rampas_preco")
      .update({ degrau_atual: novo, desde: hoje, base_avaliacoes: est.avaliacoesTotal, atualizado_em: new Date().toISOString() })
      .eq("id", r.id);
    if (!error)
      await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: r.id, tipo: dir > 0 ? "subida" : "descida", data: hoje, degrau: novo, preco: est.degraus[novo] });
    setSalvando(false);
    setMudar(null);
    if (error) return onToast?.(`Não foi possível mudar o degrau: ${error.message}`);
    onToast?.(`${linha.produto.nome}: agora vendendo ${BRL(est.degraus[novo])} em ${linha.canal.nome} — atualize o anúncio (preço original e promo abaixo)`);
  }

  // Ajustar o preço do degrau ATUAL sem subir: troca o valor, mantém o índice,
  // `desde` e a base de avaliações (os portões seguem contando) e não gera
  // registro de subida (o check da subida não roda). Degraus intermediários
  // que ficarem ≤ o preço novo saem (seria pular etapa — avisado no diálogo).
  // Histórico em checklist.ajustesDegrau [{ data, de, para }].
  async function ajustarDegrau(novo) {
    const { r, est } = ajusteDeg;
    const de = est.degraus[est.i];
    const ultimo = est.degraus.length - 1;
    const degraus = est.degraus.map(num).filter((d, k) => k <= est.i || k === ultimo || d > novo + 0.004);
    degraus[est.i] = novo;
    // novo = alvo → o degrau atual vira o próprio alvo (sem duplicar)
    const lista = degraus.filter((d, k) => !(k === est.i && k < degraus.length - 1 && Math.abs(d - degraus[degraus.length - 1]) < 0.005));
    const idx = Math.min(est.i, lista.length - 1);
    const ajustes = [...(Array.isArray(r.checklist?.ajustesDegrau) ? r.checklist.ajustesDegrau : []), { data: hoje, de, para: novo }];
    setSalvando(true);
    const { error } = await supabase
      .from("rampas_preco")
      .update({ degraus: lista, degrau_atual: idx, checklist: { ...(r.checklist || {}), ajustesDegrau: ajustes }, atualizado_em: new Date().toISOString() })
      .eq("id", r.id);
    setSalvando(false);
    if (error) return onToast?.(`Não foi possível ajustar: ${error.message}`);
    setAjusteDeg(null);
    window.dispatchEvent(new Event("focus"));
    onToast?.(`${ajusteDeg.produto.nome}: degrau ajustado pra ${BRL(novo)} (não conta como subida) — atualize a promo no anúncio`);
  }

  // Entressafra (rampa sazonal): desce ~8% (nunca abaixo do piso). O preço
  // novo entra na escada; o anúncio continua ativo, só a promo muda.
  async function descerEntressafra() {
    const l = descer;
    const preco = l.est.sazonal?.precoNovo;
    if (!(preco > 0)) return setDescer(null);
    const lista = normalizarDegraus([...l.est.degraus, preco]);
    const idx = lista.findIndex((d) => Math.abs(d - preco) < 0.005);
    setSalvando(true);
    const ok = await atualizarRampa(l, { degraus: lista, degrau_atual: idx, desde: hoje, base_avaliacoes: l.est.avaliacoesTotal });
    if (ok) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo: "descida", data: hoje, degrau: idx, preco, observacao: "entressafra" });
    setSalvando(false);
    setDescer(null);
    if (ok) {
      window.dispatchEvent(new Event("focus"));
      onToast?.(`${l.produto.nome}: agora vendendo ${BRL(preco)} (entressafra) — atualize a promo no anúncio`);
    }
  }

  async function encerrarRampa() {
    const l = encerrar;
    setEncerrar(null);
    const { error } = await supabase.from("rampas_preco").delete().eq("id", l.r.id);
    if (error) return onToast?.(`Não foi possível encerrar: ${error.message}`);
    onToast?.(`Rampa de ${l.produto.nome} encerrada (o preço salvo continua o mesmo)`);
  }

  async function atualizarRampa(l, campos, msg) {
    const { error } = await supabase.from("rampas_preco").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", l.r.id);
    if (error) {
      onToast?.(/teste_/.test(error.message) ? "Falta rodar o supabase/schema_v34.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
      return false;
    }
    if (msg) onToast?.(msg);
    return true;
  }

  // O Ads (inclusive o teste de lançamento) é gravado SÓ por lib/adsAcoes.js —
  // o mesmo diálogo e a mesma função da aba Ads.
  const adsDe = (l) => linhasAds?.linhas.find((x) => x.chave === (l.ehKit ? `kit|${l.r.kit_id}|${l.r.canal_id}` : `produto|${l.r.produto_id}|${l.r.canal_id}`)) || null;
  const periodoTesteDe = (l) => (adsDe(l)?.periodos || []).find((p) => p.tipo === "teste" && p.inicio === l.r.teste_inicio) || (adsDe(l)?.av.ativo?.tipo === "teste" ? adsDe(l).av.ativo : null);
  const [testeDlg, setTesteDlg] = useState(null); // { linha, orc }
  async function iniciarTeste(f) {
    const l = testeDlg.linha;
    setSalvando(true);
    const r = await iniciarPeriodoAds({
      lojaId,
      tipo: l.ehKit ? "kit" : "produto",
      id: l.ehKit ? l.r.kit_id : l.r.produto_id,
      canalId: l.r.canal_id,
      inicio: f.inicio,
      fim: f.comoTeste ? f.fim : f.fim || null,
      orcamento: f.orcamento === "" ? null : num(f.orcamento),
      meta: f.meta === "" ? null : num(f.meta),
      nota: f.nota || null,
      teste: f.comoTeste,
      rampa: l.r,
      regras,
    });
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg);
    window.dispatchEvent(new Event("focus"));
    setTesteDlg(null);
    onToast?.(f.comoTeste ? "Teste de lançamento iniciado — registre gasto, cliques e vendas via Ads" : "Período de Ads iniciado (sem contar como teste)");
  }
  async function concluirTeste(l, motivo = null) {
    const r = await encerrarPeriodoAds(periodoTesteDe(l), { fim: hoje, motivo, rampa: l.r });
    if (!r.ok) return onToast?.(r.msg), false;
    window.dispatchEvent(new Event("focus"));
    return true;
  }
  const acoesTeste = {
    iniciar: (l, orc) => setTesteDlg({ linha: l, orc }),
    pular: (l) => atualizarRampa(l, { teste_status: "pulado" }, "Teste de lançamento pulado"),
    concluir: async (l) => (await concluirTeste(l)) && onToast?.("Teste concluído — desligue o Ads na plataforma"),
    reabrir: async (l) => {
      const p = periodoTesteDe(l);
      if (p && !p.motivo_fim && (!p.fim || p.fim >= hoje)) await encerrarPeriodoAds(p, { fim: hoje, motivo: "teste refeito" });
      atualizarRampa(l, { teste_status: null, teste_inicio: null, teste_fim: null }, "Teste de lançamento reaberto");
    },
  };

  async function testarAcima(l, preco) {
    const lista = normalizarDegraus([...l.est.degraus, preco]);
    const idx = lista.findIndex((d) => Math.abs(d - preco) < 0.005);
    setSalvando(true);
    const ok = await atualizarRampa(l, { degraus: lista, degrau_atual: idx, desde: hoje, base_avaliacoes: l.est.avaliacoesTotal });
    if (ok) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo: "subida", data: hoje, degrau: idx, preco, observacao: "acima do alvo" });
    setSalvando(false);
    setAcimaConfirma(null);
    if (ok) onToast?.(`Testando ${BRL(preco)} (acima do alvo) por ${regras.acimaDias} dias — atualize o anúncio`);
  }

  async function voltarAoAlvo(l) {
    const idx = l.est.degraus.findIndex((d) => Math.abs(d - l.est.alvo) < 0.005);
    const novo = idx >= 0 ? idx : Math.max(0, l.est.i - 1);
    const bloq = new Date(`${hoje}T12:00:00`);
    bloq.setDate(bloq.getDate() + regras.acimaBloqueioDias);
    setSalvando(true);
    const ok = await atualizarRampa(l, {
      degrau_atual: novo,
      desde: hoje,
      base_avaliacoes: l.est.avaliacoesTotal,
      checklist: { ...(l.r.checklist || {}), acimaBloqueadoAte: bloq.toISOString().slice(0, 10) },
    });
    if (ok) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo: "descida", data: hoje, degrau: novo, preco: l.est.degraus[novo], observacao: "volta ao alvo" });
    setSalvando(false);
    setAcimaConfirma(null);
    if (ok) onToast?.(`De volta ao alvo (${BRL(l.est.degraus[novo])}). Novo teste acima só daqui a ${regras.acimaBloqueioDias} dias.`);
  }

  // Teste acima aprovado: o preço salvo (alvo) passa a ser o preço testado — só com confirmação.
  async function aprovarAcima(l) {
    const salvo = precos.find((p) => p.item_tipo === (l.ehKit ? "kit" : "produto") && p.item_id === (l.ehKit ? l.r.kit_id : l.r.produto_id) && p.canal_id === l.r.canal_id);
    if (!salvo) return onToast?.("Preço salvo não encontrado");
    const preco = l.est.preco;
    const lucro = l.est.lucroEm(preco);
    setSalvando(true);
    // Preço novo = decisão nova: zera a estratégia (estrategia.js).
    const { error } = await gravarPrecoNovo((extra) =>
      supabase
        .from("precos_canal")
        .update({ preco, custo_total: l.ctx.custo, lucro, margem: preco > 0 ? lucro / preco : null, atualizado_em: new Date().toISOString(), ...extra })
        .eq("id", salvo.id)
    );
    setSalvando(false);
    setAcimaConfirma(null);
    if (error) return onToast?.(`Não foi possível atualizar o preço salvo: ${error.message}`);
    onToast?.(`Preço salvo de ${l.produto.nome} em ${l.canal.nome} atualizado para ${BRL(preco)} — é o novo alvo`);
  }

  // Alvo mudou → "Ajustar degraus até o novo alvo". Não mexe no preço salvo nem no riscado.
  async function ajustarAoAlvo(l) {
    const aj = ajustarDegrausAoAlvo(l.est.degraus, l.est.i, l.est.alvo);
    setSalvando(true);
    const ok = await atualizarRampa(l, {
      degraus: aj.degraus,
      degrau_atual: aj.i,
      ...(aj.mudouPreco ? { desde: hoje, base_avaliacoes: l.est.avaliacoesTotal } : {}),
    });
    if (ok && aj.mudouPreco)
      await supabase.from("rampa_registros").insert({
        loja_id: lojaId || null,
        rampa_id: l.r.id,
        tipo: aj.precoDepois < aj.precoAntes ? "descida" : "subida",
        data: hoje,
        degrau: aj.i,
        preco: aj.precoDepois,
        observacao: "alvo mudou",
      });
    setSalvando(false);
    setAlvoAjuste(null);
    if (ok)
      onToast?.(
        aj.mudouPreco
          ? `Degraus ajustados: agora vendendo no novo alvo ${BRL(aj.precoDepois)} — atualize a promo no anúncio`
          : `Degraus ajustados até o novo alvo ${BRL(l.est.alvo)} — continua vendendo a ${BRL(aj.precoDepois)}`
      );
  }

  async function marcarChecklist(l, chave, valor) {
    const novo = { ...(l.r.checklist || {}), [chave]: valor };
    const { error } = await supabase.from("rampas_preco").update({ checklist: novo }).eq("id", l.r.id);
    if (error) onToast?.(`Não foi possível salvar: ${error.message}`);
  }

  if (!supabase)
    return (
      <div className="panel">
        <div className="empty">Configure o Supabase pra usar a aba Crescimento.</div>
      </div>
    );
  if (!disponivel)
    return (
      <div className="panel">
        <h3>Crescimento</h3>
        <div className="empty">
          Falta criar as tabelas da rampa no banco — rode o <strong>supabase/schema_v33.sql</strong> no SQL Editor do Supabase e recarregue a página.
        </div>
      </div>
    );

  return (
    <>
      <TopbarAcoes aba="crescimento">
        <button type="button" className="btn" onClick={() => setIniciar({})}>
          + Iniciar rampa
        </button>
        {(dados.gruposAnuncio || []).length > 0 && (
          <button type="button" className="btn" onClick={iniciarRampaGrupo} title="Rampa do anúncio com vários itens (ex.: Kit Natal 01) — todas as opções sobem juntas">
            + Rampa de anúncio com vários itens
          </button>
        )}
      </TopbarAcoes>

      <Kpis
        itens={[
          {
            label: "Pra fazer agora",
            valor: String(itensLista.filter((x) => x.secao === "fazer").length),
            tom: itensLista.some((x) => x.secao === "fazer" && x.acao.tipo === "resolver") ? "bad" : itensLista.some((x) => x.secao === "fazer") ? "warn" : undefined,
            sub: (() => {
              const f = itensLista.filter((x) => x.secao === "fazer");
              if (!f.length) return "nada pendente ✓";
              const c = {};
              for (const x of f) {
                const k = (x.l.est.sugestao?.rotulo || x.acao.titulo).toLowerCase();
                c[k] = (c[k] || 0) + 1;
              }
              return Object.entries(c).map(([k, n]) => `${n} ${k}`).join(" · ");
            })(),
          },
          {
            label: "Prontos pra subir",
            valor: String(itensLista.filter((x) => x.secao === "subir").length),
            tom: itensLista.some((x) => x.secao === "subir") ? "good" : undefined,
            sub: itensLista.filter((x) => x.secao === "subir").map((x) => x.l.produto.nome).join(", ") || "—",
          },
          {
            label: "Em rampa",
            valor: String(linhas.length + linhasGrupo.length),
            sub: `${linhas.length} produto${linhas.length === 1 ? "" : "s"}${linhasGrupo.length ? ` · ${linhasGrupo.length} anúncio${linhasGrupo.length > 1 ? "s" : ""} com vários itens` : ""}`,
          },
          {
            label: "Lucro da semana",
            valor: temSemana ? BRL(lucroSemana) : "—",
            sub: temSemana
              ? `${BRL(lucroSemanaAds)} depois de Ads${comissaoSemana > 0 ? ` · já sem ${BRL(comissaoSemana)} de comissão` : ""} · no alvo seria ${BRL(lucroSemanaAlvo)}`
              : "fecha com os pedidos importados",
          },
        ]}
      />

      <div className="panel">
        <h3 className="section-title">
          <span>
            Em rampa
            <Ajuda texto="Rampa de preço: o produto (ou o anúncio com vários itens inteiro) entra perto do 0 a 0 pra ganhar vendas e avaliações no orgânico e sobe em degraus pequenos até o PREÇO ALVO — o preço salvo em Produtos precificados, que não muda. A lista mostra primeiro o que pede ação agora, depois o que está pronto pra subir e por último o que só está sendo acompanhado. Clique numa linha pra ver o detalhe embaixo. Nada aqui muda o cadastro." />
          </span>
          <span className="h3-contagem">semana de {dataBR(hoje)}</span>
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : !itensLista.length ? (
          <div className="empty">
            Nada em rampa. Use “+ Iniciar rampa” no topo: escolha o produto, o canal e o preço em que ele já está vendendo (ou o anúncio com vários itens inteiro).
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="filtros-lista" role="group" aria-label="Filtrar a lista">
                {[
                  ["todos", "Todos", itensLista.length],
                  ["fazer", "Pra fazer", itensLista.filter((x) => x.secao === "fazer").length],
                  ["subir", "Pronto pra subir", itensLista.filter((x) => x.secao === "subir").length],
                  ["produtos", "Produtos", linhas.length],
                  ["grupos", "Vários itens", linhasGrupo.length],
                ]
                  .filter(([k, , n]) => k === "todos" || n > 0)
                  .map(([k, rot, n]) => (
                    <button key={k} type="button" className={`filtro-btn${filtroLista === k ? " ativo" : ""}${k === "subir" ? " filtro-subir" : ""}`} onClick={() => setFiltroLista(k)}>
                      {rot} <span className="filtro-n">{n}</span>
                    </button>
                  ))}
              </div>
              <input type="search" className="busca-rampa" placeholder="Buscar por nome ou SKU" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
              {(busca || filtroLista !== "todos") && <span className="muted-cel">{itensVis.length} de {itensLista.length}</span>}
            </div>
            {!itensVis.length ? (
              <div className="empty">Nada nesta lista{busca ? ` com “${busca}”` : ""}.</div>
            ) : (
              <div className="table-wrap lista-rampa">
                <table>
                  <thead>
                    <tr>
                      <th>Produto / anúncio</th>
                      <th>Degrau agora → alvo</th>
                      <th>O que fazer</th>
                      <th>Próxima conferência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["fazer", "Pra fazer agora"],
                      ["subir", "Pronto pra subir"],
                      ["acomp", "Acompanhando"],
                      ["pausa", "Sem acompanhar"],
                    ].map(([sec, titulo]) => {
                      const doSec = itensVis.filter((x) => x.secao === sec);
                      if (!doSec.length) return null;
                      const fechada = sec === "pausa" && !verPausadas && !busca.trim();
                      return (
                        <Fragment key={sec}>
                          <tr className={`secao-lista secao-${sec}${sec === "pausa" ? " linha-clicavel" : ""}`} onClick={sec === "pausa" ? () => setVerPausadas((v) => !v) : undefined}>
                            <td colSpan={4}>
                              {sec === "subir" ? "↑ " : sec === "fazer" ? "! " : sec === "pausa" ? (fechada ? "▸ " : "▾ ") : ""}
                              {titulo} <span className="filtro-n">{doSec.length}</span>
                              {sec === "pausa" && <span className="faint"> · voltam sozinhos com a próxima venda ou no fim do prazo</span>}
                            </td>
                          </tr>
                          {!fechada && doSec.map((x) => (
                            <LinhaEmRampa
                              key={x.l.r.id}
                              x={x}
                              onPausar={(dias) => pausar(x, dias)}
                              onRetomar={() => retomar(x)}
                              atual={x.grupo ? selId === x.l.r.id : sel?.r.id === x.l.r.id}
                              onAbrir={() => {
                                setSelId(x.l.r.id);
                                if (detalheRecolhido === "1") setDetalheRecolhido("0");
                              }}
                              onAcao={() => {
                                const k = x.acao.acao;
                                if (x.grupo || !k) {
                                  setSelId(x.l.r.id);
                                  return;
                                }
                                if (k === "subir") setMudar({ linha: x.l, dir: 1 });
                                else if (k === "subir2") setMudar({ linha: x.l, dir: 2 });
                                else if (k === "voltar") setMudar({ linha: x.l, dir: -1 });
                                else if (k === "descer") setDescer(x.l);
                                else if (k === "testar-acima") setAcimaConfirma({ tipo: "testar", linha: x.l, preco: x.l.est.acima?.prox });
                                else if (k === "aprovar") setAcimaConfirma({ tipo: "aprovar", linha: x.l });
                                else if (k === "voltar-alvo") setAcimaConfirma({ tipo: "voltar", linha: x.l });
                                else {
                                  setSelId(x.l.r.id);
                                  setAbaPedida({ id: x.l.r.id, aba: k === "teste" ? "ads" : k, n: Date.now() });
                                  if (detalheRecolhido === "1") setDetalheRecolhido("0");
                                }
                              }}
                            />
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <RampaGrupo linhasGrupo={linhasGrupo} dados={dados} hoje={hoje} onToast={onToast} selId={selId} setSelId={setSelId} linhasAds={linhasAds} onVerAds={onVerAds} soDetalhe />

      {sel && (
        <Detalhe
          l={sel}
          pend={pendDe(sel)}
          abaPedida={abaPedida?.id === sel.r.id ? abaPedida : null}
          recolhido={detalheRecolhido === "1"}
          onAlternar={() => setDetalheRecolhido(detalheRecolhido === "1" ? "0" : "1")}
          anuncio={anuncio}
          regras={regras}
          onMudar={(dir) => setMudar({ linha: sel, dir })}
          onEditar={() => setIniciar({ rampa: sel.r })}
          onRefazer={() => setIniciar({ rampa: sel.r, refazer: true, linha: sel })}
          onDescer={() => setDescer(sel)}
          onAjustarDegrau={() => setAjusteDeg(sel)}
          onEncerrar={() => setEncerrar(sel)}
          onChecklist={marcarChecklist}
          acoesTeste={acoesTeste}
          onAcima={(tipo, preco) => setAcimaConfirma({ tipo, linha: sel, preco })}
          onAjustarAlvo={() => setAlvoAjuste(sel)}
          adsLinha={adsDe(sel)}
          onVerAds={onVerAds}
        />
      )}
      {testeDlg && (
        <PeriodoAdsDialog
          nome={testeDlg.linha.produto.nome}
          av={adsDe(testeDlg.linha)?.av || null}
          hoje={hoje}
          regrasA={{ minDiario: regras.testeMinDiario }}
          teste={{ padrao: true, dias: regras.testeDias, orcamentoDia: Math.round(((testeDlg.orc || 0) / regras.testeDias) * 100) / 100, meta: regras.testeMeta }}
          salvando={salvando}
          onCancelar={() => setTesteDlg(null)}
          onSalvar={iniciarTeste}
        />
      )}
      {ajusteDeg && <AjustarDegrauDialog l={ajusteDeg} salvando={salvando} onCancelar={() => setAjusteDeg(null)} onSalvar={ajustarDegrau} />}
      {alvoAjuste && (() => {
        const aj = ajustarDegrausAoAlvo(alvoAjuste.est.degraus, alvoAjuste.est.i, alvoAjuste.est.alvo);
        return (
          <ConfirmDialog
            titulo="Ajustar degraus até o novo alvo"
            confirmarLabel={salvando ? "Salvando…" : "Ajustar degraus"}
            onConfirm={() => ajustarAoAlvo(alvoAjuste)}
            onCancel={() => setAlvoAjuste(null)}
          >
            <p className="modal-msg">
              {alvoAjuste.produto.nome} na {alvoAjuste.canal.nome}: degraus {alvoAjuste.est.degraus.map((d) => virgula(d)).join(" · ")} → {aj.degraus.map((d) => virgula(d)).join(" · ")}.{" "}
              {aj.mudouPreco
                ? `O degrau atual (${BRL(aj.precoAntes)}) ficou acima do novo alvo: passa a vender no novo alvo, ${BRL(aj.precoDepois)} — atualize a promo no anúncio.`
                : `Continua vendendo a ${BRL(aj.precoDepois)} (degrau ${aj.i + 1} de ${aj.degraus.length}).`}{" "}
              O preço salvo e o preço original do anúncio não mudam.
            </p>
          </ConfirmDialog>
        );
      })()}
      {acimaConfirma && (
        <ConfirmDialog
          titulo={{ testar: "Testar acima do alvo", voltar: "Voltar ao alvo", aprovar: "Atualizar o preço salvo" }[acimaConfirma.tipo]}
          confirmarLabel={salvando ? "Salvando…" : { testar: "Testar", voltar: "Voltar", aprovar: "Atualizar preço salvo" }[acimaConfirma.tipo]}
          onConfirm={() =>
            acimaConfirma.tipo === "testar"
              ? testarAcima(acimaConfirma.linha, acimaConfirma.preco)
              : acimaConfirma.tipo === "voltar"
                ? voltarAoAlvo(acimaConfirma.linha)
                : aprovarAcima(acimaConfirma.linha)
          }
          onCancel={() => setAcimaConfirma(null)}
        >
          <p className="modal-msg">
            {acimaConfirma.tipo === "testar" &&
              `${acimaConfirma.linha.produto.nome}: ${BRL(acimaConfirma.linha.est.alvo)} → ${BRL(acimaConfirma.preco)} por ${regras.acimaDias} dias. O preço salvo continua ${BRL(acimaConfirma.linha.est.alvo)} até você aprovar. Atualize o anúncio com o preço original e a promo da tela.`}
            {acimaConfirma.tipo === "voltar" &&
              `Volta pra ${BRL(acimaConfirma.linha.est.alvo)}. Um novo teste acima do alvo só é sugerido daqui a ${regras.acimaBloqueioDias} dias.`}
            {acimaConfirma.tipo === "aprovar" &&
              `O preço salvo de ${acimaConfirma.linha.produto.nome} em ${acimaConfirma.linha.canal.nome} muda de ${BRL(acimaConfirma.linha.est.alvo)} para ${BRL(acimaConfirma.linha.est.preco)} — vira o novo alvo e aparece em Produtos precificados, Anunciar e no resto do app.`}
          </p>
        </ConfirmDialog>
      )}

      <div className={`panel${verRegras ? "" : " panel-recolhido"}`}>
        <h3 className="section-title">
          <button type="button" className={`variacoes-toggle${verRegras ? " aberto" : ""}`} onClick={() => setVerRegras((v) => !v)}>
            <span className="seta">▸</span> Regras dos portões
          </button>
          <span className="h3-contagem">
            {regras.avaliacoes} avaliações · {regras.vendas} vendas · nota {virgula(regras.nota, 1)} · {regras.dias} dias por degrau
          </span>
        </h3>
        {verRegras && <RegrasPortoes regras={regras} loja={lojas.find((l) => l.id === lojaId)} atualizar={atualizar} onToast={onToast} />}
      </div>

      {iniciar && (
        <IniciarRampaDialog
          dados={dados}
          rampas={[...rampas, ...(rampasH.rampasKit || [])]}
          regras={regras}
          editar={iniciar.rampa || null}
          refazer={iniciar.refazer ? iniciar.linha : null}
          onToast={onToast}
          onClose={(id) => {
            setIniciar(null);
            if (id) setSelId(id);
          }}
        />
      )}
      {mudar && (
        <ConfirmDialog
          titulo={mudar.dir > 1 ? "Subir 2 degraus" : mudar.dir > 0 ? "Subir degrau" : "Voltar degrau"}
          confirmarLabel={salvando ? "Salvando…" : mudar.dir > 0 ? "Subir" : "Voltar"}
          onConfirm={aplicarMudanca}
          onCancel={() => setMudar(null)}
        >
          {(() => {
            const e = mudar.linha.est;
            const novo = e.degraus[Math.max(0, Math.min(e.degraus.length - 1, e.i + mudar.dir))];
            const lNovo = e.lucroEm(novo);
            return (
              <p className="modal-msg">
                {mudar.linha.produto.nome} em {mudar.linha.canal.nome}: <b>{BRL(e.preco)}</b> → <b>{BRL(novo)}</b> (lucro {BRL(e.lucroAtual)} → {BRL(lNovo)}).
                Os kits e o preço original/promo são recalculados na tela pra você atualizar o anúncio. O preço salvo (alvo) não muda.
                {mudar.dir > 0 && !e.portoesOk ? " Atenção: nem todos os portões estão ✓." : ""}
                {e.dias < e.diasMin ? ` Mudança recente: o preço mudou há ${e.dias} dia${e.dias === 1 ? "" : "s"} — o ideal é esperar ${e.diasMin} pra não mexer no preço o tempo todo.` : ""}
                {mudar.dir > 0 && e.campanhaAviso ? ` ${e.campanhaAviso.nome} em ${e.campanhaAviso.dias} dia(s): a campanha costuma pedir preço abaixo do menor dos últimos 30 dias (${BRL(e.campanhaAviso.menor)}).` : ""}
              </p>
            );
          })()}
        </ConfirmDialog>
      )}
      {descer && (
        <ConfirmDialog
          titulo="Descer preço (entressafra)"
          confirmarLabel={salvando ? "Salvando…" : `Descer pra ${BRL(descer.est.sazonal?.precoNovo)}`}
          onConfirm={descerEntressafra}
          onCancel={() => setDescer(null)}
        >
          <p className="modal-msg">
            {descer.produto.nome} em {descer.canal.nome}: <b>{BRL(descer.est.preco)}</b> → <b>{BRL(descer.est.sazonal?.precoNovo)}</b> (lucro {BRL(descer.est.lucroAtual)} →{" "}
            {BRL(descer.est.lucroEm(descer.est.sazonal?.precoNovo))}). O anúncio continua ativo; o preço original fica fixo e só a promo muda. Se a descida não aumentar o lucro da semana, o app para de descer.
          </p>
        </ConfirmDialog>
      )}
      {encerrar && (
        <ConfirmDialog
          titulo="Encerrar rampa"
          mensagem={`Encerrar a rampa de "${encerrar.produto.nome}" em ${encerrar.canal.nome}? Os registros semanais dela são apagados. O preço salvo continua o mesmo.`}
          confirmarLabel="Encerrar"
          perigo
          onConfirm={encerrarRampa}
          onCancel={() => setEncerrar(null)}
        />
      )}
    </>
  );
}

// Diálogo "Ajustar preço deste degrau" (não conta como subida).
function AjustarDegrauDialog({ l, salvando, onCancelar, onSalvar }) {
  const e = l.est;
  const atual = num(e.degraus[e.i]);
  const anterior = e.i > 0 ? num(e.degraus[e.i - 1]) : null;
  const alvo = num(e.degraus[e.degraus.length - 1]);
  const [valor, setValor] = useState(virgula(atual));
  const novo = Math.round(num(valor) * 100) / 100;
  const pulados = e.degraus.map(num).filter((d, k) => k > e.i && k < e.degraus.length - 1 && d <= novo + 0.004);
  const erro =
    !(novo > 0) ? "Informe o preço" : anterior != null && novo <= anterior ? `Precisa ficar acima do degrau anterior (${BRL(anterior)})` : novo > alvo + 0.004 ? `Não pode passar do alvo (${BRL(alvo)}) — pra vender acima do alvo use "testar acima do alvo"` : null;
  const lucroNovo = e.lucroEm ? e.lucroEm(novo) : null;
  return (
    <EditarDialog titulo={`Ajustar preço do degrau — ${l.produto.nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => !erro && onSalvar(novo)} salvarLabel="Ajustar preço">
      <p className="hint" style={{ marginTop: 0 }}>
        Troca só o preço do degrau em que você está. <b>Não conta como subida</b>: os dias, as vendas e as avaliações desde {dataBR(l.r.desde)} continuam valendo pros portões.
      </p>
      <div className="grid-auto">
        <div className="field">
          <label>Preço agora</label>
          <input type="text" value={BRL(atual)} disabled />
          {e.lucroAtual != null && <small className="muted-cel">lucro {BRL(e.lucroAtual)}</small>}
        </div>
        <div className="field">
          <label>Novo preço</label>
          <input type="text" inputMode="decimal" value={valor} onChange={(ev) => setValor(ev.target.value)} autoFocus />
          {lucroNovo != null && !erro && <small className="muted-cel">lucro {BRL(lucroNovo)}{e.lucroAtual != null ? ` (${lucroNovo >= e.lucroAtual ? "+" : "−"}${BRL(Math.abs(lucroNovo - e.lucroAtual))} por venda)` : ""}</small>}
        </div>
      </div>
      {erro && valor !== "" && <div className="alerta alerta-warn">{erro}</div>}
      {!erro && pulados.length > 0 && (
        <div className="alerta alerta-warn">
          <b>Isso pula {pulados.length === 1 ? "um degrau" : `${pulados.length} degraus`}</b>
          {pulados.map((d) => BRL(d)).join(", ")} {pulados.length === 1 ? "sai" : "saem"} da escada ao ajustar — é como subir sem passar pelos portões. Se for isso mesmo, pode seguir.
        </div>
      )}
      <p className="hint">Depois, na Anunciar, atualize a promo (o preço original continua fixo). As semanas no preço antigo deixam de contar pro funil do anúncio, que compara só semanas no mesmo preço.</p>
    </EditarDialog>
  );
}

const TESTE_TAG = {
  observando: ["info", (t) => `observando orgânico · dia ${t.dia} de ${t.de}`],
  recomendado: ["atencao", () => "teste de lançamento recomendado"],
  andamento: ["decisao", (t) => `teste em andamento · ${t.diasRestantes}d`],
  concluido: ["info", (t) => `teste concluído${t.resultado ? ` · ${t.resultado.titulo.toLowerCase()}` : ""}`],
};
function TagTeste({ teste }) {
  const c = TESTE_TAG[teste?.status];
  if (!c) return null;
  return (
    <Estado tipo={c[0]} icone={c[0] === "info" || c[0] === "decisao" ? null : undefined} className="tag-teste">
      {c[1](teste)}
    </Estado>
  );
}

// "Vale a pena?" — depois de subir: o lucro por semana no preço novo vs o
// nível em que o degrau anterior foi deixado (lib/rampa.js → lucroCheck).
const pctInt = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
function ValeAPena({ e, regras }) {
  const c = e.lucroCheck;
  const u = c.ultima;
  const ls = e.lucroSubir;
  const tom = { fica: "good", sinaliza: "warn", voltar: "bad" }[c.status] || "neutro";
  return (
    <div className="vale-a-pena">
      <h4 className="sub-h">
        Vale a pena? <span className="muted-cel">({BRL(c.de)} → {BRL(c.para)})</span>
        <Ajuda
          texto={`Compara o lucro por semana no preço novo (vendas sem conhecidos × lucro por venda, custo e taxas de hoje) com o das 2 últimas semanas no preço anterior. ≥ ${pctInt(regras.lucroFica)} = fica (ganha quase o mesmo com menos trabalho); entre ${pctInt(regras.lucroVolta)} e ${pctInt(regras.lucroFica)} = sinaliza; abaixo de ${pctInt(regras.lucroVolta)} (ou vendas abaixo de ${pctInt(regras.pisoVendas)}) por 2 semanas = voltar. Só sugere subir de novo com lucro ≥ ${pctInt(regras.lucroSobe)} do patamar deste degrau (média das 2 primeiras semanas completas) por 2 semanas — assim o preço não fica subindo e descendo. Os percentuais ficam em Regras dos portões.`}
        />
      </h4>
      {c.status === "sem-ref" ? (
        <p className="hint" style={{ margin: 0 }}>Não há semana registrada no preço anterior pra comparar. A partir daqui vale o patamar deste degrau.</p>
      ) : (
        <ul className="vap-linhas">
          <li>
            No preço novo você precisa vender <b>{c.precisaVender != null ? fmtSemana(c.precisaVender) : "—"} por semana</b> pra ganhar o mesmo de antes ({BRL(c.ref)}/semana)
            {c.precisaPct != null && (
              <>
                {" "}— <b>{pctInt(c.precisaPct)}</b> do que vendia ({fmtSemana(c.refVendas)}/semana)
              </>
            )}
            .
          </li>
          <li>
            Hoje:{" "}
            {u ? (
              <>
                {fmtSemana(u.vendas)}/semana{u.pctV != null ? ` (${pctInt(u.pctV)} das vendas)` : ""} → lucro {BRL(u.lucro)}/semana = <b>{pctInt(u.pct)}</b> do de antes
              </>
            ) : (
              "coletando — a 1ª semana completa no preço novo ainda não fechou"
            )}
            .
          </li>
          {ls && (
            <li>
              Pra subir de novo:{" "}
              {ls.medindo
                ? `primeiro o app mede o patamar deste degrau (faltam ${ls.faltamPatamar} semana${ls.faltamPatamar === 1 ? "" : "s"} completa${ls.faltamPatamar === 1 ? "" : "s"})`
                : `lucro de ${BRL(ls.meta)}/semana ou mais (${pctInt(regras.lucroSobe)} do patamar de ${BRL(ls.patamar)}) por 2 semanas`}
              .
            </li>
          )}
        </ul>
      )}
      {c.status !== "sem-ref" && c.status !== "coletando" && (
        <div className={`alerta alerta-${tom}`} style={{ marginBottom: 0 }}>
          {c.status === "fica" && (
            <>
              <b>✓ Fica neste preço</b>Lucro mantido{u?.pctV != null && u.pctV < 0.995 ? ` vendendo ${pctInt(1 - u.pctV)} menos` : ""} — menos trabalho pra impressora com o mesmo ganho. Não mexa.
            </>
          )}
          {c.status === "sinaliza" && (
            <>
              <b>{u?.ruim ? "Semana abaixo: segurar" : `Lucrando ${pctInt(1 - u.pct)} menos que antes`}</b>
              {u?.ruim ? "Uma semana fraca pode ser só variação — se a próxima também vier abaixo, o app sugere voltar." : "Ainda dentro do aceitável: só observe. Abaixo do limite por 2 semanas, o app sugere voltar."}
            </>
          )}
          {c.status === "voltar" && (
            <>
              <b>2 semanas abaixo: voltar um degrau</b>O preço novo derrubou o lucro (ou as vendas) mais do que compensou. Volte pra {BRL(e.degraus[Math.max(0, e.i - 1)])} e tente de novo depois.
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Rampa sazonal: temporada, cronograma até a data-limite e entressafra.
function CronogramaSazonal({ e, onDescer }) {
  const z = e.sazonal;
  const fase = { subindo: "subindo pro alvo", pico: "pico da temporada", entressafra: "entressafra", aguardando: "fora da temporada" }[z.fase];
  return (
    <div className="cronograma-sazonal">
      <h4 className="sub-h">
        Temporada: {z.nome}{" "}
        <span className="muted-cel">
          ({z.fase === "entressafra" && z.anterior ? `a última foi ${dataBR(z.anterior)}/${z.anterior.slice(0, 4)} · a próxima ${dataBR(z.evento)}/${z.evento.slice(0, 4)}` : dataBR(z.evento)}) · {fase}
        </span>
        <Ajuda texto="Produto “só na época de…” (Cadastros → Catálogo ou Produtos → Quando vende). A rampa sobe pelo cronograma até a data-limite (30 dias antes da data, ou 7 dias antes da 1ª campanha grande antes dela), no mínimo 3 dias por degrau, se vender pelo menos 1 pedido por dia e sem avaliação 1–2★. Vendendo 2 por dia por 3 dias, pode subir antes. Depois da data, espera 3 dias e desce aos poucos (~8%) quando o lucro da semana fica abaixo da metade do da temporada; para de descer se a descida não ajudou, e nunca passa do piso (metade do lucro do alvo, nunca abaixo do mínimo aceitável). O anúncio continua ativo." />
      </h4>
      {(z.fase === "subindo" || z.fase === "pico") && (
        <>
          <p className="hint" style={{ margin: "0 0 6px" }}>
            No alvo até <b>{dataBR(z.limite)}</b> ({z.motivoLimite}){z.diasAteLimite >= 0 ? ` · faltam ${z.diasAteLimite} dia${z.diasAteLimite === 1 ? "" : "s"}` : ""} · ritmo agora {virgula(z.ritmo ?? 0, 1)} pedido/dia
          </p>
          {z.cronograma?.length > 0 ? (
            <div className="previa-degraus">
              <span className="chip-degrau at">
                <span className="chip-degrau-valor">{virgula(e.preco)} agora</span>
              </span>
              {z.cronograma.map((c, k) => (
                <span key={k} className={`chip-degrau${k === z.cronograma.length - 1 ? " alvo" : ""}`}>
                  <span className="chip-degrau-valor">
                    {virgula(c.preco)} · {dataBR(c.data)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="hint" style={{ margin: 0 }}>No alvo: segure até a data.</p>
          )}
          {e.sugestao.chave === "subir" && (
            <div className="alerta alerta-good">
              <b>
                {z.pelaPressa ? "Vendendo rápido: " : ""}Pronto pra subir para {BRL(e.proximo)}
              </b>
              {z.pelaPressa ? "Ritmo de 2 pedidos por dia ou mais — pode adiantar o cronograma." : "Chegou a data do degrau e o ritmo está bom."}
              {e.podePerder != null ? ` Pode vender até ${Math.floor(e.podePerder * 100)}% menos e ganhar o mesmo.` : ""}
            </div>
          )}
          {e.sugestao.chave === "atrasado" && (
            <div className="alerta alerta-warn">
              <b>Atrasado no cronograma</b>A data do próximo degrau ({dataBR(z.proximaData)}) chegou, mas {e.ruins7 > 0 ? "houve avaliação 1–2★ nos últimos 7 dias" : `o ritmo está em ${virgula(z.ritmo ?? 0, 1)} pedido/dia (precisa de 1 por dia)`}. Revise o anúncio ou suba mesmo assim, se a temporada estiver acabando.
            </div>
          )}
          {e.sugestao.chave === "voltar" && (
            <div className="alerta alerta-bad">
              <b>As vendas caíram mais da metade</b>Ritmo {virgula(z.ritmo ?? 0, 1)}/dia contra {virgula(z.ritmoAnt ?? 0, 1)}/dia no degrau anterior. Volte um degrau.
            </div>
          )}
        </>
      )}
      {z.fase === "entressafra" && (
        <>
          <p className="hint" style={{ margin: "0 0 6px" }}>
            Piso da entressafra: <b>{z.piso ? BRL(z.piso) : "—"}</b> (metade do lucro do alvo, nunca abaixo do mínimo) · a próxima temporada começa em {dataBR(z.proximo?.inicioTemporada)}
          </p>
          {z.espera ? (
            <div className="alerta alerta-neutro">
              <b>A data passou em {dataBR(z.anterior)}</b>Espere {e.sazonal.diasDesdeEvento <= 3 ? 3 - e.sazonal.diasDesdeEvento + 1 : 0} dia(s) antes de mexer no preço.
            </div>
          ) : z.desce ? (
            <div className="alerta alerta-warn">
              <b>Lucro da semana abaixo da metade do da temporada há 2 semanas</b>
              Desça pra {BRL(z.precoNovo)} (lucro {BRL(e.lucroEm(z.precoNovo))} por venda). O anúncio continua ativo.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-mini primary" onClick={onDescer}>
                  Descer pra {BRL(z.precoNovo)}
                </button>
              </div>
            </div>
          ) : z.naoAjudou ? (
            <div className="alerta alerta-neutro">
              <b>Estacionado</b>A última descida não aumentou o lucro da semana — baixar mais só queima margem. O preço fica aqui até a próxima temporada.
            </div>
          ) : z.noPiso ? (
            <div className="alerta alerta-neutro">
              <b>No piso da entressafra</b>O preço fica aqui até a próxima temporada, quando a rampa volta a subir até o alvo.
            </div>
          ) : (
            <p className="hint" style={{ margin: 0 }}>Registre as semanas: com 2 semanas abaixo da metade do lucro da temporada, o app sugere descer.</p>
          )}
        </>
      )}
      {z.fase === "aguardando" && (
        <div className="alerta alerta-neutro">
          <b>Fora da temporada</b>A rampa começa a subir em {dataBR(z.inicioTemporada)} pra chegar no alvo até {dataBR(z.limite)}.
        </div>
      )}
    </div>
  );
}

// Uma linha da lista "Em rampa" (produto ou anúncio com vários itens).
function LinhaEmRampa({ x, atual, onAbrir, onAcao, onPausar, onRetomar }) {
  const { l, grupo, pend, proxima } = x;
  const [escolher, setEscolher] = useState(false);
  const e = l.est;
  // Produto que só vende dentro do anúncio com vários itens: a rampa do anúncio decide.
  const acao = !grupo && l.soNoGrupo ? { tipo: "info", titulo: "Segue a rampa do anúncio inteiro", porque: "Pode encerrar esta rampa (⋯ Mais no detalhe)." } : x.acao;
  const pctTxt = (v) => `${String(Math.round(Number(v) * 10) / 10).replace(".", ",")}%`;
  const ic = { resolver: "!", atencao: "⚠", oportunidade: "↑", decisao: "◆" }[acao.tipo];
  const botao = grupo ? (acao.acao ? "Abrir" : null) : acao.botao;
  const botaoCurto = botao && botao.length > 26 ? "Abrir" : botao;
  return (
    <tr className={`linha-clicavel${atual ? " linha-atual" : ""}`} onClick={onAbrir}>
      <td className="td-com-saude">
        {!grupo && <PontoSaude estado={saudeRampa(e, pend)} />}
        <b>{l.produto.nome}</b>
        {l.ehKit && (
          <span className="badge info tag-pronto" title="Rampa do anúncio do kit (preço salvo do kit é o alvo)">
            kit
          </span>
        )}
        {grupo && (
          <span className="badge info tag-pronto" title="Anúncio com vários itens: todas as opções sobem juntas, em % do preço salvo de cada uma">
            vários itens
          </span>
        )}
        {!grupo && l.soNoGrupo && (
          <span className="badge info tag-pronto" title="Este produto só é vendido dentro de um anúncio com vários itens: a rampa do anúncio inteiro decide e os avisos desta rampa ficam de fora do Início. Pode encerrar esta rampa (⋯ Mais no Detalhe).">
            só no anúncio com vários itens
          </span>
        )}
        <div className="sub-linha">
          <CanalTag canal={l.canal} />
          {grupo ? ` · ${l.g.ops.length} opções` : ` · ${e.avaliacoesTotal} avaliações${e.nota != null ? ` · nota ${virgula(e.nota, 1)}` : ""}`}
        </div>
        {!grupo &&
          (l.r.checklist?.pronto ? (
            <span className="badge good tag-pronto" title={`Você marcou como pronto em ${diaMes(l.r.checklist.pronto)}`}>
              ✓ pronto
            </span>
          ) : (
            <span className="badge info tag-pronto" title="Ainda não marcado como pronto (no fim do checklist, aba Anúncio do detalhe)">
              preparando
            </span>
          ))}
        {!grupo && <TagTeste teste={e.teste} />}
        {e.alvoMudou && !grupo && (
          <span className="badge warn tag-pronto" title={`O preço salvo mudou de ${BRL(e.alvoMudou.de)} para ${BRL(e.alvoMudou.para)}`}>
            ⚠ alvo mudou
          </span>
        )}
        {e.sazonal && (
          <span className="badge info tag-pronto" title={`Produto sazonal: no alvo até ${dataBR(e.sazonal.limite)} (${e.sazonal.motivoLimite})`}>
            {e.sazonal.nome} · {{ subindo: `alvo até ${dataBR(e.sazonal.limite)}`, pico: "temporada", entressafra: "entressafra", aguardando: `temporada em ${dataBR(e.sazonal.inicioTemporada)}` }[e.sazonal.fase]}
          </span>
        )}
      </td>
      <td>
        <b>{grupo ? pctTxt(l.g.pctAtual) : BRL(e.preco)}</b>
        <span className="muted-cel"> → {grupo ? "100%" : BRL(e.alvo)}</span>
        <div className="degrau-dots">
          {e.degraus.map((d, k) => (
            <i key={k} className={k < e.i ? "ok" : k === e.i ? "at" : ""} />
          ))}
        </div>
        <div className="sub-num">
          {e.fase.rotulo}
          {e.fase.chave !== "acima" ? ` · ${e.i + 1} de ${e.degraus.length}` : ""} · lucro {BRL(e.lucroAtual)}
        </div>
      </td>
      <td className="o-que-fazer">
        <div className="oqf">
          {acao.tipo === "info" ? (
            <span className="muted-cel">{acao.titulo}</span>
          ) : (
            <Estado tipo={acao.tipo} icone={ic}>
              {acao.titulo}
            </Estado>
          )}
          {botaoCurto && (
            <button
              type="button"
              className={`btn btn-mini ${acao.tipo === "oportunidade" ? "btn-verde" : ["resolver", "atencao"].includes(acao.tipo) ? "primary" : ""}`}
              title={botao}
              onClick={(ev) => {
                ev.stopPropagation();
                onAcao();
              }}
            >
              {botaoCurto}
            </button>
          )}
        </div>
        {acao.porque && <div className="sub-num oqf-porque">{acao.porque}</div>}
        {x.pausa ? (
          <div className="sub-num pausa-rampa" onClick={(ev) => ev.stopPropagation()}>
            Sem acompanhar desde {diaMes(x.pausa.desde)} · volta com a próxima venda{x.pausa.soVenda ? "" : ` ou em ${diaMes(x.pausa.ate)}`} ·{" "}
            <button type="button" className="link-btn" onClick={onRetomar}>
              acompanhar de novo
            </button>
          </div>
        ) : (
          x.podePausar && (
            <div className="sub-num pausa-rampa" onClick={(ev) => ev.stopPropagation()}>
              {!escolher ? (
                <button type="button" className="link-btn" title="Some daqui e do Início até vender ou até o prazo acabar. Prejuízo continua aparecendo." onClick={() => setEscolher(true)}>
                  não acompanhar por enquanto
                </button>
              ) : (
                <>
                  Não acompanhar:{" "}
                  {PRAZOS_PAUSA.map((d) => (
                    <button key={d ?? "venda"} type="button" className="link-btn" onClick={() => (setEscolher(false), onPausar(d))}>
                      {d ? `${d} dias` : "só quando vender"}
                    </button>
                  ))}{" "}
                  <button type="button" className="link-btn faint" onClick={() => setEscolher(false)}>
                    cancelar
                  </button>
                </>
              )}
            </div>
          )
        )}
      </td>
      <td>
        <span className={proxima.atrasada ? "prox-atrasada" : "muted-cel"}>{proxima.texto}</span>
      </td>
    </tr>
  );
}

function Detalhe({ l, pend = null, abaPedida = null, recolhido = false, onAlternar, anuncio, regras, onMudar, onEditar, onRefazer, onDescer, onAjustarDegrau, onEncerrar, onChecklist, acoesTeste, onAcima, onAjustarAlvo, adsLinha, onVerAds }) {
  const e = l.est;
  const noAlvo = e.noAlvo;
  const [orcEdit, setOrcEdit] = useState("");
  const t = e.teste;
  const checklistIncompleto = ["foto", "uso", "titulo"].filter((k) => !l.r.checklist?.[k]);
  const maxD = Math.max(...e.degraus, 1);
  const minD = Math.min(...e.degraus, maxD);
  const alt = (d) => 26 + ((d - minD) / Math.max(0.01, maxD - minD)) * 84;
  const faltam = e.portoes.filter((p) => !p.ok);
  const av = adsLinha?.av || null;
  // Ads ao vivo (mesma conta do Painel do anúncio): período ligado pelo CSV.
  const adsVivo = av?.ativo ? numerosAds(adsLinha) : null;
  const hojeAds = hojeISO();
  const ads7 = adsVivo ? adsNaJanela(adsLinha.periodos, adsLinha.semanas, new Date(new Date(`${hojeAds}T12:00:00`).getTime() - 7 * 86400000).toISOString().slice(0, 10), hojeAds) : null;
  const roasV = adsVivo ? adsVivo.roas : e.roas;
  const eqV = adsVivo ? av.empate ?? e.roasMin : e.roasMin;
  const roasPos = (v) => Math.max(2, Math.min(98, (v / Math.max((eqV || 0) * 2, (roasV || 0) * 1.2, 1)) * 100));
  // Detalhe reorganizado (out/2026, prévia aprovada): "O que fazer agora", o
  // que o app está olhando e as abas (com marca onde há algo a fazer).
  const [aba, setAba] = useState(abaPedida?.aba || "plano");
  const [abaVista, setAbaVista] = useState(abaPedida?.n || null);
  if (abaPedida && abaPedida.n !== abaVista) {
    setAbaVista(abaPedida.n);
    setAba(abaPedida.aba);
  }
  const [verMais, setVerMais] = useState(false);
  const acao = acaoDaRampa(e, { canal: l.canal.nome, checklist: l.r.checklist || {} });
  const sinais = sinaisDaRampa(e);
  const proxima = proximaConferencia(e, { pendente: pend });
  const sk = e.sugestao.chave;
  const marcaAba = {
    plano: ["subir", "testar-acima", "acima-aprovado"].includes(sk) ? "oportunidade" : ["voltar", "descer", "atrasado", "acima-voltar"].includes(sk) || e.lucroCheck?.status === "sinaliza" ? "atencao" : null,
    anuncio: e.anuncio ? (e.anuncio.motivo === "teste" ? "resolver" : "atencao") : e.semVenda || e.alertaNota ? "atencao" : null,
    ads: e.teste?.status === "recomendado" ? "atencao" : av && ["resolver", "atencao", "oportunidade"].includes(av.estado) ? av.estado : null,
    digitar: anuncio?.linhas?.some((a) => a.acimaDoRiscado) ? "atencao" : null,
  };
  const fazer = (k) => {
    if (k === "subir") onMudar(1);
    else if (k === "subir2") onMudar(2);
    else if (k === "voltar") onMudar(-1);
    else if (k === "descer") onDescer();
    else if (k === "testar-acima") onAcima("testar", e.acima?.prox);
    else if (k === "aprovar") onAcima("aprovar");
    else if (k === "voltar-alvo") onAcima("voltar");
    else if (k === "anuncio") setAba("anuncio");
    else if (k === "teste") setAba("ads");
    else if (k === "plano") setAba("plano");
  };
  const ABAS = [
    ["plano", "Plano e portões"],
    ["digitar", `O que digitar${(anuncio?.linhas || []).length > 1 ? ` (${anuncio.linhas.length})` : ""}`],
    ["anuncio", "Anúncio"],
    ["evolucao", "Evolução"],
    ["ads", "Ads e teste"],
  ];

  return (
    <div className={`panel${recolhido ? " detalhe-recolhido" : ""}`}>
      <h3 className="section-title">
        <span>
          <button type="button" className="btn-recolher" onClick={onAlternar} title={recolhido ? "Mostrar o detalhe (evolução, portões, checklist)" : "Minimizar o detalhe pra economizar espaço"} aria-expanded={!recolhido}>
            {recolhido ? "▸" : "▾"}
          </button>
          {l.produto.nome} <CanalTag canal={l.canal} />
          <span className="h3-contagem">
            degrau {e.i + 1} de {e.degraus.length} desde {dataBR(l.r.desde)} ({e.dias} dia{e.dias === 1 ? "" : "s"}) · {e.vendasTotal} vendas no total{e.conhecidosTotal > 0 ? ` (${e.conhecidosTotal} de conhecidos)` : ""}
            {(() => {
              const aj = Array.isArray(l.r.checklist?.ajustesDegrau) ? l.r.checklist.ajustesDegrau : [];
              const u = aj[aj.length - 1];
              return u ? ` · ajustado em ${dataBR(u.data)}: ${BRL(u.de)} → ${BRL(u.para)}` : "";
            })()}
          </span>
        </span>
        <span className="acoes-detalhe">
          {sk === "subir" && (
            <button type="button" className="btn btn-mini btn-verde" onClick={() => onMudar(e.sugestao.saltos === 2 ? 2 : 1)}>
              {e.sugestao.saltos === 2 ? `↑↑ Subir 2 (pra ${BRL(e.degraus[e.i + 2])})` : `↑ Subir pra ${BRL(e.proximo)}`}
            </button>
          )}
          <span className="menu-mais">
            <button type="button" className="btn btn-mini" onClick={() => setVerMais((v) => !v)} aria-expanded={verMais}>
              ⋯ Mais
            </button>
            {verMais && (
              <span className="menu-mais-lista" onClick={() => setVerMais(false)}>
                {!noAlvo && <button type="button" onClick={onAjustarDegrau}>✎ Ajustar preço deste degrau</button>}
                <button type="button" onClick={onEditar}>Editar degraus</button>
                {sk !== "subir" && e.proximo && !noAlvo && <button type="button" onClick={() => onMudar(1)}>↑ Subir pra {BRL(e.proximo)}</button>}
                {e.i > 0 && <button type="button" onClick={() => onMudar(-1)}>↓ Voltar degrau</button>}
                <button type="button" onClick={onRefazer}>↺ Refazer rampa (configurei errado)</button>
                <button type="button" className="perigo" onClick={onEncerrar}>× Encerrar rampa</button>
              </span>
            )}
          </span>
        </span>
      </h3>

      {e.alvoMudou && (
        <div className="alerta alerta-warn alvo-mudou">
          <div>
            <b>Alvo mudou: {BRL(e.alvoMudou.de)} → {BRL(e.alvoMudou.para)}</b>O preço salvo em Produtos precificados mudou depois que a rampa foi montada.{" "}
            {e.alvoMudou.para < e.preco - 0.004
              ? `O degrau atual (${BRL(e.preco)}) está acima do novo alvo: ao ajustar, passa a vender no novo alvo.`
              : e.alvoMudou.subiu
                ? "Ao ajustar, o novo alvo entra no fim da escada e o degrau atual continua."
                : "Ao ajustar, saem os degraus acima do novo alvo e o degrau atual continua."}
          </div>
          <div className="acoes-alerta" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="btn btn-mini primary" onClick={onAjustarAlvo}>Ajustar degraus até o novo alvo</button>
            <button type="button" className="btn btn-mini" onClick={() => onChecklist(l, "alvoMantido", e.alvo)} title="Esconde este aviso até o preço salvo mudar de novo">
              Manter como está
            </button>
          </div>
        </div>
      )}

      <div className="nums-rampa">
        <div>
          <small>Preço agora</small>
          <b>{BRL(e.preco)}</b>
          <span>alvo {BRL(e.alvo)}</span>
        </div>
        <div>
          <small>Lucro por venda</small>
          <b>{BRL(e.lucroAtual)}</b>
          <span>no alvo {BRL(e.lucroAlvo)}</span>
        </div>
        <div>
          <small>Vendas desde o degrau</small>
          <b>{e.vendasDesde}</b>
          <span>
            em {e.dias} dia{e.dias === 1 ? "" : "s"} · {e.vendasTotal} no total
          </span>
        </div>
        <div>
          <small>Avaliações</small>
          <b>
            {e.avaliacoesTotal}
            {e.nota != null ? ` · ★${virgula(e.nota, 1)}` : ""}
          </b>
          <span>+{e.avaliacoesDesde} desde o degrau</span>
        </div>
      </div>

      <AgoraRampa acao={acao} proxima={proxima} onAcao={fazer} />
      <OlhandoRampa sinais={sinais} />

      <div className="abas-rampa" role="tablist">
        {ABAS.map(([k, rot]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} className={aba === k ? "ativo" : ""} onClick={() => setAba(k)}>
            {rot}
            <MarcaAba tipo={marcaAba[k]} />
          </button>
        ))}
      </div>

      {aba === "plano" && (
      <div className="aba-rampa">
        <div>
          <h4 className="sub-h">Plano de preço</h4>
          <div className="ladder">
            {e.degraus.map((d, k) => (
              <div key={k} className={`deg${k < e.i ? " ok" : k === e.i ? " at" : ""}${Math.abs(d - e.alvo) < 0.005 ? " alvo" : ""}${d > e.alvo + 0.004 ? " acima" : ""}`}>
                <div className="bar" style={{ height: alt(d) }} />
                <b>{virgula(d)}</b>
                <span className="lu">{Math.abs(d - e.alvo) < 0.005 ? "alvo · " : d > e.alvo + 0.004 ? "teste · " : ""}{BRL(e.lucroEm(d))}</span>
                {freteDe(pagaNoDegrau(d, e.alvo, anuncio?.desconto, anuncio?.riscadoFixo), l.canal) && (
                  <span className="lu-frete" title={freteDe(pagaNoDegrau(d, e.alvo, anuncio?.desconto, anuncio?.riscadoFixo), l.canal).texto}>
                    paga frete
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* Aviso só quando o degrau ATUAL (o que o cliente paga hoje) está abaixo. */}
          {freteDe(pagaNoDegrau(e.preco, e.alvo, anuncio?.desconto, anuncio?.riscadoFixo), l.canal) && (
            <FreteAviso
              frete={freteDe(pagaNoDegrau(e.preco, e.alvo, anuncio?.desconto, anuncio?.riscadoFixo), l.canal)}
              dica={`a partir de ${BRL(menorFinalComFreteGratis(l.canal, finalAcima))} o cliente já tem frete grátis`}
            />
          )}
          <p className="hint" style={{ margin: "6px 0 0" }}>
            0 a 0 hoje: {BRL(e.zero)} (custo e taxas atuais). O lucro de cada degrau acompanha o custo ao vivo.
          </p>

          {e.campanhaAviso && (
            <div className="alerta alerta-neutro aviso-campanha">
              <b>
                {e.campanhaAviso.nome} em {e.campanhaAviso.dias} dia{e.campanhaAviso.dias === 1 ? "" : "s"} ({dataBR(e.campanhaAviso.data)})
              </b>
              A plataforma costuma pedir preço abaixo do menor dos últimos 30 dias: abaixo de <b>{BRL(e.campanhaAviso.menor)}</b>
              {e.campanhaAviso.lucro != null ? <> → lucro menor que {BRL(e.campanhaAviso.lucro)} por venda</> : null}. É só um aviso: subir agora não é bloqueado, mas pode deixar a campanha mais cara pra você.
            </div>
          )}

          {e.sazonal && <CronogramaSazonal e={e} onDescer={onDescer} />}

          {!noAlvo && !e.sazonal && (
            <>
              <h4 className="sub-h">Portões para subir <span className="muted-cel">(todos precisam estar ✓)</span></h4>
              <ul className="lista-portoes">
                {e.portoes.map((p) => (
                  <li key={p.chave} className={p.ok ? "ok" : "no"}>
                    <span className="ic">{p.ok ? "✓" : "✗"}</span>
                    {p.rotulo}
                    <span className="val">{p.valor}</span>
                  </li>
                ))}
              </ul>
              {e.atalho && (
                <p className={`hint atalho-ritmo${e.atalho.ok ? " ok" : ""}`} style={{ margin: "4px 0 0" }}>
                  {e.atalho.ok ? "✓ " : ""}
                  <b>Atalho pelo ritmo</b> (só no 1º degrau): {virgula(e.atalho.pedidosDia, 0)} pedidos/dia por {e.atalho.dias} dias + 1 avaliação nova sobe antes dos portões. Hoje:{" "}
                  {virgula(e.atalho.ritmo, 1)}/dia em {e.dias} dia{e.dias === 1 ? "" : "s"}, +{e.avaliacoesDesde} avaliação{e.avaliacoesDesde === 1 ? "" : "ões"}.
                </p>
              )}
              {e.alertaNota && (
                <div className="alerta alerta-bad">
                  <b>Nota abaixo de {virgula(regras.notaAlerta, 1)}</b>Revise o produto/anúncio antes de subir — avaliação ruim costuma ser sobre o produto ou a entrega, não o preço.
                </div>
              )}
              {e.sugestao.chave === "subir" ? (
                <div className="alerta alerta-good">
                  {e.sugestao.saltos === 2 ? (
                    <>
                      <b>Vendendo muito: dá pra subir 2 degraus, para {BRL(e.degraus[e.i + 2])}</b>
                      {e.vendasDesde} vendas desde o degrau (2× o portão). Com essa procura, um aumento maior compensa. Depois do salto, o app pede {regras.diasAposSalto} dias parado. Não mexa no Ads na mesma semana.
                    </>
                  ) : (
                    <>
                      <b>
                        {e.sugestao.peloRitmo ? "Vendendo rápido: " : ""}Pronto pra subir para {BRL(e.proximo)}
                      </b>
                      Não mexa no Ads na mesma semana — senão não dá pra saber o que mudou as vendas.
                    </>
                  )}
                  {e.podePerder != null && (
                    <div style={{ marginTop: 4 }}>
                      Lucro por venda {BRL(e.lucroAtual)} → {BRL(e.lucroEm(e.sugestao.saltos === 2 ? e.degraus[e.i + 2] : e.proximo))}: você <b>pode vender até {Math.floor(e.podePerder * 100)}% menos</b> e ganhar o mesmo.
                    </div>
                  )}
                </div>
              ) : e.sugestao.chave === "segurar" && faltam.length && !e.lucroCheck ? (
                <div className="alerta alerta-warn">
                  <b>Segurar: {faltam.map((p) => (p.falta ? `faltam ${p.falta} ${p.curto}` : p.curto)).join(" · ")}</b>
                  {faltam.some((p) => p.chave === "avaliacoes") ? "Dica: peça avaliação com foto no pacote (cartãozinho) — avaliação com foto pesa mais na conversão." : "Aguarde os portões fecharem."}
                </div>
              ) : null}
            </>
          )}

          {e.acima && !e.acima.ativo && (
            <>
              <h4 className="sub-h">Acima do alvo <span className="muted-cel">(teste controlado, até +{Math.round(regras.acimaMax * 100)}%)</span></h4>
              <ul className="lista-portoes">
                {e.acima.criterios.map((c) => (
                  <li key={c.rotulo} className={c.ok ? "ok" : "no"}>
                    <span className="ic">{c.ok ? "✓" : "✗"}</span>
                    {c.rotulo}
                    <span className="val">{c.valor}</span>
                  </li>
                ))}
              </ul>
              {e.acima.prox ? (
                <div className={`alerta ${e.acima.pronto ? "alerta-good" : "alerta-neutro"}`}>
                  <b>
                    {e.acima.pronto ? "Vale testar" : "Quando os critérios fecharem"}: {BRL(e.alvo)} → {BRL(e.acima.prox)}
                  </b>
                  Lucro por venda {BRL(e.acima.lucroAgora)} → {BRL(e.acima.lucroProx)}.
                  {e.acima.podePerder != null && ` Dá pra perder até ${Math.floor(e.acima.podePerder * 100)}% das vendas e ainda lucrar o mesmo no total.`} O teste dura {regras.acimaDias} dias e o preço salvo só muda se você aprovar.
                  {e.acima.pronto && (
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn-mini primary" onClick={() => onAcima("testar", e.acima.prox)}>
                        Testar {BRL(e.acima.prox)}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>Já está no teto de +{Math.round(regras.acimaMax * 100)}% acima do alvo.</p>
              )}
            </>
          )}
          {e.acima?.ativo && (
            <>
              <h4 className="sub-h">Teste acima do alvo ({BRL(e.alvo)} → {BRL(e.preco)})</h4>
              <ul className="lista-portoes">
                <li className={e.acima.diasFaltam === 0 ? "ok" : "no"}>
                  <span className="ic">{e.acima.diasFaltam === 0 ? "✓" : "…"}</span>
                  {regras.acimaDias} dias de teste
                  <span className="val">{e.acima.diasFaltam === 0 ? "completo" : `faltam ${e.acima.diasFaltam}`}</span>
                </li>
                <li className={e.acima.lucroDepois != null && e.acima.lucroAntes != null && e.acima.lucroDepois >= e.acima.lucroAntes ? "ok" : "no"}>
                  <span className="ic">{e.acima.lucroDepois != null && e.acima.lucroAntes != null && e.acima.lucroDepois >= e.acima.lucroAntes ? "✓" : "✗"}</span>
                  Lucro médio por semana ≥ no alvo
                  <span className="val">
                    {e.acima.lucroDepois != null ? BRL(e.acima.lucroDepois) : "—"} vs {e.acima.lucroAntes != null ? BRL(e.acima.lucroAntes) : "—"}
                  </span>
                </li>
              </ul>
              {e.acima.aprovado ? (
                <div className="alerta alerta-good">
                  <b>Aprovado: {BRL(e.preco)} lucra mais que o alvo</b>
                  Atualize o preço salvo pra {BRL(e.preco)} (vira o novo alvo){e.acima.proximo ? ` — depois o app pode sugerir testar ${BRL(e.acima.proximo)}` : ""}.
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-mini primary" onClick={() => onAcima("aprovar")}>Atualizar preço salvo para {BRL(e.preco)}</button>
                    <button type="button" className="btn btn-mini" onClick={() => onAcima("voltar")}>Voltar ao alvo</button>
                  </div>
                </div>
              ) : e.acima.reprovado ? (
                <div className="alerta alerta-bad">
                  <b>Lucrou menos que no alvo: voltar</b>O preço mais alto derrubou as vendas mais do que compensou. Volte pra {BRL(e.alvo)}; novo teste só daqui a {regras.acimaBloqueioDias} dias.
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-mini primary" onClick={() => onAcima("voltar")}>Voltar ao alvo</button>
                  </div>
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  Registre as semanas normalmente. Em {e.acima.diasFaltam} dia(s) o app compara o lucro com o do alvo.{" "}
                  <button type="button" className="link-btn" onClick={() => onAcima("voltar")}>voltar agora</button>
                </p>
              )}
            </>
          )}

          {e.lucroCheck && <ValeAPena e={e} regras={regras} />}
        </div>
      </div>
      )}

      {aba === "ads" && (
        <div className="aba-rampa">
          {t.status === "ads-ligado" && (
            <div className="teste-card">
              <h4 className="sub-h">Ads ligado</h4>
              <p className="teste-texto">
                Período de Ads desde {dataBR(t.periodo.inicio)}
                {t.periodo.orcamento_diario ? ` · ${BRL(t.periodo.orcamento_diario)}/dia` : ""}
                {t.periodo.meta_roas ? ` · meta ${virgula(t.periodo.meta_roas, 1)}` : ""}: o teste de lançamento não se aplica enquanto ele estiver ligado.{" "}
                <button type="button" className="link-btn" onClick={onVerAds}>Ver em Crescimento → Ads</button>
              </p>
            </div>
          )}
          {["observando", "recomendado", "andamento", "concluido"].includes(t.status) && (
            <div className={`teste-card teste-${t.status}`}>
              <h4 className="sub-h">
                Teste de lançamento <TagTeste teste={t} />
              </h4>
              {(t.status === "observando" || t.status === "recomendado") && (
                <>
                  <p className="teste-texto">
                    {t.status === "observando"
                      ? `Anúncio novo, sem vendas: os primeiros ${t.de} dias são só orgânico — use o Impulsionar nos horários de pico e o tráfego de item novo. Se chegar a ${regras.testeDispensaVendas} vendas, o teste nem é preciso.`
                      : `Passaram ${regras.testeObservarDias} dias com menos de ${regras.testeDispensaVendas} vendas. Um Ads com orçamento fechado compra as primeiras vendas e avaliações — é investimento, não lucro.`}
                  </p>
                  <div className="teste-linha">
                    <div className="field" style={{ margin: 0 }}>
                      <label>Orçamento (R$)</label>
                      <input type="number" min="0" step="5" value={orcEdit || t.orcSugerido} onChange={(ev) => setOrcEdit(ev.target.value)} style={{ width: 110 }} />
                    </div>
                    <span className="muted-cel">
                      Na plataforma: <b>{BRL((num(orcEdit) || t.orcSugerido) / regras.testeDias)}/dia por {regras.testeDias} dias</b>
                      <br />
                      sugerido {BRL(t.orcSugerido)}
                      {t.orcInfo?.porMinimo
                        ? ` = mínimo da plataforma (${BRL(regras.testeMinDiario)}/dia × ${regras.testeDias} dias; pela conta seria ${BRL(t.orcInfo.base)} = ${regras.testeMeta} vendas × lucro no alvo ${BRL(e.lucroAlvo)})`
                        : ` = ${regras.testeMeta} vendas × lucro no alvo (${BRL(e.lucroAlvo)})`}
                    </span>
                  </div>
                  {t.orcInfo?.acimaMax && (
                    <div className="alerta alerta-warn" style={{ marginTop: 8 }}>
                      <b>A Shopee exige no mínimo {BRL(regras.testeMinDiario)}/dia — o teste fica em {BRL(t.orcInfo.minimo)} em {regras.testeDias} dias</b>
                      Passa do orçamento máximo das regras ({BRL(regras.testeMax)}). Se preferir gastar menos, diminua os dias do teste nas Regras dos portões.
                    </div>
                  )}
                  {(num(orcEdit) || t.orcSugerido) / regras.testeDias < num(regras.testeMinDiario) - 0.004 && (
                    <div className="alerta alerta-bad" style={{ marginTop: 8 }}>
                      <b>Abaixo do mínimo diário da plataforma</b>
                      {BRL((num(orcEdit) || t.orcSugerido) / regras.testeDias)}/dia é menos que {BRL(regras.testeMinDiario)}/dia — a Shopee não aceita. Use pelo menos {BRL(num(regras.testeMinDiario) * regras.testeDias)} em {regras.testeDias} dias.
                    </div>
                  )}
                  {checklistIncompleto.length > 0 && (
                    <div className="alerta alerta-warn" style={{ marginTop: 8 }}>
                      <b>Anúncio incompleto</b>
                      Falta {checklistIncompleto.map((k) => CHECKLIST_ANUNCIO.find((c) => c[0] === k)?.[1].toLowerCase()).join(", ")} (itens do checklist em Revisar anúncio, abaixo). Você pagaria pra mandar gente pra um anúncio que ainda não convence.
                    </div>
                  )}
                  <div className="teste-botoes">
                    <button type="button" className={`btn btn-mini${t.status === "recomendado" ? " primary" : ""}`} onClick={() => acoesTeste.iniciar(l, num(orcEdit) || t.orcSugerido)}>
                      {t.status === "observando" ? "Iniciar teste agora" : "Iniciar teste"}
                    </button>
                    <button type="button" className="btn btn-mini" onClick={() => acoesTeste.pular(l)}>Pular</button>
                  </div>
                </>
              )}
              {(t.status === "andamento" || t.status === "concluido") && (
                <>
                  <div className="teste-metricas">
                    <div>
                      <small>Investido</small>
                      <b>{BRL(t.gasto)}</b>
                      <span className="muted-cel"> de {BRL(t.orc)} ({BRL(t.orc / Math.max(1, t.prazo))}/dia)</span>
                      <div className="barra-progresso"><i style={{ width: `${Math.min(100, (t.gasto / Math.max(1, t.orc)) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <small>Vendas via Ads</small>
                      <b>{t.vendasAds}</b>
                      <span className="muted-cel"> de {t.meta}</span>
                      <div className="barra-progresso"><i style={{ width: `${Math.min(100, (t.vendasAds / Math.max(1, t.meta)) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <small>Cliques</small>
                      <b>{t.cliques}</b>
                    </div>
                    <div>
                      <small>Custo por venda</small>
                      <b style={{ color: t.custoVenda == null ? undefined : e.lucroAlvo > 0 && t.custoVenda <= e.lucroAlvo ? "var(--good)" : "var(--bad)" }}>{t.custoVenda != null ? BRL(t.custoVenda) : "—"}</b>
                      <span className="muted-cel"> (lucro no alvo {BRL(e.lucroAlvo)})</span>
                    </div>
                  </div>
                  {t.status === "andamento" ? (
                    <p className="teste-texto">
                      {t.diasRestantes} dia(s) restante(s) · envie o CSV do Shopee Ads em Atualizar dados (pode ser todo dia). O teste acaba sozinho ao bater {t.meta} vendas, gastar o orçamento, passar {t.prazo} dias ou chegar a {regras.testeCliquesSemVenda} cliques sem venda.
                    </p>
                  ) : (
                    t.resultado &&
                    (t.resultado.chave === "revisar" ? (
                      <div className="alerta alerta-bad">
                        <b>{t.cliques} cliques e nenhuma venda</b>
                        {e.anuncio ? `Veja o aviso em Revisar anúncio, abaixo${e.anuncio.motivo === "teste" ? "" : ` (${e.anuncio.titulo.toLowerCase()})`} — por onde começar: ${e.anuncio.porOnde.toLowerCase()}.` : "Já houve venda depois do teste — o aviso de revisar saiu."}
                      </div>
                    ) : (
                      <div className={`alerta alerta-${{ good: "good", warn: "warn", bad: "bad" }[t.resultado.tom]}`}>
                        <b>{t.resultado.titulo}</b>
                        {t.resultado.texto}
                      </div>
                    ))
                  )}
                  <div className="teste-botoes">
                    {t.status === "concluido" && !t.salvoConcluido && (
                      <button type="button" className="btn btn-mini primary" onClick={() => acoesTeste.concluir(l)}>Concluir e desligar o Ads</button>
                    )}
                    {t.status === "andamento" && (
                      <button type="button" className="btn btn-mini" onClick={() => acoesTeste.concluir(l)}>Encerrar teste agora</button>
                    )}
                    <button type="button" className="link-btn" onClick={() => acoesTeste.reabrir(l)}>refazer</button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      )}

      {aba === "digitar" && (
        <div className="aba-rampa">
          <h4 className="sub-h">
            O que digitar em {l.canal.nome} <span className="muted-cel">({anuncio?.riscadoFixo ? `preço original já anunciado (${BRL(anuncio.riscadoFixo)}) fica fixo — só a promo muda` : anuncio?.desconto > 0.005 ? `riscado fixo do alvo, desconto ${Math.round(anuncio.desconto * 100)}% — só a promo muda` : "canal sem desconto configurado"})</span>
          </h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Preço original</th>
                  <th className="num">Promo</th>
                  <th className="num">Cliente paga</th>
                  <th className="num">Lucro</th>
                  {anuncio?.faixas?.length > 0 && (
                    <th className="num" title={`Cupons ativos da loja: ${anuncio.faixas.map(textoFaixa).join(" · ")} (Configuração → Regras). Pedido de 1 unidade — o pior caso.`}>
                      Com o cupom da loja
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(anuncio?.linhas || []).map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.nome}
                      {a.separado != null && a.economia != null && (
                        <div className="sub-num" title={`${a.kit ? "Peças separadas" : `${a.n} avulsos`} no preço de agora: ${BRL(a.separado)}. Regra: a curva de desconto da escada sobre o preço de agora, sem passar do alvo do kit.${a.motivo ? ` ${a.motivo}.` : ""}`}>
                          economia {pctF(a.economia)} vs {a.kit ? "separado" : `${a.n} avulsos`} ({BRL(a.separado)})
                          {a.limitado ? " · abaixo do alvo do kit" : ""}
                        </div>
                      )}
                      {a.acimaDoRiscado && (
                        <div className="sub-num" style={{ color: "var(--bad)" }} title="Subir o preço cheio no marketplace pode ser visto como manipulação — considere manter. Recalcular só na Anunciar (ação explícita).">
                          precisaria subir o preço original ({BRL(a.original)}) — considere manter
                        </div>
                      )}
                      {a.naoCompensa && (
                        <div className="sub-num" style={{ color: "var(--warn)" }}>
                          kit não compensa neste degrau (economia {pctF(Math.max(0, a.economia ?? 0))}) — segurado no mínimo aceitável
                        </div>
                      )}
                    </td>
                    <td className="num"><Copiavel valor={virgula(a.original)} texto={virgula(a.original)} /></td>
                    <td className="num">{a.promo ? <Copiavel valor={`${a.promo}%`} texto={String(a.promo)} /> : "—"}<PromoAviso canal={l.canal} promo={a.promo} /></td>
                    <td className="num">
                      {virgula(a.clientePaga)}
                      {a.clientePaga - a.real >= 0.005 && <span className="muted-cel"> +{Math.round((a.clientePaga - a.real) * 100)}¢</span>}
                      {freteDe(a.clientePaga, l.canal) && (
                        <div>
                          <FreteAviso frete={freteDe(a.clientePaga, l.canal)} compacto />
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ color: a.lucro < 0 ? "var(--bad)" : undefined }}>
                      {BRL(a.lucro)}
                      {a.lucroSeparado != null && <div className="sub-num">{a.kit ? "separado" : `${a.n} avulsos`}: {BRL(a.lucroSeparado)}</div>}
                    </td>
                    {anuncio?.faixas?.length > 0 && (
                      <td className="num" style={{ color: a.cupom?.estado === "prejuizo" ? "var(--bad)" : undefined }}>
                        {a.cupom?.faixa ? (
                          <>
                            {BRL(a.cupom.lucro)}
                            <div className="sub-num">
                              −{BRL(a.cupom.desconto)} ({textoFaixa(a.cupom.faixa).split(" acima")[0]}) · paga {BRL(a.cupom.clientePaga)}
                              {a.cupom.estado === "prejuizo" ? " · ! prejuízo" : a.cupom.estado === "abaixo" ? " · ⚠ abaixo do mínimo" : ""}
                            </div>
                          </>
                        ) : (
                          <span className="muted-cel">não alcança</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {l.ehKit ? "Rampa do kit: só o anúncio do próprio kit — o riscado fica fixo e só a promo muda. Clique no valor pra copiar." : <>Variações e kits: a mesma curva de desconto do 2º Por quantidade (até {Math.round((l.cfg.descontoMax ?? 0.3) * 100)}%, lucro sempre subindo) sobre o preço de agora, sem passar do alvo de cada kit (o preço salvo dele não muda). Clique no valor pra copiar.</>}
          </p>

        </div>
      )}

      {aba === "ads" && (
        <div className="aba-rampa">
          {/* Ao vivo (23/10/2026, pedido do Gustavo: "igual ao Painel do anúncio"):
              com período ligado, os números são os do período pelo andamento do
              CSV (numerosAds — a MESMA conta do Painel do anúncio); sem período,
              a última semana fechada com Ads. */}
          {adsVivo ? (
            <h4 className="sub-h">
              Ads <span className="muted-cel">· período desde {dataBR(String(av.ativo.inicio).slice(0, 10))}{adsVivo.ate ? ` · CSV até ${dataBR(adsVivo.ate)}` : ""} · mesma conta do Painel do anúncio</span>
            </h4>
          ) : (
            <h4 className="sub-h">Ads {e.ultAds ? <span className="muted-cel">· semana de {dataBR(e.ultAds.data)}</span> : null}</h4>
          )}
          <div className="mini3">
            <div>
              <small>{adsVivo ? "ROAS do período" : "ROAS real"}</small>
              <b style={{ color: roasV == null ? undefined : roasV >= (eqV || Infinity) ? "var(--good)" : "var(--bad)" }}>{roasV != null ? virgula(roasV, 1) : "—"}</b>
              {adsVivo?.retorno != null && <span className="muted-cel"> retorno {virgula(adsVivo.retorno, 1)}×</span>}
            </div>
            <div>
              <small>ROAS de equilíbrio</small>
              <b>{eqV != null ? virgula(eqV, 1) : "—"}</b>
            </div>
            {adsVivo ? (
              <div>
                <small>Gasto · vendas via Ads</small>
                <b>
                  {BRL(adsVivo.gasto || 0)} · {adsVivo.vendas || 0}
                </b>
                {ads7 && <span className="muted-cel"> 7 dias: {BRL(ads7.gasto)} · {ads7.vendas}</span>}
              </div>
            ) : (
              <div>
                <small>Vendas orgânicas</small>
                <b style={{ color: "var(--good)" }}>{e.organico != null ? `${Math.round(e.organico * 100)}%` : "—"}</b>
                {e.organico != null && e.organicoAntes != null && <span className="muted-cel"> {e.organico >= e.organicoAntes ? "↑" : "↓"} de {Math.round(e.organicoAntes * 100)}%</span>}
              </div>
            )}
          </div>
          {adsVivo && (
            <p className="hint" style={{ margin: "0 0 6px" }}>
              {adsVivo.cliques ? `${adsVivo.cliques} cliques · ` : ""}
              {adsVivo.custoPorVenda != null ? `${BRL(adsVivo.custoPorVenda)} por venda · ` : ""}
              {e.organico != null ? `vendas orgânicas na última semana fechada: ${Math.round(e.organico * 100)}%` : "vendas orgânicas: aparece quando a 1ª semana fechar (pedidos dos 7 dias importados)"}
            </p>
          )}
          {eqV != null && (
            <div className="roas-regua">
              <div className="trilho">
                <span className="zona z-bad" style={{ width: `${roasPos(eqV * 0.8)}%` }} />
                <span className="zona z-warn" style={{ left: `${roasPos(eqV * 0.8)}%`, width: `${roasPos(eqV * 1.5) - roasPos(eqV * 0.8)}%` }} />
                <span className="zona z-good" style={{ left: `${roasPos(eqV * 1.5)}%`, right: 0 }} />
                <span className="marca" style={{ left: `${roasPos(eqV)}%` }}>
                  <em>mínimo {virgula(eqV, 1)}</em>
                </span>
                {roasV != null && <span className="eu" style={{ left: `${roasPos(roasV)}%` }} title={`ROAS ${virgula(roasV, 1)}`} />}
              </div>
              <div className="leg">
                <span>pausar</span>
                <span>reduzir · manter</span>
                <span>pode aumentar (≥ {virgula(eqV * 1.5, 1)})</span>
              </div>
            </div>
          )}
          {t.status === "andamento" ? (
            <div className="alerta alerta-neutro">
              <b>Teste de lançamento em andamento</b>Durante o teste vale o orçamento fechado acima, não a régua do ROAS. Depois dele, a régua volta a valer.
            </div>
          ) : av ? (
          <div className={`alerta alerta-${{ resolver: "bad", atencao: "warn", oportunidade: "good" }[av.estado] || "neutro"}`}>
            <b>{av.titulo}</b>
            {av.texto}
            {av.chave === "nao-viavel" && (t.status === "observando" || t.status === "recomendado") ? " A exceção é o teste de lançamento acima: orçamento fechado pra comprar as primeiras vendas." : ""}{" "}
            <button type="button" className="link-btn" onClick={onVerAds}>Ver em Crescimento → Ads</button>
          </div>
          ) : null}
          <p className="hint" style={{ margin: 0 }}>Lembrete: não suba de degrau e mexa no Ads na mesma semana.</p>
        </div>
      )}

      {aba === "anuncio" && <FunilAnuncio funil={e.funil} />}

      {aba === "evolucao" && (
      <div className="secao-rampa">
        <h4 className="sub-h">
          Evolução <span className="muted-cel">· preço vendido, vendas por semana e avaliações</span>
          {e.ultimaSemana && conhecidosDe(e.ultimaSemana) > 0 && (
            <span className="muted-cel" title="Vendas de amigos/família: contam no caixa e no lucro da semana, não nos portões nem no funil">
              {" "}· última semana: {num(e.ultimaSemana.vendas)} vendas, {conhecidosDe(e.ultimaSemana)} de conhecidos
            </span>
          )}
        </h4>
        <GraficoRampa est={e} ajustes={l.r.checklist?.ajustesDegrau} regras={regras} />
        <SemanasFonte e={e} />
      </div>
      )}

      {aba === "anuncio" && (
      <div className={`secao-rampa${e.revisar ? " destaque-revisar" : ""}`}>
        <h4 className="sub-h">
          Revisar anúncio
          {e.revisar ? <span className="badge bad" style={{ marginLeft: 8 }}>recomendado</span> : <span className="muted-cel"> · checklist de conversão</span>}
        </h4>
        {e.anuncio && (
          <div className="alerta alerta-bad">
            <b>{e.anuncio.titulo}</b>
            {e.anuncio.texto}
            <div style={{ marginTop: 4 }}>
              <span style={{ fontWeight: 700 }}>Por onde começar:</span> {e.anuncio.porOnde.toLowerCase()} — itens destacados abaixo.
              {e.anuncio.tambem.length > 0 && <span className="muted-cel"> Também indica: {e.anuncio.tambem.map((x) => x.titulo).join(", ")}.</span>}
            </div>
          </div>
        )}
        <div className="checklist-anuncio">
          {CHECKLIST_ANUNCIO.map(([k, rotulo, dica]) => {
            const destaque = (e.anuncio?.itens || []).includes(k);
            return (
              <label key={k} className={destaque ? "item-funil" : ""}>
                <input type="checkbox" checked={!!l.r.checklist?.[k]} onChange={(ev) => onChecklist(l, k, ev.target.checked)} />
                <span>
                  {rotulo}
                  {destaque && <em className="comece"> ← comece por aqui</em>}
                  {/* Produto sem concorrente direto: marca como feito comparando com um substituto. */}
                  {k === "concorrente" && l.r.checklist?.concorrente === "substituto" ? (
                    <small>
                      Sem concorrente direto — comparei com um substituto (o que a pessoa compraria no lugar: outra versão, outro material, algo que resolve a mesma coisa).
                    </small>
                  ) : (
                    <small>{dica}</small>
                  )}
                  {k === "concorrente" && !l.r.checklist?.concorrente && (
                    <button
                      type="button"
                      className="link-btn"
                      title="Nunca viu anúncio igual ao seu? Compare com o que a pessoa compraria no lugar (outra versão, outro material, algo que resolve a mesma coisa) — esse é o preço que ela tem na cabeça."
                      onClick={(ev) => {
                        ev.preventDefault();
                        onChecklist(l, "concorrente", "substituto");
                      }}
                    >
                      não tem concorrente direto — comparei com um substituto
                    </button>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>As marcações ficam salvas por produto. Depois de mexer nas fotos, espere 7 dias antes de tirar conclusões.</p>
        <div className="pronto-linha">
          {l.r.checklist?.pronto ? (
            <>
              <span className="badge good">✓ Pronto desde {diaMes(l.r.checklist.pronto)}</span>
              <button type="button" className="link-btn" onClick={() => onChecklist(l, "pronto", null)}>
                desfazer
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => onChecklist(l, "pronto", hojeISO())}>
                ✓ Marcar como pronto
              </button>
              <span className="muted-cel">já fiz tudo o que ia fazer neste anúncio — daqui em diante é só acompanhar (não precisa marcar todo o checklist)</span>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// "1,5%" / "12%"
const pctF = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`);

// Funil do anúncio (2 semanas no preço atual): Impressões de Produto →
// Cliques Por Produto (CTR) → Pedidos (Taxa de Conversão de Pedidos), com o
// diagnóstico de onde o anúncio trava. Só leitura.
function FunilAnuncio({ funil }) {
  if (!funil) return null;
  const d = funil.diagnostico;
  const rotuloVendas = funil.usaPedidos ? "Pedidos" : "Vendas";
  return (
    <div className="secao-rampa">
      <h4 className="sub-h">
        Funil do anúncio <span className="muted-cel">· 2 semanas no preço atual</span>
        <Ajuda texto="Do relatório de Desempenho do produto da Shopee, importado em Atualizar dados (impressões, cliques e pedidos). CTR = Cliques ÷ Impressões; Taxa de Conversão de Pedidos = Pedidos ÷ Cliques (sem pedidos informados, usa as vendas). Usa as 2 últimas semanas no preço atual, de preferência sem Ads (o Ads infla as impressões). Diagnóstico na ordem: pouca exibição → pouca gente clica → clicam mas não compram. Com 5+ produtos com funil, a referência é a média (mediana) da loja: abaixo da metade dela é problema. Os limites ficam em Regras dos portões." />
      </h4>
      {funil.status === "sem-dados" ? (
        <div className="empty">Importe o relatório de Desempenho do produto da Shopee em Atualizar dados pra ver onde o anúncio trava (Impressões e Cliques Por Produto).</div>
      ) : (
        <>
          <div className="funil-anuncio">
            <div className="funil-etapa">
              <span className="funil-rot">Impressões de Produto</span>
              <b>{funil.visualizacoes.toLocaleString("pt-BR")}</b>
            </div>
            <div className="funil-seta">
              → <span>CTR {pctF(funil.ctr)}</span>
            </div>
            <div className="funil-etapa">
              <span className="funil-rot">Cliques Por Produto</span>
              <b>{funil.visitas.toLocaleString("pt-BR")}</b>
            </div>
            <div className="funil-seta">
              → <span>conversão {pctF(funil.conversao)}</span>
            </div>
            <div className="funil-etapa">
              <span className="funil-rot">{rotuloVendas}</span>
              <b>{funil.vendas.toLocaleString("pt-BR")}</b>
            </div>
          </div>
          {funil.status === "coletando" ? (
            <div className="alerta alerta-neutro">
              <b>{funil.texto}</b>O diagnóstico aparece com {funil.semanas < 2 ? "2 semanas registradas neste preço" : "o tempo mínimo de rampa"}.
            </div>
          ) : d ? (
            <div className={`alerta alerta-${d.tom}`}>
              <b>{d.titulo}</b>
              {d.texto}
            </div>
          ) : null}
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Referência: <b>{funil.referencia}</b> (CTR mínimo {pctF(funil.limiteCtr)} · conversão mínima {pctF(funil.limiteConversao)})
            {!funil.usaPedidos && funil.semanas > 0 ? " · conversão pelas vendas (pedidos não informados)" : ""}
          </p>
          {funil.comAds && (
            <p className="hint neg" style={{ margin: "4px 0 0" }}>
              Com Ads: não há 2 semanas sem Ads neste preço, então os números incluem o tráfego pago — o Ads aumenta as impressões e distorce o CTR.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function RegrasPortoes({ regras, loja, atualizar, onToast }) {
  const campos = [
    ["avaliacoes", "Avaliações por degrau", 1],
    ["vendas", "Vendas por degrau", 1],
    ["nota", "Nota mínima", 0.1],
    ["dias", "Dias mínimos no degrau", 1],
    ["pisoVendas", "Depois de subir: volta com vendas < (% do anterior)", 1, true],
    ["passo", "Tamanho máximo do degrau (%)", 0.5, true],
    ["lucroEntrada", "Lucro no 1º degrau (R$)", 0.1],
    ["notaAlerta", "Nota que gera alerta", 0.1],
    ["roasInviavel", "Ads inviável com ROAS mínimo acima de", 0.5],
    ["revisarDias", "Dias no lançamento até sugerir revisar", 1],
    ["semVendaDias", "Dias no degrau sem nenhuma venda até avisar", 1],
    ["maxDegraus", "Máximo de degraus até o alvo", 1],
    ["saltoVendas", "Salto de 2 degraus com vendas ≥ (× o portão)", 0.5],
    ["diasAposSalto", "Dias parado depois de salto ou de voltar", 1],
    ["lucroFica", "Depois de subir: fica com lucro ≥ (% do anterior)", 1, true],
    ["lucroVolta", "Depois de subir: volta com lucro < (% do anterior, 2 semanas)", 1, true],
    ["lucroSobe", "Subir de novo com lucro ≥ (% do patamar, 2 semanas)", 1, true],
    ["ritmoPedidosDia", "Atalho pelo ritmo: pedidos por dia", 0.5],
    ["ritmoDias", "Atalho pelo ritmo: dias no degrau (rampa normal)", 1],
    ["ritmoDiasSazonal", "Atalho pelo ritmo: dias no degrau (sazonal)", 1],
    ["sazonalDiasMin", "Sazonal: dias mínimos por degrau", 1],
    ["sazonalPassoMax", "Sazonal: passo máximo (%)", 0.5, true],
    ["sazonalRitmoMin", "Sazonal: pedidos por dia pra seguir o cronograma", 0.5],
    ["sazonalQuedaVolta", "Sazonal: volta se o ritmo cair abaixo de (% do anterior)", 1, true],
    ["entressafraEspera", "Entressafra: dias depois da data antes de descer", 1],
    ["entressafraPasso", "Entressafra: cada descida (%)", 0.5, true],
    ["entressafraQueda", "Entressafra: desce com lucro < (% da temporada, 2 semanas)", 1, true],
    ["testeObservarDias", "Teste: dias só no orgânico antes de recomendar", 1],
    ["testeDispensaVendas", "Teste: vendas que dispensam o teste", 1],
    ["testeMeta", "Teste: meta de vendas", 1],
    ["testeMin", "Teste: orçamento mínimo (R$)", 5],
    ["testeMax", "Teste: orçamento máximo (R$)", 5],
    ["testeDias", "Teste: prazo (dias)", 1],
    ["testeMinDiario", "Teste: orçamento mínimo por dia na plataforma (R$)", 1],
    ["testeCliquesSemVenda", "Teste: cliques sem venda = revisar anúncio", 5],
    ["acimaDias", "Acima do alvo: dias no alvo / duração do teste", 1],
    ["acimaSemanas", "Acima do alvo: semanas de vendas estáveis", 1],
    ["acimaMax", "Acima do alvo: máximo acima (%)", 1, true],
    ["acimaBloqueioDias", "Acima do alvo: espera se falhar (dias)", 1],
    ["funilDiasMin", "Funil: dias de rampa antes de diagnosticar", 1],
    ["funilVisMin", "Funil: impressões mínimas em 2 semanas", 10],
    ["funilCtrMin", "Funil: CTR mínimo (%, referência geral)", 0.1, true],
    ["funilConvMin", "Funil: conversão de pedidos mínima (%, referência geral)", 0.1, true],
    ["funilVisitasMin", "Funil: cliques mínimos pra julgar a conversão", 5],
  ];
  const [f, setF] = useState(() => Object.fromEntries(campos.map(([k, , , pct]) => [k, String(pct ? Math.round(regras[k] * 1000) / 10 : regras[k])])));
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (!loja) return;
    const novo = {};
    for (const [k, , , pct] of campos) {
      const v = num(f[k]);
      novo[k] = pct ? v / 100 : v;
    }
    setSalvando(true);
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), crescimento: novo } });
    setSalvando(false);
    onToast?.(r.ok ? "Regras dos portões salvas pra loja" : `Não foi possível salvar: ${r.error}`);
  }
  return (
    <div className="pad-painel">
      <div className="grid-auto">
        {campos.map(([k, rotulo, passo]) => (
          <div className="field" key={k}>
            <label>{rotulo}</label>
            <input type="number" step={passo} min="0" value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
      <button type="button" className="btn primary" onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar regras"}
      </button>{" "}
      <button type="button" className="btn" onClick={() => setF(Object.fromEntries(campos.map(([k, , , pct]) => [k, String(pct ? REGRAS_PADRAO[k] * 100 : REGRAS_PADRAO[k])])))}>
        Voltar ao padrão
      </button>
    </div>
  );
}

// Exportado: o 4º Lançamento (Precificação por Canal) abre o MESMO diálogo,
// já com produto e canal (produtoInicial / canalInicial).
// refazer = rampa configurada errada: refaz do zero (produto e canal fixos).
// Sem semana registrada, sobrescreve tudo; com semanas, elas continuam no
// histórico e no gráfico, e a contagem (portões, decisões) recomeça hoje.
export function IniciarRampaDialog({ dados, rampas, regras, editar: editarProp, refazer = null, onToast, onClose, produtoInicial = "", canalInicial = "" }) {
  const { lojaId } = useLoja();
  const { itens, produtos, kits, canais, precos, cfgDoProduto, publicacoesCanal, cfgLoja } = dados;
  const hoje = hojeISO();
  const editar = refazer ? null : editarProp;
  const base = refazer?.r || null;
  // Item escolhido = "p:<produto>" ou "k:<kit>" (rampa de kit, v62: kit
  // vendido no anúncio próprio dele, degraus em R$ até o preço salvo do kit).
  const idDe = (r) => (r?.kit_id ? `k:${r.kit_id}` : r?.produto_id ? `p:${r.produto_id}` : "");
  const salvoDe = (iid, cid) => precos.find((p) => p.item_tipo === (iid.startsWith("k:") ? "kit" : "produto") && p.item_id === iid.slice(2) && p.canal_id === cid) || null;
  const temRampa = (iid, cid) => rampas.some((r) => idDe(r) === iid && r.canal_id === cid);
  const [selItem, setSelItem] = useState(idDe(editar) || idDe(base) || (produtoInicial ? (/^[pk]:/.test(produtoInicial) ? produtoInicial : `p:${produtoInicial}`) : ""));
  const ehKit = selItem.startsWith("k:");
  const produtoId = selItem && !ehKit ? selItem.slice(2) : "";
  const fixo = editar || base;
  const canaisDoProduto = selItem ? canais.filter((c) => !canalDireto(c) && rampaNoCanal(c, cfgLoja) && salvoDe(selItem, c.id) && (fixo ? c.id === fixo.canal_id : !temRampa(selItem, c.id))) : [];
  const [canalId, setCanalId] = useState(editar?.canal_id || base?.canal_id || canalInicial || "");
  const canal = canais.find((c) => c.id === (canalId || canaisDoProduto[0]?.id)) || null;
  const item = itens.find((i) => i.id === selItem);
  const cfg = selItem ? cfgDoProduto(produtoId || null) : null;
  const alvo = selItem && canal ? num(salvoDe(selItem, canal.id)?.preco) : 0;
  const descAnuncio = selItem && canal ? descontoDoItem(selItem, canal, { itens, produtos, kits }).desconto : 0;
  const riscadoAnunciado = selItem && canal ? riscadoFixoDe(selItem, canal.id, publicacoesCanal) : null;
  const freteChip = (d) => freteDe(pagaNoDegrau(d, alvo, descAnuncio, riscadoAnunciado), canal);
  const zero = item && canal ? zeroAZero(canal, num(item.custoTotal), num(item.peso), cfg) : null;
  const [precoHoje, setPrecoHoje] = useState(editar ? virgula(num(editar.degraus[editar.degrau_atual])) : "");
  const [aval, setAval] = useState(refazer ? String(refazer.est.avaliacoesTotal ?? "") : "");
  const [nota, setNota] = useState(refazer?.est.nota != null ? virgula(refazer.est.nota, 1) : "");
  const [vendas, setVendas] = useState(refazer ? String(refazer.est.vendasTotal ?? "") : "");
  const [salvando, setSalvando] = useState(false);
  // Produto "só na época de…" (Quando vende): rampa sazonal até a data-limite.
  const sazonal = useMemo(() => {
    // Kit: a 1ª peça "só na época de…".
    const pids = ehKit ? (item?.componentes || []).map((c) => c.produtoId) : [produtoId];
    for (const pid of pids) {
      const S = infoSazonal(quandoVendeDe(produtos.find((x) => x.id === pid)), configCalendario(cfgLoja), hoje);
      if (S && S.tipo === "epoca") return S;
    }
    return null;
  }, [produtos, produtoId, ehKit, item, cfgLoja, hoje]);
  const jaVende = num(vendas) > 0 || num(aval) > 0;
  const sugSaz = useMemo(
    () =>
      sazonal && item && canal && alvo > 0
        ? sugerirDegrausSazonal({ canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo, regras, hoje, limite: sazonal.limite, inicioPreco: jaVende ? num(precoHoje) : null })
        : null,
    [sazonal, item, canal, alvo, cfg, regras, hoje, jaVende, precoHoje]
  );
  const sugestao = useMemo(
    () => (sugSaz ? sugSaz.degraus : item && canal && alvo > 0 ? sugerirDegraus({ canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo, regras }) : []),
    [sugSaz, item, canal, alvo, cfg, regras]
  );
  const [degrausEdit, setDegrausEdit] = useState(editar ? editar.degraus.map((d) => virgula(num(d))) : null);
  const degrausTxt = degrausEdit ?? sugestao.map((d) => virgula(d));
  const [novoDegrau, setNovoDegrau] = useState("");
  const semanasReg = refazer ? (refazer.est.semanas || []).length : 0;

  const opcoesProduto = useMemo(() => {
    const livre = (iid) => canais.some((c) => !canalDireto(c) && rampaNoCanal(c, cfgLoja) && salvoDe(iid, c.id) && !temRampa(iid, c.id));
    const comPreco = produtos.filter((p) => livre(`p:${p.id}`));
    const kitsCom = (kits || []).filter((k) => livre(`k:${k.id}`));
    return [
      { label: "Produtos", itens: comPreco.map((p) => ({ id: `p:${p.id}`, rotulo: `${p.nome}${p.sku ? ` · ${p.sku}` : ""}` })) },
      ...(kitsCom.length ? [{ label: "Kits", itens: kitsCom.map((k) => ({ id: `k:${k.id}`, rotulo: `${k.nome}${k.sku ? ` · ${k.sku}` : ""}` })) }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, kits, canais, precos, rampas, cfgLoja]);

  // Lista final: números válidos ≤ alvo, alvo no fim, e o preço de hoje incluído.
  function montarLista() {
    let lista = normalizarDegraus(degrausTxt).filter((d) => d < alvo - 0.004);
    const ph = cent(num(precoHoje));
    if (ph > 0 && ph < alvo - 0.004 && !lista.some((d) => Math.abs(d - ph) < 0.005)) lista = normalizarDegraus([...lista, ph]);
    lista.push(cent(alvo));
    return lista;
  }
  const listaFinal = alvo > 0 ? montarLista() : [];
  const ph = cent(num(precoHoje)) || listaFinal[0] || 0;

  function adicionarDegrau() {
    const v = cent(num(novoDegrau));
    if (!(v > 0)) return;
    if (v >= alvo - 0.004) return onToast?.("O degrau tem que ser menor que o alvo (o preço salvo)");
    setDegrausEdit([...listaFinal.slice(0, -1), v].sort((a, b) => a - b).map((x) => virgula(x)));
    setNovoDegrau("");
  }
  const idxHoje = listaFinal.length ? Math.max(0, listaFinal.findIndex((d) => d >= ph - 0.004)) : 0;

  async function salvar() {
    if (!selItem || !canal) return onToast?.("Escolha o produto e o canal");
    if (!(alvo > 0)) return onToast?.("Esse produto não tem preço salvo neste canal — salve no 1º Avulso primeiro (ele é o alvo)");
    if (listaFinal.length < 1) return onToast?.("Informe os degraus");
    setSalvando(true);
    if (editar) {
      const atualAntes = num(editar.degraus[editar.degrau_atual]);
      let novoIdx = listaFinal.findIndex((d) => Math.abs(d - atualAntes) < 0.005);
      if (novoIdx < 0) novoIdx = Math.max(0, listaFinal.filter((d) => d < atualAntes).length - 1);
      const { error } = await supabase.from("rampas_preco").update({ degraus: listaFinal, degrau_atual: novoIdx, atualizado_em: new Date().toISOString() }).eq("id", editar.id);
      setSalvando(false);
      if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
      onToast?.("Degraus atualizados");
      return onClose(editar.id);
    }
    if (refazer) {
      const ck = base.checklist || {};
      const recomecos = [...(Array.isArray(ck.recomecos) ? ck.recomecos : []), { data: hoje, degraus: refazer.est.degraus, preco: refazer.est.preco, semanas: semanasReg }];
      const campos = {
        degraus: listaFinal,
        degrau_atual: idxHoje,
        desde: hoje,
        base_avaliacoes: Math.round(num(aval)),
        checklist: { ...ck, recomecos, ...(semanasReg ? {} : { ajustesDegrau: [] }) },
        atualizado_em: new Date().toISOString(),
      };
      if (!semanasReg) campos.vendas_iniciais = Math.round(num(vendas));
      const { error: e1 } = await supabase.from("rampas_preco").update(campos).eq("id", base.id);
      if (e1) {
        setSalvando(false);
        return onToast?.(`Não foi possível refazer: ${e1.message}`);
      }
      // Sem semana registrada não há histórico: os marcos antigos saem.
      if (!semanasReg) await supabase.from("rampa_registros").delete().eq("rampa_id", base.id).neq("tipo", "semana");
      await supabase.from("rampa_registros").insert({
        loja_id: lojaId || null,
        rampa_id: base.id,
        tipo: "inicio",
        data: hoje,
        degrau: idxHoje,
        preco: listaFinal[idxHoje],
        avaliacoes: Math.round(num(aval)),
        nota: nota === "" ? null : num(nota),
        observacao: semanasReg ? "rampa refeita" : null,
      });
      setSalvando(false);
      window.dispatchEvent(new Event("focus"));
      onToast?.(`Rampa refeita: ${item?.nome} vendendo ${BRL(listaFinal[idxHoje])} em ${canal.nome}${semanasReg ? ` — as ${semanasReg} semanas registradas continuam no histórico` : ""}`);
      return onClose(base.id);
    }
    const { data, error } = await supabase
      .from("rampas_preco")
      .insert({
        loja_id: lojaId || null,
        ...(ehKit ? { kit_id: selItem.slice(2), produto_id: null } : { produto_id: produtoId }),
        canal_id: canal.id,
        degraus: listaFinal,
        degrau_atual: idxHoje,
        desde: hoje,
        base_avaliacoes: Math.round(num(aval)),
        vendas_iniciais: Math.round(num(vendas)),
      })
      .select()
      .single();
    if (error) {
      setSalvando(false);
      return onToast?.(ehKit && /kit_id/.test(error.message) ? "Falta rodar o supabase/schema_v62.sql no Supabase (rampa de kit)" : /rampas_preco/.test(error.message) ? "Falta rodar o supabase/schema_v33.sql no Supabase" : `Não foi possível iniciar: ${error.message}`);
    }
    await supabase.from("rampa_registros").insert({
      loja_id: lojaId || null,
      rampa_id: data.id,
      tipo: "inicio",
      data: hoje,
      degrau: idxHoje,
      preco: listaFinal[idxHoje],
      avaliacoes: Math.round(num(aval)),
      nota: nota === "" ? null : num(nota),
    });
    setSalvando(false);
    window.dispatchEvent(new Event("focus"));
    onToast?.(`Rampa iniciada: ${item?.nome} vendendo ${BRL(listaFinal[idxHoje])} em ${canal.nome}`);
    onClose(data.id);
  }

  return (
    <EditarDialog
      titulo={editar ? "Editar degraus" : refazer ? `Refazer rampa — ${refazer.produto.nome}` : "Iniciar rampa de preço"}
      salvando={salvando}
      onSalvar={salvar}
      onCancelar={() => onClose(null)}
      salvarLabel={editar ? "Salvar degraus" : refazer ? "Refazer rampa" : "Iniciar rampa"}
      classe="modal-box-md"
    >
      {refazer && (
        <div className={`alerta ${semanasReg ? "alerta-warn" : "alerta-neutro"}`} style={{ marginTop: 0 }}>
          <b>{semanasReg ? `Recomeça a contagem hoje — nada é apagado` : "Sem semana registrada: refaz do zero"}</b>
          {semanasReg
            ? `As ${semanasReg} semana${semanasReg === 1 ? "" : "s"} registrada${semanasReg === 1 ? "" : "s"} continuam no histórico, no gráfico, no Ads e no caixa. Os portões e as decisões passam a contar a partir de hoje. Pra corrigir só o preço de agora, use "✎ Ajustar preço deste degrau".`
            : "O plano antigo é trocado por este. Use pra corrigir uma rampa configurada errada (preço inicial, degraus) sem encerrar e criar de novo."}
        </div>
      )}
      {!editar && !refazer && (
        <>
          {(dados.gruposAnuncio || []).length > 0 && (
            <div className="alerta alerta-neutro" style={{ marginTop: 0 }}>
              <b>Anúncio com vários itens (ex.: {dados.gruposAnuncio[0].nome})?</b>
              Ele não aparece aqui: a rampa dele é do anúncio inteiro, com todas as opções subindo juntas.{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  onClose(null);
                  iniciarRampaGrupo();
                }}
              >
                Iniciar rampa do anúncio →
              </button>
            </div>
          )}
          <div className="field">
            <label>Produto ou kit (só os que têm preço salvo em algum canal)</label>
            <BuscaItem
              grupos={opcoesProduto}
              value={selItem}
              onChange={(id) => {
                setSelItem(id);
                setCanalId("");
                setDegrausEdit(null);
                setPrecoHoje("");
              }}
            />
          </div>
          {selItem && (
            <div className="field">
              <label>Canal (onde {ehKit ? "o kit" : "o produto"} tem preço salvo)</label>
              <select
                value={canal?.id || ""}
                onChange={(e) => {
                  setCanalId(e.target.value);
                  setDegrausEdit(null);
                }}
              >
                {canaisDoProduto.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      {ehKit && canal && (
        <div className="hint" style={{ margin: "4px 0" }}>
          Rampa do kit: o preço do <b>anúncio do kit</b> sobe em degraus até o preço salvo dele. As peças não precisam estar anunciadas sozinhas; as vendas vêm dos pedidos com o SKU do kit{item?.sku ? ` (${item.sku})` : ""}.
        </div>
      )}
      {selItem && canal && alvo > 0 && (
        <>
          <div className="aviso-fluxo">
            0 a 0: <b>{BRL(zero)}</b> · alvo (preço salvo): <b>{BRL(alvo)}</b> — o salvo não muda.
          </div>
          {sazonal && !editar && (
            <div className="alerta alerta-neutro" style={{ margin: "6px 0" }}>
              <b>
                Produto sazonal — {sazonal.nome} ({dataBR(sazonal.evento)}): no alvo até {dataBR(sazonal.limite)}
              </b>
              {sazonal.motivoLimite}.{" "}
              {sugSaz?.degraus.length === 1
                ? sugSaz.aviso || "Começa direto no alvo."
                : `Começa em ${BRL(sugestao[0])} (${sugSaz?.origem === "preço de hoje" ? "o preço que já vende" : "metade do lucro do alvo"}) e sobe pelo cronograma, no mínimo ${regras.sazonalDiasMin} dias por degrau.`}
              {sugSaz?.aviso && sugSaz.degraus.length > 1 ? ` ${sugSaz.aviso}` : ""}
              {sazonal.fase === "aguardando" || sazonal.fase === "entressafra" ? ` Fora da temporada: o preço fica parado até ${dataBR(sazonal.inicioTemporada)}.` : ""}
            </div>
          )}
          {!editar && (
            <div className="row2">
              <div className="field">
                <label>Preço pra vender agora <span className="muted-cel">(vazio = 1º degrau; ou clique num degrau)</span></label>
                <input type="text" inputMode="decimal" placeholder={listaFinal[0] ? virgula(listaFinal[0]) : ""} value={precoHoje} onChange={(e) => setPrecoHoje(e.target.value)} />
              </div>
              <div className="field">
                <label>Vendas que o anúncio já tem</label>
                <input type="number" min="0" value={vendas} onChange={(e) => setVendas(e.target.value)} />
              </div>
              <div className="field">
                <label>Avaliações hoje</label>
                <input type="number" min="0" value={aval} onChange={(e) => setAval(e.target.value)} />
              </div>
              <div className="field">
                <label>Nota hoje (se tiver)</label>
                <input type="text" inputMode="decimal" placeholder="ex: 4,9" value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
            </div>
          )}
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              Degraus <span className="muted-cel">(até {Math.round(regras.passo * 100)}%, finais ,49/,99 · o alvo é sempre o último)</span>
            </label>
            <div className="previa-degraus editavel">
              {listaFinal.map((d, k) => {
                const ultimo = k === listaFinal.length - 1;
                const atual = editar ? Math.abs(d - num(editar.degraus[editar.degrau_atual])) < 0.005 : k === idxHoje;
                return (
                  <span key={`${d}-${k}`} className={`chip-degrau${atual ? " at" : ""}${ultimo ? " alvo" : ""}${freteChip(d) ? " sem-frete" : ""}`}>
                    <button
                      type="button"
                      className="chip-degrau-valor"
                      disabled={!!editar || ultimo}
                      title={`${editar ? "" : ultimo ? "Alvo (preço salvo)" : "Estou vendendo neste preço hoje"}${freteChip(d) ? `${editar || ultimo ? "" : " · "}${freteChip(d).texto}` : ""}` || undefined}
                      onClick={() => setPrecoHoje(virgula(d))}
                    >
                      {virgula(d)}
                      {ultimo ? " alvo" : ""}
                      {freteChip(d) ? " · paga frete" : ""}
                    </button>
                    {!ultimo && !atual && (
                      <button
                        type="button"
                        className="chip-degrau-x"
                        title="Tirar este degrau"
                        onClick={() => setDegrausEdit(listaFinal.slice(0, -1).filter((_, j) => j !== k).map((x) => virgula(x)))}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <div className="degraus-acoes">
              <input
                type="text"
                inputMode="decimal"
                placeholder="novo degrau, ex: 13,79"
                value={novoDegrau}
                onChange={(e) => setNovoDegrau(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionarDegrau();
                  }
                }}
              />
              <button type="button" className="btn btn-mini" onClick={adicionarDegrau} disabled={!(num(novoDegrau) > 0)}>
                + adicionar
              </button>
              <button type="button" className="link-btn" onClick={() => setDegrausEdit(null)}>
                sugerir de novo
              </button>
            </div>
          </div>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {!editar && <>Começa no degrau destacado ({BRL(listaFinal[idxHoje])}). Os portões contam a partir de hoje. </>}
            {(() => {
              const faltam = listaFinal.length - 1 - (editar ? editar.degrau_atual : idxHoje);
              return faltam > 0 ? `Faltam ${faltam} degrau${faltam > 1 ? "s" : ""} até o alvo — no mínimo ~${faltam * regras.dias} dias (${regras.dias} por degrau), na prática mais, pelos portões de vendas e avaliações.` : "Já está no alvo.";
            })()}
          </p>
        </>
      )}
      {selItem && canal && !(alvo > 0) && <div className="alerta alerta-warn"><b>Sem preço salvo</b>Salve o preço final desejado no 1º Avulso — ele é o alvo da rampa.</div>}
      {!selItem && !opcoesProduto.some((g) => g.itens.length) && <p className="hint">Nenhum produto com preço salvo disponível (ou todos já estão em rampa).</p>}
    </EditarDialog>
  );
}
