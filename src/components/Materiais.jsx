import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Fora do Materiais() de propósito: se ficasse dentro, seria recriado a cada
// tecla digitada e o input perderia o foco a cada caractere.
function CampoPreco({ material, edicoes, setEdicoes, onSalvar }) {
  const [salvo, disparar] = useSalvoFlash();
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <input
        type="number"
        step="0.01"
        style={{ width: 90, textAlign: "right" }}
        value={edicoes[material.id] ?? material.preco_kg}
        onChange={(e) => setEdicoes((prev) => ({ ...prev, [material.id]: e.target.value }))}
        onBlur={async () => {
          if (edicoes[material.id] !== undefined && parseFloat(edicoes[material.id]) !== material.preco_kg) {
            const ok = await onSalvar(material.id);
            if (ok) disparar();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

export default function Materiais({ onToast }) {
  const { lojaId } = useLoja();
  const [materiais, setMateriais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState({ nome: "", preco_kg: "", observacao: "" });
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({}); // id -> valor em edição (preco_kg como string)
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("materiais").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setMateriais(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("materiais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function adicionar() {
    const nome = novo.nome.trim();
    const preco = parseFloat(novo.preco_kg);
    if (!nome || !isFinite(preco)) {
      onToast("Preencha nome e preço por kg");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("materiais").insert({
      nome,
      preco_kg: preco,
      observacao: novo.observacao.trim() || null,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvandoNovo(false);
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    setNovo({ nome: "", preco_kg: "", observacao: "" });
    onToast("Material adicionado");
  }

  async function salvarPreco(id) {
    const valor = parseFloat(edicoes[id]);
    if (!isFinite(valor)) {
      onToast("Preço inválido");
      return false;
    }
    const { error } = await supabase
      .from("materiais")
      .update({ preco_kg: valor, atualizado_em: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      onToast("Não foi possível atualizar — tente de novo");
      return false;
    }
    setEdicoes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    return true;
  }

  async function excluir(id) {
    const { error } = await supabase.from("materiais").delete().eq("id", id);
    if (error) {
      onToast("Não foi possível excluir — tente de novo");
      return;
    }
    setMateriais((prev) => prev.filter((m) => m.id !== id));
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Materiais</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">Adicionar material</h3>
        <div className="row3">
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              placeholder="ex: PETG Premium"
              value={novo.nome}
              onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Preço por kg (R$)</label>
            <input
              type="number"
              step="0.01"
              value={novo.preco_kg}
              onChange={(e) => setNovo((p) => ({ ...p, preco_kg: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Observação (opcional)</label>
            <input
              type="text"
              value={novo.observacao}
              onChange={(e) => setNovo((p) => ({ ...p, observacao: e.target.value }))}
            />
          </div>
        </div>
        <button className="btn primary" onClick={adicionar} disabled={salvandoNovo}>
          {salvandoNovo ? "Adicionando…" : "+ Adicionar material"}
        </button>
      </div>

      <div className="panel">
        <h3>Materiais cadastrados</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : materiais.length === 0 ? (
          <div className="empty">Nenhum material cadastrado ainda.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th className="num">Preço / kg</th>
                  <th>Observação</th>
                  <th>Atualizado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {materiais.map((m) => (
                  <tr key={m.id}>
                    <td>{m.nome}</td>
                    <td className="num">
                      <CampoPreco material={m} edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarPreco} />
                    </td>
                    <td>{m.observacao || "—"}</td>
                    <td>{new Date(m.atualizado_em).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <button className="del" title="Excluir" onClick={() => setExcluirAlvo(m)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {materiais.length > 0 && (
          <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Pra atualizar um preço: clique no valor, edite e aperte Enter (ou clique fora) para salvar. É esse valor que aparece no dropdown de filamento na aba Custo de Produção.
          </div>
        )}
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir material"
          mensagem={`Confirma excluir "${excluirAlvo.nome}"? Não é possível desfazer.`}
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
