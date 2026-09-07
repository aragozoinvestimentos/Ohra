import { useEffect, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Antes esta aba lia uma tabela solta ("produtos") que só guardava um
// instantâneo do que foi salvo em Precificação por Canal, sem ligação real
// com o cadastro. Agora ela é uma grade: cada linha é um produto ou kit
// cadastrado, cada coluna é um canal cadastrado, e cada célula é o preço
// (com lucro e margem) mais recente salvo pra essa combinação — preenchida
// automaticamente quando alguém salva em Precificação por Canal.
export default function Historico({ onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, carregando: carregandoBase } = useRankingData();
  const [precos, setPrecos] = useState([]);
  const [carregandoPrecos, setCarregandoPrecos] = useState(true);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [edicao, setEdicao] = useState({ preco: "", lucro: "", margem: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregandoPrecos(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("precos_canal").select("*");
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setPrecos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregandoPrecos(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("precos-canal-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "precos_canal" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  function precoDe(item, canalObj) {
    const [tipo, id] = item.id.split(":");
    const itemTipo = tipo === "k" ? "kit" : "produto";
    return precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalObj.id) || null;
  }

  async function excluir(precoId) {
    if (!supabase) return;
    const { error } = await supabase.from("precos_canal").delete().eq("id", precoId);
    if (error) {
      onToast("Não foi possível excluir agora — tente de novo");
      return;
    }
    setPrecos((prev) => prev.filter((p) => p.id !== precoId));
  }

  function iniciarEdicao(p) {
    setEditandoId(p.id);
    setEdicao({
      preco: Number(p.preco || 0).toFixed(2),
      lucro: p.lucro != null ? Number(p.lucro).toFixed(2) : "",
      margem: p.margem != null ? (Number(p.margem) * 100).toFixed(1) : "",
    });
  }

  async function salvarEdicao(precoId) {
    const preco = parseFloat(String(edicao.preco).replace(",", "."));
    if (!isFinite(preco) || preco <= 0) {
      onToast("Informe um preço válido");
      return;
    }
    const lucroNum = parseFloat(String(edicao.lucro).replace(",", "."));
    const margemNum = parseFloat(String(edicao.margem).replace(",", "."));
    const lucro = isFinite(lucroNum) ? arredondarPreco(lucroNum) : null;
    const margem = isFinite(margemNum) ? margemNum / 100 : null;
    setSalvandoEdicao(true);
    const { error } = await supabase
      .from("precos_canal")
      .update({ preco: arredondarPreco(preco), lucro, margem, atualizado_em: new Date().toISOString() })
      .eq("id", precoId);
    setSalvandoEdicao(false);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    setPrecos((prev) => prev.map((p) => (p.id === precoId ? { ...p, preco: arredondarPreco(preco), lucro, margem } : p)));
    setEditandoId(null);
    setRecemSalvoId(precoId);
    setTimeout(() => setRecemSalvoId((atual) => (atual === precoId ? null : atual)), 1000);
    onToast("Preço atualizado");
  }

  const carregando = carregandoBase || carregandoPrecos;

  return (
    <div className="panel">
      <h3>
        Preços por canal
        <Ajuda texto="Cada célula mostra o preço, lucro e margem salvos pra esse produto/kit nesse canal. Célula vazia significa que ainda não foi salvo nada pra essa combinação — preencha em Precificação por Canal. Já salvo, use o ✎ pra corrigir na mão ou o × pra excluir (com confirmação)." />
      </h3>
      {!supabase ? (
        <div className="empty">Preços por Canal indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="empty">Nenhum produto ou kit cadastrado ainda. Cadastre em Cadastros → Produtos ou Kits.</div>
      ) : canais.length === 0 ? (
        <div className="empty">Nenhum canal cadastrado ainda. Cadastre em Cadastros → Canais.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto/Kit</th>
                <th className="num">Custo total</th>
                {canais.map((c) => (
                  <th key={c.id} className="num">{c.nome}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.nome} <span className="campo-anterior">({item.tipo})</span>
                  </td>
                  <td className="num">{BRL(item.custoTotal)}</td>
                  {canais.map((c) => {
                    const p = precoDe(item, c);
                    if (p && editandoId === p.id) {
                      return (
                        <td key={c.id} className="num">
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Preço"
                              style={{ width: 88, textAlign: "right" }}
                              value={edicao.preco}
                              onChange={(e) => setEdicao((prev) => ({ ...prev, preco: e.target.value }))}
                              autoFocus
                            />
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Lucro"
                              style={{ width: 88, textAlign: "right" }}
                              value={edicao.lucro}
                              onChange={(e) => setEdicao((prev) => ({ ...prev, lucro: e.target.value }))}
                            />
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Margem %"
                              style={{ width: 88, textAlign: "right" }}
                              value={edicao.margem}
                              onChange={(e) => setEdicao((prev) => ({ ...prev, margem: e.target.value }))}
                            />
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="btn primary" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => salvarEdicao(p.id)} disabled={salvandoEdicao}>
                                {salvandoEdicao ? "…" : "✓"}
                              </button>
                              <button className="del" title="Cancelar" onClick={() => setEditandoId(null)}>
                                ×
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={c.id} className="num">
                        {p ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                            <span>
                              {BRL(p.preco)}
                              {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                              <span className="campo-anterior" style={{ display: "block" }}>
                                {p.lucro != null ? `lucro ${BRL(p.lucro)}` : "—"}
                                {p.margem != null ? ` · ${PCT(p.margem)}` : ""}
                              </span>
                            </span>
                            <button className="del" title="Editar preço salvo" onClick={() => iniciarEdicao(p)}>
                              ✎
                            </button>
                            <button
                              className="del"
                              title="Excluir preço salvo"
                              onClick={() => setExcluirAlvo({ ...p, nomeItem: item.nome, nomeCanal: c.nome })}
                            >
                              ×
                            </button>
                          </span>
                        ) : (
                          <span style={{ color: "var(--ink-faint)" }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        Pra preencher uma célula vazia, vá em Precificação por Canal, escolha o produto/kit e o canal, calcule e clique em "Salvar". Pra corrigir um valor já
        salvo, use o ✎ na própria célula — ou o × pra excluir (pede confirmação antes).
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir preço salvo"
          mensagem={`Confirma excluir o preço de "${excluirAlvo.nomeItem}" em ${excluirAlvo.nomeCanal}? Não é possível desfazer.`}
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
