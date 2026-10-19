import { usePreferencia } from "../hooks/usePreferencia.js";
import { useSubAba } from "../lib/subAbas.js";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { BRL } from "../lib/format.js";
import {
  CATEGORIAS,
  rotuloCategoria,
  hojeISO,
  mesDe,
  somarMeses,
  dataNoMes,
  rotuloMes,
  ocorrenciasRecorrentes,
  lancamentosReais,
  saldoRealizado,
  mediaMensal,
  mesesDaMedia,
  projetar,
  statusLancamento,
  loadEstimativas,
} from "../lib/fluxoCaixa.js";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import ResumoFixo from "./ResumoFixo.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import EditarDialog from "./EditarDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CompraMaterialDialog from "./CompraMaterialDialog.jsx";
import { dividirParcelas, linhasParceladas } from "../lib/comprasMaterial.js";
import Estado from "./Estado.jsx";
import VendasMes from "./VendasMes.jsx";
import { recarregarReserva, useReservaProducao } from "../hooks/useReservaProducao.js";
import { saldoReserva } from "../lib/vendasMes.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { saldoAds } from "../lib/saldoAds.js";
import SaldoAdsCaixa from "./SaldoAdsCaixa.jsx";
import Payoff from "./Payoff.jsx";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";

const IGNORAR_COMPRA_KEY = "ohra:caixa:ignorar-compra";

// Sub-abas (out/2026): o dia a dia, o que repete/parcela, e o resultado das vendas.
const SUBABAS_CAIXA = [
  { key: "caixa", label: "1 · Caixa" },
  { key: "contas", label: "2 · Contas fixas e parcelas" },
  { key: "vendas", label: "3 · Vendas do mês" },
  { key: "payoff", label: "4 · Payoff" },
];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function somarDiasISO(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// "Compra PLA (2/3)" → "Compra PLA"
const semSufixoParcela = (d) => String(d || "").replace(/\s*\(\d+\/\d+\)\s*$/, "");

const novoForm = (tipo) => ({
  id: null,
  tipo,
  descricao: "",
  valor: "",
  categoria: tipo === "entrada" ? "venda" : "filamento",
  canal_id: "",
  data_prevista: hojeISO(),
  realizado: tipo === "entrada" ? false : true,
  data_realizada: hojeISO(),
  recorrente: false,
  recorrencia_ate: "",
  parcelado: false,
  parcelas: "",
  observacao: "",
  modeloId: null, // confirmando uma ocorrência de recorrente
  usarReserva: false, // saída paga com a reserva de produção (schema v51)
});

const STATUS_BADGE = {
  // Regra única de cores: pago/recebido = OK (sem cor, só ✓); saída atrasada
  // = conta vencida (resolver); entrada atrasada = atenção.
  recebido: ["neutro", "✓ Recebido"],
  pago: ["neutro", "✓ Pago"],
  previsto: ["", "Previsto"],
  atrasado: ["warn", "⚠ Atrasado"],
};

export default function FluxoCaixa({ onToast }) {
  const { lojaId } = useLoja();
  const [lancamentos, setLancamentos] = useState([]);
  const { canaisTodos, produtos: prodsCat, kits: kitsCat, variacoes: varsCat } = useCatalogo();
  const { grupos: gruposAds } = useAnunciosGrupo();
  const canais = useMemo(() => [...canaisTodos].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR")), [canaisTodos]);
  const [carregando, setCarregando] = useState(!!supabase);
  const [erroTabela, setErroTabela] = useState(null);
  const [form, setForm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [excluirGrupo, setExcluirGrupo] = useState(false); // ao excluir uma parcela: também as outras em aberto
  const [compraDialog, setCompraDialog] = useState(null); // {} nova | { lancamento, grupo } completar | { inicial }
  const [ignorados, setIgnorados] = usePreferencia("caixa:ignorar-compra", [], { legado: IGNORAR_COMPRA_KEY });
  const [verPendentes, setVerPendentes] = useState(false);
  const [verTabela, setVerTabela] = useState(() => {
    try {
      return localStorage.getItem("ohra:caixa:ver-tabela") === "1";
    } catch {
      return false;
    }
  });
  const [editGrupo, setEditGrupo] = useState(null); // { g, descricao, categoria, data1 } editando um parcelamento
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  const hoje = hojeISO();
  const mesAtual = mesDe(hoje);
  const [mesFiltro, setMesFiltro] = useState(mesAtual);
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [horizonte, setHorizonte] = useState(12);
  // Estimativas da projeção: no banco (preferencias_loja, v59) — iguais em todo aparelho.
  const [estimativas, setEstimativas] = usePreferencia("caixa:estimativas", { vendas: "", custos: "" }, { legado: () => loadEstimativas(lojaId), legadoPorLoja: true });
  const [sub] = useSubAba("ohra:caixa:sub", "caixa", SUBABAS_CAIXA.map((x) => x.key));
  // Período de Vendas do mês (navegação — fica no aparelho).
  const [periodoVendas, setPeriodoVendas] = useState(() => {
    try {
      return localStorage.getItem("ohra:vendas:periodo") || "mes";
    } catch {
      return "mes";
    }
  });
  const trocarPeriodoVendas = (v) => {
    setPeriodoVendas(v);
    try {
      localStorage.setItem("ohra:vendas:periodo", v);
    } catch {
      // sem problema
    }
  };
  const [verConfig, setVerConfig] = useState(false);
  const reserva = useReservaProducao();
  const adsP = useAdsPeriodos();
  const [baseAds] = usePreferencia("caixa:saldo-ads-base", null);
  // Nome do anúncio de um período de Ads (cartão "de onde vem o gasto").
  const nomeDoPeriodoAds = (p) => {
    if (p.item_tipo === "loja") return "GMV Max da Loja";
    if (p.item_tipo === "grupo") return `Anúncio: ${(gruposAds || []).find((g) => g.id === p.item_id)?.nome || "vários itens"}`;
    if (p.item_tipo === "kit") return (kitsCat || []).find((k) => k.id === p.item_id)?.nome || "Kit";
    if (p.item_tipo === "variacao") {
      const v = (varsCat || []).find((x) => x.id === p.item_id);
      const pai = v && (prodsCat || []).find((x) => x.id === v.produto_id);
      return pai ? `${pai.nome} — ${v.quantidade} un.` : "Variação";
    }
    return (prodsCat || []).find((x) => x.id === p.item_id)?.nome || "Produto";
  };
  const saldoDeAds = useMemo(() => (adsP.disponivel ? saldoAds({ lancamentos, periodos: adsP.periodos, hoje, base: baseAds }) : null), [adsP.disponivel, adsP.periodos, lancamentos, hoje, baseAds]);
  const saldoDaReserva = useMemo(() => saldoReserva(reserva.registros).saldo, [reserva.registros]);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      try {
        let ql = supabase.from("lancamentos_caixa").select("*").order("data_prevista", { ascending: false });
        if (lojaId) ql = ql.eq("loja_id", lojaId);
        const rl = await ql;
        if (!ativo) return;
        if (rl.error) setErroTabela(rl.error.message);
        else {
          setErroTabela(null);
          setLancamentos(rl.data || []);
        }
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const ch = supabase
      .channel("fluxo-caixa-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lancamentos_caixa" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [lojaId]);

  // --- Números do topo e projeção ---
  const saldoAtual = useMemo(() => saldoRealizado(lancamentos, hoje), [lancamentos, hoje]);
  const mediaVendas = useMemo(() => mediaMensal(lancamentos, "entrada", mesAtual), [lancamentos, mesAtual]);
  const mediaCustos = useMemo(() => mediaMensal(lancamentos, "saida", mesAtual), [lancamentos, mesAtual]);
  const vendasEst = estimativas.vendas === "" ? mediaVendas : Number(estimativas.vendas) || 0;
  const custosEst = estimativas.custos === "" ? mediaCustos : Number(estimativas.custos) || 0;

  const projecao = useMemo(
    () => projetar(lancamentos, { mesAtual, meses: horizonte, mesesPassados: MESES_PASSADOS, vendasEstimadas: vendasEst, custosEstimados: custosEst }),
    [lancamentos, mesAtual, horizonte, vendasEst, custosEst]
  );
  // Gráfico e tabela: os meses passados (só realizado) + a projeção.
  const linhasProjecao = [...projecao.passado, ...projecao.linhas];
  const iMesAtual = projecao.passado.length;
  // Mês escolhido (clique no gráfico/tabela ou o seletor dos Lançamentos):
  // os KPIs do topo mostram ele. Mesma conta da projeção, cobrindo os 12
  // meses antes e depois (alcance do seletor), pra qualquer mês escolhido.
  const projecaoAmpla = useMemo(
    () => projetar(lancamentos, { mesAtual, meses: 13, mesesPassados: 12, vendasEstimadas: vendasEst, custosEstimados: custosEst }),
    [lancamentos, mesAtual, vendasEst, custosEst]
  );
  const linhaSel = [...projecaoAmpla.passado, ...projecaoAmpla.linhas].find((l) => l.mes === mesFiltro) || mesCorrente;
  const selFase = mesFiltro < mesAtual ? "passado" : mesFiltro > mesAtual ? "futuro" : "atual";
  const mesCorrente = projecao.linhas[0];
  const menor = projecao.linhas.reduce((m, l) => (!m || l.saldoFinal < m.saldoFinal ? l : m), null);

  // --- Lista do mês filtrado (inclui ocorrências de recorrentes ainda não confirmadas) ---
  const listaMes = useMemo(() => {
    const reais = lancamentosReais(lancamentos).filter((l) => mesDe(l.data_realizada || l.data_prevista) === mesFiltro);
    const virtuais = ocorrenciasRecorrentes(lancamentos, mesFiltro, mesFiltro);
    return [...reais, ...virtuais]
      .filter((l) => tipoFiltro === "todos" || (tipoFiltro === "aberto" ? !l.data_realizada : l.tipo === tipoFiltro))
      .sort((a, b) => (a.data_realizada || a.data_prevista).localeCompare(b.data_realizada || b.data_prevista));
  }, [lancamentos, mesFiltro, tipoFiltro]);
  const mostrarCanal = listaMes.some((l) => l.canal_id);
  const totalMesEntradas = listaMes.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalMesSaidas = listaMes.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);

  const modelos = lancamentos.filter((l) => l.recorrencia === "mensal");

  // Parcelamentos: linhas com o mesmo parcela_grupo (schema v32).
  const grupos = useMemo(() => {
    const m = new Map();
    for (const l of lancamentos) {
      if (!l.parcela_grupo) continue;
      if (!m.has(l.parcela_grupo)) m.set(l.parcela_grupo, []);
      m.get(l.parcela_grupo).push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.parcela_num || 0) - (b.parcela_num || 0));
    return m;
  }, [lancamentos]);
  const parcelamentos = useMemo(
    () =>
      [...grupos.entries()]
        .map(([id, arr]) => {
          const abertas = arr.filter((l) => !l.data_realizada);
          return {
            id,
            linhas: arr,
            tipo: arr[0].tipo,
            categoria: arr[0].categoria,
            descricao: semSufixoParcela(arr[0].descricao),
            total: arr.reduce((s, l) => s + Number(l.valor || 0), 0),
            n: arr[0].parcela_total || arr.length,
            pagas: arr.length - abertas.length,
            abertas,
            proxima: abertas[0] || null,
          };
        })
        .filter((g) => g.abertas.length > 0)
        .sort((a, b) => a.proxima.data_prevista.localeCompare(b.proxima.data_prevista)),
    [grupos]
  );

  // Saídas de material sem os dados da compra (só depois do schema v32, quando
  // a coluna compra_material_id existe) — uma por compra (parcelas juntas).
  const pendentesCompra = useMemo(() => {
    const vistos = new Set();
    const out = [];
    for (const l of lancamentos) {
      if (l.tipo !== "saida" || l.categoria !== "filamento" || l.recorrencia === "mensal") continue;
      if (!("compra_material_id" in l) || l.compra_material_id) continue;
      const chave = l.parcela_grupo || l.id;
      if (vistos.has(chave) || ignorados.includes(chave)) continue;
      vistos.add(chave);
      out.push({ chave, lancamento: l, grupo: l.parcela_grupo ? grupos.get(l.parcela_grupo) : null });
    }
    return out.sort((a, b) => b.lancamento.data_prevista.localeCompare(a.lancamento.data_prevista));
  }, [lancamentos, grupos, ignorados]);

  function ignorarPendente(chave) {
    setIgnorados((prev) => [...(prev || []), chave]);
  }
  const canalNome = (id) => canais.find((c) => c.id === id)?.nome || "";

  const temSaldoInicial = lancamentos.some((l) => l.categoria === "saldo_inicial");
  const usandoMediaCustos = estimativas.custos === "" && mediaCustos > 0;
  const nMesesMedia = mesesDaMedia(lancamentos, mesAtual).size;
  const textoMeses = nMesesMedia === 1 ? "do último mês fechado" : `dos ${nMesesMedia} últimos meses fechados`;
  const usandoMediaVendas = estimativas.vendas === "" && mediaVendas > 0;

  // --- Ações ---
  function abrirNovo(tipo) {
    setForm(novoForm(tipo));
  }

  function abrirRecargaAds() {
    const shopee = (canais || []).find((c) => c.tipo === "shopee");
    setForm({ ...novoForm("saida"), descricao: "Recarga de Ads (Shopee)", categoria: "anuncios", canal_id: shopee?.id || "", realizado: true });
  }

  function abrirSaldoInicial() {
    const primeira = lancamentos.reduce((m, l) => (!m || (l.data_realizada || l.data_prevista) < m ? l.data_realizada || l.data_prevista : m), null);
    setForm({ ...novoForm("entrada"), descricao: "Saldo inicial", categoria: "saldo_inicial", realizado: true, data_prevista: primeira || hoje, data_realizada: primeira || hoje });
  }

  function alternarTabela() {
    setVerTabela((v) => {
      try {
        localStorage.setItem("ohra:caixa:ver-tabela", v ? "0" : "1");
      } catch {
        // sem problema
      }
      return !v;
    });
  }

  function abrirEdicao(l) {
    setForm({
      id: l.id,
      tipo: l.tipo,
      descricao: l.descricao,
      valor: String(l.valor ?? ""),
      categoria: l.categoria,
      canal_id: l.canal_id || "",
      data_prevista: l.data_prevista,
      realizado: !!l.data_realizada,
      data_realizada: l.data_realizada || hoje,
      recorrente: l.recorrencia === "mensal",
      recorrencia_ate: l.recorrencia_ate || "",
      observacao: l.observacao || "",
      modeloId: null,
    });
  }

  function abrirConfirmacaoOcorrencia(l) {
    setForm({
      ...novoForm(l.tipo),
      descricao: l.descricao,
      valor: String(l.valor ?? ""),
      categoria: l.categoria,
      canal_id: l.canal_id || "",
      data_prevista: l.data_prevista,
      realizado: true,
      data_realizada: l.data_prevista < hoje ? l.data_prevista : hoje,
      observacao: l.observacao || "",
      modeloId: l.modeloId,
    });
  }

  async function salvar() {
    const valor = Number(String(form.valor).replace(",", "."));
    if (!form.descricao.trim()) return onToast?.("Informe uma descrição");
    if (!isFinite(valor) || valor <= 0) return onToast?.("Informe um valor maior que zero");
    if (!form.data_prevista) return onToast?.("Informe a data");
    const registro = {
      loja_id: lojaId || null,
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      categoria: form.categoria,
      canal_id: form.canal_id || null,
      valor,
      data_prevista: form.data_prevista,
      data_realizada: !form.recorrente && form.realizado ? form.data_realizada || hoje : null,
      recorrencia: form.recorrente ? "mensal" : "nenhuma",
      recorrencia_ate: form.recorrente && form.recorrencia_ate ? form.recorrencia_ate : null,
      recorrencia_origem_id: form.modeloId || null,
      observacao: form.observacao.trim() || null,
    };
    const parcelado = !form.id && !form.modeloId && !form.recorrente && form.parcelado;
    const parcInformadas = Math.round(Number(form.parcelas));
    if (parcelado && !(parcInformadas >= 2 && parcInformadas <= 60)) return onToast?.("Informe o nº de parcelas (2 a 60)");
    const nParc = Math.max(2, Math.min(60, parcInformadas || 2));
    setSalvando(true);
    const r = form.id
      ? await supabase.from("lancamentos_caixa").update(registro).eq("id", form.id)
      : parcelado
        ? await supabase.from("lancamentos_caixa").insert(
            linhasParceladas(registro, {
              valorTotal: valor,
              parcelas: nParc,
              data1: form.data_prevista,
              primeiraRealizada: form.realizado,
              hoje,
            })
          )
        : form.usarReserva
          ? await supabase.from("lancamentos_caixa").insert(registro).select("id").single()
          : await supabase.from("lancamentos_caixa").insert(registro);
    setSalvando(false);
    const { error } = r;
    if (error)
      return onToast?.(
        parcelado && /parcela_/.test(error.message) ? "Falta rodar o supabase/schema_v32.sql no Supabase pra parcelar." : `Não foi possível salvar: ${error.message}`
      );
    // Saída paga com a reserva de produção (schema v51): sai também da reserva.
    if (!form.id && form.usarReserva && form.tipo === "saida" && !form.recorrente) {
      const rr = await supabase
        .from("reserva_producao")
        .insert({ loja_id: lojaId || null, tipo: "usar", valor, data: form.realizado ? form.data_realizada || hoje : form.data_prevista, descricao: form.descricao.trim(), lancamento_id: r.data?.id || null });
      if (rr.error) onToast?.(/reserva_producao/i.test(rr.error.message) ? "Saída lançada, mas falta rodar o supabase/schema_v51.sql pra usar a reserva" : `Saída lançada, mas a reserva não foi atualizada: ${rr.error.message}`);
      else recarregarReserva();
    }
    onToast?.(form.id ? "Lançamento atualizado" : form.recorrente ? "Lançamento recorrente criado" : parcelado ? `Parcelado em ${nParc}× registrado` : "Lançamento registrado");
    setForm(null);
  }

  async function alternarRealizado(l) {
    const { error } = await supabase
      .from("lancamentos_caixa")
      .update({ data_realizada: l.data_realizada ? null : hoje })
      .eq("id", l.id);
    if (error) return onToast?.(`Não foi possível atualizar: ${error.message}`);
    setLancamentos((prev) => prev.map((x) => (x.id === l.id ? { ...x, data_realizada: l.data_realizada ? null : hoje } : x)));
  }

  async function excluir(l, comGrupo = false) {
    const { error } = await supabase.from("lancamentos_caixa").delete().eq("id", l.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    let ids = [l.id];
    if (comGrupo && l.parcela_grupo) {
      const r = await supabase.from("lancamentos_caixa").delete().eq("parcela_grupo", l.parcela_grupo).is("data_realizada", null);
      if (!r.error) ids = ids.concat((grupos.get(l.parcela_grupo) || []).filter((x) => !x.data_realizada).map((x) => x.id));
    }
    setLancamentos((prev) => prev.filter((x) => !ids.includes(x.id)));
    onToast?.(ids.length > 1 ? `${ids.length} parcelas excluídas` : "Lançamento excluído");
  }

  // Editar parcelamento: descrição/categoria em todas as parcelas; a data da
  // 1ª parcela redistribui as datas das parcelas EM ABERTO (uma por mês, mesmo
  // dia). As já pagas/recebidas mantêm a data em que aconteceram.
  function abrirEdicaoGrupo(g) {
    const primeira = g.linhas.find((l) => l.parcela_num === 1) || g.linhas[0];
    setEditGrupo({ g, descricao: g.descricao, categoria: g.categoria, data1: primeira.data_prevista });
  }

  async function salvarGrupo() {
    const { g, descricao, categoria, data1 } = editGrupo;
    if (!descricao.trim()) return onToast?.("Informe uma descrição");
    if (!data1) return onToast?.("Informe a data da 1ª parcela");
    setSalvandoGrupo(true);
    const n = g.n;
    const mudancas = g.linhas.map((l, i) => {
      const num = l.parcela_num || i + 1;
      const upd = { descricao: `${descricao.trim()} (${num}/${n})`, categoria };
      if (!l.data_realizada) upd.data_prevista = num === 1 ? data1 : dataNoMes(data1, somarMeses(mesDe(data1), num - 1));
      return { id: l.id, upd };
    });
    for (const { id, upd } of mudancas) {
      const { error } = await supabase.from("lancamentos_caixa").update(upd).eq("id", id);
      if (error) {
        setSalvandoGrupo(false);
        return onToast?.(`Não foi possível salvar: ${error.message}`);
      }
    }
    setLancamentos((prev) => prev.map((x) => ({ ...x, ...(mudancas.find((m) => m.id === x.id)?.upd || {}) })));
    setSalvandoGrupo(false);
    setEditGrupo(null);
    onToast?.("Parcelamento atualizado");
  }

  // Parcelamento: exclui só as parcelas ainda em aberto (as pagas ficam).
  async function excluirAbertas(g) {
    const { error } = await supabase.from("lancamentos_caixa").delete().eq("parcela_grupo", g.id).is("data_realizada", null);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    const ids = g.abertas.map((x) => x.id);
    setLancamentos((prev) => prev.filter((x) => !ids.includes(x.id)));
    onToast?.(`${ids.length} parcela${ids.length > 1 ? "s" : ""} em aberto excluída${ids.length > 1 ? "s" : ""}`);
  }

  // --- Telas de estado ---
  if (!supabase) {
    return (
      <div className="panel">
        <h3>Fluxo de Caixa</h3>
        <div className="empty">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }
  if (carregando) {
    return (
      <div className="panel">
        <div className="empty">Carregando…</div>
      </div>
    );
  }
  if (erroTabela) {
    return (
      <div className="panel">
        <h3>Fluxo de Caixa</h3>
        <div className="empty">
          A tabela do fluxo de caixa ainda não existe no banco — rode o <strong>supabase/schema_v25.sql</strong> no SQL Editor do Supabase e
          recarregue a página.
        </div>
      </div>
    );
  }

  const mesesFiltro = Array.from({ length: 25 }, (_, i) => somarMeses(mesAtual, i - 12));
  const iMesSel = mesesFiltro.indexOf(mesFiltro);
  // Reserva de produção (schema v51): parte do saldo que está separada pra repor a produção.
  const livre = saldoAtual - saldoDaReserva;
  // Pendências do caixa numa linha só (saldo inicial + compras de material sem dados).
  const faltaSaldoInicial = !temSaldoInicial && lancamentos.length > 0;
  const nPendencias = (faltaSaldoInicial ? 1 : 0) + pendentesCompra.length;
  // Lançamentos do mês agrupados por dia.
  const porDia = [];
  for (const l of listaMes) {
    const d = l.data_realizada || l.data_prevista;
    const g = porDia[porDia.length - 1];
    if (g && g.data === d) g.itens.push(l);
    else porDia.push({ data: d, itens: [l] });
  }
  const rotuloDia = (d) => (d === hoje ? "Hoje" : d === somarDiasISO(hoje, -1) ? "Ontem" : d === somarDiasISO(hoje, 1) ? "Amanhã" : `${DIAS_SEMANA[new Date(`${d}T12:00:00`).getDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`);

  const seletorMes = (
    <div className="seletor-mes">
      <button type="button" className="btn btn-mini btn-icone" disabled={iMesSel <= 0} onClick={() => setMesFiltro(mesesFiltro[iMesSel - 1])} aria-label="Mês anterior">
        ‹
      </button>
      <select value={mesFiltro} onChange={(e) => setMesFiltro(e.target.value)} aria-label="Mês">
        {mesesFiltro.map((m) => (
          <option key={m} value={m}>
            {rotuloMes(m)}
            {m === mesAtual ? " (atual)" : ""}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-mini btn-icone" disabled={iMesSel >= mesesFiltro.length - 1} onClick={() => setMesFiltro(mesesFiltro[iMesSel + 1])} aria-label="Próximo mês">
        ›
      </button>
      {mesFiltro !== mesAtual && (
        <button type="button" className="link-btn" onClick={() => setMesFiltro(mesAtual)}>
          voltar ao mês atual
        </button>
      )}
    </div>
  );

  return (
    <>
      <TopbarAcoes aba="caixa">
        <button type="button" className="btn so-pc" onClick={() => setCompraDialog({})} title="Registra a compra (atualiza o preço/kg do material) e cria a saída — à vista ou parcelada">
          Compra de material
        </button>
        <button type="button" className="btn" onClick={() => abrirNovo("saida")}>
          − Saída
        </button>
        <button type="button" className="btn primary" onClick={() => abrirNovo("entrada")}>
          + Entrada
        </button>
      </TopbarAcoes>

      <div className="caixa-cabecalho">
        {sub !== "contas" && sub !== "payoff" && (sub !== "vendas" || periodoVendas === "mes") && seletorMes}
        {sub === "vendas" && (
          <select className="seletor-periodo" value={periodoVendas} onChange={(e) => trocarPeriodoVendas(e.target.value)} aria-label="Período das vendas">
            <option value="mes">Mês escolhido</option>
            <option value="2">Últimos 2 meses</option>
            <option value="3">Últimos 3 meses</option>
            <option value="6">Último semestre</option>
            <option value="12">Último ano</option>
            <option value="tudo">Todo o período</option>
          </select>
        )}
      </div>

      {sub === "caixa" && (
        <>
          <ResumoFixo>
            <Kpis
              itens={[
                {
                  label: "Saldo atual",
                  valor: BRL(saldoAtual),
                  tom: saldoAtual >= 0 ? "destaque" : "bad",
                  sub: reserva.disponivel && saldoDaReserva > 0 ? `livre ${BRL(livre)} · reserva de produção ${BRL(saldoDaReserva)}` : "tudo que já foi recebido − pago",
                },
                {
                  label: `Entradas de ${rotuloMes(mesFiltro)}`,
                  valor: BRL(linhaSel?.entradas || 0),
                  sub:
                    selFase === "passado"
                      ? `${BRL(linhaSel?.entradasRealizadas || 0)} recebido`
                      : `${BRL(linhaSel?.entradasRealizadas || 0)} recebido · ${BRL(linhaSel?.entradasPrevistas || 0)} a receber${linhaSel?.entradasEstimadas ? ` · ${BRL(linhaSel.entradasEstimadas)} estimado` : ""}`,
                },
                {
                  label: `Saídas de ${rotuloMes(mesFiltro)}`,
                  valor: BRL(linhaSel?.saidas || 0),
                  sub:
                    selFase === "passado"
                      ? `${BRL(linhaSel?.saidasRealizadas || 0)} pago`
                      : `${BRL(linhaSel?.saidasRealizadas || 0)} pago · ${BRL(linhaSel?.saidasPrevistas || 0)} a pagar${linhaSel?.saidasEstimadas ? ` · ${BRL(linhaSel.saidasEstimadas)} estimado` : ""}`,
                },
                {
                  label: `Saldo no fim de ${rotuloMes(mesFiltro)}${selFase === "futuro" ? " (projetado)" : ""}`,
                  valor: BRL(linhaSel?.saldoFinal || 0),
                  tom: (linhaSel?.saldoFinal || 0) >= 0 ? undefined : "bad",
                  sub:
                    menor && menor.saldoFinal < 0
                      ? `fica negativo em ${rotuloMes(menor.mes)} (${BRL(menor.saldoFinal)})`
                      : `menor saldo da projeção: ${BRL(menor?.saldoFinal || 0)} em ${rotuloMes(menor?.mes || mesAtual)}`,
                },
              ]}
            />
          </ResumoFixo>

          <SaldoAdsCaixa s={saldoDeAds} hoje={hoje} onRecarga={abrirRecargaAds} nomeDe={nomeDoPeriodoAds} />

          {nPendencias > 0 && (
            <div className={`pendencias-caixa${verPendentes ? " aberto" : ""}`}>
              <button type="button" className="pendencias-caixa-cab" onClick={() => setVerPendentes((v) => !v)}>
                <Estado tipo="atencao">{nPendencias === 1 ? "1 pendência" : `${nPendencias} pendências`}</Estado>
                <span className="muted-cel">
                  {[faltaSaldoInicial && "falta o saldo inicial", pendentesCompra.length > 0 && `${pendentesCompra.length} compra${pendentesCompra.length > 1 ? "s" : ""} de material sem dados`].filter(Boolean).join(" · ")}
                </span>
                <span className="link-btn">{verPendentes ? "esconder" : "ver"}</span>
              </button>
              {verPendentes && (
                <ul className="lista-pendentes">
                  {faltaSaldoInicial && (
                    <li>
                      <span>
                        <b>Falta o saldo inicial</b> — o saldo começa em zero, então as primeiras saídas deixam ele negativo. Lance quanto a loja tinha em caixa antes do primeiro lançamento.
                      </span>
                      <span>
                        <button type="button" className="btn btn-mini primary" onClick={abrirSaldoInicial}>Lançar saldo inicial</button>
                      </span>
                    </li>
                  )}
                  {pendentesCompra.map((p) => (
                    <li key={p.chave}>
                      <span>
                        <b>Compra sem dados</b> {p.lancamento.data_prevista.slice(8, 10)}/{p.lancamento.data_prevista.slice(5, 7)} · {semSufixoParcela(p.lancamento.descricao)} ·{" "}
                        {BRL(p.grupo ? p.grupo.reduce((t, l) => t + Number(l.valor || 0), 0) : p.lancamento.valor)}
                        {p.grupo ? ` (${p.grupo.length}×)` : ""} — sem material e quantidade, não entra na média de preço/kg
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-mini primary" onClick={() => setCompraDialog({ lancamento: p.lancamento, grupo: p.grupo })}>
                          Completar
                        </button>{" "}
                        <button type="button" className="btn btn-mini" title="Não é compra de material (ex.: frete, ferramenta) — não avisar mais" onClick={() => ignorarPendente(p.chave)}>
                          Ignorar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="panel">
            <h3 className="section-title h3-split">
              <span>
                Projeção de caixa
                <Ajuda texto="Os 3 meses antes do atual mostram só o que de fato caiu/saiu (realizado). Do mês atual em diante, o saldo soma o que já caiu/saiu, os lançamentos previstos (atrasados entram no mês atual), as contas fixas e parcelas e, nos meses futuros, a estimativa de vendas e custos por mês (⚙ Projeção). Clique num mês pra ver ele no topo e nos lançamentos." />
              </span>
              <button type="button" className={`btn btn-mini${verConfig ? " primary" : ""}`} onClick={() => setVerConfig((x) => !x)}>
                ⚙ Projeção
              </button>
            </h3>
            {verConfig && (
              <div className="grid-auto caixa-config">
                <div className="field">
                  <label>Horizonte</label>
                  <select value={horizonte} onChange={(e) => setHorizonte(Number(e.target.value))}>
                    <option value={3}>3 meses</option>
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses</option>
                  </select>
                </div>
                <div className="field">
                  <label title="Entradas que você espera por mês além dos lançamentos já previstos">Vendas estimadas / mês (R$)</label>
                  <input type="number" step="0.01" min="0" placeholder={`média: ${BRL(mediaVendas)}`} value={estimativas.vendas} onChange={(e) => setEstimativas((p) => ({ ...p, vendas: e.target.value }))} />
                  {usandoMediaVendas && (
                    <span className="campo-nota">
                      usando a média {textoMeses} ·{" "}
                      <button type="button" className="link-btn" onClick={() => setEstimativas((p) => ({ ...p, vendas: "0" }))}>usar 0</button>
                    </span>
                  )}
                </div>
                <div className="field">
                  <label title="Saídas variáveis que você espera por mês (material, frete, anúncios…) além das recorrentes">Custos variáveis / mês (R$)</label>
                  <input type="number" step="0.01" min="0" placeholder={`média: ${BRL(mediaCustos)}`} value={estimativas.custos} onChange={(e) => setEstimativas((p) => ({ ...p, custos: e.target.value }))} />
                  {usandoMediaCustos && (
                    <span className="campo-nota aviso">
                      somando {BRL(mediaCustos)}/mês de estimativa (média {textoMeses}) ·{" "}
                      <button type="button" className="link-btn" onClick={() => setEstimativas((p) => ({ ...p, custos: "0" }))}>usar 0</button>
                    </span>
                  )}
                </div>
              </div>
            )}
            {!verConfig && (usandoMediaVendas || usandoMediaCustos) && (
              <div className="grafico-sel">
                Meses futuros com estimativa pela média {textoMeses}
                {usandoMediaVendas ? ` (vendas ${BRL(mediaVendas)}/mês)` : ""}
                {usandoMediaCustos ? ` (custos ${BRL(mediaCustos)}/mês)` : ""} ·{" "}
                <button type="button" className="link-btn" onClick={() => setVerConfig(true)}>ajustar</button>
              </div>
            )}

            <GraficoProjecao linhas={linhasProjecao} iAtual={iMesAtual} selecionado={mesFiltro} onSelecionar={setMesFiltro} />

            <div className="tabela-toggle">
              <button type="button" className={`variacoes-toggle${verTabela ? " aberto" : ""}`} onClick={alternarTabela}>
                <span className="seta">▸</span> {verTabela ? "Esconder" : "Ver"} mês a mês
              </button>
            </div>
            {verTabela && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="num">Entradas</th>
                      <th className="num">Saídas</th>
                      <th className="num">Resultado</th>
                      <th className="num">Saldo no fim do mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasProjecao.map((l, i) => (
                      <tr
                        key={l.mes}
                        className={`linha-clicavel${i === iMesAtual ? " linha-atual" : l.passado ? " linha-passado" : ""}${l.mes === mesFiltro ? " linha-sel" : ""}`}
                        onClick={() => setMesFiltro(l.mes)}
                        title="Mostrar este mês no topo e nos lançamentos"
                      >
                        <td>
                          {rotuloMes(l.mes)}
                          {i === iMesAtual && <span className="h3-contagem">mês atual</span>}
                          {l.passado && <span className="h3-contagem">realizado</span>}
                        </td>
                        <td className="num" title={l.passado ? `Recebido ${BRL(l.entradasRealizadas)}` : `Recebido ${BRL(l.entradasRealizadas)} · previsto ${BRL(l.entradasPrevistas)} · estimado ${BRL(l.entradasEstimadas)}`}>
                          {BRL(l.entradas)}
                          {l.entradasEstimadas > 0 && <div className="sub-num">{BRL(l.entradasEstimadas)} estimado</div>}
                        </td>
                        <td className="num" title={l.passado ? `Pago ${BRL(l.saidasRealizadas)}` : `Pago ${BRL(l.saidasRealizadas)} · previsto ${BRL(l.saidasPrevistas)} · estimado ${BRL(l.saidasEstimadas)}`}>
                          {BRL(l.saidas)}
                          {l.saidasEstimadas > 0 && <div className="sub-num">{BRL(l.saidasEstimadas)} estimado</div>}
                        </td>
                        <td className="num" style={{ color: l.resultado >= 0 ? "var(--good)" : "var(--bad)" }}>
                          {l.resultado >= 0 ? "+" : ""}
                          {BRL(l.resultado)}
                        </td>
                        <td className="num" style={{ fontWeight: 600, color: l.saldoFinal < 0 ? "var(--bad)" : undefined }}>
                          {BRL(l.saldoFinal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3 className="section-title h3-split">
              <span>
                Lançamentos de {rotuloMes(mesFiltro)}
                <Ajuda texto="Entradas e saídas do mês escolhido, por dia. “Previsto” é o que ainda vai cair/sair (ex.: repasse da Shopee que só libera depois da entrega) — marque como recebido/pago quando acontecer. Linhas com ↻ são contas fixas: “Confirmar” grava o valor real daquele mês. Contas fixas e parcelas ficam na 2ª sub-aba." />
              </span>
              <span className="toolbar-info">
                <span style={{ color: "var(--good)" }}>+{BRL(totalMesEntradas)}</span> · <span>−{BRL(totalMesSaidas)}</span>
              </span>
            </h3>
            <div className="toolbar">
              <div className="subabas subabas-compacta">
                {[
                  ["todos", "Tudo"],
                  ["entrada", "Entradas"],
                  ["saida", "Saídas"],
                  ["aberto", "A pagar / receber"],
                ].map(([k, label]) => (
                  <button key={k} className={`btn${tipoFiltro === k ? " primary" : ""}`} onClick={() => setTipoFiltro(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {listaMes.length === 0 ? (
              <div className="empty">
                {tipoFiltro === "todos" ? `Nenhum lançamento em ${rotuloMes(mesFiltro)}. Use “+ Entrada” ou “− Saída” no topo.` : "Nada com esse filtro neste mês."}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="tabela-lancamentos">
                  <tbody>
                    {porDia.map((g) => {
                      const somaDia = g.itens.reduce((t, l) => t + (l.tipo === "entrada" ? 1 : -1) * Number(l.valor || 0), 0);
                      return (
                        <Fragment key={g.data}>
                          <tr className="dia-cab">
                            <td colSpan={3}>{rotuloDia(g.data)}</td>
                            <td className="num">
                              {somaDia >= 0 ? "+" : "−"}
                              {BRL(Math.abs(somaDia))}
                            </td>
                            <td></td>
                          </tr>
                          {g.itens.map((l) => {
                            const st = statusLancamento(l, hoje);
                            const [tom0, texto0] = STATUS_BADGE[st];
                            const vencida = st === "atrasado" && l.tipo === "saida";
                            const tom = vencida ? "bad" : tom0;
                            const texto = vencida ? "! Vencida" : texto0;
                            const gp = l.parcela_grupo ? grupos.get(l.parcela_grupo) : null;
                            return (
                              <tr key={l.id} className="lanc-linha">
                                <td className="lanc-cat">
                                  <i className={`ponto-cat cat-${l.tipo}`} />
                                </td>
                                <td>
                                  <div className="lanc-desc">
                                    {(l.virtual || l.recorrencia_origem_id) && <span title="Conta fixa (repete todo mês)" className="lanc-rec">↻</span>}
                                    {gp ? semSufixoParcela(l.descricao) : l.descricao}
                                    {gp && (
                                      <span
                                        className="chip-parcela"
                                        title={`Parcelado ${l.parcela_total || gp.length}× · total ${BRL(gp.reduce((t, x) => t + Number(x.valor || 0), 0))} · ${gp.filter((x) => x.data_realizada).length} ${l.tipo === "entrada" ? "recebidas" : "pagas"}`}
                                      >
                                        {l.parcela_num || "?"}/{l.parcela_total || gp.length}
                                      </span>
                                    )}
                                  </div>
                                  <div className="lanc-sub">
                                    {rotuloCategoria(l.tipo, l.categoria)}
                                    {mostrarCanal && l.canal_id ? ` · ${canalNome(l.canal_id)}` : ""}
                                    {l.observacao ? ` · ${l.observacao}` : ""}
                                  </div>
                                </td>
                                <td>
                                  <span className={`badge${tom ? ` ${tom}` : " neutro"}`}>{texto}</span>
                                </td>
                                <td className="num lanc-valor" style={{ color: l.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}>
                                  {l.tipo === "entrada" ? "+" : "−"}
                                  {BRL(l.valor)}
                                </td>
                                <td className="num" style={{ whiteSpace: "nowrap" }}>
                                  {l.virtual ? (
                                    <button className="btn btn-mini" onClick={() => abrirConfirmacaoOcorrencia(l)}>
                                      Confirmar
                                    </button>
                                  ) : (
                                    <>
                                      <button className="btn btn-mini" onClick={() => alternarRealizado(l)} title={l.data_realizada ? "Voltar pra previsto" : "Marcar como feito hoje"}>
                                        {l.data_realizada ? "Desfazer" : l.tipo === "entrada" ? "Recebido" : "Pago"}
                                      </button>
                                      <span className="acoes-linha">
                                        <button className="del" title="Editar" onClick={() => abrirEdicao(l)}>✎</button>
                                        <button className="del" title="Excluir" onClick={() => setExcluirAlvo(l)}>×</button>
                                      </span>
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {sub === "contas" && (
        <>
          <Kpis
            itens={[
              { label: "Contas fixas / mês", valor: BRL(modelos.filter((m) => m.tipo === "saida" && (!m.recorrencia_ate || mesDe(m.recorrencia_ate) >= mesAtual)).reduce((t, m) => t + Number(m.valor || 0), 0)), sub: `${modelos.filter((m) => m.tipo === "saida").length} saída(s) que repetem todo mês` },
              { label: "Receitas fixas / mês", valor: BRL(modelos.filter((m) => m.tipo === "entrada" && (!m.recorrencia_ate || mesDe(m.recorrencia_ate) >= mesAtual)).reduce((t, m) => t + Number(m.valor || 0), 0)), sub: `${modelos.filter((m) => m.tipo === "entrada").length} entrada(s) que repetem todo mês` },
              {
                label: "Parcelas em aberto",
                valor: BRL(parcelamentos.filter((g) => g.tipo === "saida").reduce((t, g) => t + g.abertas.reduce((u, l) => u + Number(l.valor || 0), 0), 0)),
                sub: `${parcelamentos.length} parcelamento(s) em andamento`,
              },
            ]}
          />
          <div className="panel">
            <h3 className="section-title">
              Contas fixas (repetem todo mês)
              <Ajuda texto="Contas e receitas que se repetem todo mês (energia, internet, assinatura, parcela da impressora, mensalidade…). Elas entram sozinhas na projeção, uma vez por mês, até a data final (ou sem fim). Pra criar, marque “Repete todo mês” no lançamento (+ Entrada / − Saída)." />
            </h3>
            {modelos.length === 0 ? (
              <div className="empty">Nenhuma ainda — marque “Repete todo mês” em + Entrada / − Saída (energia, internet, assinatura…).</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th>Dia</th>
                      <th>Desde</th>
                      <th>Até</th>
                      <th className="num">Valor / mês</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelos.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <i className={`ponto-cat cat-${m.tipo}`} /> {m.descricao}
                        </td>
                        <td className="muted-cel">{rotuloCategoria(m.tipo, m.categoria)}</td>
                        <td>dia {Number(m.data_prevista.slice(8, 10))}</td>
                        <td>{rotuloMes(mesDe(m.data_prevista))}</td>
                        <td>{m.recorrencia_ate ? rotuloMes(mesDe(m.recorrencia_ate)) : "sem fim"}</td>
                        <td className="num" style={{ fontWeight: 600, color: m.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}>
                          {m.tipo === "entrada" ? "+" : "−"}
                          {BRL(m.valor)}
                        </td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>
                          <span className="acoes-linha">
                            <button className="del" title="Editar" onClick={() => abrirEdicao(m)}>✎</button>
                            <button className="del" title="Excluir" onClick={() => setExcluirAlvo(m)}>×</button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3 className="section-title">
              Parcelados em aberto
              <Ajuda texto="Compras e recebimentos parcelados (uma linha por parcela, todo mês). Marque cada parcela como paga/recebida nos lançamentos do mês (sub-aba Caixa). “Excluir em aberto” apaga só as parcelas que ainda não foram pagas — as pagas continuam registradas." />
            </h3>
            {parcelamentos.length === 0 ? (
              <div className="empty">Nenhum parcelamento em aberto — marque “Parcelado” ao lançar uma entrada ou saída.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th>Parcelas</th>
                      <th>Próxima</th>
                      <th className="num">Total</th>
                      <th className="num">Em aberto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelamentos.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <i className={`ponto-cat cat-${g.tipo}`} /> {g.descricao}
                        </td>
                        <td className="muted-cel">{rotuloCategoria(g.tipo, g.categoria)}</td>
                        <td>
                          {g.pagas} de {g.n} {g.tipo === "entrada" ? "recebida" : "paga"}
                          {g.pagas !== 1 ? "s" : ""}
                          <div className="barra-progresso" title={`${Math.round((g.pagas / g.n) * 100)}% ${g.tipo === "entrada" ? "recebido" : "pago"}`}>
                            <i style={{ width: `${(g.pagas / g.n) * 100}%` }} />
                          </div>
                        </td>
                        <td>
                          {g.proxima.data_prevista.slice(8, 10)}/{g.proxima.data_prevista.slice(5, 7)}/{g.proxima.data_prevista.slice(0, 4)} · {BRL(g.proxima.valor)}
                        </td>
                        <td className="num">{BRL(g.total)}</td>
                        <td className="num" style={{ fontWeight: 600, color: g.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}>
                          {g.tipo === "entrada" ? "+" : "−"}
                          {BRL(g.abertas.reduce((t, l) => t + Number(l.valor || 0), 0))}
                        </td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-mini" title="Editar descrição, categoria e a data da 1ª parcela (as outras acompanham, uma por mês)" onClick={() => abrirEdicaoGrupo(g)}>
                            Editar
                          </button>
                          <span className="acoes-linha">
                            <button className="del" title="Excluir as parcelas em aberto" onClick={() => setExcluirAlvo({ grupoParcelas: g })}>×</button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {sub === "vendas" && <VendasMes mes={mesFiltro} periodo={periodoVendas} onToast={onToast} />}
      {sub === "payoff" && <Payoff lancamentos={lancamentos} hoje={hoje} saldoAds={saldoDeAds} reservaRegistros={reserva.registros} />}

      {form && (
        <EditarDialog
          titulo={form.id ? "Editar lançamento" : form.modeloId ? "Confirmar ocorrência" : form.tipo === "entrada" ? "Nova entrada" : "Nova saída"}
          salvando={salvando}
          onSalvar={salvar}
          onCancelar={() => setForm(null)}
          salvarLabel={form.id ? "Salvar alterações" : "Salvar"}
        >
          {!form.id && !form.modeloId && (
            <div className="subabas" style={{ marginBottom: 12 }}>
              {[
                ["entrada", "Entrada"],
                ["saida", "Saída"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`btn${form.tipo === k ? " primary" : ""}`}
                  onClick={() => setForm((p) => ({ ...p, tipo: k, categoria: CATEGORIAS[k][0].key }))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="field">
            <label>Descrição</label>
            <input
              type="text"
              autoFocus
              value={form.descricao}
              placeholder={form.tipo === "entrada" ? "ex: Repasse Shopee semana 38" : "ex: 3 rolos PLA Silk"}
              onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
            />
          </div>
          <div className="row2">
            <div className="field">
              <label>{form.parcelado && !form.recorrente ? "Valor total (R$)" : "Valor (R$)"}</label>
              <input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))} />
            </div>
            <div className="field">
              <label>Categoria</label>
              <select value={form.categoria} onChange={(e) => setForm((p) => ({ ...p, categoria: e.target.value }))}>
                {CATEGORIAS[form.tipo].map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>{form.recorrente ? "Primeira data" : form.parcelado ? "Data da 1ª parcela" : "Data prevista"}</label>
              <input type="date" value={form.data_prevista} onChange={(e) => setForm((p) => ({ ...p, data_prevista: e.target.value }))} />
            </div>
            <div className="field">
              <label>Canal (opcional)</label>
              <select value={form.canal_id} onChange={(e) => setForm((p) => ({ ...p, canal_id: e.target.value }))}>
                <option value="">—</option>
                {canais.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {!form.id && !form.modeloId && form.tipo === "saida" && form.categoria === "filamento" && (
            <div className="aviso-fluxo">
              É compra de filamento/material?{" "}
              <button
                type="button"
                className="btn btn-mini primary"
                onClick={() => {
                  setCompraDialog({ inicial: { valor: form.valor, data: form.data_prevista, pago: form.realizado, observacao: form.observacao } });
                  setForm(null);
                }}
              >
                Registrar como compra de material
              </button>{" "}
              — informa material e quantidade, atualiza o preço/kg pela média e cria a saída (à vista ou parcelada).
            </div>
          )}
          {!form.id && !form.modeloId && form.tipo === "saida" && !form.recorrente && reserva.disponivel && (
            <label className="check-linha" title="Material, embalagem, peça ou manutenção: sai também da reserva de produção (Vendas do mês)">
              <input type="checkbox" checked={form.usarReserva} onChange={(e) => setForm((p) => ({ ...p, usarReserva: e.target.checked }))} />
              Pago com a reserva de produção {saldoDaReserva > 0 ? `(saldo ${BRL(saldoDaReserva)})` : ""}
            </label>
          )}
          {!form.modeloId && !form.parcelado && (
            <label className="check-linha">
              <input type="checkbox" checked={form.recorrente} onChange={(e) => setForm((p) => ({ ...p, recorrente: e.target.checked }))} />
              Repete todo mês
            </label>
          )}
          {!form.id && !form.modeloId && !form.recorrente && (
            <label className="check-linha">
              <input type="checkbox" checked={form.parcelado} onChange={(e) => setForm((p) => ({ ...p, parcelado: e.target.checked }))} />
              Parcelado (uma parcela por mês)
            </label>
          )}
          {form.parcelado && !form.recorrente && (() => {
            const total = Number(String(form.valor).replace(",", ".")) || 0;
            const informadas = Math.round(Number(form.parcelas));
            const n = Math.max(2, Math.min(60, informadas || 2));
            const vals = total > 0 && informadas >= 2 ? dividirParcelas(total, n) : null;
            return (
              <div className="field">
                <label>Nº de parcelas</label>
                <input type="number" min="2" max="60" step="1" placeholder="ex: 10" value={form.parcelas} onChange={(e) => setForm((p) => ({ ...p, parcelas: e.target.value }))} />
                {vals && (
                  <div className="hint" style={{ margin: "4px 0 0" }}>
                    {n}× de {BRL(vals[n - 1])}
                    {vals[0] !== vals[n - 1] ? ` (1ª ${BRL(vals[0])})` : ""} — a 1ª na data acima, as outras no mesmo dia dos meses seguintes.
                  </div>
                )}
              </div>
            );
          })()}
          {form.recorrente ? (
            <div className="field">
              <label>Até (opcional — em branco = sem fim)</label>
              <input type="date" value={form.recorrencia_ate} onChange={(e) => setForm((p) => ({ ...p, recorrencia_ate: e.target.value }))} />
            </div>
          ) : (
            <>
              <label className="check-linha">
                <input type="checkbox" checked={form.realizado} onChange={(e) => setForm((p) => ({ ...p, realizado: e.target.checked }))} />
                {form.parcelado ? (form.tipo === "entrada" ? "1ª parcela já recebida" : "1ª parcela já paga") : form.tipo === "entrada" ? "Já recebido" : "Já pago"}
              </label>
              {form.realizado && (
                <div className="field">
                  <label>{form.tipo === "entrada" ? "Recebido em" : "Pago em"}</label>
                  <input type="date" value={form.data_realizada} onChange={(e) => setForm((p) => ({ ...p, data_realizada: e.target.value }))} />
                </div>
              )}
            </>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Observação (opcional)</label>
            <input type="text" value={form.observacao} onChange={(e) => setForm((p) => ({ ...p, observacao: e.target.value }))} />
          </div>
        </EditarDialog>
      )}

      {editGrupo && (() => {
        const { g, data1 } = editGrupo;
        const datas = data1 ? g.linhas.map((l, i) => {
          const num = l.parcela_num || i + 1;
          return l.data_realizada ? null : num === 1 ? data1 : dataNoMes(data1, somarMeses(mesDe(data1), num - 1));
        }).filter(Boolean) : [];
        const fmt = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
        return (
          <EditarDialog titulo="Editar parcelamento" salvando={salvandoGrupo} onSalvar={salvarGrupo} onCancelar={() => setEditGrupo(null)}>
            <p className="hint" style={{ marginTop: 0 }}>
              {g.n}× · total {BRL(g.total)} · {g.pagas} de {g.n} {g.tipo === "entrada" ? "recebida" : "paga"}{g.pagas !== 1 ? "s" : ""}. Valores das parcelas não mudam.
            </p>
            <div className="field">
              <label>Descrição</label>
              <input type="text" value={editGrupo.descricao} onChange={(e) => setEditGrupo((p) => ({ ...p, descricao: e.target.value }))} />
            </div>
            <div className="row2">
              <div className="field">
                <label>Data da 1ª parcela (vencimento)</label>
                <input type="date" value={editGrupo.data1} onChange={(e) => setEditGrupo((p) => ({ ...p, data1: e.target.value }))} />
              </div>
              <div className="field">
                <label>Categoria</label>
                <select value={editGrupo.categoria} onChange={(e) => setEditGrupo((p) => ({ ...p, categoria: e.target.value }))}>
                  {CATEGORIAS[g.tipo].map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {datas.length > 0 && (
              <p className="hint" style={{ marginTop: 0 }}>
                Parcelas em aberto vão vencer de <b>{fmt(datas[0])}</b> a <b>{fmt(datas[datas.length - 1])}</b>, uma por mês
                {g.pagas > 0 ? " (as já pagas ficam com a data em que foram pagas)" : ""}.
              </p>
            )}
          </EditarDialog>
        );
      })()}

      {excluirAlvo?.grupoParcelas && (
        <ConfirmDialog
          titulo="Excluir parcelas em aberto"
          mensagem={`Excluir as ${excluirAlvo.grupoParcelas.abertas.length} parcela(s) ainda em aberto de "${excluirAlvo.grupoParcelas.descricao}"? As já pagas/recebidas continuam registradas.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluirAbertas(excluirAlvo.grupoParcelas);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
      {excluirAlvo && !excluirAlvo.grupoParcelas && (
        <ConfirmDialog
          titulo="Excluir lançamento"
          mensagem={
            excluirAlvo.recorrencia === "mensal"
              ? `Excluir o recorrente "${excluirAlvo.descricao}"? Ele sai da projeção dos próximos meses (os meses já confirmados continuam registrados).`
              : `Excluir "${excluirAlvo.descricao}" (${BRL(excluirAlvo.valor)})? Não é possível desfazer.`
          }
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo, excluirGrupo);
            setExcluirAlvo(null);
            setExcluirGrupo(false);
          }}
          onCancel={() => {
            setExcluirAlvo(null);
            setExcluirGrupo(false);
          }}
        >
          {excluirAlvo.parcela_grupo && (grupos.get(excluirAlvo.parcela_grupo) || []).filter((x) => !x.data_realizada && x.id !== excluirAlvo.id).length > 0 && (
            <label className="check-linha">
              <input type="checkbox" checked={excluirGrupo} onChange={(e) => setExcluirGrupo(e.target.checked)} />
              Excluir também as outras parcelas em aberto ({(grupos.get(excluirAlvo.parcela_grupo) || []).filter((x) => !x.data_realizada && x.id !== excluirAlvo.id).length})
            </label>
          )}
        </ConfirmDialog>
      )}

      {compraDialog && (
        <CompraMaterialDialog lancamento={compraDialog.lancamento} grupo={compraDialog.grupo} inicial={compraDialog.inicial} onToast={onToast} onClose={() => setCompraDialog(null)} />
      )}
    </>
  );
}

// Gráfico da projeção (out/2026): por mês, entradas (verde) e saídas (cinza)
// em barras LADO A LADO a partir do zero, com a parte ESTIMADA (campos de
// estimativa) clara e tracejada; por cima, a LINHA do saldo no fim do mês —
// contínua no que já aconteceu, tracejada na projeção — e uma faixa vermelha
// clara abaixo de zero (mês que fica negativo salta aos olhos). Eixo com
// números "redondos". Passar o mouse/tocar num mês mostra os valores; clicar
// escolhe o mês da tela.
const MESES_PASSADOS = 3;

function passoBonito(bruto) {
  const p = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const f = bruto / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function GraficoProjecao({ linhas, iAtual = 0, selecionado, onSelecionar }) {
  const [hover, setHover] = useState(null);
  if (!linhas.length) return null;
  const W = 960;
  const H = 270;
  const padL = 58;
  const padR = 12;
  const padT = 22;
  const padB = 26;
  const reaisE = (l) => l.entradas - l.entradasEstimadas;
  const reaisS = (l) => l.saidas - l.saidasEstimadas;
  let max = Math.max(0, ...linhas.flatMap((l) => [l.entradas, l.saidas, l.saldoFinal]));
  let min = Math.min(0, ...linhas.map((l) => l.saldoFinal));
  if (max === min) max = min + 100;
  const passo = passoBonito((max - min) / 4);
  max = Math.ceil(max / passo) * passo;
  min = Math.floor(min / passo) * passo;
  const ticks = [];
  for (let t = min; t <= max + 1e-6; t += passo) ticks.push(t);
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);
  const larguraMes = (W - padL - padR) / linhas.length;
  const barra = Math.max(4, Math.min(18, larguraMes * 0.26));
  const cx = (i) => padL + larguraMes * i + larguraMes / 2;
  const fmtCurto = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : Math.round(v).toLocaleString("pt-BR"));
  const iSel = linhas.findIndex((l) => l.mes === selecionado);
  const h = hover != null ? linhas[hover] : iSel >= 0 ? linhas[iSel] : null;
  const temEstimado = linhas.some((l) => l.entradasEstimadas || l.saidasEstimadas);
  const y0 = y(0);
  const ret = (x, v0, v1, cls) => {
    const a = y(v0);
    const b = y(v1);
    const top = Math.min(a, b);
    const alt = Math.abs(b - a);
    return alt > 0.3 ? <rect x={x} y={top} width={barra} height={alt} rx="2" className={cls} /> : null;
  };
  // Saldo: contínuo até o mês atual (o que já aconteceu), tracejado depois.
  const pts = linhas.map((l, i) => `${cx(i)},${y(l.saldoFinal)}`);
  const feito = pts.slice(0, iAtual + 1).join(" ");
  const projetado = pts.slice(iAtual).join(" ");

  return (
    <div className="grafico-caixa">
      <div className="grafico-legenda">
        <span><i className="leg-entrada" />Entradas</span>
        <span><i className="leg-saida" />Saídas</span>
        {temEstimado && <span><i className="leg-estimado" />Estimativa</span>}
        <span><i className="leg-saldo" />Saldo no fim do mês</span>
        <span><i className="leg-saldo-proj" />projetado</span>
      </div>
      <div className="grafico-cartao-mes">
        {h ? (
          <>
            <b>{rotuloMes(h.mes)}</b>
            <span className="muted-cel">{h.passado ? "realizado" : linhas.indexOf(h) === iAtual ? "mês atual" : "projeção"}</span>
            <span>
              entradas <b style={{ color: "var(--good)" }}>{BRL(h.entradas)}</b>
            </span>
            <span>
              saídas <b>{BRL(h.saidas)}</b>
            </span>
            <span>
              resultado <b style={{ color: h.resultado >= 0 ? "var(--good)" : "var(--bad)" }}>{h.resultado >= 0 ? "+" : ""}{BRL(h.resultado)}</b>
            </span>
            <span>
              saldo <b style={{ color: h.saldoFinal < 0 ? "var(--bad)" : undefined }}>{BRL(h.saldoFinal)}</b>
            </span>
            {h.saidasEstimadas || h.entradasEstimadas ? <span className="muted-cel">com estimativa</span> : null}
          </>
        ) : (
          <span className="muted-cel">passe o mouse ou clique num mês</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Projeção de entradas, saídas e saldo por mês" onMouseLeave={() => setHover(null)}>
        {min < 0 && <rect x={padL} y={y0} width={W - padL - padR} height={H - padB - y0} className="faixa-negativa" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grade"} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="eixo">{fmtCurto(t)}</text>
          </g>
        ))}
        {linhas.map((l, i) => {
          const xE = cx(i) - barra - 1;
          const xS = cx(i) + 1;
          return (
            <g key={l.mes}>
              {i < iAtual && <rect x={padL + larguraMes * i} y={padT} width={larguraMes} height={H - padT - padB} className="faixa-passado" />}
              {iSel === i && <rect x={padL + larguraMes * i} y={padT} width={larguraMes} height={H - padT - padB} className="faixa-sel" />}
              {hover === i && iSel !== i && <rect x={padL + larguraMes * i} y={padT} width={larguraMes} height={H - padT - padB} className="faixa-hover" />}
              {ret(xE, 0, reaisE(l), "barra-entrada")}
              {ret(xE, reaisE(l), l.entradas, "barra-entrada estimada")}
              {ret(xS, 0, reaisS(l), "barra-saida")}
              {ret(xS, reaisS(l), l.saidas, "barra-saida estimada")}
              <text x={cx(i)} y={H - 8} textAnchor="middle" className={`eixo${i === iAtual ? " eixo-atual" : ""}${i === iSel ? " eixo-sel" : ""}`}>{rotuloMes(l.mes, i === 0 || i === iAtual || l.mes.endsWith("-01"))}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} className="zero" />
        {iAtual > 0 && (
          <g>
            <line x1={padL + larguraMes * iAtual} x2={padL + larguraMes * iAtual} y1={padT - 12} y2={H - padB} className="divisa-passado" />
            <text x={padL + larguraMes * iAtual - 6} y={padT - 4} textAnchor="end" className="eixo">realizado</text>
            <text x={padL + larguraMes * iAtual + 6} y={padT - 4} textAnchor="start" className="eixo">projeção</text>
          </g>
        )}
        <polyline points={feito} className="linha-saldo" />
        {pts.length > iAtual + 1 && <polyline points={projetado} className="linha-saldo projetada" />}
        {linhas.map((l, i) => (
          <circle key={l.mes} cx={cx(i)} cy={y(l.saldoFinal)} r={hover === i || iSel === i ? 5 : 3.5} className={`ponto-saldo${l.saldoFinal < 0 ? " negativo" : ""}${i > iAtual ? " projetado" : ""}`} />
        ))}
        {linhas.map((l, i) => (
          <rect key={l.mes} x={padL + larguraMes * i} y={0} width={larguraMes} height={H} fill="transparent" style={{ cursor: "pointer" }} onMouseEnter={() => setHover(i)} onClick={() => onSelecionar?.(l.mes)}>
            <title>{`${rotuloMes(l.mes)}: entradas ${BRL(l.entradas)}, saídas ${BRL(l.saidas)}, saldo ${BRL(l.saldoFinal)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
