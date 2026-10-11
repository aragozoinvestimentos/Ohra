import { useState } from "react";
import Portal from "./Portal.jsx";
import BuscaItem from "./BuscaItem.jsx";
import Estado from "./Estado.jsx";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { ABAS_TAREFA, REPETIR } from "../lib/tarefas.js";
import { rotuloLink, salvarTarefa } from "../lib/tarefasAcoes.js";

const diaMesAno = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

// Criar/editar tarefa: descrição obrigatória; data, repetir e link opcionais.
export function TarefaDialog({ tarefa, itens, lojaId, onToast, onClose }) {
  const [f, setF] = useState(() => ({
    descricao: tarefa?.descricao || "",
    vence: tarefa?.vence ? String(tarefa.vence).slice(0, 10) : "",
    repetir: tarefa?.repetir || "",
    link_aba: tarefa?.link_aba || "",
    link_item: tarefa?.link_item || "",
  }));
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const ok = f.descricao.trim().length > 0;

  async function salvar() {
    if (!ok || salvando) return;
    setSalvando(true);
    const err = await salvarTarefa(f, { id: tarefa?.id, lojaId });
    setSalvando(false);
    if (err) {
      onToast?.(/tarefas|relation|schema/i.test(err.message || "") ? "Rode o supabase/schema_v42.sql no Supabase pra usar as tarefas" : `Não deu pra salvar: ${err.message}`);
      return;
    }
    onToast?.(tarefa ? "Tarefa atualizada" : "Tarefa criada");
    onClose();
  }

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box modal-box-larga" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <h3>{tarefa ? "Editar tarefa" : "Nova tarefa"}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <div className="field">
              <label htmlFor="tarefa-desc">O que fazer</label>
              <input id="tarefa-desc" type="text" value={f.descricao} onChange={set("descricao")} placeholder="ex.: comprar filamento PETG preto" autoFocus maxLength={200} />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="tarefa-vence">Data (opcional)</label>
                <input id="tarefa-vence" type="date" value={f.vence} onChange={set("vence")} />
              </div>
              <div className="field">
                <label htmlFor="tarefa-repetir">Repetir</label>
                <select id="tarefa-repetir" value={f.repetir} onChange={set("repetir")}>
                  {REPETIR.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="tarefa-aba">Abrir em (opcional)</label>
              <select id="tarefa-aba" value={f.link_aba} onChange={set("link_aba")}>
                <option value="">— nenhuma aba —</option>
                {ABAS_TAREFA.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.rotulo}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Produto (opcional)</label>
              <BuscaItem grupos={gruposDoSeletor(itens)} value={f.link_item} onChange={set("link_item")} vazio="— nenhum produto —" />
              {f.link_item && !f.link_aba && <div className="hint" style={{ marginTop: 4 }}>Sem aba escolhida, “abrir” leva pra Produtos precificados com ele.</div>}
            </div>
            {f.repetir && <div className="hint">Ao concluir, o app cria a próxima {f.repetir === "semanal" ? "uma semana depois" : "um mês depois"}{f.vence ? ` de ${diaMesAno(f.vence)}` : " (a partir de hoje)"}.</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn primary" disabled={!ok || salvando}>
                {salvando ? "Salvando…" : tarefa ? "Salvar" : "Criar tarefa"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

// Uma tarefa no "Pra fazer": texto (clicar = editar), data/estado, repetição,
// link, ✓ concluir, abrir e × excluir.
export function LinhaTarefa({ p, itens, onEditar, onConcluir, onExcluir, onAbrir }) {
  const t = p.tarefa;
  const e = p.estadoTarefa;
  const link = rotuloLink(t, itens);
  return (
    <>
      <button type="button" className="tarefa-check" onClick={() => onConcluir(t)} title="Concluir" aria-label={`Concluir: ${t.descricao}`}>
        ✓
      </button>
      <div className="inicio-item-txt">
        <button type="button" className="tarefa-texto" onClick={() => onEditar(t)} title="Editar tarefa">
          {t.descricao}
        </button>
        <span className="tarefa-meta">
          {e.tipo ? <Estado tipo={e.tipo}>{e.rotulo}</Estado> : <span>{e.rotulo}</span>}
          {t.repetir && <span>↻ {t.repetir === "semanal" ? "toda semana" : "todo mês"}</span>}
          {link && <span>{link}</span>}
        </span>
      </div>
      <span className="tarefa-acoes">
        {link && (
          <button type="button" className="btn btn-mini" onClick={() => onAbrir(t)}>
            abrir
          </button>
        )}
        <button type="button" className="del" onClick={() => onExcluir(t)} title="Excluir tarefa" aria-label={`Excluir: ${t.descricao}`}>
          ×
        </button>
      </span>
    </>
  );
}
