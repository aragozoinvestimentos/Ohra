import { useEffect, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";

export default function Historico({ onToast }) {
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }

    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("produtos")
        .select("*")
        .order("criado_em", { ascending: false });
      if (!ativo) return;
      if (!error) setProdutos(data || []);
      setCarregando(false);
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
  }, []);

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("produtos").delete().eq("id", id);
    if (error) {
      onToast("Não foi possível excluir agora — tente de novo");
      return;
    }
    setProdutos((prev) => prev.filter((p) => p.id !== id));
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
                  <td>{p.nome || "—"}</td>
                  <td>{p.canal || "—"}</td>
                  <td className="num">{BRL(p.custo)}</td>
                  <td className="num">{BRL(p.preco)}</td>
                  <td className="num">{PCT(p.margem)}</td>
                  <td>
                    <button className="del" title="Excluir" onClick={() => excluir(p.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
