import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const COLUNAS = [
  { key: "a_produzir", label: "A produzir" },
  { key: "produzindo", label: "Produzindo" },
  { key: "embalado", label: "Embalado" },
  { key: "enviado", label: "Enviado" },
];

export default function Organizacao({ onToast }) {
  const { lojaId } = useLoja();
  const [cards, setCards] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [titulo, setTitulo] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("kanban_cards").select("*").order("criado_em", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setCards(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("kanban-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "kanban_cards" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function adicionar() {
    const t = titulo.trim();
    if (!t) {
      onToast("Dê um título ao cartão");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("kanban_cards").insert({
      titulo: t,
      produto_nome: produtoNome.trim() || null,
      coluna: "a_produzir",
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvando(false);
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    setTitulo("");
    setProdutoNome("");
  }

  async function mover(card, direcao) {
    const idx = COLUNAS.findIndex((c) => c.key === card.coluna);
    const novoIdx = idx + direcao;
    if (novoIdx < 0 || novoIdx >= COLUNAS.length) return;
    const { error } = await supabase.from("kanban_cards").update({ coluna: COLUNAS[novoIdx].key }).eq("id", card.id);
    if (error) onToast("Não foi possível mover — tente de novo");
  }

  async function excluir(id) {
    const { error } = await supabase.from("kanban_cards").delete().eq("id", id);
    if (error) onToast("Não foi possível excluir — tente de novo");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Organização</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">Novo cartão</h3>
        <div className="save-row">
          <div className="field">
            <label>Título</label>
            <input type="text" placeholder="ex: 12x vaso decorativo médio" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="field">
            <label>Produto (opcional)</label>
            <input type="text" placeholder="ex: Vaso decorativo médio" value={produtoNome} onChange={(e) => setProdutoNome(e.target.value)} />
          </div>
          <button className="btn primary" onClick={adicionar} disabled={salvando}>
            {salvando ? "Adicionando…" : "+ Adicionar"}
          </button>
        </div>
      </div>

      {carregando ? (
        <div className="panel"><div className="empty">Carregando…</div></div>
      ) : (
        <div className="kanban-board">
          {COLUNAS.map((coluna, colIdx) => (
            <div className="kanban-col" key={coluna.key}>
              <h3 className="kanban-col-title">{coluna.label}</h3>
              {cards.filter((c) => c.coluna === coluna.key).length === 0 && (
                <div className="empty" style={{ padding: "12px 0" }}>—</div>
              )}
              {cards
                .filter((c) => c.coluna === coluna.key)
                .map((card) => (
                  <div className="kanban-card" key={card.id}>
                    <div className="kanban-card-titulo">{card.titulo}</div>
                    {card.produto_nome && <div className="kanban-card-produto">{card.produto_nome}</div>}
                    <div className="kanban-card-actions">
                      <button className="del" title="Voltar" disabled={colIdx === 0} onClick={() => mover(card, -1)}>←</button>
                      <button className="del" title="Avançar" disabled={colIdx === COLUNAS.length - 1} onClick={() => mover(card, 1)}>→</button>
                      <button className="del" title="Excluir" onClick={() => setExcluirAlvo(card)}>×</button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir cartão"
          mensagem={`Confirma excluir "${excluirAlvo.titulo}"? Não é possível desfazer.`}
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
