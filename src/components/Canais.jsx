import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const NOVO_VAZIO = { nome: "", comissao_pct: "", taxa_fixa: "", imposto_pct: "", custos_fixos_pct: "" };

const TIPO_LABEL = {
  shopee: "Shopee (faixas oficiais)",
  ml: "Mercado Livre (faixas oficiais)",
  tiktok: "TikTok Shop (faixas oficiais)",
  custom: "Canal próprio",
};

// Componente fora do Canais() de propósito: se ficasse dentro, seria recriado
// a cada tecla digitada e o input perderia o foco a cada caractere.
function CampoEditavel({ canal, campo, isPct, sufixo, edicoes, setEdicoes, onSalvar }) {
  const [salvo, disparar] = useSalvoFlash();
  const k = `${canal.id}:${campo}`;
  const valorAtual = canal[campo];
  const valorExibido = edicoes[k] ?? (isPct ? (Number(valorAtual || 0) * 100).toFixed(1) : Number(valorAtual || 0).toFixed(2));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {sufixo === "R$" && "R$ "}
      <input
        type="number"
        step="0.01"
        style={{ width: 64, textAlign: "right" }}
        value={valorExibido}
        onChange={(e) => setEdicoes((prev) => ({ ...prev, [k]: e.target.value }))}
        onBlur={async () => {
          if (edicoes[k] !== undefined) {
            const ok = await onSalvar(canal.id, campo, isPct);
            if (ok) disparar();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {sufixo === "%" && "%"}
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

export default function Canais({ onToast }) {
  const { lojaId } = useLoja();
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(NOVO_VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({});
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("canais").select("*").order("tipo", { ascending: true }).order("nome");
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
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
  }, [lojaId]);

  function chave(id, campo) {
    return `${id}:${campo}`;
  }

  async function salvarCampo(id, campo, isPct) {
    const raw = edicoes[chave(id, campo)];
    const valor = parseFloat(String(raw).replace(",", "."));
    const valorFinal = isFinite(valor) ? (isPct ? valor / 100 : valor) : 0;
    const { error } = await supabase.from("canais").update({ [campo]: valorFinal }).eq("id", id);
    if (error) {
      onToast("Não foi possível atualizar — tente de novo");
      return false;
    }
    setEdicoes((prev) => {
      const next = { ...prev };
      delete next[chave(id, campo)];
      return next;
    });
    return true;
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
      ...(lojaId ? { loja_id: lojaId } : {}),
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

  const temTiktok = canais.some((c) => c.tipo === "tiktok");

  async function adicionarTiktok() {
    const { error } = await supabase.from("canais").insert({
      nome: "TikTok Shop",
      tipo: "tiktok",
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    onToast("TikTok Shop adicionado");
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
        <h3>
          Canais cadastrados
          <Ajuda texto="Comissão e taxa fixa da Shopee/ML seguem as faixas oficiais (calculadas automaticamente). Imposto e custos fixos são por canal — o Comparativo usa o valor daqui pra cada um. % de Ads é quanto você costuma investir em anúncio patrocinado, usado só pra mostrar o lucro com Ads no Comparativo." />
        </h3>
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
                  <th className="num">Imposto</th>
                  <th className="num">Custos fixos</th>
                  <th className="num">% Ads</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {canais.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td>{TIPO_LABEL[c.tipo] || c.tipo}</td>
                    <td className="num">
                      {c.tipo === "custom" ? (
                        <CampoEditavel canal={c} campo="comissao_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                      ) : (
                        "por faixa"
                      )}
                    </td>
                    <td className="num">
                      {c.tipo === "custom" ? (
                        <CampoEditavel canal={c} campo="taxa_fixa" sufixo="R$" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                      ) : (
                        "por faixa"
                      )}
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="imposto_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="custos_fixos_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="ads_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td>
                      {(c.tipo === "custom" || c.tipo === "tiktok") && (
                        <button className="del" title="Excluir" onClick={() => setExcluirAlvo(c)}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          Shopee, Mercado Livre e TikTok Shop usam as faixas oficiais de comissão/taxa (calculadas na hora). Imposto e custos fixos agora são por canal — o Comparativo usa automaticamente o valor daqui. O % de Ads é o que você costuma investir em anúncio patrocinado nesse canal.
        </div>
        {!temTiktok && (
          <button className="btn" style={{ marginTop: 12 }} onClick={adicionarTiktok}>
            + Adicionar TikTok Shop (faixas oficiais)
          </button>
        )}
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

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir canal"
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
