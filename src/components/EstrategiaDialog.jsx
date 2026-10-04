import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { BRL } from "../lib/format.js";
import { ESTRATEGIAS, PRAZO_CRESCIMENTO_DIAS, hojeLocal, somarDiasIso } from "../lib/estrategia.js";
import EditarDialog from "./EditarDialog.jsx";
import CanalTag from "./CanalTag.jsx";

const TEXTO = {
  crescimento: "Preço baixo de propósito por um tempo (entrar no mercado, ganhar vendas e avaliações). O aviso de mínimo some até o prazo.",
  atracao: "O avulso puxa o clique na busca e o lucro vem no kit/variação. O aviso de mínimo some, sem prazo.",
  normal: "Preço normal: o app avisa quando ficar abaixo do mínimo aceitável.",
};

/**
 * "Manter assim" — grava a estratégia do preço salvo (schema v37).
 * alvo = { item, canal, linha (precos_canal ao vivo), outras: [{ canal, linha }] (mesmo item, outros canais) }
 * inicial = 'crescimento' | 'atracao' | 'normal' (opcional)
 */
export default function EstrategiaDialog({ alvo, inicial, onClose, onToast }) {
  const atual = alvo.linha?.estrategia || null;
  const [chave, setChave] = useState(inicial || atual || "crescimento");
  const [dias, setDias] = useState(() => {
    if (atual === "crescimento" && alvo.linha?.estrategia_ate) {
      const d = Math.round((new Date(`${alvo.linha.estrategia_ate}T12:00:00`) - new Date(`${hojeLocal()}T12:00:00`)) / 86400000);
      return String(Math.max(1, d));
    }
    return String(PRAZO_CRESCIMENTO_DIAS);
  });
  const [motivo, setMotivo] = useState(alvo.linha?.estrategia_motivo || "");
  const [todos, setTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const outras = (alvo.outras || []).filter((o) => o.linha && o.canal.id !== alvo.canal.id);

  async function salvar() {
    if (!supabase) return;
    const nDias = Math.round(Number(dias));
    if (chave === "crescimento" && !(nDias > 0)) return onToast?.("Informe o prazo em dias");
    const alvos = [{ canal: alvo.canal, linha: alvo.linha }, ...(todos ? outras : [])];
    const agora = new Date().toISOString();
    setSalvando(true);
    for (const a of alvos) {
      const { error } = await supabase
        .from("precos_canal")
        .update({
          estrategia: chave,
          estrategia_ate: chave === "crescimento" ? somarDiasIso(hojeLocal(), nDias) : null,
          // Lucro ao vivo de hoje: se cair mais de R$0,05, a decisão vence e o aviso volta.
          estrategia_lucro_ref: a.linha.lucro != null ? Math.round(Number(a.linha.lucro) * 100) / 100 : null,
          estrategia_motivo: motivo.trim() || null,
          estrategia_em: agora,
        })
        .eq("id", a.linha.id);
      if (error) {
        setSalvando(false);
        return onToast?.(/estrategia/i.test(error.message) ? "Falta rodar o supabase/schema_v37.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
      }
    }
    setSalvando(false);
    recarregarCatalogo();
    onToast?.(`${alvo.item.nome}: ${ESTRATEGIAS[chave].toLowerCase()}${chave === "crescimento" ? ` por ${nDias} dias` : ""}${alvos.length > 1 ? ` em ${alvos.length} canais` : ""}`);
    onClose();
  }

  return (
    <EditarDialog titulo={`Manter assim — ${alvo.item.nome}`} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Salvar decisão" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>
        <CanalTag canal={alvo.canal} /> · preço salvo {BRL(Number(alvo.linha.preco))} · lucro hoje {alvo.linha.lucro != null ? BRL(Number(alvo.linha.lucro)) : "—"}. Prejuízo continua aparecendo sempre (discreto). Salvar um preço novo desfaz a decisão.
      </p>
      <div className="estrategia-opcoes">
        {["crescimento", "atracao", "normal"].map((k) => (
          <label key={k} className={`estrategia-op${chave === k ? " ativa" : ""}`}>
            <input type="radio" name="estrategia" checked={chave === k} onChange={() => setChave(k)} />
            <span>
              <b>{ESTRATEGIAS[k]}</b>
              <small>{TEXTO[k]}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="grid-auto" style={{ marginTop: 8 }}>
        {chave === "crescimento" && (
          <div className="field">
            <label>Prazo (dias)</label>
            <input type="number" min="1" value={dias} onChange={(e) => setDias(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>Motivo (opcional)</label>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: entrar com preço baixo pra ganhar avaliação" />
        </div>
      </div>
      {outras.length > 0 && (
        <label className="check-inline">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Aplicar em todos os canais deste item ({outras.length + 1})
        </label>
      )}
    </EditarDialog>
  );
}
