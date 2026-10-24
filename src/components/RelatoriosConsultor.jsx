import { useState } from "react";
import { MODELOS_RELATORIO, nomeDoMes, periodoPadrao } from "../lib/relatorios.js";
import Estado from "./Estado.jsx";

// Relatórios exportáveis do consultor (lib/relatorios.js). Montados SÓ no
// clique; a data do que foi gerado fica em preferencias_loja
// `relatorios:gerados` = { fechamento: "AAAA-MM", ads: "AAAA-MM", semana: segunda }.
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rotuloPeriodo = (k, p) => (k === "semana" ? `semana de ${dm(p)} a ${dm(somarDias(p, 6))}` : k === "parados" ? "até hoje" : nomeDoMes(p));
function opcoesPeriodo(k, hoje) {
  const pad = periodoPadrao(k, hoje);
  if (k === "parados") return [pad];
  if (k === "semana") return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => somarDias(pad, -7 * i));
  const out = [hoje.slice(0, 7)];
  let m = pad;
  for (let i = 0; i < 6; i++) {
    out.push(m);
    const [a, mm] = m.split("-").map(Number);
    m = mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, "0")}`;
  }
  return out;
}

/** Cartão "pronto pra gerar" (aba Propostas do consultor). */
export function CartoesRelatorioDevido({ rel }) {
  if (!rel?.devidos.length) return null;
  return rel.devidos.map((d) => (
    <div key={d.k} className="consultor-cartao">
      <Estado tipo="atencao">arquivo pronto pra gerar</Estado>
      <b>📄 {d.nome} — {rotuloPeriodo(d.k, d.periodo)}</b>
      <div className="sede-aviso-txt">{d.desc}.</div>
      <span className="consultor-acoes">
        <button type="button" className="btn primary btn-sm" onClick={() => rel.gerar(d.k, d.periodo, "pdf")}>
          Gerar PDF
        </button>
        <button type="button" className="btn btn-sm" onClick={() => rel.gerar(d.k, d.periodo, "csv")}>
          CSV
        </button>
      </span>
    </div>
  ));
}

/** Aba "📄 Relatórios": todos os modelos, qualquer período, quando quiser. */
export default function RelatoriosConsultor({ rel }) {
  const [periodos, setPeriodos] = useState({});
  return (
    <div className="consultor-relatorios">
      <div className="sede-ok">Modelos fixos, sempre no mesmo formato. Montados só quando você clica. PDF: na janela que abrir, escolha “Salvar como PDF”.</div>
      {MODELOS_RELATORIO.map((m) => {
        const ops = opcoesPeriodo(m.k, rel.hoje);
        const p = periodos[m.k] || periodoPadrao(m.k, rel.hoje);
        return (
          <div key={m.k} className="consultor-cartao">
            <b>📄 {m.nome}</b>
            <div className="sede-aviso-txt">{m.desc}</div>
            <span className="sede-quem">
              oferecido {m.quando}
              {rel.gerados?.[m.k] ? ` · último gerado: ${rotuloPeriodo(m.k, rel.gerados[m.k])}` : ""}
            </span>
            <span className="consultor-acoes">
              {ops.length > 1 && (
                <select value={p} onChange={(e) => setPeriodos((x) => ({ ...x, [m.k]: e.target.value }))} aria-label={`Período do ${m.nome}`}>
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {rotuloPeriodo(m.k, o)}
                      {m.k !== "semana" && o === rel.hoje.slice(0, 7) ? " (até hoje)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn primary btn-sm" onClick={() => rel.gerar(m.k, p, "pdf")}>
                Gerar PDF
              </button>
              <button type="button" className="btn btn-sm" onClick={() => rel.gerar(m.k, p, "csv")}>
                CSV
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
