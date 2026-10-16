import { BRL } from "../lib/format.js";

// Embaixo da Evolução da Rampa: as últimas semanas e DE ONDE veio cada número
// (16/10/2026 — semanas automáticas, lib/semanasAuto.js). Só leitura.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const somar = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function SemanasFonte({ e, grupo = false, n = 6 }) {
  const regs = e?.registros || [];
  const semanas = regs.filter((r) => r.tipo === "semana").slice(-n).reverse();
  const aval = [...regs].reverse().find((r) => r.tipo === "avaliacao") || null;
  const parcial = e?.parcial || null;
  if (!semanas.length && !parcial && !aval) return null;
  const precoTxt = (r) => (r.preco == null ? "" : grupo ? `degrau ${String(r.preco).replace(".", ",")}%` : BRL(Number(r.preco)));
  return (
    <div className="semanas-fonte">
      <div className="semanas-fonte-tit">Semanas · de onde vem cada número</div>
      {parcial && (
        <div className="semana-fonte em-aberto">
          <b>Em aberto desde {dm(parcial.de)}</b> · {parcial.vendas} venda{parcial.vendas === 1 ? "" : "s"} até hoje <span className="faint">(fecha quando os pedidos cobrirem 7 dias — já conta nas vendas desde o degrau)</span>
        </div>
      )}
      {semanas.map((r) => {
        const de = r.periodo_inicio || somar(String(r.data).slice(0, 10), -7);
        const ate = somar(String(r.data).slice(0, 10), -1);
        return (
          <div key={r.id || r.data} className="semana-fonte">
            <b>
              {dm(de)}–{dm(ate)}
            </b>{" "}
            · {Number(r.vendas) || 0} venda{Number(r.vendas) === 1 ? "" : "s"}
            {precoTxt(r) && <span className="faint"> · {precoTxt(r)}</span>}
            {r.ads_gasto != null && Number(r.ads_gasto) > 0 && <span className="faint"> · Ads {BRL(Number(r.ads_gasto))}</span>}
            <span className="chips-fonte">
              {r.auto ? (
                <>
                  <span className="chip-fonte">pedidos</span>
                  {r.fontes?.desempenho && <span className="chip-fonte">desempenho {r.fontes.desempenho}</span>}
                  {r.fontes?.ads && <span className={`chip-fonte${r.fontes.ads === "falta CSV" ? " falta" : ""}`}>{r.fontes.ads === "falta CSV" ? "Ads: falta o CSV" : r.fontes.ads}</span>}
                </>
              ) : (
                <span className="chip-fonte antiga">registrada à mão (antes)</span>
              )}
            </span>
          </div>
        );
      })}
      {aval && (
        <div className="semana-fonte">
          <b>Avaliações</b> · {aval.avaliacoes ?? "—"}
          {aval.nota != null ? ` · nota ${String(aval.nota).replace(".", ",")}` : ""}
          <span className="chips-fonte">
            <span className="chip-fonte">avaliações {dm(aval.data)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
