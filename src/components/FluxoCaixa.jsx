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

const ESTIMATIVA_KEY = "ohra:caixa:estimativas";

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
  const totalMesEntradas = listaMes.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalMesSaidas = listaMes.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);

  const modelos = lancamentos.filter((l) => l.recorrencia === "mensal");
  const canalNome = (id) => canais.find((c) => c.id === id)?.nome || "";

  // --- Ações ---
  function abrirNovo(tipo) {
    setForm(novoForm(tipo));
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
    setSalvando(true);
    const { error } = form.id
      ? await supabase.from("lancamentos_caixa").update(registro).eq("id", form.id)
      : await supabase.from("lancamentos_caixa").insert(registro);
    setSalvando(false);
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    onToast?.(form.id ? "Lançamento atualizado" : form.recorrente ? "Lançamento recorrente criado" : "Lançamento registrado");
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

  async function excluir(l) {
    const { error } = await supabase.from("lancamentos_caixa").delete().eq("id", l.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    setLancamentos((prev) => prev.filter((x) => x.id !== l.id));
    onToast?.("Lançamento excluído");
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
            valor: BRL(mesCorrente?.entradasRealizadas || 0),
            tom: "good",
            sub: mesCorrente?.entradasPrevistas ? `+ ${BRL(mesCorrente.entradasPrevistas)} a receber` : "recebido no mês",
          },
          {
            label: `Saídas de ${rotuloMes(mesAtual)}`,
            valor: BRL(mesCorrente?.saidasRealizadas || 0),
            sub: mesCorrente?.saidasPrevistas ? `+ ${BRL(mesCorrente.saidasPrevistas)} a pagar` : "pago no mês",
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
          </div>
        </div>

        <GraficoProjecao linhas={projecao.linhas} />

        <div className="table-wrap" style={{ marginTop: 12 }}>
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
                  </td>
                  <td className="num" title={`Pago ${BRL(l.saidasRealizadas)} · previsto ${BRL(l.saidasPrevistas)} · estimado ${BRL(l.saidasEstimadas)}`}>
                    {BRL(l.saidas)}
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
      </div>

      <div className="panel">
        <h3 className="section-title">
          Lançamentos
          <Ajuda texto="Entradas e saídas do mês escolhido. “Previsto” é o que ainda vai cair/sair (ex.: repasse da Shopee que só libera depois da entrega) — marque como recebido/pago quando acontecer. Linhas com ↻ são ocorrências de um lançamento recorrente: “Confirmar” grava o valor real daquele mês." />
        </h3>
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
                  <th>Canal</th>
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
                        {l.observacao && <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>{l.observacao}</div>}
                      </td>
                      <td className="muted-cel">{rotuloCategoria(l.tipo, l.categoria)}</td>
                      <td className="muted-cel">{canalNome(l.canal_id) || "—"}</td>
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

      <div className="panel">
        <h3 className="section-title">
          Recorrentes
          <Ajuda texto="Contas e receitas que se repetem todo mês (energia, internet, assinatura, parcela da impressora, mensalidade…). Elas entram sozinhas na projeção, uma vez por mês, até a data final (ou sem fim). Pra criar, marque “Repete todo mês” no lançamento." />
        </h3>
        {modelos.length === 0 ? (
          <div className="empty">Nenhum lançamento recorrente. Crie um marcando “Repete todo mês” em + Entrada / − Saída.</div>
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
              <label>Valor (R$)</label>
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
              <label>{form.recorrente ? "Primeira data" : "Data prevista"}</label>
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

          {!form.modeloId && (
            <label className="check-linha">
              <input type="checkbox" checked={form.recorrente} onChange={(e) => setForm((p) => ({ ...p, recorrente: e.target.checked }))} />
              Repete todo mês
            </label>
          )}
          {form.recorrente ? (
            <div className="field">
              <label>Até (opcional — em branco = sem fim)</label>
              <input type="date" value={form.recorrencia_ate} onChange={(e) => setForm((p) => ({ ...p, recorrencia_ate: e.target.value }))} />
            </div>
          ) : (
            <>
              <label className="check-linha">
                <input type="checkbox" checked={form.realizado} onChange={(e) => setForm((p) => ({ ...p, realizado: e.target.checked }))} />
                {form.tipo === "entrada" ? "Já recebido" : "Já pago"}
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

      {excluirAlvo && (
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
            excluir(excluirAlvo);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </>
  );
}

// Barras de entradas (verde) e saídas (vermelho) por mês + linha do saldo no
// fim de cada mês, tudo no mesmo eixo em R$. Passar o mouse num mês mostra os
// valores (tooltip nativo do SVG); a tabela logo abaixo tem os números exatos.
function GraficoProjecao({ linhas }) {
  const [hover, setHover] = useState(null);
  if (!linhas.length) return null;
  const W = 960;
  const H = 240;
  const padL = 64;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const valores = linhas.flatMap((l) => [l.entradas, l.saidas, l.saldoFinal, 0]);
  let max = Math.max(...valores);
  let min = Math.min(...valores);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.08;
  max += pad;
  if (min < 0) min -= pad;
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);
  const larguraMes = (W - padL - padR) / linhas.length;
  const barra = Math.min(18, larguraMes * 0.28);
  const cx = (i) => padL + larguraMes * i + larguraMes / 2;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const fmtCurto = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : Math.round(v).toLocaleString("pt-BR"));
  const pontos = linhas.map((l, i) => `${cx(i)},${y(l.saldoFinal)}`).join(" ");
  const h = hover != null ? linhas[hover] : null;

  return (
    <div className="grafico-caixa">
      <div className="grafico-legenda">
        <span><i className="leg-entrada" />Entradas</span>
        <span><i className="leg-saida" />Saídas</span>
        <span><i className="leg-saldo" />Saldo no fim do mês</span>
        {h && (
          <span className="grafico-hover">
            <strong>{rotuloMes(h.mes)}</strong> · entradas {BRL(h.entradas)} · saídas {BRL(h.saidas)} · saldo {BRL(h.saldoFinal)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Projeção de entradas, saídas e saldo por mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grade" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="eixo">{fmtCurto(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="zero" />
        {linhas.map((l, i) => (
          <g key={l.mes}>
            {hover === i && <rect x={padL + larguraMes * i} y={padT} width={larguraMes} height={H - padT - padB} className="faixa-hover" />}
            <rect x={cx(i) - barra - 1} y={y(Math.max(l.entradas, 0))} width={barra} height={Math.max(0, y(0) - y(l.entradas))} rx="3" className="barra-entrada" />
            <rect x={cx(i) + 1} y={y(Math.max(l.saidas, 0))} width={barra} height={Math.max(0, y(0) - y(l.saidas))} rx="3" className="barra-saida" />
            <text x={cx(i)} y={H - 8} textAnchor="middle" className="eixo">{rotuloMes(l.mes, i === 0 || l.mes.endsWith("-01"))}</text>
            <rect
              x={padL + larguraMes * i}
              y={0}
              width={larguraMes}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            >
              <title>{`${rotuloMes(l.mes)}: entradas ${BRL(l.entradas)}, saídas ${BRL(l.saidas)}, saldo ${BRL(l.saldoFinal)}`}</title>
            </rect>
          </g>
        ))}
        <polyline points={pontos} className="linha-saldo" />
        {linhas.map((l, i) => (
          <circle key={l.mes} cx={cx(i)} cy={y(l.saldoFinal)} r={hover === i ? 5 : 3.5} className={l.saldoFinal < 0 ? "ponto-saldo negativo" : "ponto-saldo"} />
        ))}
      </svg>
    </div>
  );
}
