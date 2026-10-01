import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
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
  projetar,
  statusLancamento,
} from "../lib/fluxoCaixa.js";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import EditarDialog from "./EditarDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CompraMaterialDialog from "./CompraMaterialDialog.jsx";
import { dividirParcelas, linhasParceladas } from "../lib/comprasMaterial.js";

const ESTIMATIVA_KEY = "ohra:caixa:estimativas";
const IGNORAR_COMPRA_KEY = "ohra:caixa:ignorar-compra";

function loadIgnorados() {
  try {
    return JSON.parse(localStorage.getItem(IGNORAR_COMPRA_KEY) || "[]");
  } catch {
    return [];
  }
}

// "Compra PLA (2/3)" → "Compra PLA"
const semSufixoParcela = (d) => String(d || "").replace(/\s*\(\d+\/\d+\)\s*$/, "");

function loadEstimativas(lojaId) {
  try {
    const raw = JSON.parse(localStorage.getItem(ESTIMATIVA_KEY) || "{}");
    return raw[lojaId || "sem-loja"] || { vendas: "", custos: "" };
  } catch {
    return { vendas: "", custos: "" };
  }
}

function saveEstimativas(lojaId, valor) {
  try {
    const raw = JSON.parse(localStorage.getItem(ESTIMATIVA_KEY) || "{}");
    raw[lojaId || "sem-loja"] = valor;
    localStorage.setItem(ESTIMATIVA_KEY, JSON.stringify(raw));
  } catch {
    // sem problema, só não lembra da próxima vez
  }
}

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
  parcelas: 2,
  observacao: "",
  modeloId: null, // confirmando uma ocorrência de recorrente
});

const STATUS_BADGE = {
  recebido: ["good", "✓ Recebido"],
  pago: ["good", "✓ Pago"],
  previsto: ["", "Previsto"],
  atrasado: ["warn", "Atrasado"],
};

export default function FluxoCaixa({ onToast }) {
  const { lojaId } = useLoja();
  const [lancamentos, setLancamentos] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(!!supabase);
  const [erroTabela, setErroTabela] = useState(null);
  const [form, setForm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [excluirGrupo, setExcluirGrupo] = useState(false); // ao excluir uma parcela: também as outras em aberto
  const [compraDialog, setCompraDialog] = useState(null); // {} nova | { lancamento, grupo } completar | { inicial }
  const [ignorados, setIgnorados] = useState(loadIgnorados);
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
  const [estimativas, setEstimativas] = useState(() => loadEstimativas(lojaId));

  useEffect(() => {
    saveEstimativas(lojaId, estimativas);
  }, [lojaId, estimativas]);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      try {
        let ql = supabase.from("lancamentos_caixa").select("*").order("data_prevista", { ascending: false });
        let qc = supabase.from("canais").select("id, nome, tipo").order("nome");
        if (lojaId) {
          ql = ql.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
        }
        const [rl, rc] = await Promise.all([ql, qc]);
        if (!ativo) return;
        if (rl.error) setErroTabela(rl.error.message);
        else {
          setErroTabela(null);
          setLancamentos(rl.data || []);
        }
        if (!rc.error) setCanais(rc.data || []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
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
    () => projetar(lancamentos, { mesAtual, meses: horizonte, vendasEstimadas: vendasEst, custosEstimados: custosEst }),
    [lancamentos, mesAtual, horizonte, vendasEst, custosEst]
  );
  const mesCorrente = projecao.linhas[0];
  const ultimo = projecao.linhas[projecao.linhas.length - 1];
  const menor = projecao.linhas.reduce((m, l) => (!m || l.saldoFinal < m.saldoFinal ? l : m), null);

  // --- Lista do mês filtrado (inclui ocorrências de recorrentes ainda não confirmadas) ---
  const listaMes = useMemo(() => {
    const reais = lancamentosReais(lancamentos).filter((l) => mesDe(l.data_realizada || l.data_prevista) === mesFiltro);
    const virtuais = ocorrenciasRecorrentes(lancamentos, mesFiltro, mesFiltro);
    return [...reais, ...virtuais]
      .filter((l) => tipoFiltro === "todos" || l.tipo === tipoFiltro)
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
    setIgnorados((prev) => {
      const next = [...prev, chave];
      try {
        localStorage.setItem(IGNORAR_COMPRA_KEY, JSON.stringify(next));
      } catch {
        // sem problema
      }
      return next;
    });
  }
  const canalNome = (id) => canais.find((c) => c.id === id)?.nome || "";

  const temSaldoInicial = lancamentos.some((l) => l.categoria === "saldo_inicial");
  const usandoMediaCustos = estimativas.custos === "" && mediaCustos > 0;
  const usandoMediaVendas = estimativas.vendas === "" && mediaVendas > 0;

  // --- Ações ---
  function abrirNovo(tipo) {
    setForm(novoForm(tipo));
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
    const nParc = Math.max(2, Math.min(60, Math.round(Number(form.parcelas)) || 2));
    setSalvando(true);
    const { error } = form.id
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
        : await supabase.from("lancamentos_caixa").insert(registro);
    setSalvando(false);
    if (error)
      return onToast?.(
        parcelado && /parcela_/.test(error.message) ? "Falta rodar o supabase/schema_v32.sql no Supabase pra parcelar." : `Não foi possível salvar: ${error.message}`
      );
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

      <Kpis
        itens={[
          { label: "Saldo atual", valor: BRL(saldoAtual), tom: saldoAtual >= 0 ? "destaque" : "bad", sub: "tudo que já foi recebido − pago" },
          {
            label: `Entradas de ${rotuloMes(mesAtual)}`,
            valor: BRL((mesCorrente?.entradasRealizadas || 0) + (mesCorrente?.entradasPrevistas || 0)),
            tom: "good",
            sub: `${BRL(mesCorrente?.entradasRealizadas || 0)} recebido · ${BRL(mesCorrente?.entradasPrevistas || 0)} a receber`,
          },
          {
            label: `Saídas de ${rotuloMes(mesAtual)}`,
            valor: BRL((mesCorrente?.saidasRealizadas || 0) + (mesCorrente?.saidasPrevistas || 0)),
            sub: `${BRL(mesCorrente?.saidasRealizadas || 0)} pago · ${BRL(mesCorrente?.saidasPrevistas || 0)} a pagar`,
          },
          {
            label: `Saldo projetado (${rotuloMes(ultimo?.mes || mesAtual)})`,
            valor: BRL(ultimo?.saldoFinal || 0),
            tom: (ultimo?.saldoFinal || 0) >= 0 ? "good" : "bad",
            sub:
              menor && menor.saldoFinal < 0
                ? `fica negativo em ${rotuloMes(menor.mes)} (${BRL(menor.saldoFinal)})`
                : `menor saldo: ${BRL(menor?.saldoFinal || 0)} em ${rotuloMes(menor?.mes || mesAtual)}`,
          },
        ]}
      />

      {!temSaldoInicial && lancamentos.length > 0 && (
        <div className="alerta alerta-warn">
          <b>Falta o saldo inicial</b>
          O saldo começa em zero, então as primeiras saídas deixam ele negativo. Lance quanto a loja tinha em caixa antes do primeiro lançamento.{" "}
          <button type="button" className="btn btn-mini primary" onClick={abrirSaldoInicial}>Lançar saldo inicial</button>
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          Projeção de caixa
          <Ajuda texto="Saldo mês a mês a partir do saldo atual: soma o que já caiu/saiu, os lançamentos previstos (atrasados entram no mês atual), as recorrências mensais e, nos meses futuros, a estimativa de vendas e custos variáveis por mês. Deixe a estimativa em branco pra usar a média dos últimos 3 meses fechados (sem recorrentes, saldo inicial e aportes)." />
        </h3>
        <div className="grid-auto">
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
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={`média: ${BRL(mediaVendas)}`}
              value={estimativas.vendas}
              onChange={(e) => setEstimativas((p) => ({ ...p, vendas: e.target.value }))}
            />
            {usandoMediaVendas && (
              <span className="campo-nota">
                usando a média dos 3 últimos meses ·{" "}
                <button type="button" className="link-btn" onClick={() => setEstimativas((p) => ({ ...p, vendas: "0" }))}>usar 0</button>
              </span>
            )}
          </div>
          <div className="field">
            <label title="Saídas variáveis que você espera por mês (material, frete, anúncios…) além das recorrentes">Custos variáveis / mês (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={`média: ${BRL(mediaCustos)}`}
              value={estimativas.custos}
              onChange={(e) => setEstimativas((p) => ({ ...p, custos: e.target.value }))}
            />
            {usandoMediaCustos && (
              <span className="campo-nota aviso">
                somando {BRL(mediaCustos)}/mês de estimativa (média) ·{" "}
                <button type="button" className="link-btn" onClick={() => setEstimativas((p) => ({ ...p, custos: "0" }))}>usar 0</button>
              </span>
            )}
          </div>
        </div>

        <GraficoProjecao linhas={projecao.linhas} />

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
              {projecao.linhas.map((l, i) => (
                <tr key={l.mes} className={i === 0 ? "linha-atual" : ""}>
                  <td>
                    {rotuloMes(l.mes)}
                    {i === 0 && <span className="h3-contagem">mês atual</span>}
                  </td>
                  <td className="num" title={`Recebido ${BRL(l.entradasRealizadas)} · previsto ${BRL(l.entradasPrevistas)} · estimado ${BRL(l.entradasEstimadas)}`}>
                    {BRL(l.entradas)}
                    {l.entradasEstimadas > 0 && <div className="sub-num">{BRL(l.entradasEstimadas)} estimado</div>}
                  </td>
                  <td className="num" title={`Pago ${BRL(l.saidasRealizadas)} · previsto ${BRL(l.saidasPrevistas)} · estimado ${BRL(l.saidasEstimadas)}`}>
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
        <h3 className="section-title">
          Lançamentos
          <Ajuda texto="Entradas e saídas do mês escolhido. “Previsto” é o que ainda vai cair/sair (ex.: repasse da Shopee que só libera depois da entrega) — marque como recebido/pago quando acontecer. Linhas com ↻ são ocorrências de um lançamento recorrente: “Confirmar” grava o valor real daquele mês." />
        </h3>
        {pendentesCompra.length > 0 && (
          <div className="alerta alerta-warn">
            <b>
              {pendentesCompra.length} saída{pendentesCompra.length > 1 ? "s" : ""} de material sem os dados da compra
            </b>
            Sem material e quantidade, essas compras não entram na média de preço/kg.{" "}
            <button type="button" className="btn btn-mini" onClick={() => setVerPendentes((v) => !v)}>
              {verPendentes ? "Esconder" : "Ver e completar"}
            </button>
            {verPendentes && (
              <ul className="lista-pendentes">
                {pendentesCompra.map((p) => (
                  <li key={p.chave}>
                    <span>
                      {p.lancamento.data_prevista.slice(8, 10)}/{p.lancamento.data_prevista.slice(5, 7)} · {semSufixoParcela(p.lancamento.descricao)} ·{" "}
                      {BRL(p.grupo ? p.grupo.reduce((s, l) => s + Number(l.valor || 0), 0) : p.lancamento.valor)}
                      {p.grupo ? ` (${p.grupo.length}×)` : ""}
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
        <div className="toolbar">
          <select value={mesFiltro} onChange={(e) => setMesFiltro(e.target.value)} aria-label="Mês" style={{ width: "auto" }}>
            {mesesFiltro.map((m) => (
              <option key={m} value={m}>
                {rotuloMes(m)}
                {m === mesAtual ? " (atual)" : ""}
              </option>
            ))}
          </select>
          <div className="subabas subabas-compacta">
            {[
              ["todos", "Todos"],
              ["entrada", "Entradas"],
              ["saida", "Saídas"],
            ].map(([k, label]) => (
              <button key={k} className={`btn${tipoFiltro === k ? " primary" : ""}`} onClick={() => setTipoFiltro(k)}>
                {label}
              </button>
            ))}
          </div>
          <span className="toolbar-info">
            <span style={{ color: "var(--good)" }}>+{BRL(totalMesEntradas)}</span> · <span style={{ color: "var(--bad)" }}>−{BRL(totalMesSaidas)}</span>
          </span>
        </div>
        {listaMes.length === 0 ? (
          <div className="empty">Nenhum lançamento em {rotuloMes(mesFiltro)}. Use “+ Entrada” ou “− Saída” no topo.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  {mostrarCanal && <th>Canal</th>}
                  <th>Status</th>
                  <th className="num">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listaMes.map((l) => {
                  const st = statusLancamento(l, hoje);
                  const [tom, texto] = STATUS_BADGE[st];
                  const data = l.data_realizada || l.data_prevista;
                  return (
                    <tr key={l.id}>
                      <td>{data.slice(8, 10)}/{data.slice(5, 7)}</td>
                      <td>
                        {(l.virtual || l.recorrencia_origem_id) && <span title="Recorrente" style={{ color: "var(--ink-faint)", marginRight: 4 }}>↻</span>}
                        {l.descricao}
                        {l.parcela_grupo && grupos.get(l.parcela_grupo) && (() => {
                          const g = grupos.get(l.parcela_grupo);
                          const pagas = g.filter((x) => x.data_realizada).length;
                          return (
                            <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>
                              Parcelado {l.parcela_total || g.length}× · total {BRL(g.reduce((s, x) => s + Number(x.valor || 0), 0))} · {pagas} de {l.parcela_total || g.length}{" "}
                              {l.tipo === "entrada" ? "recebida" : "paga"}{pagas !== 1 ? "s" : ""}
                            </div>
                          );
                        })()}
                        {l.observacao && <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>{l.observacao}</div>}
                      </td>
                      <td className="muted-cel">{rotuloCategoria(l.tipo, l.categoria)}</td>
                      {mostrarCanal && <td className="muted-cel">{canalNome(l.canal_id) || "—"}</td>}
                      <td>
                        <span className={`badge${tom ? ` ${tom}` : " neutro"}`}>{texto}</span>
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: l.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}>
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
              </tbody>
            </table>
          </div>
        )}
      </div>

      {parcelamentos.length > 0 && (
        <div className="panel">
          <h3 className="section-title">
            Parcelados em aberto
            <Ajuda texto="Compras e recebimentos parcelados (uma linha por parcela, todo mês). Marque cada parcela como paga/recebida na lista do mês. “Excluir em aberto” apaga só as parcelas que ainda não foram pagas — as pagas continuam registradas." />
          </h3>
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
                    <td>{g.descricao}</td>
                    <td className="muted-cel">{rotuloCategoria(g.tipo, g.categoria)}</td>
                    <td>
                      {g.n}× · {g.pagas} de {g.n} {g.tipo === "entrada" ? "recebida" : "paga"}
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
                      {BRL(g.abertas.reduce((s, l) => s + Number(l.valor || 0), 0))}
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
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          Recorrentes
          <Ajuda texto="Contas e receitas que se repetem todo mês (energia, internet, assinatura, parcela da impressora, mensalidade…). Elas entram sozinhas na projeção, uma vez por mês, até a data final (ou sem fim). Pra criar, marque “Repete todo mês” no lançamento." />
        </h3>
        {modelos.length === 0 ? (
          <p className="hint" style={{ margin: "4px 0 2px" }}>Nenhum ainda — marque “Repete todo mês” em + Entrada / − Saída (energia, internet, assinatura…).</p>
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
                    <td>{m.descricao}</td>
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
            const n = Math.max(2, Math.min(60, Math.round(Number(form.parcelas)) || 2));
            const vals = total > 0 ? dividirParcelas(total, n) : null;
            return (
              <div className="field">
                <label>Nº de parcelas</label>
                <input type="number" min="2" max="60" step="1" value={form.parcelas} onChange={(e) => setForm((p) => ({ ...p, parcelas: e.target.value }))} />
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

// Gráfico da projeção: entradas sobem (verde) e saídas descem (vermelho) a
// partir do zero, com a parte ESTIMADA (campos de estimativa) mais clara e
// tracejada — assim dá pra ver o que é conta de verdade (realizado/previsto/
// parcelas) e o que é chute. A linha é o saldo no fim de cada mês. Eixo com
// números "redondos". Passar o mouse/tocar num mês mostra os valores.
function passoBonito(bruto) {
  const p = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const f = bruto / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function GraficoProjecao({ linhas }) {
  const [hover, setHover] = useState(null);
  if (!linhas.length) return null;
  const W = 960;
  const H = 260;
  const padL = 58;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const reaisE = (l) => l.entradas - l.entradasEstimadas;
  const reaisS = (l) => l.saidas - l.saidasEstimadas;
  let max = Math.max(0, ...linhas.flatMap((l) => [l.entradas, l.saldoFinal]));
  let min = Math.min(0, ...linhas.flatMap((l) => [-l.saidas, l.saldoFinal]));
  if (max === min) max = min + 100;
  const passo = passoBonito((max - min) / 4);
  max = Math.ceil(max / passo) * passo;
  min = Math.floor(min / passo) * passo;
  const ticks = [];
  for (let t = min; t <= max + 1e-6; t += passo) ticks.push(t);
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);
  const larguraMes = (W - padL - padR) / linhas.length;
  const barra = Math.min(26, larguraMes * 0.42);
  const cx = (i) => padL + larguraMes * i + larguraMes / 2;
  const fmtCurto = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : Math.round(v).toLocaleString("pt-BR"));
  const pontos = linhas.map((l, i) => `${cx(i)},${y(l.saldoFinal)}`).join(" ");
  const h = hover != null ? linhas[hover] : null;
  const temEstimado = linhas.some((l) => l.entradasEstimadas || l.saidasEstimadas);
  const y0 = y(0);
  const ret = (x, v0, v1, cls) => {
    const a = y(v0);
    const b = y(v1);
    const top = Math.min(a, b);
    const alt = Math.abs(b - a);
    return alt > 0.3 ? <rect x={x} y={top} width={barra} height={alt} rx="2" className={cls} /> : null;
  };

  return (
    <div className="grafico-caixa">
      <div className="grafico-legenda">
        <span><i className="leg-entrada" />Entradas</span>
        <span><i className="leg-saida" />Saídas</span>
        {temEstimado && <span><i className="leg-estimado" />Estimativa</span>}
        <span><i className="leg-saldo" />Saldo no fim do mês</span>
        <span className="grafico-hover">
          {h ? (
            <>
              <strong>{rotuloMes(h.mes)}</strong> · entradas {BRL(h.entradas)} · saídas {BRL(h.saidas)}
              {h.saidasEstimadas || h.entradasEstimadas ? " (com estimativa)" : ""} · saldo <b style={{ color: h.saldoFinal < 0 ? "var(--bad)" : undefined }}>{BRL(h.saldoFinal)}</b>
            </>
          ) : (
            <span className="muted-cel">passe o mouse num mês</span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Projeção de entradas, saídas e saldo por mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grade"} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="eixo">{fmtCurto(t)}</text>
          </g>
        ))}
        {linhas.map((l, i) => {
          const x = cx(i) - barra / 2;
          return (
            <g key={l.mes}>
              {hover === i && <rect x={padL + larguraMes * i} y={padT} width={larguraMes} height={H - padT - padB} className="faixa-hover" />}
              {ret(x, 0, reaisE(l), "barra-entrada")}
              {ret(x, reaisE(l), l.entradas, "barra-entrada estimada")}
              {ret(x, 0, -reaisS(l), "barra-saida")}
              {ret(x, -reaisS(l), -l.saidas, "barra-saida estimada")}
              <text x={cx(i)} y={H - 8} textAnchor="middle" className={`eixo${i === 0 ? " eixo-atual" : ""}`}>{rotuloMes(l.mes, i === 0 || l.mes.endsWith("-01"))}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} className="zero" />
        <defs>
          <clipPath id="fc-acima"><rect x="0" y="0" width={W} height={y0} /></clipPath>
          <clipPath id="fc-abaixo"><rect x="0" y={y0} width={W} height={H - y0} /></clipPath>
        </defs>
        <polygon points={`${cx(0)},${y0} ${pontos} ${cx(linhas.length - 1)},${y0}`} className="area-saldo positivo" clipPath="url(#fc-acima)" />
        <polygon points={`${cx(0)},${y0} ${pontos} ${cx(linhas.length - 1)},${y0}`} className="area-saldo negativo" clipPath="url(#fc-abaixo)" />
        <polyline points={pontos} className="linha-saldo" />
        {linhas.map((l, i) => (
          <circle key={l.mes} cx={cx(i)} cy={y(l.saldoFinal)} r={hover === i ? 5 : 3.5} className={l.saldoFinal < 0 ? "ponto-saldo negativo" : "ponto-saldo"} />
        ))}
        {linhas.map((l, i) => (
          <rect key={l.mes} x={padL + larguraMes * i} y={0} width={larguraMes} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <title>{`${rotuloMes(l.mes)}: entradas ${BRL(l.entradas)}, saídas ${BRL(l.saidas)}, saldo ${BRL(l.saldoFinal)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
