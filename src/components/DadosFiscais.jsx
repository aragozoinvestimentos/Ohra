import { useState } from "react";
import Ajuda from "./Ajuda.jsx";
import { monofasicoPeloNcm } from "../lib/revenda.js";

// Dados fiscais do produto (28/10/2026, v69): NCM, CEST, unidade, origem, ST e monofásico.
// Vêm sozinhos da nota de compra; aqui dá pra conferir e corrigir. No MEI não mudam nada;
// no Simples, ST e monofásico tiram parte do DAS daquela venda (aba Dinheiro → Fiscal).
// RECOLHIDO por padrão; abre sozinho se falta o NCM num produto de revenda.
const ORIGENS = [
  ["0", "0 · nacional"],
  ["1", "1 · estrangeira (importação direta)"],
  ["2", "2 · estrangeira (comprada no Brasil)"],
  ["3", "3 · nacional com mais de 40% importado"],
  ["4", "4 · nacional (processo básico)"],
  ["5", "5 · nacional com até 40% importado"],
  ["6", "6 · estrangeira sem similar (direta)"],
  ["7", "7 · estrangeira sem similar (no Brasil)"],
  ["8", "8 · nacional com mais de 70% importado"],
];
const simNao = (v) => (v === true ? "sim" : v === false ? "nao" : "");
const deSimNao = (v) => (v === "sim" ? true : v === "nao" ? false : null);

export default function DadosFiscais({ form, setForm, revenda, abertoInicial }) {
  const [aberto, setAberto] = useState(abertoInicial ?? (!!revenda && !form.ncm));
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const sugMono = monofasicoPeloNcm(form.ncm);
  const resumo = [form.ncm ? `NCM ${form.ncm}` : "sem NCM", form.imposto_st === true && "com ST", form.monofasico === true && "monofásico"].filter(Boolean).join(" · ");
  return (
    <>
      <h3 className="section-title" style={{ cursor: "pointer" }} onClick={() => setAberto(!aberto)}>
        {aberto ? "▾" : "▸"} Dados fiscais <span className="h3-contagem">{resumo}</span>
        <Ajuda texto="Vêm da nota de compra. No MEI não mudam o imposto (o DAS é fixo). No Simples, produto com ICMS-ST e com PIS/COFINS monofásico paga menos DAS — o app separa isso em Dinheiro → Fiscal. Na dúvida, confira com o contador." />
      </h3>
      {aberto && (
        <div className="row4">
          <div className="field">
            <label>NCM</label>
            <input inputMode="numeric" placeholder="8 dígitos" value={form.ncm} onChange={set("ncm")} />
          </div>
          <div className="field">
            <label>CEST</label>
            <input inputMode="numeric" placeholder="só com ST" value={form.cest} onChange={set("cest")} />
          </div>
          <div className="field">
            <label>Unidade</label>
            <input placeholder="UN, CX, KG…" value={form.unidade_com} onChange={(e) => setForm((p) => ({ ...p, unidade_com: e.target.value.toUpperCase() }))} />
          </div>
          <div className="field">
            <label>Origem</label>
            <select value={form.origem_mercadoria} onChange={set("origem_mercadoria")}>
              <option value="">—</option>
              {ORIGENS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Comprado com ICMS-ST?</label>
            <select value={simNao(form.imposto_st)} onChange={(e) => setForm((p) => ({ ...p, imposto_st: deSimNao(e.target.value) }))}>
              <option value="">não informado</option>
              <option value="sim">sim (CFOP 5405 / CST 60 na compra)</option>
              <option value="nao">não</option>
            </select>
          </div>
          <div className="field">
            <label>PIS/COFINS monofásico?</label>
            <select value={simNao(form.monofasico)} onChange={(e) => setForm((p) => ({ ...p, monofasico: deSimNao(e.target.value) }))}>
              <option value="">não informado</option>
              <option value="sim">sim</option>
              <option value="nao">não</option>
            </select>
            {sugMono && form.monofasico == null && (
              <small className="hint" style={{ margin: 0 }}>
                pelo NCM parece que sim ({sugMono.nome}){" "}
                <button type="button" className="link-btn" onClick={() => setForm((p) => ({ ...p, monofasico: true }))}>
                  marcar
                </button>
              </small>
            )}
          </div>
        </div>
      )}
    </>
  );
}
