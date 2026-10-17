import { useState } from "react";
import { BRL } from "../lib/format.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { DIAS_AVISO_RECARGA, precisaRecarregar } from "../lib/saldoAds.js";
import Ajuda from "./Ajuda.jsx";

// Fluxo de Caixa → 1 · Caixa: saldo de Ads na Shopee (recargas − gasto dos
// CSVs). O Gustavo digita o saldo que a Shopee mostra pra conferir — fica no
// banco (preferencias_loja), igual em todo aparelho.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const num = (v) => {
  const x = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isFinite(x) ? x : null;
};

export default function SaldoAdsCaixa({ s, hoje, onRecarga }) {
  const [conf, setConf] = usePreferencia("caixa:saldo-ads-shopee", null);
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState("");
  if (!s) return null;
  if (!s.temRecarga && !(s.gasto > 0)) return null;
  const recarregar = precisaRecarregar(s);
  const dif = conf && conf.valor != null && s.temRecarga ? Math.round((conf.valor - s.saldo) * 100) / 100 : null;
  return (
    <div className={`saldo-ads${recarregar ? " recarregar" : ""}`}>
      <div className="saldo-ads-cab">
        <b>Saldo de Ads na Shopee</b>
        <Ajuda texto="A Shopee pede o dinheiro antes (recarga). Lance cada depósito como saída na categoria “Anúncios / Ads (recarga)” — é quando o dinheiro sai da sua conta. O gasto que os CSVs do Shopee Ads mostram não vira saída de novo (já desconta do lucro em Vendas do mês). Saldo = recargas − gasto dos CSVs (inclui a GMV Max da Loja)." />
        <button type="button" className="btn btn-mini" onClick={onRecarga}>+ Recarga de Ads</button>
      </div>
      {!s.temRecarga ? (
        <div className="saldo-ads-linha">
          Os CSVs mostram {BRL(s.gasto)} gastos em Ads, mas nenhuma recarga lançada. Lance os depósitos que fez na Shopee (“+ Recarga de Ads”) pra o app acompanhar o saldo.
        </div>
      ) : (
        <>
          <div className="saldo-ads-linha">
            <span className="saldo-ads-valor">{BRL(s.saldo)}</span> = recargas {BRL(s.recargas)} − gasto {BRL(s.gasto)}
            {s.ate ? <span className="faint"> (CSV até {dm(s.ate)})</span> : null}
            {s.dias != null && s.gastoDia > 0 && (
              <span className={recarregar ? "saldo-ads-alerta" : "faint"}>
                {" "}· {recarregar ? "⚠ " : ""}dá pra ~{Math.max(0, Math.floor(s.dias))} dia{Math.floor(s.dias) === 1 ? "" : "s"} no ritmo de {BRL(s.gastoDia)}/dia
                {recarregar ? ` — recarregue (menos de ${DIAS_AVISO_RECARGA} dias)` : ""}
              </span>
            )}
          </div>
          <div className="saldo-ads-linha faint">
            {editando ? (
              <>
                Saldo que a Shopee mostra hoje:{" "}
                <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="75,17" style={{ width: 90 }} autoFocus />{" "}
                <button
                  type="button"
                  className="btn btn-mini primary"
                  onClick={() => {
                    const v = num(txt);
                    if (v != null) setConf({ valor: v, data: hoje });
                    setEditando(false);
                  }}
                >
                  Conferir
                </button>{" "}
                <button type="button" className="link-btn" onClick={() => setEditando(false)}>cancelar</button>
              </>
            ) : conf?.valor != null ? (
              <>
                Na Shopee em {dm(conf.data)}: {BRL(conf.valor)}
                {dif != null && Math.abs(dif) < 1 ? (
                  <span className="saldo-ads-ok"> ✓ bate</span>
                ) : (
                  <span className="saldo-ads-alerta">
                    {" "}
                    · diferença de {BRL(dif)} — {dif < 0 ? "a Shopee usou mais do que os CSVs mostram: exporte o CSV do Ads desde a 1ª recarga" : "falta lançar alguma recarga, ou a Shopee devolveu/bonificou saldo"}
                    {conf.data < hoje ? " (ou houve gasto depois da conferência)" : ""}
                  </span>
                )}{" "}
                <button type="button" className="link-btn" onClick={() => { setTxt(""); setEditando(true); }}>conferir de novo</button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={() => { setTxt(""); setEditando(true); }}>conferir com o saldo que a Shopee mostra</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
