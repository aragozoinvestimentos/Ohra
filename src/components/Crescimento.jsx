import { canalDireto } from "../lib/canais.js";
import { useEffect, useMemo, useState } from "react";
import { alertaPreco } from "../lib/estrategia.js";
import { menorFinalComFreteGratis } from "../lib/freteGratis.js";
import FreteAviso from "./FreteAviso.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL, PCT } from "../lib/format.js";
import { hojeISO } from "../lib/fluxoCaixa.js";

// "2026-10-03" → "03/10" (sem passar por Date, que no fuso do Brasil voltaria um dia).
// Frete grátis (v38) de um preço no canal — aviso único via alertaPreco.
const freteDe = (valor, canal) => (canal && valor > 0 ? alertaPreco({ preco: valor, canal }).frete : null);
// O que o cliente PAGA num degrau: riscado fixo no alvo + promo do degrau
// (mesma conta do "O que digitar", lib/rampaAnuncio.js) — nunca o riscado.
// Com riscado fixo (já anunciado), só a promo muda — mesma conta (anuncioNoRiscado).
const pagaNoDegrau = (d, alvo, desconto, riscadoFixo = null) => (riscadoFixo ? anuncioNoRiscado(d, riscadoFixo) : anuncioFixo(d, alvo, desconto))?.clientePaga ?? d;
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
import { anuncioDaRampa, anuncioFixo, anuncioNoRiscado, riscadoFixoDe } from "../lib/rampaAnuncio.js";
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
import { useCrescimento } from "../hooks/useCrescimento.js";
import { pegarPedido } from "../lib/navegar.js";
import { useSemanaPendente } from "../hooks/useSemanaPendente.js";
import SemanaPendenteFaixa from "./SemanaPendenteFaixa.jsx";
import { chaveSemanaRampa, periodoEmAberto, somarDiasIso, ultimoRegistroAf, ultimoRegistroRampa } from "../lib/semanaPendente.js";
import Estado, { PontoSaude } from "./Estado.jsx";
import { estadoSugestaoRampa, saudeRampa } from "../lib/estados.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { cruzarRelatorios, lembrarIdsShopee, lerRelatorio, normSku, textoMistura } from "../lib/relatorioShopee.js";
import { andamentoParaSemana } from "../lib/ads.js";

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

const SUBABAS_CRESC = [
  { key: "rampa", label: "Rampa de preço" },
  { key: "ads", label: "Ads" },
  { key: "afiliados", label: "Afiliados" },
];
const lerSub = () => {
  try {
    const v = localStorage.getItem("ohra:crescimento-sub");
    return v === "afiliados" || v === "ads" ? v : "rampa";
  } catch {
    return "rampa";
  }
};

export default function Crescimento({ onToast }) {
  const { dados, rampasH, af, regras, hoje, linhas, linhasAf, mapaAf, semanaAf, adsH, regrasA, linhasAds } = useCrescimento();
  const [sub, setSub] = useState(lerSub);
  const [semanaAberta, setSemanaAberta] = useState(false);
  const [selId, setSelId] = useState(null); // rampa aberta no Detalhe

  // Pedidos vindos do Início (lib/navegar.js): sub-aba, rampa e "Registrar agora".
  useEffect(() => {
    const aplicar = (p) => {
      if (!p) return;
      if (p.sub) trocarSub(p.sub);
      if (p.rampaId) setSelId(p.rampaId);
      if (p.registrar) setSemanaAberta(true);
    };
    aplicar(pegarPedido("crescimento"));
    const ouvir = (e) => e.detail.aba === "crescimento" && aplicar(pegarPedido("crescimento"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);

  function trocarSub(k) {
    setSub(k);
    try {
      localStorage.setItem("ohra:crescimento-sub", k);
    } catch {
      // sem localStorage — só não lembra
    }
  }

  const podeRegistrar = linhas.length > 0 || linhasAf.some((l) => l.conf.ativo) || linhasAds.linhas.some((l) => l.av.ativo);

  return (
    <>
      <OndeSeDecide />
      <SemanaPendenteFaixa onRegistrar={() => podeRegistrar && setSemanaAberta(true)} />
      <div className="subabas">
        {SUBABAS_CRESC.map((s) => (
          <button key={s.key} type="button" data-sub={s.key} className={`btn${sub === s.key ? " primary" : ""}`} onClick={() => trocarSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === "rampa" ? (
        <RampaPreco
          dados={dados}
          linhasAds={linhasAds}
          onVerAds={() => trocarSub("ads")}
          rampasH={rampasH}
          regras={regras}
          linhas={linhas}
          hoje={hoje}
          comissaoSemana={semanaAf.comissaoRampa}
          podeRegistrar={podeRegistrar}
          onRegistrar={() => setSemanaAberta(true)}
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
          podeRegistrar={podeRegistrar}
          onRegistrar={() => setSemanaAberta(true)}
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
          podeRegistrar={podeRegistrar}
          onRegistrar={() => setSemanaAberta(true)}
          onToast={onToast}
        />
      )}
      {semanaAberta && (
        <RegistrarSemanaDialog linhas={linhas} linhasAf={linhasAf} linhasAds={linhasAds} af={af} onToast={onToast} onClose={() => setSemanaAberta(false)} />
      )}
    </>
  );
}

function RampaPreco({ dados, linhasAds, onVerAds, rampasH, regras, linhas, hoje, comissaoSemana, podeRegistrar, onRegistrar, onToast, selId, setSelId }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const { itens, produtos, kits, precos, concorrentes, cfgDoProduto, publicacoesCanal, anunciadoNoCanal } = dados;
  const { rampas, disponivel, carregando } = rampasH;
  const [iniciar, setIniciar] = useState(null); // {} novo | { rampa } editar degraus
  const [mudar, setMudar] = useState(null); // { linha, dir: 1 | -1 }
  const [ajusteDeg, setAjusteDeg] = useState(null); // linha: ajustar o preço do degrau atual
  const [encerrar, setEncerrar] = useState(null);
  const [descer, setDescer] = useState(null); // entressafra: descer um degrau
  const [busca, setBusca] = useState("");
  const [verRegras, setVerRegras] = useState(false);
  const [acimaConfirma, setAcimaConfirma] = useState(null);
  const [alvoAjuste, setAlvoAjuste] = useState(null); // linha com "alvo mudou" esperando confirmação // { tipo: "testar"|"voltar"|"aprovar", linha, preco }
  const [salvando, setSalvando] = useState(false);

  const sel = linhas.find((l) => l.r.id === selId) || linhas[0] || null;
  // Busca por nome ou SKU na lista "Produtos em rampa".
  const linhasVis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return linhas;
    return linhas.filter((l) => `${l.produto.nome} ${l.produto.sku || ""}`.toLowerCase().includes(t));
  }, [linhas, busca]);
  // Semana pendente (estado único com o Início): adiada não mostra etiqueta.
  const semanaPend = useSemanaPendente();
  const pendDe = (l) => {
    const x = semanaPend.porChave.get(chaveSemanaRampa(l.r.id));
    return x && x.pendente && !x.lembrete ? x : null;
  };

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
    const res = anuncioDaRampa({ produtoId: r.produto_id, canal, preco: est.preco, alvo: est.alvo, cfg, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoes: publicacoesCanal });
    // Lucro do avulso = o da rampa (mesmo custo/taxas ao vivo). Variação não
    // anunciada no canal (2º Por quantidade → Anunciado em) fica de fora.
    const linhasA = res.linhas.filter((l) => l.id === "avulso" || !l.itemId?.startsWith("v:") || anunciadoNoCanal(itens.find((i) => i.id === l.itemId), canal));
    return { ...res, linhas: linhasA.map((l) => (l.id === "avulso" ? { ...l, lucro: est.lucroAtual } : l)) };
  }, [sel, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoesCanal, anunciadoNoCanal]);

  // --- KPIs ---
  const prontos = linhas.filter((l) => l.est.sugestao.chave === "subir");
  const segurando = linhas.filter((l) => ["segurar", "revisar", "voltar"].includes(l.est.sugestao.chave));
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
  const adsDe = (l) => linhasAds?.linhas.find((x) => x.chave === `produto|${l.r.produto_id}|${l.r.canal_id}`) || null;
  const periodoTesteDe = (l) => (adsDe(l)?.periodos || []).find((p) => p.tipo === "teste" && p.inicio === l.r.teste_inicio) || (adsDe(l)?.av.ativo?.tipo === "teste" ? adsDe(l).av.ativo : null);
  const [testeDlg, setTesteDlg] = useState(null); // { linha, orc }
  async function iniciarTeste(f) {
    const l = testeDlg.linha;
    setSalvando(true);
    const r = await iniciarPeriodoAds({
      lojaId,
      tipo: "produto",
      id: l.r.produto_id,
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
    const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === l.r.produto_id && p.canal_id === l.r.canal_id);
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
        <button type="button" className="btn primary" onClick={onRegistrar} disabled={!podeRegistrar}>
          Registrar semana
        </button>
      </TopbarAcoes>

      <Kpis
        itens={[
          {
            label: "Em rampa",
            valor: String(linhas.length),
            sub: !linhas.length
              ? "nenhum produto ainda"
              : linhas.filter((l) => l.est.teste.status === "recomendado").length
                ? `${linhas.filter((l) => l.est.teste.status === "recomendado").length} com teste de lançamento recomendado`
                : `${new Set(linhas.map((l) => l.canal.id)).size} canal(is)`,
            tom: linhas.some((l) => l.est.teste.status === "recomendado") ? "warn" : undefined,
          },
          { label: "Prontos pra subir", valor: String(prontos.length), tom: prontos.length ? "good" : undefined, sub: prontos.map((l) => l.produto.nome).join(", ") || "—" },
          {
            label: "Segurando / revisar",
            valor: String(segurando.length),
            tom: segurando.length ? "warn" : undefined,
            sub: segurando.length ? `${segurando.filter((l) => l.est.sugestao.chave === "revisar").length} revisar anúncio · ${segurando.filter((l) => l.est.sugestao.chave === "voltar").length} voltar` : "—",
          },
          {
            label: "Lucro da semana",
            valor: temSemana ? BRL(lucroSemana) : "—",
            sub: temSemana
              ? `${BRL(lucroSemanaAds)} depois de Ads${comissaoSemana > 0 ? ` · já sem ${BRL(comissaoSemana)} de comissão` : ""} · no alvo seria ${BRL(lucroSemanaAlvo)}`
              : "registre a semana pra ver",
          },
        ]}
      />

      <div className="panel">
        <h3 className="section-title">
          <span>
            Produtos em rampa
            <Ajuda texto="Rampa de preço: o produto entra perto do 0 a 0 pra ganhar vendas e avaliações no orgânico e sobe em degraus pequenos (até ~5%, finais ,49/,99) até o PREÇO ALVO — o preço salvo em Produtos precificados, que não muda. Sobe só quando passa em todos os portões. Clique numa linha pra ver o detalhe embaixo. Nada aqui muda o cadastro." />
          </span>
          <span className="h3-contagem">semana de {dataBR(hoje)}</span>
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : !linhas.length ? (
          <div className="empty">
            Nenhum produto em rampa. Use “+ Iniciar rampa” no topo: escolha o produto, o canal e o preço em que ele já está vendendo.
          </div>
        ) : (
          <>
          {linhas.length > 1 || busca ? (
            <div className="toolbar">
              <input type="search" className="busca-rampa" placeholder="Buscar por nome ou SKU" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
              {busca && <span className="muted-cel">{linhasVis.length} de {linhas.length}</span>}
            </div>
          ) : null}
          {!linhasVis.length ? (
            <div className="empty">Nenhum produto em rampa com “{busca}”.</div>
          ) : (
          <div className="table-wrap lista-rampa">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Fase</th>
                  <th className="num">0 a 0</th>
                  <th className="num">Vendendo</th>
                  <th className="num">Alvo</th>
                  <th>Próximo degrau</th>
                  <th>Portões</th>
                  <th>Sugestão</th>
                </tr>
              </thead>
              <tbody>
                {linhasVis.map((l) => {
                  const e = l.est;
                  return (
                    <tr key={l.r.id} className={`linha-clicavel${sel?.r.id === l.r.id ? " linha-atual" : ""}`} onClick={() => setSelId(l.r.id)}>
                      <td className="td-com-saude">
                        <PontoSaude estado={saudeRampa(e, pendDe(l))} />
                        <b>{l.produto.nome}</b>
                        <div className="sub-linha">
                          <CanalTag canal={l.canal} /> · {e.avaliacoesTotal} avaliações{e.nota != null ? ` · nota ${virgula(e.nota, 1)}` : ""}
                        </div>
                        {l.r.checklist?.pronto ? (
                          <span className="badge good tag-pronto" title={`Você marcou como pronto em ${diaMes(l.r.checklist.pronto)}: agora é só acompanhar e registrar a semana`}>
                            ✓ pronto
                          </span>
                        ) : (
                          <span className="badge info tag-pronto" title="Ainda não marcado como pronto (botão no fim do painel do produto, em Revisar anúncio)">
                            preparando
                          </span>
                        )}
                        <TagTeste teste={e.teste} />
                        {pendDe(l) && (
                          <span className="badge warn tag-pronto" title={`Último registro em ${diaMes(pendDe(l).ultimo)} — use “Registrar semana”`}>
                            ↻ semana pendente há {pendDe(l).dias} dias
                          </span>
                        )}
                        {e.alvoMudou && (
                          <span className="badge warn tag-pronto" title={`O preço salvo mudou de ${BRL(e.alvoMudou.de)} para ${BRL(e.alvoMudou.para)} — abra o produto pra ajustar os degraus`}>
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
                        {e.fase.rotulo}
                        {e.fase.chave !== "acima" ? ` · ${e.i + 1} de ${e.degraus.length}` : ` · ${BRL(e.preco)}`}
                        <div className="degrau-dots">
                          {e.degraus.map((d, k) => (
                            <i key={k} className={k < e.i ? "ok" : k === e.i ? "at" : ""} />
                          ))}
                        </div>
                      </td>
                      <td className="num">{BRL(e.zero)}</td>
                      <td className="num">
                        <b>{BRL(e.preco)}</b>
                        <div className="sub-num">lucro {BRL(e.lucroAtual)}</div>
                      </td>
                      <td className="num">
                        {BRL(e.alvo)}
                        <div className="sub-num">lucro {BRL(e.lucroAlvo)}</div>
                      </td>
                      <td>{e.proximo ? <>{BRL(e.proximo)} <span className="muted-cel">(+{PCT(e.proximo / e.preco - 1)})</span></> : "—"}</td>
                      <td>
                        {e.fase.chave === "alvo" ? (
                          <span className="muted-cel">—</span>
                        ) : e.sazonal ? (
                          <span className="muted-cel">{e.sazonal.proximaData ? `cronograma: próximo ${dataBR(e.sazonal.proximaData)}` : e.sazonal.fase === "entressafra" ? `piso ${BRL(e.sazonal.piso)}` : "—"}</span>
                        ) : (
                          <div className="chips-portoes">
                            {e.portoes.map((p) => (
                              <span key={p.chave} className={`chip-portao ${p.ok ? "ok" : "no"}`} title={`${p.rotulo}: ${p.valor}`}>
                                {p.ok ? `✓ ${p.curto}` : p.falta ? `faltam ${p.falta} ${p.curto}` : `✗ ${p.curto}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {(() => {
                          const tipo = estadoSugestaoRampa(e);
                          return tipo ? (
                            <Estado tipo={tipo} icone={tipo === "oportunidade" ? "↑" : undefined}>
                              {e.sugestao.rotulo}
                            </Estado>
                          ) : (
                            <span className="muted-cel">{e.sugestao.rotulo}</span>
                          );
                        })()}
                        {e.sugestao.chave === "revisar" && e.anuncio && (
                          <div className="sub-num" title={`${e.anuncio.titulo} — por onde começar`}>começar por: {e.anuncio.porOnde.toLowerCase()}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          </>
        )}
      </div>

      {sel && (
        <Detalhe
          l={sel}
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
          adsLinha={linhasAds?.linhas.find((x) => x.chave === `produto|${sel.r.produto_id}|${sel.r.canal_id}`) || null}
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
          rampas={rampas}
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

function Detalhe({ l, anuncio, regras, onMudar, onEditar, onRefazer, onDescer, onAjustarDegrau, onEncerrar, onChecklist, acoesTeste, onAcima, onAjustarAlvo, adsLinha, onVerAds }) {
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
  const roasPos = (v) => Math.max(2, Math.min(98, (v / Math.max(e.roasMin * 2, (e.roas || 0) * 1.2, 1)) * 100));

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
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
          <button type="button" className="btn btn-mini" onClick={onEditar}>Editar degraus</button>
          <button type="button" className="btn btn-mini" onClick={onRefazer} title="Configurou errado? Refaz a rampa do zero (preço inicial, degraus) sem precisar encerrar e criar de novo">
            ↺ Refazer rampa
          </button>
          {!noAlvo && (
            <button type="button" className="btn btn-mini" onClick={onAjustarDegrau} title="Corrige o preço do degrau em que você está, sem contar como subida">
              ✎ Ajustar preço deste degrau
            </button>
          )}
          <button type="button" className="btn btn-mini" onClick={() => onMudar(-1)} disabled={e.i === 0}>↓ Voltar degrau</button>
          <button type="button" className={`btn btn-mini${e.sugestao.chave === "subir" && e.sugestao.saltos !== 2 ? " primary" : ""}`} onClick={() => onMudar(1)} disabled={noAlvo || !e.proximo}>
            ↑ Subir{e.proximo ? ` para ${BRL(e.proximo)}` : ""}
          </button>
          {e.sugestao.saltos === 2 && (
            <button type="button" className="btn btn-mini primary" onClick={() => onMudar(2)}>
              ↑↑ Subir 2 (para {BRL(e.degraus[e.i + 2])})
            </button>
          )}
          <button type="button" className="del" title="Encerrar rampa" onClick={onEncerrar}>×</button>
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

      <div className="grid-rampa">
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

        <div>
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
                      {t.diasRestantes} dia(s) restante(s) · registre gasto, cliques e vendas via Ads no “Registrar semana” (pode ser todo dia). O teste acaba sozinho ao bater {t.meta} vendas, gastar o orçamento, passar {t.prazo} dias ou chegar a {regras.testeCliquesSemVenda} cliques sem venda.
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
                    <td className="num">{a.promo ? <Copiavel valor={`${a.promo}%`} texto={String(a.promo)} /> : "—"}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Variações e kits: a mesma curva de desconto do 2º Por quantidade (até {Math.round((l.cfg.descontoMax ?? 0.3) * 100)}%, lucro sempre subindo) sobre o preço de agora, sem passar do alvo de cada kit (o preço salvo dele não muda). Clique no valor pra copiar.
          </p>

          <h4 className="sub-h">Ads {e.ultAds ? <span className="muted-cel">· semana de {dataBR(e.ultAds.data)}</span> : null}</h4>
          <div className="mini3">
            <div>
              <small>ROAS real</small>
              <b style={{ color: e.roas == null ? undefined : e.roas >= (e.roasMin || Infinity) ? "var(--good)" : "var(--bad)" }}>{e.roas != null ? virgula(e.roas, 1) : "—"}</b>
            </div>
            <div>
              <small>ROAS mínimo (empate)</small>
              <b>{e.roasMin != null ? virgula(e.roasMin, 1) : "—"}</b>
            </div>
            <div>
              <small>Vendas orgânicas</small>
              <b style={{ color: "var(--good)" }}>{e.organico != null ? `${Math.round(e.organico * 100)}%` : "—"}</b>
              {e.organico != null && e.organicoAntes != null && <span className="muted-cel"> {e.organico >= e.organicoAntes ? "↑" : "↓"} de {Math.round(e.organicoAntes * 100)}%</span>}
            </div>
          </div>
          {e.roasMin != null && (
            <div className="roas-regua">
              <div className="trilho">
                <span className="zona z-bad" style={{ width: `${roasPos(e.roasMin * 0.8)}%` }} />
                <span className="zona z-warn" style={{ left: `${roasPos(e.roasMin * 0.8)}%`, width: `${roasPos(e.roasMin * 1.5) - roasPos(e.roasMin * 0.8)}%` }} />
                <span className="zona z-good" style={{ left: `${roasPos(e.roasMin * 1.5)}%`, right: 0 }} />
                <span className="marca" style={{ left: `${roasPos(e.roasMin)}%` }}>
                  <em>mínimo {virgula(e.roasMin, 1)}</em>
                </span>
                {e.roas != null && <span className="eu" style={{ left: `${roasPos(e.roas)}%` }} title={`ROAS real ${virgula(e.roas, 1)}`} />}
              </div>
              <div className="leg">
                <span>pausar</span>
                <span>reduzir · manter</span>
                <span>pode aumentar (≥ {virgula(e.roasMin * 1.5, 1)})</span>
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
      </div>

      <FunilAnuncio funil={e.funil} />

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
      </div>

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
                  <small>{dica}</small>
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
        <Ajuda texto="Do painel de desempenho do produto na Shopee, informado no Registrar semana (+ impressões, cliques e pedidos). CTR = Cliques ÷ Impressões; Taxa de Conversão de Pedidos = Pedidos ÷ Cliques (sem pedidos informados, usa as vendas). Usa as 2 últimas semanas no preço atual, de preferência sem Ads (o Ads infla as impressões). Diagnóstico na ordem: pouca exibição → pouca gente clica → clicam mas não compram. Com 5+ produtos com funil, a referência é a média (mediana) da loja: abaixo da metade dela é problema. Os limites ficam em Regras dos portões." />
      </h4>
      {funil.status === "sem-dados" ? (
        <div className="empty">Informe visualizações e visitas no Registrar semana pra ver onde o anúncio trava (Impressões de Produto e Cliques Por Produto, do painel da Shopee).</div>
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

function RegrasPortoes({ regras, loja, atualizar, onToast }) {
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
  const salvoDe = (pid, cid) => precos.find((p) => p.item_tipo === "produto" && p.item_id === pid && p.canal_id === cid) || null;
  const [produtoId, setProdutoId] = useState(editar?.produto_id || base?.produto_id || produtoInicial || "");
  const fixo = editar || base;
  const canaisDoProduto = produtoId ? canais.filter((c) => !canalDireto(c) && salvoDe(produtoId, c.id) && (fixo ? c.id === fixo.canal_id : !rampas.some((r) => r.produto_id === produtoId && r.canal_id === c.id))) : [];
  const [canalId, setCanalId] = useState(editar?.canal_id || base?.canal_id || canalInicial || "");
  const canal = canais.find((c) => c.id === (canalId || canaisDoProduto[0]?.id)) || null;
  const item = itens.find((i) => i.id === `p:${produtoId}`);
  const cfg = produtoId ? cfgDoProduto(produtoId) : null;
  const alvo = produtoId && canal ? num(salvoDe(produtoId, canal.id)?.preco) : 0;
  const descAnuncio = produtoId && canal ? descontoDoItem(`p:${produtoId}`, canal, { itens, produtos, kits }).desconto : 0;
  const riscadoAnunciado = produtoId && canal ? riscadoFixoDe(`p:${produtoId}`, canal.id, publicacoesCanal) : null;
  const freteChip = (d) => freteDe(pagaNoDegrau(d, alvo, descAnuncio, riscadoAnunciado), canal);
  const zero = item && canal ? zeroAZero(canal, num(item.custoTotal), num(item.peso), cfg) : null;
  const [precoHoje, setPrecoHoje] = useState(editar ? virgula(num(editar.degraus[editar.degrau_atual])) : "");
  const [aval, setAval] = useState(refazer ? String(refazer.est.avaliacoesTotal ?? "") : "");
  const [nota, setNota] = useState(refazer?.est.nota != null ? virgula(refazer.est.nota, 1) : "");
  const [vendas, setVendas] = useState(refazer ? String(refazer.est.vendasTotal ?? "") : "");
  const [salvando, setSalvando] = useState(false);
  // Produto "só na época de…" (Quando vende): rampa sazonal até a data-limite.
  const sazonal = useMemo(() => {
    const p = produtos.find((x) => x.id === produtoId);
    const S = infoSazonal(quandoVendeDe(p), configCalendario(cfgLoja), hoje);
    return S && S.tipo === "epoca" ? S : null;
  }, [produtos, produtoId, cfgLoja, hoje]);
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
    const comPreco = produtos.filter((p) => canais.some((c) => salvoDe(p.id, c.id) && !rampas.some((r) => r.produto_id === p.id && r.canal_id === c.id)));
    return [{ label: "Produtos", itens: comPreco.map((p) => ({ id: p.id, rotulo: `${p.nome}${p.sku ? ` · ${p.sku}` : ""}` })) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, canais, precos, rampas]);

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
    if (!produtoId || !canal) return onToast?.("Escolha o produto e o canal");
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
        produto_id: produtoId,
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
      return onToast?.(/rampas_preco/.test(error.message) ? "Falta rodar o supabase/schema_v33.sql no Supabase" : `Não foi possível iniciar: ${error.message}`);
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
          <div className="field">
            <label>Produto (só os que têm preço salvo em algum canal)</label>
            <BuscaItem
              grupos={opcoesProduto}
              value={produtoId}
              onChange={(id) => {
                setProdutoId(id);
                setCanalId("");
                setDegrausEdit(null);
                setPrecoHoje("");
              }}
            />
          </div>
          {produtoId && (
            <div className="field">
              <label>Canal (onde o produto tem preço salvo)</label>
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
      {produtoId && canal && alvo > 0 && (
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
      {produtoId && canal && !(alvo > 0) && <div className="alerta alerta-warn"><b>Sem preço salvo</b>Salve o preço final desejado no 1º Avulso — ele é o alvo da rampa.</div>}
      {!produtoId && !opcoesProduto[0].itens.length && <p className="hint">Nenhum produto com preço salvo disponível (ou todos já estão em rampa).</p>}
    </EditarDialog>
  );
}

const VAZIO_RAMPA = { vendas: "", avaliacoes: "", nota: "", ruins: "", gasto: "", cliques: "", adsVendas: "", conhecidos: "" };
const DICA_CONHECIDOS = "Vendas de pessoas próximas (amigos/família) — contam no caixa, não no orgânico. Entram nas vendas totais, no lucro da semana e nas avaliações, mas não nos portões, no funil nem no teste de lançamento. Em branco = nenhuma.";
const VAZIO_FUNIL = { impressoes: "", cliquesProduto: "", pedidos: "" };

const somaDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntreIso = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// Período a puxar no painel da Shopee pro registro na data `data`: um registro
// cobre até a véspera. Em dia = os 7 dias antes ("Últimos 7 dias"); atrasou =
// "Por dia" (somando) começando no dia seguinte ao período anterior (sem pular
// nem repetir dias). Lacuna muito grande (> 13 dias) volta pros últimos 7.
function periodoFunil(registros, data) {
  const fim = somaDias(data, -1);
  const ant = [...(registros || [])].reverse().find((g) => g.tipo === "semana" && g.visualizacoes != null && g.data < data);
  let inicio = ant ? ant.data : somaDias(data, -7);
  if (diasEntreIso(inicio, fim) + 1 > 13 || inicio > fim) inicio = somaDias(data, -7);
  const dias = diasEntreIso(inicio, fim) + 1;
  return { inicio, fim, dias, modo: dias === 7 ? "Últimos 7 Dias" : "Por dia" };
}
const VAZIO_AF = { afVendas: "", afComissao: "", parceiro: "" };
const VAZIO_TODOS = { ...VAZIO_RAMPA, ...VAZIO_FUNIL, ...VAZIO_AF };

// Cada "Registrar semana" conta como UMA semana nas contas (funil, ROAS, check
// da subida, acima do alvo, afiliados) — registrar antes de ~7 dias distorce.
// Devolve o aviso (ou null) pra data escolhida, a partir do último registro
// (ou do início da rampa). Teste em andamento: Ads pode ser diário.
const DIAS_MIN_SEMANA = 6;
function avisoIntervalo(datasAnteriores, data, { inicio = null, teste = false } = {}) {
  const antes = (datasAnteriores || []).filter((d) => d && d <= data).sort();
  const ult = antes[antes.length - 1] || null;
  const ref = ult || (inicio && inicio <= data ? inicio : null);
  if (!ref) return null;
  const dias = diasEntreIso(ref, data);
  if (dias >= DIAS_MIN_SEMANA) return null;
  const desde = ult ? `o último registro (${diaMes(ult)})` : `o início da rampa (${diaMes(ref)})`;
  const quando = diaMes(somaDias(ref, 7));
  if (teste)
    return { tom: "neutro", texto: `Teste em andamento: pode registrar o Ads (gasto, cliques, vendas via Ads) todo dia. Vendas, avaliações e impressões da semana, só a partir de ${quando}.` };
  return {
    tom: "warn",
    texto:
      dias === 0
        ? `Já existe registro neste dia (${diaMes(ref)}). Um novo registro conta como mais uma semana inteira.`
        : `Faz só ${dias} dia${dias === 1 ? "" : "s"} desde ${desde}: este registro vai contar como uma semana inteira (funil, ROAS, check da subida). Melhor registrar a partir de ${quando}. Dá pra registrar mesmo assim.`,
  };
}
const AvisoIntervalo = ({ aviso }) =>
  aviso ? <div className={`alerta alerta-${aviso.tom === "warn" ? "warn" : "neutro"} aviso-intervalo`}>{aviso.texto}</div> : null;

// Uma janela só pra semana: produtos em rampa (vendas, avaliações, nota, 1–2★,
// Ads) + bloco Afiliado nos itens com comissão ativa — e os itens com
// afiliado fora de rampa (kits, variações, produtos no alvo sem rampa).
function RegistrarSemanaDialog({ linhas, linhasAf, linhasAds, af, onToast, onClose }) {
  const { lojaId } = useLoja();
  const [data, setData] = useState(hojeISO());
  const afDe = (l) => linhasAf.find((x) => x.chave === `produto|${l.r.produto_id}|${l.r.canal_id}` && x.conf.ativo) || null;
  const foraRampa = linhasAf.filter((x) => x.conf.ativo && !x.rampa);
  // Itens só com Ads ligado (Crescimento → Ads), fora de rampa e sem afiliado.
  const soAds = (linhasAds?.linhas || []).filter((x) => x.av.ativo && !x.rampa && !foraRampa.some((y) => y.chave === x.chave));
  // Andamento do Ads (v48): o que foi informado no meio do período e ainda não
  // está em semana registrada já vem nos campos de Ads (acumulado − registrado).
  const [andamentos] = useState(() => {
    const m = {};
    const de = (chaveAds, id) => {
      const la = (linhasAds?.linhas || []).find((x) => x.chave === chaveAds);
      const a = la?.av.ativo ? andamentoParaSemana(la.av.ativo, la.semanas) : null;
      if (a) m[id] = a;
    };
    for (const l of linhas) de(`produto|${l.r.produto_id}|${l.r.canal_id}`, l.r.id);
    for (const x of foraRampa) de(x.chave, x.chave);
    for (const x of soAds) de(x.chave, x.chave);
    return m;
  });
  const comAndamento = (id, base) => {
    const a = andamentos[id];
    if (!a) return base;
    const t = (v) => String(v).replace(".", ",");
    return { ...base, gasto: t(a.gasto), cliques: t(a.cliques), adsVendas: t(a.adsVendas) };
  };
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(soAds.map((x) => [x.chave, comAndamento(x.chave, { ...VAZIO_RAMPA })])),
    ...Object.fromEntries(linhas.map((l) => [l.r.id, comAndamento(l.r.id, { ...VAZIO_RAMPA, ...VAZIO_FUNIL, ...VAZIO_AF })])),
    ...Object.fromEntries(foraRampa.map((x) => [x.chave, comAndamento(x.chave, { ...VAZIO_RAMPA, ...VAZIO_AF })])),
  }));
  const notaAndamento = (id) =>
    andamentos[id] && !importado?.porChave[id] ? (
      <div className="importar-linha">
        📈 Ads do andamento até {diaMes(andamentos[id].ate)}: {BRL(andamentos[id].gasto)} · {andamentos[id].cliques} cliques · {andamentos[id].adsVendas} venda{andamentos[id].adsVendas === 1 ? "" : "s"} via Ads (o que ainda não estava em semana registrada) — confira com o relatório
      </div>
    ) : null;
  const [salvando, setSalvando] = useState(false);
  const [funilAberto, setFunilAberto] = useState(() => new Set());
  // Importar relatórios da Shopee (lib/relatorioShopee.js): só PREENCHE os
  // campos — nada é gravado até "Registrar".
  const { produtos: catProdutos, kits: catKits } = useRankingData();
  const [importado, setImportado] = useState(null);
  const [lendo, setLendo] = useState(false);
  const alternarFunil = (id) =>
    setFunilAberto((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Item que ainda não estava carregado quando o diálogo abriu (ex.: "Registrar
  // agora" vindo do Início) começa em branco.
  const fv = (id) => f[id] || VAZIO_TODOS;
  const set = (id, k) => (e) => setF((p) => ({ ...p, [id]: { ...VAZIO_TODOS, ...p[id], [k]: e.target.value } }));
  const doRelatorio = (id, k) =>
    importado?.marcados.has(`${id}|${k}`) || (andamentos[id] && !importado?.porChave[id] && ["gasto", "cliques", "adsVendas"].includes(k)) ? "campo-importado" : undefined;

  async function importarRelatorios(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (!arquivos.length) return;
    setLendo(true);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      lembrarIdsShopee(lidos); // o andamento do Ads usa essa ligação ID do item → SKU
      const ehShopee = (canal) => canal?.tipo === "shopee";
      const skuDoProduto = (id) => catProdutos.find((p) => p.id === id)?.sku || "";
      const itensApp = [
        ...linhas.filter((l) => ehShopee(l.canal)).map((l) => ({ chave: l.r.id, sku: l.produto.sku, tipo: "produto", rampa: true })),
        ...foraRampa
          .filter((x) => ehShopee(x.canal))
          .map((x) => ({ chave: x.chave, sku: x.item.sku, tipo: x.tipo, skuPai: x.tipo === "variacao" ? skuDoProduto(x.item.produtoId) : "", quantidade: x.item.quantidade })),
        ...soAds.filter((x) => ehShopee(x.canal)).map((x) => ({ chave: x.chave, sku: x.item.sku, tipo: x.tipo })),
      ];
      const res = cruzarRelatorios(lidos, itensApp);
      const marcados = new Set();
      const novaData = res.periodo?.ate ? somarDiasIso(res.periodo.ate, 1) : null;
      setF((prev) => {
        const nf = { ...prev };
        for (const it of itensApp) {
          const n = res.porChave[it.chave];
          if (!n) continue;
          const campos = it.rampa ? ["vendas", "impressoes", "cliquesProduto", "pedidos", "gasto", "cliques", "adsVendas"] : ["vendas", "gasto", "cliques", "adsVendas"];
          const v = { ...VAZIO_TODOS, ...nf[it.chave] };
          for (const k of campos)
            if (n[k] != null) {
              v[k] = String(Math.round(n[k] * 100) / 100).replace(".", ",");
              marcados.add(`${it.chave}|${k}`);
            }
          // Período em aberto: De/Até = o do relatório.
          if (res.periodo) {
            v.de = res.periodo.de;
            v.ate = res.periodo.ate;
          }
          nf[it.chave] = v;
        }
        return nf;
      });
      setFunilAberto((s) => new Set([...s, ...itensApp.filter((it) => it.rampa && res.porChave[it.chave]).map((it) => it.chave)]));
      if (novaData && novaData !== data) setData(novaData);
      const skusApp = new Set([...catProdutos, ...catKits].map((i) => normSku(i.sku)).filter(Boolean));
      setImportado({
        ...res,
        arquivos: lidos.map((r) => r.arquivo),
        marcados,
        n: Object.keys(res.porChave).length,
        dataAjustada: novaData && novaData !== data ? novaData : null,
        semPar: res.semPar.map((i) => ({ ...i, existe: !!i.sku && skusApp.has(i.sku) })),
      });
    } catch (err) {
      onToast?.(err.message || "Não foi possível ler o arquivo");
    } finally {
      setLendo(false);
    }
  }
  const preenchido = (v, campos) => campos.some((k) => v[k] !== "");
  // Registro por período (v40): sem registro há mais de 7 dias → De (início
  // do período em aberto) e Até (véspera da data), editáveis. Grava
  // periodo_inicio = De e data = Até + 1 (o registro cobre até a véspera).
  const periodoDe = (id, ultimo) => {
    const per = periodoEmAberto(ultimo, data);
    if (!per || !per.pendente) return null;
    const v = fv(id);
    const de = v.de || per.de;
    const ate = v.ate || per.ate;
    const dias = de && ate ? Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 86400000) + 1 : 0;
    return { ...per, ultimo: per.de, de, ate, diasPeriodo: dias };
  };
  const perRampa = (l) => periodoDe(l.r.id, ultimoRegistroRampa(l.r, l.est.registros));
  const perAf = (x) => periodoDe(x.chave, ultimoRegistroAf(x.tipo, x.id, x.canal.id, af.registros, x.conf.row));
  const perAds = (x) => periodoDe(x.chave, ultimoRegistroAf(x.tipo, x.id, x.canal.id, af.registros) || String(x.av.ativo.inicio).slice(0, 10));
  const dataDoPeriodo = (per) => (per ? { data: somarDiasIso(per.ate, 1), periodo_inicio: per.de } : { data });
  const intOuNull = (x) => (x === "" ? null : Math.round(num(x)));

  async function salvar() {
    const rampaSalvar = [];
    const afSalvar = [];
    for (const l of linhas) {
      const v = fv(l.r.id);
      if (preenchido(v, [...Object.keys(VAZIO_RAMPA), ...Object.keys(VAZIO_FUNIL)]))
        rampaSalvar.push({
          loja_id: lojaId || null,
          rampa_id: l.r.id,
          tipo: "semana",
          ...dataDoPeriodo(perRampa(l)),
          degrau: l.est.i,
          preco: l.est.preco,
          vendas: v.vendas === "" ? 0 : Math.round(num(v.vendas)),
          avaliacoes: intOuNull(v.avaliacoes),
          nota: v.nota === "" ? null : num(v.nota),
          avaliacoes_ruins: Math.round(num(v.ruins)),
          ads_gasto: v.gasto === "" ? null : num(v.gasto),
          ads_vendas: intOuNull(v.adsVendas),
          ...(v.cliques !== "" ? { ads_cliques: Math.round(num(v.cliques)) } : {}),
          // Conhecidos (schema v39): em branco = não vai (null).
          ...(v.conhecidos !== "" ? { conhecidos: Math.round(num(v.conhecidos)) } : {}),
          // Funil (schema v36): só vai pro banco quando preenchido — em branco = null, nunca 0.
          ...(v.impressoes !== "" ? { visualizacoes: Math.round(num(v.impressoes)) } : {}),
          ...(v.cliquesProduto !== "" ? { visitas: Math.round(num(v.cliquesProduto)) } : {}),
          ...(v.pedidos !== "" ? { pedidos: Math.round(num(v.pedidos)) } : {}),
        });
      const la = afDe(l);
      if (la && preenchido(v, ["afVendas", "afComissao"]))
        afSalvar.push({
          loja_id: lojaId || null,
          item_tipo: "produto",
          item_id: l.r.produto_id,
          canal_id: l.r.canal_id,
          ...dataDoPeriodo(perRampa(l)),
          preco: l.est.preco,
          vendas: Math.round(num(v.afVendas)),
          comissao: v.afComissao === "" ? cent(num(v.afVendas) * l.est.preco * la.conf.comissao) : num(v.afComissao),
          parceiro_id: v.parceiro || null,
        });
    }
    for (const x of foraRampa) {
      const v = fv(x.chave);
      if (!preenchido(v, ["vendas", "gasto", "cliques", "adsVendas", "conhecidos", "afVendas", "afComissao"])) continue;
      afSalvar.push({
        loja_id: lojaId || null,
        item_tipo: x.tipo,
        item_id: x.id,
        canal_id: x.canal.id,
        ...dataDoPeriodo(perAf(x)),
        preco: x.preco,
        vendas: Math.round(num(v.afVendas)),
        comissao: v.afComissao === "" ? cent(num(v.afVendas) * x.preco * x.conf.comissao) : num(v.afComissao),
        vendas_total: v.vendas === "" ? null : Math.round(num(v.vendas)),
        ads_gasto: v.gasto === "" ? null : num(v.gasto),
        ads_cliques: intOuNull(v.cliques),
        ads_vendas: intOuNull(v.adsVendas),
        ...(v.conhecidos !== "" ? { conhecidos: Math.round(num(v.conhecidos)) } : {}),
        parceiro_id: v.parceiro || null,
      });
    }
    for (const x of soAds) {
      const v = fv(x.chave);
      if (!preenchido(v, ["vendas", "gasto", "cliques", "adsVendas", "conhecidos"])) continue;
      afSalvar.push({
        loja_id: lojaId || null,
        item_tipo: x.tipo,
        item_id: x.id,
        canal_id: x.canal.id,
        ...dataDoPeriodo(perAds(x)),
        preco: x.preco,
        vendas: 0,
        comissao: 0,
        vendas_total: v.vendas === "" ? null : Math.round(num(v.vendas)),
        ads_gasto: v.gasto === "" ? null : num(v.gasto),
        ads_cliques: intOuNull(v.cliques),
        ads_vendas: intOuNull(v.adsVendas),
        ...(v.conhecidos !== "" ? { conhecidos: Math.round(num(v.conhecidos)) } : {}),
        parceiro_id: null,
      });
    }
    if (!rampaSalvar.length && !afSalvar.length) return onToast?.("Preencha pelo menos um item");
    if ([...rampaSalvar, ...afSalvar].some((g) => g.periodo_inicio && g.periodo_inicio >= g.data)) return onToast?.("Período inválido: o “De” precisa ser antes do “Até”");
    const semAf = afSalvar.find((g) => g.vendas_total != null && g.vendas > g.vendas_total);
    if (semAf) return onToast?.("Vendas via afiliado não podem passar das vendas da semana");
    // Ads + afiliado + conhecidos ≤ vendas totais da semana.
    const somaPassa = (total, partes) => total != null && partes.reduce((t, x) => t + num(x), 0) > total;
    for (const r of rampaSalvar) {
      const l = linhas.find((x) => x.r.id === r.rampa_id);
      const afV = afSalvar.find((g) => g.item_tipo === "produto" && g.item_id === l.r.produto_id && g.canal_id === l.r.canal_id && g.vendas_total == null);
      if (somaPassa(r.vendas, [r.ads_vendas, afV?.vendas, r.conhecidos]))
        return onToast?.(`${l.produto.nome}: Ads + afiliado + conhecidos passam das ${r.vendas} vendas da semana`);
    }
    for (const g of afSalvar.filter((x) => x.vendas_total != null))
      if (somaPassa(g.vendas_total, [g.ads_vendas, g.vendas, g.conhecidos])) {
        const x = [...foraRampa, ...soAds].find((y) => y.tipo === g.item_tipo && y.id === g.item_id && y.canal.id === g.canal_id);
        return onToast?.(`${x?.item.nome || "Item"}: Ads + afiliado + conhecidos passam das ${g.vendas_total} vendas da semana`);
      }
    setSalvando(true);
    // Sem o v39 (conhecidos) / v40 (periodo_inicio): grava sem a coluna e avisa.
    const faltou = new Set();
    const inserir = async (tabela, lista) => {
      let atual = lista;
      let res = await supabase.from(tabela).insert(atual);
      for (const col of ["conhecidos", "periodo_inicio"]) {
        if (!res.error || !new RegExp(col).test(res.error.message) || !atual.some((x) => x[col] !== undefined)) continue;
        faltou.add(col);
        atual = atual.map((x) => {
          const y = { ...x };
          delete y[col];
          return y;
        });
        res = await supabase.from(tabela).insert(atual);
      }
      return res;
    };
    if (rampaSalvar.length) {
      const { error } = await inserir("rampa_registros", rampaSalvar);
      if (error) {
        setSalvando(false);
        if (/visualizacoes|visitas|pedidos/.test(error.message)) return onToast?.("Falta rodar o supabase/schema_v36.sql no Supabase");
        return onToast?.(/ads_cliques/.test(error.message) ? "Falta rodar o supabase/schema_v34.sql no Supabase (coluna de cliques)" : `Não foi possível salvar: ${error.message}`);
      }
    }
    if (afSalvar.length) {
      const { error } = await inserir("afiliado_registros", afSalvar);
      if (error) {
        setSalvando(false);
        return onToast?.(/afiliado_registros|schema cache|does not exist/.test(error.message) ? "Falta rodar o supabase/schema_v35.sql no Supabase (afiliados)" : `Não foi possível salvar o afiliado: ${error.message}`);
      }
    }
    setSalvando(false);
    // Recarrega rampas/afiliados já (semana pendente some no Início e no menu sem esperar o realtime).
    window.dispatchEvent(new Event("focus"));
    const n = new Set([
      ...rampaSalvar.map((r) => {
        const l = linhas.find((x) => x.r.id === r.rampa_id);
        return `produto|${l.r.produto_id}|${l.r.canal_id}`;
      }),
      ...afSalvar.map((g) => `${g.item_tipo}|${g.item_id}|${g.canal_id}`),
    ]).size;
    onToast?.(
      faltou.size
        ? `Semana registrada (${n} item${n > 1 ? "s" : ""}) sem ${[...faltou].map((c) => (c === "conhecidos" ? "o campo Conhecidos (schema_v39)" : "o período (schema_v40)")).join(" e ")} — falta rodar o SQL no Supabase`
        : `Semana registrada (${n} item${n > 1 ? "s" : ""})`
    );
    onClose();
  }

  const blocoPeriodo = (id, per) =>
    per ? (
      <div className="alerta alerta-neutro bloco-periodo">
        <b>
          Sem registro desde {diaMes(per.ultimo)} ({per.dias} dias)
        </b>
        No painel da Shopee use “Por dia” (somando os dias) ou importe o relatório desse período. Nas regras semanais os números entram por semana (× 7 ÷ dias).
        <div className="grid-semana" style={{ marginTop: 6 }}>
          <div className="field"><label>De</label><input type="date" value={per.de} onChange={set(id, "de")} /></div>
          <div className="field"><label>Até</label><input type="date" value={per.ate} onChange={set(id, "ate")} /></div>
          <div className="field">
            <label>Período</label>
            <div className="periodo-dias">{per.diasPeriodo} dias ≈ {(per.diasPeriodo / 7).toFixed(1).replace(".", ",")} semanas</div>
          </div>
        </div>
      </div>
    ) : null;

  const blocoAfiliado = (chave, la, preco) => {
    const v = fv(chave);
    const parceiros = (af.parceiros || []).filter((p) => !p.canal_id || p.canal_id === la.canal.id);
    const estimada = num(v.afVendas) > 0 ? cent(num(v.afVendas) * preco * la.conf.comissao) : null;
    return (
      <div className="bloco-afiliado">
        <div className="bloco-afiliado-titulo">Afiliado · comissão {Math.round(la.conf.comissao * 100)}%</div>
        <div className="grid-semana">
          <div className="field"><label>Vendas via afiliado</label><input type="number" min="0" value={v.afVendas} onChange={set(chave, "afVendas")} /></div>
          <div className="field">
            <label>Comissão paga (R$)</label>
            <input type="text" inputMode="decimal" value={v.afComissao} placeholder={estimada != null ? virgula(estimada) : ""} onChange={set(chave, "afComissao")} />
          </div>
          <div className="field">
            <label>Parceiro (opcional)</label>
            <select value={v.parceiro} onChange={set(chave, "parceiro")}>
              <option value="">campanha aberta</option>
              {parceiros.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  return (
    <EditarDialog titulo="Registrar semana" salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Registrar" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>
        Do painel do canal: vendas da semana (unidades vendidas do anúncio), o total de avaliações que aparece no anúncio, a nota, quantas avaliações de 1–2★
        chegaram na semana e, se usou Ads, o gasto e as vendas via Ads. Vendas de amigos/família vão em “Conhecidos” (contam no caixa, não no orgânico). Itens com afiliado ganham o bloco Afiliado (vendas e comissão do painel de afiliados;
        comissão em branco = estimada pelo %). Deixe em branco o que não quiser registrar.
      </p>
      <div className="importar-shopee">
        <label className={`btn btn-mini${lendo ? " disabled" : ""}`}>
          {lendo ? "Lendo…" : "📄 Importar relatórios da Shopee"}
          <input type="file" accept=".xlsx,.csv" multiple hidden onChange={importarRelatorios} disabled={lendo} />
        </label>
        <Ajuda
          texto={
            <>
              Escolha os dois arquivos juntos, com o mesmo período (Últimos 7 Dias):
              <br />• <b>Desempenho</b> (.xlsx): Dados → Informações Gerenciais → Produto → Performance do produto → Exportar dados.
              <br />• <b>Shopee Ads</b> (.csv): Marketing → Shopee Ads → Exportar dados → Dados Gerais de Anúncios.
              <br />O app liga cada anúncio ao produto pelo <b>SKU</b> (o SKU Principal da Shopee = SKU do Cadastros) e preenche vendas (Unidades, pedido pago), impressões, cliques, pedidos e o Ads. Nada é gravado até você clicar em Registrar. Avaliações, nota, 1–2★, conhecidos e afiliado continuam à mão. O arquivo é lido só no seu navegador.
            </>
          }
        />
        {importado && (
          <div className="importar-resumo">
            <b>
              {importado.n ? `${importado.n} ite${importado.n > 1 ? "ns" : "m"} preenchido${importado.n > 1 ? "s" : ""}` : "Nenhum item preenchido"}
            </b>
            {importado.periodo && ` · período ${diaMes(importado.periodo.de)} a ${diaMes(importado.periodo.ate)}`}
            {importado.temAds && importado.totalAds && ` · Ads da loja: ${BRL(importado.totalAds.gasto)}, ${importado.totalAds.cliques} cliques, ${importado.totalAds.vendas} venda${importado.totalAds.vendas === 1 ? "" : "s"}`}
            {!importado.temAds && " · sem o arquivo do Ads (campos de Ads ficam como estão)"}
            {importado.dataAjustada && <div>Data do registro ajustada pra {diaMes(importado.dataAjustada)} (o relatório vai até {diaMes(importado.periodo.ate)}).</div>}
            {importado.avisos.map((a) => (
              <div key={a} className="importar-aviso">⚠ {a}</div>
            ))}
            {importado.semPar.map((i) => (
              <div key={i.itemId} className="importar-aviso">
                ⚠ {i.sku || "sem SKU"} · {i.nome.slice(0, 50)}
                {i.nome.length > 50 ? "…" : ""} ({i.unidades || 0} venda{i.unidades === 1 ? "" : "s"}):{" "}
                {i.existe ? "não está em rampa nem com afiliado na Shopee — fica fora do registro" : "SKU não encontrado no app — confira o SKU em Cadastros"}
              </div>
            ))}
            {importado.adsSemPar
              .filter((a) => !importado.semPar.some((i) => i.itemId === a.itemId))
              .map((a) => (
                <div key={a.itemId} className="importar-aviso">⚠ Ads de “{a.nome.slice(0, 50)}” ({BRL(a.gasto)}) sem produto ligado — confira o SKU em Cadastros</div>
              ))}
            <div className="muted-cel">Confira os campos marcados “do relatório” e complete avaliações, nota, 1–2★ e conhecidos.</div>
          </div>
        )}
      </div>
      <div className="field" style={{ maxWidth: 200 }}>
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      {linhas.map((l) => {
        const la = afDe(l);
        return (
          <div key={l.r.id} className="bloco-semana">
            <div className="bloco-semana-titulo">
              <b>{l.produto.nome}</b> <CanalTag canal={l.canal} /> <span className="muted-cel">em rampa · vendendo {BRL(l.est.preco)} · {l.est.avaliacoesTotal} avaliações até agora</span>
            </div>
            {notaAndamento(l.r.id)}
            {importado?.porChave[l.r.id] && (
              <div className="importar-linha">
                📄 do relatório: {importado.porChave[l.r.id].vendas ?? 0} venda{importado.porChave[l.r.id].vendas === 1 ? "" : "s"}
                {importado.porChave[l.r.id].mistura ? ` (${textoMistura(importado.porChave[l.r.id].mistura)})` : ""}
                {importado.temAds ? (importado.porChave[l.r.id].gasto != null ? ` · Ads ${BRL(importado.porChave[l.r.id].gasto)}` : " · sem Ads") : ""}
              </div>
            )}
            {perRampa(l) ? (
              blocoPeriodo(l.r.id, perRampa(l))
            ) : (
              <AvisoIntervalo
                aviso={avisoIntervalo(
                  l.est.registros.filter((g) => g.tipo === "semana").map((g) => g.data),
                  data,
                  { inicio: l.est.registros.find((g) => g.tipo === "inicio")?.data || null, teste: l.est.teste.status === "andamento" }
                )}
              />
            )}
            <div className="grid-semana">
              <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={fv(l.r.id).vendas} onChange={set(l.r.id, "vendas")} className={doRelatorio(l.r.id, "vendas")} /></div>
              <div className="field"><label>Avaliações (total)</label><input type="number" min="0" value={fv(l.r.id).avaliacoes} onChange={set(l.r.id, "avaliacoes")} /></div>
              <div className="field"><label>Nota</label><input type="text" inputMode="decimal" value={fv(l.r.id).nota} onChange={set(l.r.id, "nota")} /></div>
              <div className="field"><label>1–2★ na semana</label><input type="number" min="0" value={fv(l.r.id).ruins} onChange={set(l.r.id, "ruins")} /></div>
              <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={fv(l.r.id).gasto} onChange={set(l.r.id, "gasto")} className={doRelatorio(l.r.id, "gasto")} /></div>
              <div className="field"><label>Ads: cliques</label><input type="number" min="0" value={fv(l.r.id).cliques} onChange={set(l.r.id, "cliques")} className={doRelatorio(l.r.id, "cliques")} /></div>
              <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={fv(l.r.id).adsVendas} onChange={set(l.r.id, "adsVendas")} className={doRelatorio(l.r.id, "adsVendas")} /></div>
              <div className="field"><label>Conhecidos <Ajuda texto={DICA_CONHECIDOS} /></label><input type="number" min="0" value={fv(l.r.id).conhecidos} onChange={set(l.r.id, "conhecidos")} placeholder="amigos/família" title="vendas de pessoas próximas — contam no caixa, não no orgânico" /></div>
            </div>
            <button type="button" className={`variacoes-toggle${funilAberto.has(l.r.id) ? " aberto" : ""}`} onClick={() => alternarFunil(l.r.id)}>
              <span className="seta">▸</span> {funilAberto.has(l.r.id) ? "impressões, cliques e pedidos" : "+ impressões, cliques e pedidos"}
            </button>
            {funilAberto.has(l.r.id) && (
              <div className="bloco-funil">
                {(() => {
                  const pr = perRampa(l);
                  const per = pr ? { inicio: pr.de, fim: pr.ate, dias: pr.diasPeriodo, modo: "Por dia" } : periodoFunil(l.est.registros, data);
                  return (
                    <p className="hint" style={{ margin: "0 0 6px" }}>
                      Da Shopee: Dados → Informações Gerenciais → Produto (colunas Impressão do Produto, Cliques Por Produto e Produto Pago). Período:{" "}
                      <b>
                        {per.modo} — {diaMes(per.inicio)} a {diaMes(per.fim)}
                      </b>
                      {per.modo === "Por dia" ? ` (${per.dias} dias somados, emendando no registro anterior, sem pular dias)` : ""} — termina ontem porque o dia de hoje ainda não fechou na Shopee. Opcional — o que ficar em branco não é gravado.
                    </p>
                  );
                })()}
                <div className="grid-semana">
                  <div className="field"><label>Impressões de Produto</label><input type="number" min="0" value={fv(l.r.id).impressoes} onChange={set(l.r.id, "impressoes")} className={doRelatorio(l.r.id, "impressoes")} /></div>
                  <div className="field"><label>Cliques Por Produto</label><input type="number" min="0" value={fv(l.r.id).cliquesProduto} onChange={set(l.r.id, "cliquesProduto")} className={doRelatorio(l.r.id, "cliquesProduto")} /></div>
                  <div className="field"><label>Pedidos</label><input type="number" min="0" value={fv(l.r.id).pedidos} onChange={set(l.r.id, "pedidos")} className={doRelatorio(l.r.id, "pedidos")} /></div>
                </div>
              </div>
            )}
            {la && blocoAfiliado(l.r.id, la, l.est.preco)}
          </div>
        );
      })}
      {foraRampa.map((x) => (
        <div key={x.chave} className="bloco-semana">
          <div className="bloco-semana-titulo">
            <b>{x.item.nome}</b> <CanalTag canal={x.canal} /> <span className="muted-cel">fora de rampa · vendendo {BRL(x.preco)}</span>
          </div>
          {notaAndamento(x.chave)}
          {importado?.porChave[x.chave] && (
            <div className="importar-linha">
              📄 do relatório: {importado.porChave[x.chave].vendas ?? 0} venda{importado.porChave[x.chave].vendas === 1 ? "" : "s"}
              {importado.porChave[x.chave].mistura ? ` (${textoMistura(importado.porChave[x.chave].mistura)})` : ""}
            </div>
          )}
          {perAf(x) ? (
            blocoPeriodo(x.chave, perAf(x))
          ) : (
            <AvisoIntervalo
              aviso={avisoIntervalo(
                (af.registros || []).filter((g) => g.item_tipo === x.tipo && g.item_id === x.id && g.canal_id === x.canal.id).map((g) => g.data),
                data
              )}
            />
          )}
          <div className="grid-semana">
            <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={fv(x.chave).vendas} onChange={set(x.chave, "vendas")} className={doRelatorio(x.chave, "vendas")} /></div>
            <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={fv(x.chave).gasto} onChange={set(x.chave, "gasto")} className={doRelatorio(x.chave, "gasto")} /></div>
            <div className="field"><label>Ads: cliques</label><input type="number" min="0" value={fv(x.chave).cliques} onChange={set(x.chave, "cliques")} className={doRelatorio(x.chave, "cliques")} /></div>
            <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={fv(x.chave).adsVendas} onChange={set(x.chave, "adsVendas")} className={doRelatorio(x.chave, "adsVendas")} /></div>
            <div className="field"><label>Conhecidos <Ajuda texto={DICA_CONHECIDOS} /></label><input type="number" min="0" value={fv(x.chave).conhecidos} onChange={set(x.chave, "conhecidos")} placeholder="amigos/família" title="vendas de pessoas próximas — contam no caixa, não no orgânico" /></div>
          </div>
          {blocoAfiliado(x.chave, x, x.preco)}
        </div>
      ))}
      {soAds.map((x) => (
        <div key={x.chave} className="bloco-semana">
          <div className="bloco-semana-titulo">
            <b>{x.item.nome}</b> <CanalTag canal={x.canal} /> <span className="muted-cel">só Ads · vendendo {BRL(x.preco)}</span>
          </div>
          {notaAndamento(x.chave)}
          {importado?.porChave[x.chave] && (
            <div className="importar-linha">
              📄 do relatório: {importado.porChave[x.chave].vendas ?? 0} venda{importado.porChave[x.chave].vendas === 1 ? "" : "s"}
              {importado.porChave[x.chave].mistura ? ` (${textoMistura(importado.porChave[x.chave].mistura)})` : ""}
              {importado.temAds ? (importado.porChave[x.chave].gasto != null ? ` · Ads ${BRL(importado.porChave[x.chave].gasto)}` : " · sem Ads") : ""}
            </div>
          )}
          {perAds(x) ? (
            blocoPeriodo(x.chave, perAds(x))
          ) : (
            <AvisoIntervalo
              aviso={avisoIntervalo(
                (af.registros || []).filter((g) => g.item_tipo === x.tipo && g.item_id === x.id && g.canal_id === x.canal.id).map((g) => g.data),
                data
              )}
            />
          )}
          <div className="grid-semana">
            <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={fv(x.chave).vendas} onChange={set(x.chave, "vendas")} className={doRelatorio(x.chave, "vendas")} /></div>
            <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={fv(x.chave).gasto} onChange={set(x.chave, "gasto")} className={doRelatorio(x.chave, "gasto")} /></div>
            <div className="field"><label>Ads: cliques</label><input type="number" min="0" value={fv(x.chave).cliques} onChange={set(x.chave, "cliques")} className={doRelatorio(x.chave, "cliques")} /></div>
            <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={fv(x.chave).adsVendas} onChange={set(x.chave, "adsVendas")} className={doRelatorio(x.chave, "adsVendas")} /></div>
            <div className="field"><label>Conhecidos <Ajuda texto={DICA_CONHECIDOS} /></label><input type="number" min="0" value={fv(x.chave).conhecidos} onChange={set(x.chave, "conhecidos")} placeholder="amigos/família" /></div>
          </div>
        </div>
      ))}
    </EditarDialog>
  );
}
