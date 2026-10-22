import { BRL } from "../lib/format.js";

// "Como o app mediu o orçamento" (22/10/2026): os envios do CSV usados pra
// dizer quanto a Shopee gastou do orçamento (usoDoOrcamento em ads.js).
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

export default function ComoMediuOrcamento({ uso }) {
  if (!uso) return null;
  const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <details className="como-mediu">
      <summary>como o app mediu o orçamento</summary>
      <div className="muted-cel">
        {uso.uso == null ? (
          <>Não deu pra medir pelos envios: {uso.motivo}. Vale a média simples desde o ajuste.</>
        ) : (
          <>
            Dias inteiros: {pct(uso.media)}{uso.diasMedia ? ` em ${uso.diasMedia} dias` : ""} · últimos dias{uso.ultimosDe ? ` (${dm(uso.ultimosDe)} → ${dm(uso.ultimosAte)})` : ""}: {pct(uso.ultimos)} · vale o maior: <b>{pct(uso.uso)}</b>
          </>
        )}
        {uso.rebase && <> · a soma do CSV mudou de base em {dm(uso.rebase)} — contado a partir dele</>}
      </div>
      {uso.pontos?.length > 0 && (
        <div className="muted-cel">
          Envios usados (gasto acumulado): {uso.pontos.map((p) => `${dm(p.ate)} ${BRL(p.gasto)}`).join(" · ")}
        </div>
      )}
    </details>
  );
}
