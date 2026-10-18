import { useMemo } from "react";
import Ajuda from "./Ajuda.jsx";
import { BRL } from "../lib/format.js";
import { analiseCupom } from "../lib/live.js";

// Cupom da live (18/10/2026): o preço dos produtos é o da loja (nada muda no
// anúncio); o cupom tira um valor fixo dos pedidos acima de uma compra mínima.
// Analisa os produtos da live e sugere o cupom que ainda deixa o PIOR pedido
// acima do seu mínimo. Guardado em live.pedidos._cupom (lib/live.js).
const ETIQ = {
  puxa: { cls: "st st-oportunidade", txt: "↑ puxa o pedido", dica: "Combo/kit com mais lucro que os avulsos — mostre ele com o cupom." },
  pode: { cls: "st st-info", txt: "pode entrar no cupom", dica: "Tem lucro acima do seu mínimo." },
  sem: { cls: "st st-atencao", txt: "⚠ sem folga", dica: "Lucro já no mínimo (em rampa ou preço baixo): entra sem desconto — use kit ou brinde." },
};
const nVal = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) && x > 0 ? x : null;
};

export default function CupomLivePlano({ produtos, ctx, cupom, onCupom, bloqueado }) {
  const fora = Array.isArray(cupom?.fora) ? cupom.fora : null;
  const an = useMemo(() => analiseCupom(produtos, ctx, fora), [produtos, ctx, fora]);
  const foraAtual = an.itens.filter((x) => !x.noCupom).map((x) => x.prod.key);
  const alternar = (key) => {
    const set0 = new Set(foraAtual);
    if (set0.has(key)) set0.delete(key);
    else set0.add(key);
    onCupom({ ...(cupom || {}), fora: [...set0] });
  };
  const ativo = !!cupom && cupom.ativo !== false;
  const valor = nVal(cupom?.valor);
  const minimo = nVal(cupom?.minimo);
  const res = ativo && valor && minimo ? an.avaliar(valor, minimo) : null;
  const sug = an.sugestao;
  const set = (patch) => onCupom({ ...(cupom || {}), ativo: true, ...patch });
  if (!produtos.length) return null;
  return (
    <div className="panel live-cupom">
      <h3>
        Cupom da live
        <Ajuda texto="Os produtos ficam com o preço da loja (o anúncio não muda). O cupom da plataforma tira um valor fixo de quem compra acima de uma compra mínima — faz a pessoa levar mais. O app analisa os produtos e sugere um cupom que ainda deixa o PIOR pedido acima do seu lucro mínimo. Conta conservadora: o cupom sai inteiro do lucro." />
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Preço na live</th>
              <th className="num">Lucro</th>
              <th className="num">Seu mínimo</th>
              <th className="num">Folga pra desconto</th>
              <th />
              <th title="Produtos que entram no cupom (cupom de produto). Os sem folga ficam fora por padrão.">No cupom</th>
            </tr>
          </thead>
          <tbody>
            {an.itens.map((x) => (
              <tr key={x.prod.key}>
                <td>{x.prod.nome}</td>
                <td className="num">{BRL(x.preco)}</td>
                <td className="num">{BRL(x.lucro)}</td>
                <td className="num muted-num">{BRL(x.minimo)}</td>
                <td className="num"><b>{x.folga > 0 ? BRL(x.folga) : "—"}</b></td>
                <td title={ETIQ[x.etiqueta].dica}>
                  <span className={ETIQ[x.etiqueta].cls}>{ETIQ[x.etiqueta].txt}</span>
                </td>
                <td>
                  <input type="checkbox" checked={x.noCupom} disabled={bloqueado} onChange={() => alternar(x.prod.key)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {foraAtual.length > 0 && (
        <div className="hint" style={{ marginTop: 6 }}>
          {foraAtual.length === 1 ? "1 produto fica" : `${foraAtual.length} produtos ficam`} fora do cupom: na plataforma, crie o cupom só pros produtos marcados (cupom de produto). Se não der pra escolher os produtos, tire da live os sem folga — senão o pedido só com eles sai abaixo do mínimo.
        </div>
      )}
      {!sug && an.itens.length > 0 && (
        <div className="alerta alerta-warn" style={{ marginTop: 8 }}>
          <b>Nenhum produto no cupom</b>Marque ao menos um produto com folga.
        </div>
      )}
      {sug && (
        <div className={`alerta ${sug.valor > 0 ? "alerta-good" : "alerta-warn"}`} style={{ marginTop: 8 }}>
          {sug.valor > 0 ? (
            <>
              <b>Sugestão: R$ {sug.valor} off em compras acima de {BRL(sug.minimo)}</b>
              A compra mínima passa do avulso mais caro, então a pessoa leva 2 itens ou um kit. O valor cabe na folga até do pior pedido.{" "}
              {!bloqueado && (
                <button type="button" className="link-btn" onClick={() => set({ valor: sug.valor, minimo: sug.minimo })}>
                  usar esta sugestão
                </button>
              )}
            </>
          ) : (
            <>
              <b>Cupom não cabe nesses produtos</b>
              Algum pedido acima de {BRL(sug.minimo)} já fica no seu mínimo. Prefira kit, brinde barato ou "primeiros N" — ou tire da live os produtos sem folga.
            </>
          )}
        </div>
      )}

      <fieldset disabled={bloqueado} className="live-fieldset">
        <div className="grid-auto" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Desconto do cupom (R$)</label>
            <input type="text" inputMode="decimal" style={{ width: 100 }} placeholder="—" value={cupom?.valor ?? ""} onChange={(e) => set({ valor: e.target.value })} />
          </div>
          <div className="field">
            <label>Compra mínima (R$)</label>
            <input type="text" inputMode="decimal" style={{ width: 100 }} placeholder="—" value={cupom?.minimo ?? ""} onChange={(e) => set({ minimo: e.target.value })} />
          </div>
          <div className="field">
            <label>Quantos cupons (opcional)</label>
            <input type="number" min="0" style={{ width: 100 }} placeholder="sem limite" value={cupom?.usos ?? ""} onChange={(e) => set({ usos: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} />
          </div>
          {cupom && (
            <div className="field" style={{ alignSelf: "end" }}>
              <button type="button" className="link-btn" onClick={() => onCupom(null)}>
                tirar o cupom
              </button>
            </div>
          )}
        </div>
      </fieldset>

      {res?.pior && (
        <div className={`alerta ${res.prejuizo ? "alerta-bad" : res.abaixo ? "alerta-warn" : "alerta-neutro"}`}>
          <b>
            Pior pedido: {res.pior.itens.map((x) => x.prod.nome).join(" + ")} ({BRL(res.pior.total)}) → lucro {BRL(res.pior.lucroCom)}
            {res.prejuizo ? " — prejuízo" : res.abaixo ? ` — abaixo do seu mínimo (${BRL(res.pior.minimo)})` : " ✓"}
          </b>
          Pedido médio com o cupom: lucro {BRL(res.medio)}.
          {cupom?.usos ? ` Se usarem os ${cupom.usos} cupons: até ${BRL(cupom.usos * valor)} de desconto no total.` : ""}
        </div>
      )}
    </div>
  );
}

// Faixa do Ao vivo: marcar cada cupom usado (sai do lucro da live).
export function CupomAoVivo({ cupom, onUsados }) {
  if (!cupom) return null;
  const usados = Number(cupom.usados) || 0;
  return (
    <span className="live-cupom-faixa" title="Marque cada pedido que usou o cupom — o desconto sai do lucro da live">
      🎟 R$ {String(cupom.valor).replace(".", ",")} acima de R$ {String(cupom.minimo).replace(".", ",")} · usados <b>{usados}</b>
      {cupom.usos ? ` de ${cupom.usos}` : ""}{" "}
      <button type="button" className="btn btn-mini" onClick={() => onUsados(usados + 1)}>+1</button>
      <button type="button" className="btn btn-mini" disabled={!usados} onClick={() => onUsados(usados - 1)}>−1</button>
    </span>
  );
}
