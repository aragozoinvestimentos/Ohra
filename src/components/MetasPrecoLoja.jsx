import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { ESCADA_PADRAO } from "../lib/escada.js";
import Ajuda from "./Ajuda.jsx";

// Metas de preço da loja (config_escada): margem desejada, margem mínima e
// lucro mínimo em R$ por venda — valem pro app todo (Avulso, Por quantidade,
// kits, Comparar, Promoções, Orçamento, Ranking). Produto pode ter as
// próprias em Por quantidade → Regras da escada → "Regras próprias".
export default function MetasPrecoLoja({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const cfg = { ...ESCADA_PADRAO, ...(loja?.config_escada || {}) };
  const [edit, setEdit] = useState(null);
  const [salvando, setSalvando] = useState(false);
  if (!loja) return null;
  const valores = edit ?? {
    margemDesejada: String(Math.round(cfg.margemDesejada * 1000) / 10),
    margemMin: String(Math.round(cfg.margemMin * 1000) / 10),
    lucroMinimo: String(Number(cfg.lucroMinimo) || 0),
  };
  const set = (k) => (e) => setEdit({ ...valores, [k]: e.target.value });
  async function salvar() {
    const pct = (k) => Math.max(0, Math.min(90, Number(String(valores[k]).replace(",", ".")) || 0)) / 100;
    const novo = { ...(loja.config_escada || {}), margemDesejada: pct("margemDesejada"), margemMin: pct("margemMin"), lucroMinimo: Math.max(0, Number(String(valores.lucroMinimo).replace(",", ".")) || 0) };
    if (novo.margemMin > novo.margemDesejada) {
      onToast("A margem mínima não pode ser maior que a desejada");
      return;
    }
    setSalvando(true);
    const r = await atualizar(lojaId, { configEscada: novo });
    setSalvando(false);
    if (!r.ok) {
      onToast(/config_escada|column/i.test(r.error || "") ? "Rode o SQL v27 no Supabase pra salvar" : `Não foi possível salvar: ${r.error}`);
      return;
    }
    setEdit(null);
    onToast("Metas de preço salvas pra loja toda");
  }
  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          Metas de preço — {loja.nome}
          <Ajuda texto="Valem pro app todo. Margem desejada = ponto de partida dos preços (Avulso, Comparar, Promoções, Orçamento) e base do lucro por peça da escada. Mínimo aceitável = o maior entre a margem mínima e o lucro mínimo em R$ por venda — nenhuma sugestão (escada, kit, concorrente, promoção) fica abaixo dele. O lucro mínimo em R$ protege os itens baratos, onde a % engana por causa da taxa fixa (0 = desligado). Um produto pode ter metas próprias em Precificação → 2º Por quantidade → Regras da escada." />
        </span>
      </h3>
      <div className="grid-auto metas-preco">
        <div className="field">
          <label>Margem desejada (%)</label>
          <input type="number" step="1" value={valores.margemDesejada} onChange={set("margemDesejada")} />
        </div>
        <div className="field">
          <label>Margem mínima (%)</label>
          <input type="number" step="1" value={valores.margemMin} onChange={set("margemMin")} />
        </div>
        <div className="field">
          <label>Lucro mínimo por venda (R$)</label>
          <input type="number" step="0.5" value={valores.lucroMinimo} onChange={set("lucroMinimo")} />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn primary" disabled={salvando || !edit} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar metas"}
          </button>
        </div>
      </div>
    </div>
  );
}
