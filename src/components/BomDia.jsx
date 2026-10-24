import { BRL } from "../lib/format.js";

// Cartão "☀️ Bom dia" (lib/bomDia.js): ontem × o normal, Ads de ontem e contas
// de hoje — primeiro o que falta subir. Só informa.
const var_ = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
export default function BomDia({ d, onAtualizar, compacto = false }) {
  if (!d) return null;
  const dm = `${d.ontem.slice(8, 10)}/${d.ontem.slice(5, 7)}`;
  const vv = d.pedidos ? var_(d.pedidos.vendas, d.pedidos.mediaVendas) : null;
  return (
    <div className={`bom-dia${compacto ? " compacto" : ""}`}>
      <b>☀️ Bom dia — ontem ({dm})</b>
      {d.faltando.length > 0 && (
        <div className="bom-dia-falta">
          Falta subir: {d.faltando.map((f) => f.texto).join(" · ")}
          {onAtualizar && (
            <button type="button" className="btn btn-sm primary" onClick={onAtualizar}>
              Atualizar dados
            </button>
          )}
        </div>
      )}
      <ul>
        <li>
          <span>Vendas</span>
          {d.pedidos ? (
            <>
              {d.pedidos.n} pedido{d.pedidos.n === 1 ? "" : "s"} · {BRL(d.pedidos.vendas)} · lucro {BRL(d.pedidos.lucro)}
              <small> (normal: {BRL(d.pedidos.mediaVendas)}/dia{vv != null ? ` · ${vv >= 0 ? "+" : ""}${vv}%` : ""})</small>
            </>
          ) : (
            <i>aguardando arquivo</i>
          )}
        </li>
        {(d.ads || d.faltando.some((f) => f.chave === "ads")) && (
          <li>
            <span>Ads</span>
            {d.ads ? (
              <>
                {BRL(d.ads.gasto)} de {BRL(d.ads.orcamento)}/dia de orçamento
              </>
            ) : (
              <i>aguardando arquivo</i>
            )}
          </li>
        )}
        <li>
          <span>Hoje</span>
          {d.contas.hoje || d.contas.atrasadas ? `${d.contas.hoje} conta${d.contas.hoje === 1 ? "" : "s"} vencendo${d.contas.atrasadas ? ` · ${d.contas.atrasadas} atrasada${d.contas.atrasadas === 1 ? "" : "s"}` : ""} · ${BRL(d.contas.total)}` : "nenhuma conta vencendo ✓"}
        </li>
      </ul>
      <small className="bom-dia-nota">Um dia sozinho não decide nada — as decisões seguem as janelas de 3 e 7 dias.</small>
    </div>
  );
}
