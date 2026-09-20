import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL, PCT } from "../lib/format.js";
import { custoProdutoPorPeca } from "../lib/calc.js";
import {
  calcTaxaFalhaAtual,
  calcFracaoMediaFalha,
  calcPrejuizoMedioPorFalha,
  calcPrejuizoEsperado,
  calcLoteMaximoSeguro,
} from "../lib/registroImpressao.js";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const TETO_STORAGE_KEY = "ohra:registro-impressao:teto-prejuizo";
const TETO_PADRAO = 50;

function loadTeto() {
  try {
    const raw = localStorage.getItem(TETO_STORAGE_KEY);
    if (raw != null && raw !== "") return Number(raw);
  } catch {
    // sem problema, usa o padrão
  }
  return TETO_PADRAO;
}

const VAZIO_FORM = {
  produtoId: "",
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
  const [produtos, setProdutos] = useState([]);
  const [materiais, setMateriais] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(VAZIO_FORM);
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [produtoSimuladorId, setProdutoSimuladorId] = useState("");
  const [tetoReais, setTetoReais] = useState(loadTeto);

  useEffect(() => {
    try {
      localStorage.setItem(TETO_STORAGE_KEY, String(tetoReais));
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }, [tetoReais]);

  // Produtos cadastrados (pra puxar o detalhamento de produção e sugerir
  // quantidade/tempo) e materiais (pra recalcular o custo com o preço
  // atual) — troca de loja invalida o que estava selecionado.
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
    async function carregarProdutos() {
      let query = supabase.from("produtos_cadastro").select("id, nome, producao_detalhe, pecas_por_impressao").order("nome");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setProdutos(data || []);
    }
    async function carregarMateriais() {
      let query = supabase.from("materiais").select("*");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setMateriais(data || []);
    }
    carregarProdutos();
    carregarMateriais();
    const canalProdutos = supabase
      .channel("registro-impressao-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregarProdutos)
      .subscribe();
    const canalMateriais = supabase
      .channel("registro-impressao-materiais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregarMateriais)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canalProdutos);
      supabase.removeChannel(canalMateriais);
    };
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

  // Ao escolher um produto cadastrado, sugere quantidade e tempo a partir do
  // detalhamento salvo — continua editável, porque na prática o lote de
  // hoje pode ter mais ou menos peças que o padrão do produto.
  useEffect(() => {
    if (!produtoSelecionado) return;
    setForm((prev) => ({
      ...prev,
      quantidadeLote: Number(produtoSelecionado.pecas_por_impressao) || prev.quantidadeLote || 1,
      tempoEstimadoMin: produtoSelecionado.producao_detalhe?.tempo ?? prev.tempoEstimadoMin,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.produtoId]);

  const custoPorPecaSelecionado = useMemo(() => {
    if (produtoSelecionado) {
      const resultado = custoProdutoPorPeca(produtoSelecionado, materiais);
      return resultado ? resultado.total : null;
    }
    const manual = Number(form.custoPorPecaManual);
    return isFinite(manual) && manual > 0 ? manual : null;
  }, [produtoSelecionado, materiais, form.custoPorPecaManual]);

  const custoLotePreview = custoPorPecaSelecionado != null ? custoPorPecaSelecionado * (Number(form.quantidadeLote) || 0) : null;

  function set(key) {
    return (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function registrar() {
    const nome = produtoSelecionado?.nome || form.nomeLivre.trim();
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
    const { error } = await supabase.from("registros_impressao").insert({
      loja_id: lojaId || null,
      produto_id: produtoSelecionado?.id || null,
      produto_nome: nome,
      quantidade_lote: quantidade,
      tempo_estimado_min: form.tempoEstimadoMin === "" ? null : Number(form.tempoEstimadoMin),
      status: form.status,
      falha_pct: form.status === "falha" ? Number(form.falhaPct) : null,
      custo_lote_estimado: custoLotePreview,
      observacao: form.observacao.trim() || null,
    });
    setSalvando(false);
    if (error) {
      onToast?.("Não foi possível registrar agora — tente de novo");
      return;
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
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Registrar impressão
            <Ajuda texto='Registre cada impressão depois que ela termina, deu certo ou não. Isso vai construindo um histórico real de taxa de falha — a taxa começa numa estimativa conservadora (12,5%) e vai se ajustando sozinha conforme os registros entram. Se a impressão falhou, informe em que % ela parou: uma falha aos 90% desperdiça muito mais material/tempo que uma aos 10%, e é essa % que estima o prejuízo real, não o custo total sempre.' />
          </h3>

          <div className="field">
            <label>Produto cadastrado (opcional)</label>
            <select value={form.produtoId} onChange={(e) => setForm((prev) => ({ ...prev, produtoId: e.target.value, nomeLivre: "" }))}>
              <option value="">— peça avulsa / ainda não cadastrada —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>

          {!produtoSelecionado && (
            <div className="field">
              <label>Nome da peça</label>
              <input type="text" value={form.nomeLivre} onChange={set("nomeLivre")} placeholder="ex: Suporte de celular V2" />
            </div>
          )}

          <div className="row2">
            <div className="field">
              <label>Quantidade no lote (peças nessa impressão)</label>
              <input type="number" step="1" min="1" value={form.quantidadeLote} onChange={set("quantidadeLote")} />
            </div>
            <div className="field">
              <label>Tempo estimado (min)</label>
              <input type="number" step="1" value={form.tempoEstimadoMin} onChange={set("tempoEstimadoMin")} />
            </div>
          </div>

          {!produtoSelecionado && (
            <div className="field">
              <label>Custo estimado por peça (R$) — opcional</label>
              <input type="number" step="0.01" value={form.custoPorPecaManual} onChange={set("custoPorPecaManual")} placeholder="deixe em branco se não souber" />
            </div>
          )}

          <div className="field">
            <label>Resultado</label>
            <div className="save-row" style={{ gap: 6 }}>
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
                          <span className="badge good">✓ Certo</span>
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
            Taxa de falha
            <Ajuda texto="Começa em 12,5% (estimativa conservadora) e vai puxando pra taxa real conforme os registros entram — com poucos registros, ainda pesa bastante a estimativa inicial; com muitos, fica quase só nos dados reais." />
          </h3>
          <div className="kv total"><span className="k">Taxa de falha atual</span><span className="v">{PCT(taxaFalha.taxa)}</span></div>
          <div className="kv"><span className="k">Registros no histórico</span><span className="v">{taxaFalha.total} ({taxaFalha.falhas} falhas)</span></div>
          <div className="kv"><span className="k">Prejuízo médio por impressão perdida</span><span className="v">{prejuizoMedioPorFalha != null ? BRL(prejuizoMedioPorFalha) : "— (sem falhas registradas ainda)"}</span></div>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Simulador de lote
            <Ajuda texto='Escolha um produto pra ver o prejuízo esperado (e o "se falhar dessa vez") em cada tamanho de lote, e o maior lote recomendado dado o quanto você toparia perder de uma vez.' />
          </h3>
          <div className="field">
            <label>Produto</label>
            <select value={produtoSimuladorId} onChange={(e) => setProdutoSimuladorId(e.target.value)}>
              <option value="">— escolha um produto —</option>
              {produtos.map((p) => (
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
  );
}
