import { useEffect, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Lista dos orçamentos avulsos (encomendas diretas) salvos em "Encomenda
// avulsa" — separada de Preços por Canal porque não tem comissão de
// marketplace nem um canal cadastrado por trás, é só um preço de venda direta.
export default function Orcamentos({ onToast }) {
  const { lojaId } = useLoja();
  const [orcamentos, setOrcamentos] = useState([]);
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
        let query = supabase.from("orcamentos_avulsos").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setOrcamentos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("orcamentos-avulsos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orcamentos_avulsos" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("orcamentos_avulsos").delete().eq("id", id);
    if (error) {
      onToast("Não foi possível excluir agora — tente de novo");
      return;
    }
    setOrcamentos((prev) => prev.filter((o) => o.id !== id));
  }

  function iniciarEdicao(o) {
    setEditandoId(o.id);
    setNomeEditado(o.nome || "");
  }

  async function salvarNome(id) {
    const nome = nomeEditado.trim();
    if (!nome) {
      onToast("O nome não pode ficar vazio");
      return;
    }
    const { error } = await supabase.from("orcamentos_avulsos").update({ nome }).eq("id", id);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    setOrcamentos((prev) => prev.map((o) => (o.id === id ? { ...o, nome } : o)));
    setEditandoId(null);
    setRecemSalvoId(id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === id ? null : atual)), 1000);
  }

  return (
    <div className="panel">
      <h3>Orçamentos salvos</h3>
      {!supabase ? (
        <div className="empty">Orçamentos indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : orcamentos.length === 0 ? (
        <div className="empty">Nenhum orçamento salvo ainda. Calcule um em "Encomenda avulsa" e clique em "Salvar".</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th className="num">Custo total</th>
                <th className="num">Preço</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orcamentos.map((o) => (
                <tr key={o.id}>
                  <td>
                    {editandoId === o.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={nomeEditado}
                        onChange={(e) => setNomeEditado(e.target.value)}
                        onBlur={() => salvarNome(o.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                          if (e.key === "Escape") setEditandoId(null);
                        }}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <>
                        {o.nome || "—"}
                        {recemSalvoId === o.id && <span className="salvo-check">✓</span>}
                      </>
                    )}
                  </td>
                  <td className="num">{BRL(o.custo_total)}</td>
                  <td className="num">{BRL(o.preco)}</td>
                  <td className="num">{BRL(o.lucro)}</td>
                  <td className="num">{PCT(o.margem)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="del" title="Editar nome" onClick={() => iniciarEdicao(o)}>✎</button>
                    <button className="del" title="Excluir" onClick={() => setExcluirAlvo(o)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir orçamento"
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
