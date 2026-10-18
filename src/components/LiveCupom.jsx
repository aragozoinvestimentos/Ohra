import { useMemo } from "react";
import Ajuda from "./Ajuda.jsx";
import { BRL } from "../lib/format.js";
import { analiseCupom, faixasDoCupom, textoFaixa, usadosDoCupom } from "../lib/live.js";

// Cupom da live (18/10/2026): o preço dos produtos é o da loja (nada muda no
// anúncio); o cupom dá desconto no TOTAL do pedido por faixa ("7% acima de
// R$ 40 · 10% acima de R$ 60", ou R$ fixo). O app analisa os produtos da live
// e SUGERE as faixas (compra mínima + desconto que ainda deixa o pior pedido
// acima do seu mínimo) e os combos que passam de cada faixa. Guardado em
// live.pedidos._cupom (lib/live.js).
const ETIQ = {
  puxa: { cls: "st st-oportunidade", txt: "↑ puxa o pedido", dica: "Combo/kit com mais lucro que os avulsos — mostre ele com o cupom." },
  pode: { cls: "st st-info", txt: "pode entrar no cupom", dica: "Tem lucro acima do seu mínimo." },
  sem: { cls: "st st-atencao", txt: "⚠ sem folga", dica: "Lucro já no mínimo (em rampa ou preço baixo): fica fora do cupom — use kit ou brinde." },
};
const MAX_FAIXAS = 3;

export default function CupomLivePlano({ produtos, ctx, cupom, onCupom, bloqueado, onToast }) {
  const copiar = (t, msg) => navigator.clipboard?.writeText(t).then(() => onToast?.(msg || `Copiado: ${t}`), () => onToast?.("Não deu pra copiar neste navegador"));
  const fora = Array.isArray(cupom?.fora) ? cupom.fora : null;
  const an = useMemo(() => analiseCupom(produtos, ctx, fora), [produtos, ctx, fora]);
  const foraAtual = an.itens.filter((x) => !x.noCupom).map((x) => x.prod.key);
  const tipo = cupom?.tipo === "valor" ? "valor" : "pct";
  const sug = useMemo(() => an.sugerir(tipo), [an, tipo]);
  // Faixas digitadas (texto, pra editar) — antigas {valor, minimo} viram 1 faixa.
  const faixasTxt = Array.isArray(cupom?.faixas) ? cupom.faixas : faixasDoCupom(cupom).map((f) => ({ ...f }));
  const faixas = faixasDoCupom({ faixas: faixasTxt.map((f) => ({ ...f, tipo })) });
  const res = faixas.length ? an.avaliar(faixas) : null;
  const combos = an.combos(faixas.length ? faixas : sug);
  const set = (patch) => onCupom({ ...(cupom || {}), ativo: true, tipo, faixas: faixasTxt, ...patch });
  const setFaixa = (i, patch) => set({ faixas: faixasTxt.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  const alternar = (key) => {
    const s0 = new Set(foraAtual);
    if (s0.has(key)) s0.delete(key);
    else s0.add(key);
    onCupom({ ...(cupom || {}), tipo, faixas: faixasTxt, fora: [...s0] });
  };
  const unid = tipo === "pct" ? "%" : "R$";
  if (!produtos.length) return null;
  return (
    <div className="panel live-cupom">
      <h3>
        Cupom da live
        <Ajuda texto="Os produtos ficam com o preço da loja (o anúncio não muda). O cupom da plataforma dá desconto no TOTAL do pedido, por faixa (ex.: 7% acima de R$ 40 e 10% acima de R$ 60) — faz a pessoa levar mais. O app analisa os produtos da live e sugere as faixas e os combos; o desconto sugerido ainda deixa o PIOR pedido de cada faixa acima do seu lucro mínimo. Conta conservadora: o desconto sai inteiro do lucro." />
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
          {foraAtual.length === 1 ? "1 produto fica" : `${foraAtual.length} produtos ficam`} fora do cupom: na plataforma, crie o cupom só pros produtos marcados (cupom de produto). Se não der pra escolher os produtos, tire da live os sem folga — senão o pedido com eles sai abaixo do mínimo.
        </div>
      )}

      <div className="toolbar" style={{ marginTop: 8 }}>
        <span className="faint">Desconto em:</span>
        {[
          ["pct", "% do pedido"],
          ["valor", "R$ fixo"],
        ].map(([k, t]) => (
          <button key={k} type="button" className={`filtro-btn${tipo === k ? " ativo" : ""}`} disabled={bloqueado} onClick={() => onCupom({ ...(cupom || {}), tipo: k, faixas: [] })}>
            {t}
          </button>
        ))}
      </div>

      <div className={`alerta ${sug.length ? "alerta-good" : "alerta-warn"}`} style={{ marginTop: 8 }}>
        {sug.length ? (
          <>
            <b>Sugestão pra estes produtos: {sug.map(textoFaixa).join(" · ")}</b>
            A {sug.length > 1 ? "1ª faixa" : "compra mínima"} passa do avulso mais caro (a pessoa leva 2 itens ou um kit){sug.length > 1 ? "; a 2ª pede um pedido ~1,5× maior com desconto maior" : "; uma 2ª faixa não cabe nesses produtos"}. O desconto usa no máximo 80% da folga do pior pedido de cada faixa — sobra margem.{" "}
            {!bloqueado && (
              <button type="button" className="link-btn" onClick={() => set({ faixas: sug.map((f) => ({ minimo: f.minimo, valor: f.valor })) })}>
                usar esta sugestão
              </button>
            )}
          </>
        ) : (
          <>
            <b>Hoje o cupom não vale a pena nesses produtos</b>
            Os pedidos que passariam da compra mínima já ficam no seu lucro mínimo. Use kit/combo ou brinde barato — ou deixe o cupom pra quando os preços estiverem no alvo.
          </>
        )}
      </div>

      <fieldset disabled={bloqueado} className="live-fieldset">
        <div className="live-faixas">
          {faixasTxt.map((f, i) => (
            <div key={i} className="live-faixa">
              <span className="faint">Faixa {i + 1}:</span>
              <input type="text" inputMode="decimal" style={{ width: 70 }} value={f.valor ?? ""} onChange={(e) => setFaixa(i, { valor: e.target.value })} /> {unid} acima de R${" "}
              <input type="text" inputMode="decimal" style={{ width: 80 }} value={f.minimo ?? ""} onChange={(e) => setFaixa(i, { minimo: e.target.value })} />
              {tipo === "pct" && (
                <>
                  {" "}· máx. R${" "}
                  <input type="text" inputMode="decimal" style={{ width: 70 }} placeholder="sem" value={f.teto ?? ""} onChange={(e) => setFaixa(i, { teto: e.target.value })} />
                </>
              )}
              <button type="button" className="btn-icone" title="Tirar a faixa" onClick={() => set({ faixas: faixasTxt.filter((_, k) => k !== i) })}>
                ×
              </button>
            </div>
          ))}
          <div className="live-faixa">
            {faixasTxt.length < MAX_FAIXAS && (
              <button type="button" className="btn btn-sm" onClick={() => set({ faixas: [...faixasTxt, { valor: "", minimo: "" }] })}>
                + Faixa
              </button>
            )}
            <span className="faint">Quantos cupons (opcional):</span>
            <input type="number" min="0" style={{ width: 90 }} placeholder="sem limite" value={cupom?.usos ?? ""} onChange={(e) => set({ usos: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} />
            {cupom && (
              <button type="button" className="link-btn" onClick={() => onCupom(null)}>
                tirar o cupom
              </button>
            )}
          </div>
        </div>
      </fieldset>

      {res && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Faixa</th>
                <th>Pior pedido da faixa</th>
                <th className="num">Desconto</th>
                <th className="num">Lucro do pior</th>
                <th className="num">Pedido médio</th>
              </tr>
            </thead>
            <tbody>
              {res.porFaixa.map((l, i) => (
                <tr key={i}>
                  <td>{textoFaixa(l.faixa)}</td>
                  <td>{l.pior ? `${l.pior.itens.map((x) => x.prod.nome).join(" + ")} (${BRL(l.pior.total)})` : <span className="faint">nenhum pedido de até 4 itens chega aqui</span>}</td>
                  <td className="num">{l.pior ? BRL(l.pior.desconto) : "—"}</td>
                  <td className="num">
                    {l.pior ? (
                      <span className={l.prejuizo ? "st st-resolver" : l.abaixo ? "st st-atencao" : ""}>
                        {BRL(l.pior.lucroCom)}
                        {l.prejuizo ? " · prejuízo" : l.abaixo ? ` · abaixo do mínimo (${BRL(l.pior.minimo)})` : " ✓"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{l.medio != null ? `lucro ${BRL(l.medio)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="sub-h">Cupom por produto (referência)</h4>
      <div className="hint" style={{ marginTop: 0 }}>
        O cupom de live SOMA com a promo da loja (não substitui): um cupom igual à promo dá desconto em dobro. Esta lista é o máximo que vale a pena dar em cada produto (até 80% da folga dele) — pra digitar rápido no cupom de produto da plataforma. Sem folga = fica fora.
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Preço na live</th>
              <th className="num">Cupom (R$)</th>
              <th className="num">ou (%)</th>
              <th className="num">Cliente paga</th>
              <th className="num">Lucro com o cupom</th>
            </tr>
          </thead>
          <tbody>
            {an.itens.map((x) => (
              <tr key={x.prod.key} className={x.cupomR > 0 ? "" : "linha-apagada"}>
                <td>
                  {x.prod.nome}
                  {x.prod.sku && <span className="faint"> · {x.prod.sku}</span>}
                </td>
                <td className="num">{BRL(x.preco)}</td>
                <td className="num">{x.cupomR > 0 ? <button type="button" className="link-btn" title="copiar" onClick={() => copiar(x.cupomR.toFixed(2).replace(".", ","))}>{BRL(x.cupomR)}</button> : "—"}</td>
                <td className="num">{x.cupomPct > 0 ? <button type="button" className="link-btn" title="copiar" onClick={() => copiar(String(x.cupomPct))}>{x.cupomPct}%</button> : "—"}</td>
                <td className="num">{x.cupomR > 0 ? BRL(x.preco - x.cupomR) : "—"}</td>
                <td className="num">{x.cupomR > 0 ? BRL(x.lucroComCupom) : <span className="faint">sem folga</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {an.itens.some((x) => x.cupomR > 0) && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => copiar(["Produto\tSKU\tCupom R$\tCupom %", ...an.itens.filter((x) => x.cupomR > 0).map((x) => `${x.prod.nome}\t${x.prod.sku || ""}\t${x.cupomR.toFixed(2).replace(".", ",")}\t${x.cupomPct}`)].join("\n"), "Lista copiada")}>
          Copiar a lista
        </button>
      )}

      {combos.length > 0 && (
        <>
          <h4 className="sub-h">Combos pra oferecer na live</h4>
          <div className="hint" style={{ marginTop: 0 }}>Avulsos diferentes que juntos alcançam uma faixa e ainda lucram acima do seu mínimo — dá pra montar como combo na live. Os que mais sobram por real vendido primeiro.</div>
          <ul className="live-combos">
            {combos.map((c, i) => (
              <li key={i}>
                <b>{c.itens.map((x) => x.prod.nome).join(" + ")}</b> · {BRL(c.total)} → {faixas.length || sug.length ? `desconto ${BRL(c.desconto)} · ` : ""}lucro <b>{BRL(c.lucroCom)}</b>
                {c.faltaProx != null && c.faltaProx > 0 && <span className="faint"> · faltam {BRL(c.faltaProx)} pra próxima faixa</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Faixa do Ao vivo: marcar cada cupom usado, por faixa (sai do lucro da live;
// em % o desconto é estimado pelo total médio dos pedidos da faixa).
export function CupomAoVivo({ cupom, onUsados }) {
  const faixas = faixasDoCupom(cupom);
  if (!faixas.length) return null;
  const usados = usadosDoCupom(cupom);
  const total = usados.reduce((t, x) => t + x, 0);
  const mudar = (i, d) => {
    const novo = faixas.map((_, k) => usados[k] || 0);
    novo[i] = Math.max(0, novo[i] + d);
    onUsados(novo);
  };
  return (
    <span className="live-cupom-faixa" title="Marque cada pedido que usou o cupom, na faixa que ele alcançou — o desconto sai do lucro da live">
      🎟 {cupom.usos ? `${total} de ${cupom.usos} · ` : ""}
      {faixas.map((f, i) => (
        <span key={i} className="live-cupom-item">
          {textoFaixa(f).replace(/ acima de /, " >")}: <b>{usados[i] || 0}</b>
          <button type="button" className="btn btn-mini" onClick={() => mudar(i, 1)}>+1</button>
          <button type="button" className="btn btn-mini" disabled={!usados[i]} onClick={() => mudar(i, -1)}>−1</button>
        </span>
      ))}
    </span>
  );
}
