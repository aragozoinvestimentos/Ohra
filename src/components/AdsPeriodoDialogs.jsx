import { useState } from "react";
import { BRL } from "../lib/format.js";
import { metaSugerida } from "../lib/ads.js";
import EditarDialog from "./EditarDialog.jsx";

// Diálogos dos períodos de Ads — os MESMOS na aba Crescimento → Ads e no
// teste de lançamento da Rampa (gravação em lib/adsAcoes.js).
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const um = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const somarDiasIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const NAO_RECOMENDA = new Set(["nao-viavel", "arrumar", "aguardar", "sem-necessidade"]);

// `teste` (opcional, só produto em rampa com o teste ainda não feito):
// { padrao: bool, dias, orcamentoDia, meta (vendas) } — "contar como teste de
// lançamento" = orçamento fechado com data de fim, regras do teste na Rampa.
export function PeriodoAdsDialog({ nome, av, hoje, regrasA, teste = null, salvando, onCancelar, onSalvar }) {
  const comoTeste0 = !!teste?.padrao;
  const [f, setF] = useState(() => ({
    inicio: hoje,
    orcamento: virg(comoTeste0 ? teste.orcamentoDia : regrasA.minDiario),
    meta: av?.empate ? virg(metaSugerida(av.empate)) : "",
    fim: comoTeste0 ? somarDiasIso(hoje, teste.dias - 1) : "",
    nota: "",
    comoTeste: comoTeste0,
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const alternarTeste = (v) =>
    setF((p) => ({
      ...p,
      comoTeste: v,
      fim: v ? somarDiasIso(p.inicio || hoje, teste.dias - 1) : "",
      orcamento: v ? virg(teste.orcamentoDia) : p.orcamento,
    }));
  const metaBaixa = av?.empate && f.meta !== "" && num(f.meta) < av.empate;
  const dias = f.fim && f.inicio ? Math.round((new Date(`${f.fim}T12:00:00`) - new Date(`${f.inicio}T12:00:00`)) / 86400000) + 1 : null;
  return (
    <EditarDialog
      titulo={`${f.comoTeste ? "Teste de lançamento" : "Novo período de Ads"} — ${nome}`}
      salvando={salvando}
      onCancelar={onCancelar}
      onSalvar={() => (f.inicio && (!f.comoTeste || f.fim) ? onSalvar(f) : null)}
      salvarLabel={f.comoTeste ? "Iniciar teste" : "Iniciar período"}
      classe="modal-box-md"
    >
      {av && NAO_RECOMENDA.has(av.chave) && !f.comoTeste && (
        <div className="alerta alerta-warn">
          <b>O app não recomenda agora: {av.titulo}</b>
          {av.texto} Dá pra iniciar mesmo assim, a decisão é sua.
        </div>
      )}
      {teste && (
        <label className="check-inline" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={f.comoTeste} onChange={(e) => alternarTeste(e.target.checked)} /> Contar como <b>teste de lançamento</b> da Rampa
          <span className="muted-cel"> (orçamento fechado até a data de fim; meta de {teste.meta} vendas)</span>
        </label>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        {f.comoTeste
          ? "Compra as primeiras vendas e avaliações: é investimento, não lucro. A régua do ROAS não vale durante o teste; o resultado sai na Rampa e no histórico da aba Ads."
          : "Registre o que você configurou na plataforma. Os 7 primeiros dias são de aprendizado: o app não sugere mexer."}
        {av?.empate ? ` Empate deste produto: ROAS ${um(av.empate)}.` : ""}
      </p>
      <div className="grid-auto">
        <div className="field"><label>Início</label><input type="date" value={f.inicio} onChange={set("inicio")} /></div>
        <div className="field"><label>Orçamento diário (R$)</label><input type="text" inputMode="decimal" value={f.orcamento} onChange={set("orcamento")} /></div>
        <div className="field"><label>Meta de ROAS {f.comoTeste ? "(opcional)" : ""}</label><input type="text" inputMode="decimal" value={f.meta} onChange={set("meta")} placeholder={av?.empate ? virg(metaSugerida(av.empate)) : ""} /></div>
        <div className="field"><label>Fim {f.comoTeste ? "" : "(opcional)"}</label><input type="date" value={f.fim} onChange={set("fim")} /></div>
      </div>
      {f.comoTeste && dias && num(f.orcamento) > 0 && <p className="hint" style={{ margin: "0 0 6px" }}>Total do teste: {BRL(num(f.orcamento) * dias)} em {dias} dias.</p>}
      {metaBaixa && <div className="alerta alerta-warn"><b>Meta abaixo do empate ({um(av.empate)})</b>Com essa meta, a Shopee pode vender com prejuízo pra você.</div>}
      {num(f.orcamento) > 0 && num(f.orcamento) < regrasA.minDiario && <div className="alerta alerta-warn"><b>Abaixo do mínimo da Shopee</b>A Shopee exige no mínimo {BRL(regrasA.minDiario)}/dia.</div>}
      <div className="field"><label>Observação (opcional)</label><input type="text" value={f.nota} onChange={set("nota")} placeholder="ex.: GMV Max, meta de ROAS" /></div>
    </EditarDialog>
  );
}

export function EncerrarAdsDialog({ nome, teste = false, hoje, salvando, onCancelar, onSalvar }) {
  const [f, setF] = useState({ fim: hoje, motivo: "" });
  return (
    <EditarDialog titulo={`${teste ? "Encerrar teste de lançamento" : "Encerrar Ads"} — ${nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => (f.fim ? onSalvar(f) : null)} salvarLabel="Encerrar" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>Marque o dia em que pausou na plataforma. O período fica no histórico com o resultado{teste ? " e o teste é concluído na Rampa" : ""}.</p>
      <div className="grid-auto">
        <div className="field"><label>Pausei em</label><input type="date" value={f.fim} onChange={(e) => setF((p) => ({ ...p, fim: e.target.value }))} /></div>
        <div className="field"><label>Motivo (opcional)</label><input type="text" value={f.motivo} onChange={(e) => setF((p) => ({ ...p, motivo: e.target.value }))} placeholder="ex.: ROAS abaixo do empate" /></div>
      </div>
    </EditarDialog>
  );
}
