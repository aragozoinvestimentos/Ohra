import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { BRL, PCT } from "../lib/format.js";
import { custoProdutoPorPeca } from "../lib/calc.js";
import { infoPeca } from "../lib/planoKit.js";
import {
  calcTaxaFalhaAtual,
  calcFracaoMediaFalha,
  calcPrejuizoMedioPorFalha,
  calcPrejuizoEsperado,
  calcLoteMaximoSeguro,
} from "../lib/registroImpressao.js";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Kpis from "./Kpis.jsx";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { entradaDeProducao } from "../lib/revendaAcoes.js";
import { temEstoquePronto } from "../lib/revenda.js";
import { hojeSP } from "../lib/datas.js";

const TETO_STORAGE_KEY = "ohra:registro-impressao:teto-prejuizo";
const TETO_PADRAO = 50;

const VAZIO_FORM = {
  produtoId: "",
  mesa: "", // várias mesas: índice da mesa impressa ("" = o produto inteiro)
  nomeLivre: "",
  quantidadeLote: 1,
  tempoEstimadoMin: "",
  status: "sucesso",
  falhaPct: "",
  custoPorPecaManual: "",
  observacao: "",
};

export default function RegistroImpressoes({ onToast }) {
  const { lojaId } = useLoja();
  // Produtos (detalhamento de produção) e materiais (preço atual) vêm do
  // catálogo compartilhado — ao vivo, sem busca própria.
  const { produtos, materiais, kits = [], kitProdutos = [] } = useCatalogo();
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(VAZIO_FORM);
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [produtoSimuladorId, setProdutoSimuladorId] = useState("");
  // Estoque de fabricados (v70): impressão com sucesso de produto marcado "tenho estoque
  // pronto" pergunta "Pôr no estoque?" — já preenchido, editável, nunca trava.
  const [pergunta, setPergunta] = useState(null);
  // Teto de prejuízo por lote: salvo no banco (preferencias_loja, v59) — igual em todo aparelho.
  const [tetoReais, setTetoReais] = usePreferencia("impressao:teto-prejuizo", TETO_PADRAO, { legado: () => {
    try {
      const raw = localStorage.getItem(TETO_STORAGE_KEY);
      return raw != null && raw !== "" ? Number(raw) : undefined;
    } catch {
      return undefined;
    }
  } });

  // Troca de loja invalida o que estava selecionado.
  useEffect(() => {
    setForm(VAZIO_FORM);
    setProdutoSimuladorId("");
  }, [lojaId]);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregarRegistros() {
      try {
        let query = supabase.from("registros_impressao").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setRegistros(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregarRegistros();
    const canal = supabase
      .channel("registro-impressao-registros-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "registros_impressao" }, carregarRegistros)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const produtoSelecionado = produtos.find((p) => p.id === form.produtoId) || null;
  // Kit (também o composto, que só é vendido junto): o lote conta KITS. Sugestão:
  // a chapa do kit da Otimização (kits.chapa_kit: kits por chapa + tempo total),
  // senão 1 kit = soma do tempo por peça de cada produto × quantidade.
  const kitSelecionado = form.produtoId.startsWith("k:") ? kits.find((k) => k.id === form.produtoId.slice(2)) || null : null;
  const kitInfo = useMemo(() => {
    if (!kitSelecionado) return null;
    const linhas = kitProdutos
      .filter((kp) => kp.kit_id === kitSelecionado.id)
      .map((kp) => ({ p: produtos.find((x) => x.id === kp.produto_id), q: Number(kp.quantidade) || 0 }))
      .filter((l) => l.p && l.q > 0);
    let custo = 0;
    let custoOk = linhas.length > 0;
    let tempo = 0;
    for (const { p, q } of linhas) {
      const c = custoProdutoPorPeca(p, materiais);
      if (c) custo += c.total * q;
      else custoOk = false;
      const i = infoPeca(p);
      tempo += (i.tempoChapaMin / i.pecasChapa) * q;
    }
    const chapa = kitSelecionado.chapa_kit || null;
    const porChapa = Number(chapa?.kitsPorChapa) || null;
    const daChapa = !!(porChapa && Number(chapa?.tempo) > 0);
    const tempoChapa = daChapa ? Number(chapa.tempo) : tempo > 0 ? Math.round(tempo) : null;
    return { custo: custoOk ? custo : null, porChapa: daChapa ? porChapa : 1, tempoChapa, daChapa };
  }, [kitSelecionado, kitProdutos, produtos, materiais]);
  useEffect(() => {
    if (!kitInfo) return;
    setForm((prev) => ({ ...prev, quantidadeLote: kitInfo.porChapa, tempoEstimadoMin: kitInfo.tempoChapa ?? prev.tempoEstimadoMin, tempoManual: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.produtoId, kitInfo?.porChapa, kitInfo?.tempoChapa]);

  // Produto impresso em várias mesas (partes separadas, 30/10/2026): dá pra
  // registrar UMA mesa — falhou a mesa das coroas = perde só ela.
  const contaProduto = useMemo(() => (produtoSelecionado ? custoProdutoPorPeca(produtoSelecionado, materiais) : null), [produtoSelecionado, materiais]);
  const mesasDoProduto = produtoSelecionado?.producao_detalhe?.impressao === "varias" ? contaProduto?.mesas || [] : [];
  const mesaSel = form.mesa !== "" ? mesasDoProduto[Number(form.mesa)] || null : null;
  function escolherMesa(v) {
    const m = v !== "" ? mesasDoProduto[Number(v)] : null;
    setForm((prev) => ({
      ...prev,
      mesa: v,
      quantidadeLote: m ? m.rende : Number(produtoSelecionado?.pecas_por_impressao) || 1,
      tempoEstimadoMin: m ? m.tempo : produtoSelecionado?.producao_detalhe?.tempo ?? prev.tempoEstimadoMin,
      tempoManual: false,
    }));
  }

  // Ao escolher um produto cadastrado, sugere quantidade e tempo a partir do
  // detalhamento salvo — continua editável, porque na prática o lote de
  // hoje pode ter mais ou menos peças que o padrão do produto.
  useEffect(() => {
    if (!produtoSelecionado) return;
    setForm((prev) => ({
      ...prev,
      quantidadeLote: Number(produtoSelecionado.pecas_por_impressao) || prev.quantidadeLote || 1,
      tempoEstimadoMin: produtoSelecionado.producao_detalhe?.tempo ?? prev.tempoEstimadoMin,
      tempoManual: false,
      mesa: "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.produtoId]);

  const custoPorPecaSelecionado = useMemo(() => {
    if (produtoSelecionado) {
      if (mesaSel) return mesaSel.custoMesa / Math.max(1, mesaSel.rende);
      return contaProduto ? contaProduto.total : null;
    }
    if (kitInfo) return kitInfo.custo;
    const manual = Number(form.custoPorPecaManual);
    return isFinite(manual) && manual > 0 ? manual : null;
  }, [produtoSelecionado, kitInfo, contaProduto, mesaSel, form.custoPorPecaManual]);

  const custoLotePreview = custoPorPecaSelecionado != null ? custoPorPecaSelecionado * (Number(form.quantidadeLote) || 0) : null;

  function set(key) {
    return (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  // Tempo proporcional às peças: a chapa cheia do produto (pecas_por_impressao)
  // leva producao_detalhe.tempo; com menos/mais peças o tempo sugerido acompanha.
  // Se você digitar o tempo na mão, ele não muda mais (até trocar de produto).
  const tempoChapa = kitInfo ? kitInfo.tempoChapa : mesaSel ? mesaSel.tempo || null : Number(produtoSelecionado?.producao_detalhe?.tempo) || null;
  const pecasChapa = kitInfo ? kitInfo.porChapa : mesaSel ? mesaSel.rende : Number(produtoSelecionado?.pecas_por_impressao) || null;
  const tempoProporcional = (qtd) => (tempoChapa && pecasChapa && Number(qtd) > 0 ? Math.round((tempoChapa * Number(qtd)) / pecasChapa) : null);
  function mudarQuantidade(e) {
    const qtd = e.target.value;
    setForm((prev) => {
      const sug = tempoProporcional(qtd);
      return { ...prev, quantidadeLote: qtd, ...(!prev.tempoManual && sug != null ? { tempoEstimadoMin: sug } : {}) };
    });
  }
  function mudarTempo(e) {
    setForm((prev) => ({ ...prev, tempoEstimadoMin: e.target.value, tempoManual: e.target.value !== "" }));
  }

  async function registrar() {
    const nome = (produtoSelecionado && mesaSel ? `${produtoSelecionado.nome} — mesa ${mesaSel.nome}` : "") || produtoSelecionado?.nome || (kitSelecionado ? `${kitSelecionado.nome} (kit)` : "") || form.nomeLivre.trim();
    if (!nome) {
      onToast?.("Escolha um produto cadastrado ou digite o nome da peça");
      return;
    }
    const quantidade = Math.max(1, parseInt(form.quantidadeLote, 10) || 1);
    if (form.status === "falha" && (form.falhaPct === "" || Number(form.falhaPct) < 0 || Number(form.falhaPct) > 100)) {
      onToast?.("Informe em que % (0 a 100) a impressão falhou");
      return;
    }

    setSalvando(true);
    const { data: criado, error } = await supabase.from("registros_impressao").insert({
      loja_id: lojaId || null,
      produto_id: produtoSelecionado?.id || null,
      produto_nome: nome,
      quantidade_lote: quantidade,
      tempo_estimado_min: form.tempoEstimadoMin === "" ? null : Number(form.tempoEstimadoMin),
      status: form.status,
      falha_pct: form.status === "falha" ? Number(form.falhaPct) : null,
      custo_lote_estimado: custoLotePreview,
      observacao: form.observacao.trim() || null,
    }).select("id").single();
    setSalvando(false);
    if (error) {
      onToast?.("Não foi possível registrar agora — tente de novo");
      return;
    }
    if (form.status === "sucesso" && !mesaSel) {
      // peças que entram no estoque: o produto, ou as peças do kit impresso junto
      const pecas = produtoSelecionado
        ? [{ produto: produtoSelecionado, quantidade }]
        : kitSelecionado
          ? kitProdutos.filter((kp) => kp.kit_id === kitSelecionado.id).map((kp) => ({ produto: produtos.find((p) => p.id === kp.produto_id), quantidade: quantidade * (Number(kp.quantidade) || 1) }))
          : [];
      const itens = pecas.filter((x) => temEstoquePronto(x.produto)).map((x) => ({ produtoId: x.produto.id, nome: x.produto.nome, quantidade: String(x.quantidade) }));
      if (itens.length) setPergunta({ registroId: criado?.id || null, nome, itens });
    }
    setForm((prev) => ({ ...VAZIO_FORM, produtoId: prev.produtoId }));
    onToast?.("Impressão registrada");
  }

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("registros_impressao").delete().eq("id", id);
    if (error) {
      onToast?.("Não foi possível excluir agora — tente de novo");
      return;
    }
    setRegistros((prev) => prev.filter((r) => r.id !== id));
  }

  // --- Dashboard / simulador de lote ---

  const taxaFalha = useMemo(() => calcTaxaFalhaAtual(registros), [registros]);
  const fracaoMediaFalha = useMemo(() => calcFracaoMediaFalha(registros), [registros]);
  const prejuizoMedioPorFalha = useMemo(() => calcPrejuizoMedioPorFalha(registros), [registros]);

  const produtoSimulador = produtos.find((p) => p.id === produtoSimuladorId) || null;
  const custoPorPecaSimulador = produtoSimulador ? custoProdutoPorPeca(produtoSimulador, materiais)?.total ?? null : null;
  const mesaCheia = Number(produtoSimulador?.pecas_por_impressao) || null;

  const tamanhosLote = useMemo(() => {
    const base = [1, 3, 5];
    if (mesaCheia && !base.includes(mesaCheia)) base.push(mesaCheia);
    return base.sort((a, b) => a - b);
  }, [mesaCheia]);

  const simulacao = useMemo(() => {
    if (custoPorPecaSimulador == null) return [];
    return tamanhosLote.map((n) => ({
      n,
      ehMesaCheia: n === mesaCheia,
      ...calcPrejuizoEsperado({
        custoPorPeca: custoPorPecaSimulador,
        quantidade: n,
        taxaFalha: taxaFalha.taxa,
        fracaoMediaFalha,
      }),
    }));
  }, [custoPorPecaSimulador, tamanhosLote, mesaCheia, taxaFalha.taxa, fracaoMediaFalha]);

  const loteMaximoSeguro =
    custoPorPecaSimulador != null
      ? calcLoteMaximoSeguro({ custoPorPeca: custoPorPecaSimulador, fracaoMediaFalha, tetoReais: Number(tetoReais) || 0 })
      : null;

  if (carregando) {
    return (
      <div className="panel">
        <div className="empty">Carregando…</div>
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Registro de Impressões</h3>
        <div className="empty">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <>
    <Kpis
      itens={[
        { label: "Taxa de falha atual", valor: PCT(taxaFalha.taxa), tom: "destaque", sub: `${taxaFalha.falhas} falha${taxaFalha.falhas === 1 ? "" : "s"} em ${taxaFalha.total} impress${taxaFalha.total === 1 ? "ão" : "ões"} registrada${taxaFalha.total === 1 ? "" : "s"}` },
        { label: "Impressões registradas", valor: taxaFalha.total, sub: `${taxaFalha.falhas} ${taxaFalha.falhas === 1 ? "falha" : "falhas"}` },
        { label: "Prejuízo médio por falha", valor: prejuizoMedioPorFalha != null ? BRL(prejuizoMedioPorFalha) : "—", tom: prejuizoMedioPorFalha != null ? "bad" : undefined, sub: prejuizoMedioPorFalha != null ? "custo perdido por impressão que falhou" : "sem falhas registradas ainda" },
        { label: "Avanço médio até falhar", valor: taxaFalha.falhas > 0 ? PCT(fracaoMediaFalha) : "—", sub: taxaFalha.falhas > 0 ? "quanto a impressão anda antes de dar errado" : "sem falhas registradas ainda" },
      ]}
    />
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Registrar impressão
            <Ajuda texto='Registre cada impressão depois que ela termina, deu certo ou não. Isso vai construindo um histórico real de taxa de falha — a taxa é a real: falhas ÷ impressões registradas (começa em 0%). Se a impressão falhou, informe em que % ela parou: uma falha aos 90% desperdiça muito mais material/tempo que uma aos 10%, e é essa % que estima o prejuízo real, não o custo total sempre.' />
          </h3>

          <div className="field">
            <label>Produto cadastrado (opcional)</label>
            <select value={form.produtoId} onChange={(e) => setForm((prev) => ({ ...prev, produtoId: e.target.value, nomeLivre: "" }))}>
              <option value="">— peça avulsa / ainda não cadastrada —</option>
              <optgroup label="Produtos">
                {produtos.filter((p) => p.origem !== "revenda").map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </optgroup>
              {kits.length > 0 && (
                <optgroup label="Kits (impressos juntos)">
                  {kits.map((k) => (
                    <option key={k.id} value={`k:${k.id}`}>{k.nome}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {mesasDoProduto.length > 0 && (
            <div className="field">
              <label>Qual mesa você imprimiu?</label>
              <select value={form.mesa} onChange={(e) => escolherMesa(e.target.value)}>
                <option value="">O produto inteiro (todas as mesas)</option>
                {mesasDoProduto.map((m, i) => (
                  <option key={i} value={String(i)}>
                    Mesa {m.nome} — rende {m.rende}
                  </option>
                ))}
              </select>
              {mesaSel && <div className="hint" style={{ marginTop: 4 }}>Se falhar, perde só essa mesa ({BRL(mesaSel.custoMesa)}). Uma mesa sozinha não entra no estoque de prontos.</div>}
            </div>
          )}

          {!produtoSelecionado && !kitSelecionado && (
            <div className="field">
              <label>Nome da peça</label>
              <input type="text" value={form.nomeLivre} onChange={set("nomeLivre")} placeholder="ex: Suporte de celular V2" />
            </div>
          )}

          <div className="row2">
            <div className="field">
              <label title={kitSelecionado ? "Quantos kits nessa impressão" : "Quantas peças nessa impressão"}>{kitSelecionado ? "Kits no lote" : mesaSel ? `Partes no lote (${mesaSel.nome})` : "Peças no lote"}</label>
              <input type="number" step="1" min="1" value={form.quantidadeLote} onChange={mudarQuantidade} />
            </div>
            <div className="field">
              <label>Tempo estimado (min)</label>
              <input type="number" step="1" value={form.tempoEstimadoMin} onChange={mudarTempo} />
              {tempoChapa && pecasChapa ? (
                form.tempoManual && tempoProporcional(form.quantidadeLote) != null && Number(form.tempoEstimadoMin) !== tempoProporcional(form.quantidadeLote) ? (
                  <small className="hint">
                    proporcional: {tempoProporcional(form.quantidadeLote)} min ·{" "}
                    <button type="button" className="link-btn" onClick={() => setForm((prev) => ({ ...prev, tempoEstimadoMin: tempoProporcional(prev.quantidadeLote), tempoManual: false }))}>
                      usar
                    </button>
                  </small>
                ) : (
                  <small className="hint">
                    {kitInfo
                      ? kitInfo.daChapa
                        ? `proporcional (chapa do kit: ${pecasChapa} kit${pecasChapa > 1 ? "s" : ""} = ${tempoChapa} min)`
                        : `proporcional (1 kit ≈ ${tempoChapa} min, soma das peças)`
                      : `proporcional às peças (chapa de ${pecasChapa} = ${tempoChapa} min)`}
                  </small>
                )
              ) : null}
            </div>
          </div>

          {!produtoSelecionado && !kitSelecionado && (
            <div className="field">
              <label>Custo estimado por peça (R$) — opcional</label>
              <input type="number" step="0.01" value={form.custoPorPecaManual} onChange={set("custoPorPecaManual")} placeholder="deixe em branco se não souber" />
            </div>
          )}

          <div className="field">
            <label>Resultado</label>
            <div className="subabas" style={{ marginBottom: 0 }}>
              <button type="button" className={`btn${form.status === "sucesso" ? " primary" : ""}`} style={{ flex: "none" }} onClick={() => setForm((prev) => ({ ...prev, status: "sucesso" }))}>
                ✓ Deu certo
              </button>
              <button type="button" className={`btn${form.status === "falha" ? " primary" : ""}`} style={{ flex: "none" }} onClick={() => setForm((prev) => ({ ...prev, status: "falha" }))}>
                ✕ Falhou
              </button>
            </div>
          </div>

          {form.status === "falha" && (
            <div className="field">
              <label>Em que % da impressão ela falhou (0–100)</label>
              <input type="number" step="1" min="0" max="100" style={{ maxWidth: 160 }} value={form.falhaPct} onChange={set("falhaPct")} />
            </div>
          )}

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Observação (opcional)</label>
            <input type="text" value={form.observacao} onChange={set("observacao")} placeholder="ex: descolou da mesa perto do fim" />
          </div>

          {custoLotePreview != null && (
            <div className="hint" style={{ marginTop: 10 }}>
              Custo estimado desse lote: <strong style={{ color: "var(--ink)" }}>{BRL(custoLotePreview)}</strong>
            </div>
          )}

          <button className="btn primary" style={{ marginTop: 10, width: "100%" }} disabled={salvando} onClick={registrar}>
            {salvando ? "Registrando…" : "Registrar impressão"}
          </button>
          {pergunta && (
            <div className="alerta alerta-good" style={{ marginTop: 10 }}>
              <b>Pôr no estoque de prontos?</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {pergunta.itens.map((it, i) => (
                  <label key={it.produtoId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 160px" }}>{it.nome} — peças boas</span>
                    <input
                      inputMode="numeric"
                      style={{ width: 90 }}
                      value={it.quantidade}
                      onChange={(e) => setPergunta((p) => ({ ...p, itens: p.itens.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)) }))}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  className="btn primary btn-mini"
                  onClick={async () => {
                    const r = await entradaDeProducao({ lojaId, registroId: pergunta.registroId, nome: pergunta.nome, data: hojeSP(), itens: pergunta.itens.map((x) => ({ produtoId: x.produtoId, quantidade: Number(String(x.quantidade).replace(",", ".")) || 0 })) });
                    onToast?.(r.error ? r.error.message : r.aviso || "No estoque ✓");
                    if (!r.error) setPergunta(null);
                  }}
                >
                  Pôr no estoque
                </button>
                <button type="button" className="btn btn-mini" onClick={() => setPergunta(null)}>
                  Não, foi pra encomenda
                </button>
              </div>
              <p className="hint" style={{ margin: "6px 0 0" }}>Se fechar sem responder, nada trava: dá pra lançar depois em Estoque e compras (± Ajustar).</p>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Histórico</h3>
          {registros.length === 0 ? (
            <div className="empty">Nenhuma impressão registrada ainda.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Peça</th>
                    <th className="num">Qtd.</th>
                    <th>Resultado</th>
                    <th className="num">Custo do lote</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.produto_nome}
                        {r.observacao && <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>{r.observacao}</div>}
                      </td>
                      <td className="num">{r.quantidade_lote}</td>
                      <td>
                        {r.status === "sucesso" ? (
                          <span className="badge neutro">✓ Certo</span>
                        ) : (
                          <span className="badge bad">✕ Falhou{r.falha_pct != null ? ` aos ${r.falha_pct}%` : ""}</span>
                        )}
                      </td>
                      <td className="num">{r.custo_lote_estimado != null ? BRL(r.custo_lote_estimado) : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="del" title="Excluir" onClick={() => setExcluirAlvo(r)}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="panel">
          <h3 className="section-title">
            Simulador de lote
            <Ajuda texto='Escolha um produto pra ver o prejuízo esperado (e o "se falhar dessa vez") em cada tamanho de lote, e o maior lote recomendado dado o quanto você toparia perder de uma vez.' />
          </h3>
          <div className="field">
            <label>Produto</label>
            <select value={produtoSimuladorId} onChange={(e) => setProdutoSimuladorId(e.target.value)}>
              <option value="">— escolha um produto —</option>
              {produtos.filter((p) => p.origem !== "revenda").map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Prejuízo máximo que você toparia perder de uma vez (R$)</label>
            <input type="number" step="1" style={{ maxWidth: 160 }} value={tetoReais} onChange={(e) => setTetoReais(e.target.value)} />
          </div>

          {!produtoSimulador ? (
            <div className="empty">Escolha um produto acima.</div>
          ) : custoPorPecaSimulador == null ? (
            <div className="empty">Esse produto não tem detalhamento de produção salvo (Cadastros → Produtos) — sem custo por peça não dá pra simular.</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th className="num">Custo do lote</th>
                      <th className="num">Se falhar dessa vez</th>
                      <th className="num">Prejuízo esperado (médio)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulacao.map((s) => (
                      <tr key={s.n}>
                        <td>{s.n} {s.n === 1 ? "peça" : "peças"}{s.ehMesaCheia ? " (mesa cheia)" : ""}</td>
                        <td className="num">{BRL(s.custoLote)}</td>
                        <td className="num">{BRL(s.prejuizoSeFalhar)}</td>
                        <td className="num">{BRL(s.prejuizoEsperado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="destaque-preco" style={{ marginTop: 14 }}>
                <span className="k">
                  Lote máximo seguro
                  <span className="k-sub">Maior lote cujo prejuízo "se falhar" fica dentro do teto informado</span>
                </span>
                <span className="v">{loteMaximoSeguro != null ? `${loteMaximoSeguro} ${loteMaximoSeguro === 1 ? "peça" : "peças"}` : "—"}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir registro"
          mensagem={`Confirma excluir o registro de "${excluirAlvo.produto_nome}"? Isso também ajusta a taxa de falha calculada. Não é possível desfazer.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </div>
    </>
  );
}
