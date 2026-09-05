import { useEffect, useState } from "react";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";

const VAZIO = { nome: "", material_nome: "", custo_producao: "", frete_padrao: "", embalagem_padrao: "", observacao: "" };

export default function Produtos({ produtoRecebido, onToast }) {
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        const { data, error } = await supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true });
        if (!ativo) return;
        if (!error) setProdutos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("produtos-cadastro-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, []);

  // Quando "Salvar como Produto" é clicado na aba de Custo de Produção.
  useEffect(() => {
    if (produtoRecebido == null) return;
    setEditandoId(null);
    setForm({
      nome: "",
      material_nome: produtoRecebido.materialNome || "",
      custo_producao: produtoRecebido.custo,
      frete_padrao: "",
      embalagem_padrao: "",
      observacao: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoRecebido?.seq]);

  const setCampo = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function limpar() {
    setForm(VAZIO);
    setEditandoId(null);
  }

  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao produto");
      return;
    }
    const payload = {
      nome,
      material_nome: form.material_nome.trim() || null,
      custo_producao: parseFloat(form.custo_producao) || 0,
      frete_padrao: parseFloat(form.frete_padrao) || 0,
      embalagem_padrao: parseFloat(form.embalagem_padrao) || 0,
      observacao: form.observacao.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    setSalvando(true);
    const { error } = editandoId
      ? await supabase.from("produtos_cadastro").update(payload).eq("id", editandoId)
      : await supabase.from("produtos_cadastro").insert(payload);
    setSalvando(false);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    onToast(editandoId ? "Produto atualizado" : "Produto cadastrado");
    limpar();
  }

  function editar(p) {
    setEditandoId(p.id);
    setForm({
      nome: p.nome,
      material_nome: p.material_nome || "",
      custo_producao: p.custo_producao,
      frete_padrao: p.frete_padrao,
      embalagem_padrao: p.embalagem_padrao,
      observacao: p.observacao || "",
    });
  }

  async function excluir(id) {
    const { error } = await supabase.from("produtos_cadastro").delete().eq("id", id);
    if (error) {
      onToast("Não foi possível excluir — tente de novo");
      return;
    }
    if (editandoId === id) limpar();
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Produtos</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">{editandoId ? "Editar produto" : "Cadastrar produto"}</h3>
        <div className="row2">
          <div className="field">
            <label>Nome do produto</label>
            <input type="text" placeholder="ex: Vaso decorativo médio" value={form.nome} onChange={setCampo("nome")} />
          </div>
          <div className="field">
            <label>Material</label>
            <input type="text" placeholder="ex: PLA (seu custo real)" value={form.material_nome} onChange={setCampo("material_nome")} />
          </div>
        </div>
        <div className="row3">
          <div className="field">
            <label>Custo de produção (R$)</label>
            <input type="number" step="0.01" value={form.custo_producao} onChange={setCampo("custo_producao")} />
          </div>
          <div className="field">
            <label>Frete padrão (R$)</label>
            <input type="number" step="0.01" value={form.frete_padrao} onChange={setCampo("frete_padrao")} />
          </div>
          <div className="field">
            <label>Embalagem padrão (R$)</label>
            <input type="number" step="0.01" value={form.embalagem_padrao} onChange={setCampo("embalagem_padrao")} />
          </div>
        </div>
        <div className="field">
          <label>Observação (opcional)</label>
          <input type="text" value={form.observacao} onChange={setCampo("observacao")} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editandoId ? "Salvar alterações" : "+ Cadastrar produto"}
          </button>
          {editandoId && (
            <button className="btn" onClick={limpar}>Cancelar</button>
          )}
        </div>
        <div className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
          Dica: na aba Custo de Produção, o botão "Salvar como Produto" já traz o custo calculado pra cá.
        </div>
      </div>

      <div className="panel">
        <h3>Produtos cadastrados</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : produtos.length === 0 ? (
          <div className="empty">Nenhum produto cadastrado ainda.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Material</th>
                  <th className="num">Custo</th>
                  <th className="num">Frete</th>
                  <th className="num">Embalagem</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td>{p.material_nome || "—"}</td>
                    <td className="num">{BRL(p.custo_producao)}</td>
                    <td className="num">{BRL(p.frete_padrao)}</td>
                    <td className="num">{BRL(p.embalagem_padrao)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="del" title="Editar" onClick={() => editar(p)}>✎</button>
                      <button className="del" title="Excluir" onClick={() => excluir(p.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
