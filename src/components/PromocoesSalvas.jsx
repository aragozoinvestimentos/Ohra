import { useEffect, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { TIPOS } from "../lib/promocaoTipos.js";

function labelTipo(tipo) {
  return TIPOS.find((t) => t.key === tipo)?.label || tipo || "—";
}

// Lista das promoções salvas em "Promoções → Simular promoção" — mesmo
// padrão de Orçamentos salvos, só que cada linha guarda também o tipo de
// promoção e um resumo em texto da configuração usada (desconto %, leve/pague,
// tiers do progressivo…), já que cada tipo calcula de um jeito diferente e
// nem sempre tem um preço único (ex: Progressivo).
export default function PromocoesSalvas({ onToast }) {
  const { lojaId } = useLoja();
  const [promocoes, setPromocoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editandoId, setEditandoId] = useState(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
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
        let query = supabase.from("promocoes_salvas").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setPromocoes(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("promocoes-salvas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "promocoes_salvas" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("promocoes_salvas").delete().eq("id", id);
    if (error) {
      onToast?.("Não foi possível excluir agora — tente de novo");
      return;
    }
    setPromocoes((prev) => prev.filter((p) => p.id !== id));
  }

  function iniciarEdicao(p) {
    setEditandoId(p.id);
    setNomeEditado(p.nome || "");
  }

  async function salvarNome() {
    const id = editandoId;
    const nome = nomeEditado.trim();
    if (!nome) {
      onToast?.("O nome não pode ficar vazio");
      return;
    }
    setSalvandoEdicao(true);
    const { error } = await supabase.from("promocoes_salvas").update({ nome }).eq("id", id);
    setSalvandoEdicao(false);
    if (error) {
      onToast?.("Não foi possível salvar — tente de novo");
      return;
    }
    setPromocoes((prev) => prev.map((p) => (p.id === id ? { ...p, nome } : p)));
    setEditandoId(null);
    setRecemSalvoId(id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === id ? null : atual)), 1000);
    onToast?.("Nome atualizado");
  }

  return (
    <div className="panel">
      <h3>Promoções salvas</h3>
      {!supabase ? (
        <div className="empty">Promoções salvas indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : promocoes.length === 0 ? (
        <div className="empty">Nenhuma promoção salva ainda. Configure uma em "Simular promoção" e clique em "Salvar".</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promoção</th>
                <th>Tipo</th>
                <th>Item / Canal</th>
                <th className="num">Preço</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promocoes.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.nome || "—"}
                    {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                    {p.resumo && (
                      <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>
                        {p.resumo}
                      </div>
                    )}
                  </td>
                  <td>{labelTipo(p.tipo)}</td>
                  <td>
                    {p.item_nome || "—"}
                    {p.canal_nome ? ` — ${p.canal_nome}` : ""}
                  </td>
                  <td className="num">{p.preco != null ? BRL(p.preco) : "—"}</td>
                  <td className="num">{p.lucro != null ? BRL(p.lucro) : "—"}</td>
                  <td className="num">{p.margem != null ? PCT(p.margem) : "—"}</td>
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

      {editandoId && (
        <EditarDialog
          titulo="Editar nome da promoção"
          salvando={salvandoEdicao}
          onSalvar={salvarNome}
          onCancelar={() => setEditandoId(null)}
        >
          <div className="field">
            <label>Nome da promoção</label>
            <input
              type="text"
              autoFocus
              value={nomeEditado}
              onChange={(e) => setNomeEditado(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvarNome();
              }}
            />
          </div>
        </EditarDialog>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir promoção"
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
