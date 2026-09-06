import { useEffect, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

export default function Historico({ onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editandoId, setEditandoId] = useState(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }

    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("produtos").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
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
      .channel("produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("produtos").delete().eq("id", id);
    if (error) {
      onToast("Não foi possível excluir agora — tente de novo");
      return;
    }
    setProdutos((prev) => prev.filter((p) => p.id !== id));
  }

  function iniciarEdicao(p) {
    setEditandoId(p.id);
    setNomeEditado(p.nome || "");
  }

  async function salvarNome(id) {
    const nome = nomeEditado.trim();
    if (!nome) {
      onToast("O nome não pode ficar vazio");
      return;
    }
    const { error } = await supabase.from("produtos").update({ nome }).eq("id", id);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    setProdutos((prev) => prev.map((p) => (p.id === id ? { ...p, nome } : p)));
    setEditandoId(null);
    setRecemSalvoId(id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === id ? null : atual)), 1000);
  }

  return (
    <div className="panel">
      <h3>Produtos salvos</h3>
      {!supabase ? (
        <div className="empty">
          Histórico indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.
        </div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : produtos.length === 0 ? (
        <div className="empty">Nenhum produto salvo ainda. Calcule um preço na aba anterior e clique em "Salvar".</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Canal</th>
                <th className="num">Custo</th>
                <th className="num">Preço</th>
                <th className="num">Margem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id}>
                  <td>
                    {editandoId === p.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={nomeEditado}
                        onChange={(e) => setNomeEditado(e.target.value)}
                        onBlur={() => salvarNome(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                          if (e.key === "Escape") setEditandoId(null);
                        }}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <>
                        {p.nome || "—"}
                        {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                      </>
                    )}
                  </td>
                  <td>{p.canal || "—"}</td>
                  <td className="num">{BRL(p.custo)}</td>
                  <td className="num">{BRL(p.preco)}</td>
                  <td className="num">{PCT(p.margem)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="del" title="Editar nome" onClick={() => iniciarEdicao(p)}>✎</button>
                    <button className="del" title="Excluir" onClick={() => setExcluirAlvo(p)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir do histórico"
          mensagem={`Confirma excluir "${excluirAlvo.nome || "este item"}"? Não é possível desfazer.`}
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
