import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { configCalendario, datasEscolhiveis, limiteDoEvento, ocorrencias, quandoVendeDe, rotuloQuando, TIPOS_QUANDO } from "../lib/calendario.js";
import { hojeSP } from "../lib/datas.js";
import Ajuda from "./Ajuda.jsx";

// "Quando vende" do produto (lib/calendario.js) — o MESMO editor no detalhe
// do Catálogo (seletor rápido) e no cadastro do produto. Grava direto em
// produtos_cadastro.escada_config.quandoVende (sem SQL; o resto do jsonb fica).
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

export default function QuandoVende({ produtoId, onToast, compacto = false }) {
  const { lojas, lojaId } = useLoja();
  const { produtos } = useCatalogo();
  const produto = (produtos || []).find((p) => p.id === produtoId) || null;
  const cal = useMemo(() => configCalendario(lojas.find((l) => l.id === lojaId)?.config_escada), [lojas, lojaId]);
  const gravado = quandoVendeDe(produto);
  const [edit, setEdit] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeSP();
  if (!produto) return null;
  const q = edit ?? gravado ?? { tipo: "", datas: [], limiteDias: {} };
  const datas = datasEscolhiveis(cal);
  const mudou = edit != null;

  const setTipo = (tipo) => setEdit({ ...q, tipo, datas: tipo === "ano" ? [] : q.datas || [] });
  const alternar = (chave) => {
    const tem = (q.datas || []).includes(chave);
    setEdit({ ...q, datas: tem ? q.datas.filter((c) => c !== chave) : [...(q.datas || []), chave] });
  };
  const setLimite = (chave, v) => setEdit({ ...q, limiteDias: { ...(q.limiteDias || {}), [chave]: v === "" ? undefined : Math.max(1, Math.round(Number(v) || 0)) } });

  async function salvar() {
    if (q.tipo && q.tipo !== "ano" && !(q.datas || []).length) return onToast?.("Escolha pelo menos uma data");
    const limpo = q.tipo
      ? {
          tipo: q.tipo,
          datas: q.tipo === "ano" ? [] : q.datas,
          ...(q.tipo === "epoca" && Object.values(q.limiteDias || {}).some((v) => v > 0)
            ? { limiteDias: Object.fromEntries(Object.entries(q.limiteDias).filter(([c, v]) => v > 0 && q.datas.includes(c))) }
            : {}),
        }
      : null;
    const { quandoVende: _antigo, ...resto } = produto.escada_config || {};
    const novo = limpo ? { ...resto, quandoVende: limpo } : Object.keys(resto).length ? resto : null;
    setSalvando(true);
    const { error } = await supabase.from("produtos_cadastro").update({ escada_config: novo }).eq("id", produto.id);
    setSalvando(false);
    if (error) return onToast?.(/escada_config|column/i.test(error.message) ? "Rode o SQL v27 no Supabase pra salvar" : `Não foi possível salvar: ${error.message}`);
    recarregarCatalogo();
    setEdit(null);
    onToast?.(`${produto.nome}: ${rotuloQuando(limpo, cal)}`);
  }

  return (
    <div className={`quando-vende${compacto ? " compacto" : ""}`}>
      <div className="quando-topo">
        <b>Quando vende</b>
        <Ajuda texto="O ano todo = rampa normal. Com pico em… = rampa normal + lembrete no Início 60 dias antes da data. Só na época de… = rampa sazonal: sobe até o alvo até a data-limite (30 dias antes, ou 7 dias antes da 1ª campanha grande antes da data) e desce aos poucos depois. Datas e campanhas ficam em Configuração → Lojas → Calendário de vendas. Campanhas da plataforma nunca deixam um produto sazonal." />
        {!gravado && !mudou && <span className="badge info">sem classificação</span>}
      </div>
      <div className="quando-tipos">
        {TIPOS_QUANDO.map((t) => (
          <label key={t.chave} className={`quando-tipo${q.tipo === t.chave ? " ativo" : ""}`}>
            <input type="radio" name={`qv-${produto.id}`} checked={q.tipo === t.chave} onChange={() => setTipo(t.chave)} />
            {t.rotulo}
          </label>
        ))}
      </div>
      {(q.tipo === "pico" || q.tipo === "epoca") && (
        <div className="quando-datas">
          {datas.map((d) => {
            const on = (q.datas || []).includes(d.chave);
            const { prox } = ocorrencias(d.chave, cal, hoje);
            return (
              <button key={d.chave} type="button" className={`chip-quando${on ? " on" : ""}`} onClick={() => alternar(d.chave)} title={prox ? `Próxima: ${dm(prox)}` : undefined}>
                {on ? "✓ " : ""}
                {d.nome} <span className="muted-cel">{dm(prox)}</span>
              </button>
            );
          })}
        </div>
      )}
      {q.tipo === "epoca" && (q.datas || []).length > 0 && (
        <div className="quando-limites">
          {q.datas.map((c) => {
            const { prox } = ocorrencias(c, cal, hoje);
            if (!prox) return null;
            const lim = limiteDoEvento(c, prox, cal, q.limiteDias?.[c]);
            const nome = datas.find((d) => d.chave === c)?.nome || c;
            return (
              <div key={c} className="quando-limite">
                <span>
                  {nome}: no alvo até <b>{dm(lim.limite)}</b> <span className="muted-cel">({lim.motivo})</span>
                </span>
                <label className="muted-cel">
                  ou{" "}
                  <input type="number" min="1" style={{ width: 64 }} placeholder="dias" value={q.limiteDias?.[c] ?? ""} onChange={(e) => setLimite(c, e.target.value)} /> dias antes
                </label>
              </div>
            );
          })}
        </div>
      )}
      {mudou && (
        <div className="quando-acoes">
          <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" className="btn btn-mini" onClick={() => setEdit(null)}>
            Cancelar
          </button>
          {gravado && (
            <button type="button" className="link-btn" onClick={() => setEdit({ tipo: "", datas: [], limiteDias: {} })}>
              tirar a classificação
            </button>
          )}
        </div>
      )}
    </div>
  );
}
