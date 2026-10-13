import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { CAMPANHAS, configCalendario, DATAS_COMEMORATIVAS, ocorrencias } from "../lib/calendario.js";
import { hojeSP } from "../lib/datas.js";
import Ajuda from "./Ajuda.jsx";

// Calendário de vendas da loja (Configuração → Lojas): datas comemorativas
// (datas calculadas sozinhas: Páscoa, Dia das Mães, Black Friday…),
// campanhas da plataforma (3.3 a 12.12) e datas próprias. Grava em
// lojas.config_escada.calendario (sem SQL). Os produtos escolhem as datas em
// "Quando vende" (Cadastros → Catálogo ou Produtos).
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function CalendarioLoja({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const [edit, setEdit] = useState(null);
  const [nova, setNova] = useState({ nome: "", dia: "", mes: "" });
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeSP();
  if (!loja) return null;
  const cal = edit ?? configCalendario(loja.config_escada);
  const set = (k, chave, v) => setEdit({ ...cal, [k]: { ...cal[k], [chave]: v ? undefined : false } });

  function addPropria() {
    const nome = nova.nome.trim();
    const dia = Math.round(Number(nova.dia));
    const mes = Math.round(Number(nova.mes));
    if (!nome || !(dia >= 1 && dia <= 31) || !(mes >= 1 && mes <= 12)) return onToast?.("Informe nome, dia e mês da data");
    setEdit({ ...cal, proprias: [...cal.proprias, { id: `d${Date.now().toString(36)}`, nome, dia, mes }] });
    setNova({ nome: "", dia: "", mes: "" });
  }
  async function salvar() {
    const limpa = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === false));
    setSalvando(true);
    const r = await atualizar(lojaId, { configEscada: { ...(loja.config_escada || {}), calendario: { datas: limpa(cal.datas), campanhas: limpa(cal.campanhas), proprias: cal.proprias } } });
    setSalvando(false);
    if (!r.ok) return onToast?.(`Não foi possível salvar: ${r.error}`);
    setEdit(null);
    onToast?.("Calendário de vendas salvo");
  }

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          Calendário de vendas — {loja.nome}
          <Ajuda texto="Datas comemorativas: os produtos “só na época de…” sobem até o alvo antes delas e descem depois (rampa sazonal); os “com pico em…” ganham um lembrete no Início 60 dias antes. Campanhas da plataforma: as que você participa entram na data-limite (no alvo 7 dias antes da 1ª campanha grande — 9.9 a 12.12 — antes da data) e no aviso de preço de campanha do Crescimento. Campanha nunca deixa um produto sazonal." />
        </span>
      </h3>
      <div className="pad-painel calendario-loja">
        <div className="ads-rotulo">Datas comemorativas</div>
        <div className="quando-datas">
          {DATAS_COMEMORATIVAS.map((d) => {
            const on = cal.datas[d.chave] !== false;
            return (
              <label key={d.chave} className={`chip-quando${on ? " on" : ""}`}>
                <input type="checkbox" checked={on} onChange={(e) => set("datas", d.chave, e.target.checked)} />
                {d.nome} <span className="muted-cel">{dm(ocorrencias(d.chave, cal, hoje).prox)}</span>
              </label>
            );
          })}
        </div>
        <div className="ads-rotulo" style={{ marginTop: 12 }}>Campanhas da plataforma em que participo</div>
        <div className="quando-datas">
          {CAMPANHAS.map((c) => {
            const on = cal.campanhas[c.chave] !== false;
            return (
              <label key={c.chave} className={`chip-quando${on ? " on" : ""}`} title={c.grande ? "Campanha grande: conta pra data-limite dos produtos sazonais" : undefined}>
                <input type="checkbox" checked={on} onChange={(e) => set("campanhas", c.chave, e.target.checked)} />
                {c.nome}
                {c.grande ? <span className="muted-cel"> grande</span> : null}
              </label>
            );
          })}
        </div>
        <div className="ads-rotulo" style={{ marginTop: 12 }}>Datas próprias (repetem todo ano)</div>
        <div className="quando-datas">
          {cal.proprias.map((p) => (
            <span key={p.id} className="chip-quando on">
              {p.nome} <span className="muted-cel">{String(p.dia).padStart(2, "0")}/{MESES[(Number(p.mes) || 1) - 1]}</span>
              <button type="button" className="btn-icone" title="Tirar esta data" onClick={() => setEdit({ ...cal, proprias: cal.proprias.filter((x) => x.id !== p.id) })}>
                ×
              </button>
            </span>
          ))}
          {!cal.proprias.length && <span className="muted-cel">nenhuma</span>}
        </div>
        <div className="calendario-nova">
          <input type="text" placeholder="nome, ex: Volta às aulas" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} />
          <input type="number" min="1" max="31" placeholder="dia" style={{ width: 64 }} value={nova.dia} onChange={(e) => setNova({ ...nova, dia: e.target.value })} />
          <select value={nova.mes} onChange={(e) => setNova({ ...nova, mes: e.target.value })}>
            <option value="">mês</option>
            {MESES.map((m, k) => (
              <option key={m} value={k + 1}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-mini" onClick={addPropria}>
            + data própria
          </button>
        </div>
        {edit && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar calendário"}
            </button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
