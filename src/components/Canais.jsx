import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

const NOVO_VAZIO = { nome: "", comissao_pct: "", taxa_fixa: "", imposto_pct: "", custos_fixos_pct: "" };

const TIPO_LABEL = { shopee: "Shopee (faixas oficiais)", ml: "Mercado Livre (faixas oficiais)", custom: "Canal próprio" };

export default function Canais({ onToast }) {
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(NOVO_VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoesAds, setEdicoesAds] = useState({});

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        const { data, error } = await supabase.from("canais").select("*").order("tipo", { ascending: true }).order("nome");
        if (!ativo) return;
        if (!error) setCanais(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("canais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, []);

  async function salvarAds(id) {
    const valor = parseFloat(edicoesAds[id]);
    const { error } = await supabase
      .from("canais")
      .update({ ads_pct: isFinite(valor) ? valor / 100 : 0 })
      .eq("id", id);
    if (error) {
      onToast("Não foi possível atualizar — tente de novo");
      return;
    }
    setEdicoesAds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    onToast("% de Ads atualizado");
  }

  async function adicionar() {
    const nome = novo.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao canal");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("canais").insert({
      nome,
      tipo: "custom",
      comissao_pct: (parseFloat(novo.comissao_pct) || 0) / 100,
      taxa_fixa: parseFloat(novo.taxa_fixa) || 0,
      imposto_pct: (parseFloat(novo.imposto_pct) || 0) / 100,
      custos_fixos_pct: (parseFloat(novo.custos_fixos_pct) || 0) / 100,
    });
    setSalvandoNovo(false);
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    setNovo(NOVO_VAZIO);
    onToast("Canal adicionado");
  }

  async function excluir(id) {
    const { error } = await supabase.from("canais").delete().eq("id", id);
    if (error) onToast("Não foi possível excluir — tente de novo");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Canais</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3>Canais cadastrados</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Tipo</th>
                  <th className="num">Comissão</th>
                  <th className="num">Taxa fixa</th>
                  <th className="num">% Ads</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {canais.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td>{TIPO_LABEL[c.tipo] || c.tipo}</td>
                    <td className="num">{c.tipo === "custom" ? `${(c.comissao_pct * 100).toFixed(1)}%` : "por faixa"}</td>
                    <td className="num">{c.tipo === "custom" ? `R$ ${Number(c.taxa_fixa).toFixed(2)}` : "por faixa"}</td>
                    <td className="num">
                      <input
                        type="number"
                        step="0.1"
                        style={{ width: 70, textAlign: "right" }}
                        value={edicoesAds[c.id] ?? (c.ads_pct * 100).toFixed(1)}
                        onChange={(e) => setEdicoesAds((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        onBlur={() => {
                          if (edicoesAds[c.id] !== undefined) salvarAds(c.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                        }}
                      />
                      %
                    </td>
                    <td>
                      {c.tipo === "custom" && (
                        <button className="del" title="Excluir" onClick={() => excluir(c.id)}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          Shopee e Mercado Livre continuam usando as faixas oficiais de comissão/taxa (calculadas na hora). O % de Ads é o que você costuma investir em anúncio patrocinado nesse canal — usado no Comparativo pra mostrar o lucro com e sem Ads.
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">Adicionar canal próprio</h3>
        <div className="row2">
          <div className="field">
            <label>Nome</label>
            <input type="text" placeholder="ex: Site Próprio" value={novo.nome} onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))} />
          </div>
          <div className="field">
            <label>Comissão (%)</label>
            <input type="number" step="0.1" value={novo.comissao_pct} onChange={(e) => setNovo((p) => ({ ...p, comissao_pct: e.target.value }))} />
          </div>
        </div>
        <div className="row3">
          <div className="field">
            <label>Taxa fixa (R$)</label>
            <input type="number" step="0.01" value={novo.taxa_fixa} onChange={(e) => setNovo((p) => ({ ...p, taxa_fixa: e.target.value }))} />
          </div>
          <div className="field">
            <label>Imposto (%)</label>
            <input type="number" step="0.1" value={novo.imposto_pct} onChange={(e) => setNovo((p) => ({ ...p, imposto_pct: e.target.value }))} />
          </div>
          <div className="field">
            <label>Custos fixos (%)</label>
            <input type="number" step="0.1" value={novo.custos_fixos_pct} onChange={(e) => setNovo((p) => ({ ...p, custos_fixos_pct: e.target.value }))} />
          </div>
        </div>
        <button className="btn primary" onClick={adicionar} disabled={salvandoNovo}>
          {salvandoNovo ? "Adicionando…" : "+ Adicionar canal"}
        </button>
      </div>
    </div>
  );
}
