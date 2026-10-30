import { BRL } from "../lib/format.js";
import { derivarDetalhe, gramasPorMetro, modoImpressao, nomeDaUnidade } from "../lib/calc.js";

// Dados do fatiador, do jeito que você imprime (30/10/2026, aprovado pela
// prévia "Dados do fatiador"): o que você vende como 1 unidade (peça ou
// kit/conjunto — só muda os nomes dos campos), como imprime (uma mesa / uma
// mesa com AMS / várias mesas) e a frase de conferência ao vivo. Usado no
// Simular custo e no Detalhamento do cadastro de produtos. A conta é a do
// calc.js (mesasDoDetalhe/calcPorMesas); aqui só monta os campos e, em AMS e
// várias mesas, grava junto o lote equivalente (derivarDetalhe) pras telas
// que leem tempo/filamento/peças como uma mesa.

const MODOS = [
  { v: "uma", t: "Uma mesa", s: "como sempre foi" },
  { v: "ams", t: "Uma mesa com AMS", s: "a impressora troca de cor sozinha" },
  { v: "varias", t: "Várias mesas", s: "(partes impressas separadas)" },
];

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const virg = (v, casas = 0) => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const horas = (min) => {
  const m = Math.round(num(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
};
const plural = (nome) => (/[sz]$/i.test(nome) ? nome : /ão$/i.test(nome) ? nome.replace(/ão$/i, "ões") : nome + "s");


function Num({ valor, onChange, step = "1", largura, id, anterior }) {
  const mudou = anterior != null && String(anterior) !== "" && Number(anterior) !== Number(valor);
  return (
    <>
      <input id={id} type="number" step={step} value={valor ?? ""} style={largura ? { width: largura } : undefined} onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))} />
      {mudou && <span className="campo-anterior"> (era {anterior})</span>}
    </>
  );
}

export default function ImpressaoFatiador({ d, pecas, onChange, onPecas, filamentos = [], resultado, pesoCadastro = null, anterior = null, pecasAnterior = null, topo = null, onComparar = null }) {
  const modo = modoImpressao(d);
  const un = nomeDaUnidade(d);
  const uns = plural(un);
  const kit = d?.unidade?.tipo === "kit";
  const nPecas = Math.max(1, num(pecas) || 1);
  const gm = gramasPorMetro(d?.diametro, d?.densidade) || 1;
  const filPadrao = d?.materialNome || filamentos[0]?.nome || "";

  // Toda mudança passa por aqui: em AMS/várias mesas, grava junto o lote equivalente.
  const mudar = (patch) => {
    const nd = { ...d, ...patch };
    if (modoImpressao(nd) === "uma") return onChange(nd);
    const r = derivarDetalhe(nd, nPecas);
    onChange(r.detalhe);
    if (r.pecas !== nPecas) onPecas?.(r.pecas);
  };

  const trocarModo = (m) => {
    if (m === modo) return;
    // Ponto de partida = o que a conta de agora dá pra mesa inteira (vale vindo de várias mesas).
    const tempoMesa = resultado?.tempoUn ? Math.round(resultado.tempoUn * nPecas) : num(d?.tempo);
    const gramasMesa = resultado ? Math.round(num(resultado.peso3d ?? resultado.peso) * nPecas) : Math.round(num(d?.comprimento) * gm);
    if (m === "ams" && !(d?.ams?.filamentos || []).length) {
      return mudar({ impressao: m, tempo: tempoMesa, ams: { filamentos: [{ materialNome: filPadrao, gramas: gramasMesa }], purga: d?.ams?.purga ?? "" } });
    }
    if (m === "uma" && modo === "ams") return mudar({ impressao: m, tempo: tempoMesa, comprimento: Math.round((gramasMesa / gm) * 100) / 100 });
    if (m === "varias" && !(d?.mesas || []).length) {
      return mudar({ impressao: m, mesas: [{ nome: "Mesa 1", materialNome: filPadrao, comprimento: num(d?.comprimento), tempo: num(d?.tempo), rende: nPecas, leva: 1 }] });
    }
    mudar({ impressao: m });
  };

  const opcoesFil = filamentos.map((m) => (
    <option key={m.id || m.nome} value={m.nome}>
      {m.nome} — R${Number(m.preco).toFixed(2)}/kg
    </option>
  ));

  // ---------- partes da tela ----------
  const mesas = d?.mesas || [];
  const setMesa = (i, campo, v) => mudar({ mesas: mesas.map((m, k) => (k === i ? { ...m, [campo]: v } : m)) });
  const ams = d?.ams || { filamentos: [], purga: "" };
  const setAmsFil = (i, campo, v) => mudar({ ams: { ...ams, filamentos: ams.filamentos.map((f, k) => (k === i ? { ...f, [campo]: v } : f)) } });

  // Conferência ao vivo
  const imp = resultado ? resultado.total - (resultado.consumiveis || 0) - (resultado.modelagem || 0) - (resultado.artesanal || 0) : 0;
  const peso3d = resultado ? num(resultado.peso3d ?? resultado.peso) : 0;
  let conferencia = null;
  let dica = null;
  if (resultado) {
    if (modo === "uma") {
      const gMesa = num(d?.comprimento) * gm;
      conferencia = (
        <div>
          Mesa com <b>{nPecas} {nPecas > 1 ? uns : un}</b> · {virg(gMesa)} g · {horas(d?.tempo)} → <b className="fat-total">cada {un}: {virg(peso3d, 1)} g · {horas(resultado.tempoUn)} · {BRL(imp)}</b>
        </div>
      );
      if (nPecas === 1 && num(d?.tempo) > 0) dica = `Se você costuma imprimir mais de ${kit ? "um " + un : "uma peça"} por vez, coloque quantos cabem na mesa (e o filamento e o tempo da mesa cheia): o custo por ${un} cai.`;
    } else if (modo === "ams") {
      const fils = ams.filamentos || [];
      const gPecas = fils.reduce((t, f) => t + num(f.gramas), 0);
      const purga = num(ams.purga);
      conferencia = (
        <>
          <div>
            Mesa com <b>{nPecas} {nPecas > 1 ? uns : un}</b> · {virg(gPecas)} g de peça{purga > 0 ? ` + ${virg(purga)} g de purga` : ""} · {horas(d?.tempo)} → <b className="fat-total">cada {un}: {virg(peso3d, 1)} g · {horas(resultado.tempoUn)} · {BRL(imp)}</b>
          </div>
          <div className="fat-partes">
            {fils.filter((f) => num(f.gramas) > 0).map((f) => `${f.materialNome || filPadrao} ${virg(num(f.gramas) / nPecas, 1)} g`).join(" · ")}
            {purga > 0 && ` · purga ${virg(purga / nPecas, 1)} g (${Math.round((purga / (gPecas + purga || 1)) * 100)}% do filamento)`}
          </div>
        </>
      );
      if (!(purga > 0)) dica = "Confira a purga/descarte no fatiador (Bambu Studio mostra em “Flushed”): costuma ser um custo grande no AMS.";
    } else {
      const ms = resultado.mesas || [];
      conferencia = (
        <>
          <div>
            {ms.map((m) => `${m.nome} ${BRL(m.porUnidade)}`).join(" + ")} → <b className="fat-total">cada {un}: {BRL(imp)} · {horas(resultado.tempoUn)} de máquina · {virg(peso3d, 1)} g</b>
          </div>
          <div className="fat-partes">{ms.length} {ms.length === 1 ? "mesa" : "mesas"} · cada uma com o preço do filamento dela · lote de {nPecas} {nPecas > 1 ? uns : un} nas outras telas</div>
        </>
      );
      const rendes = [...new Set(mesas.map((m) => Math.max(1, num(m.rende) || 1)))];
      if (rendes.length > 1) dica = `As mesas rendem quantidades diferentes (${rendes.join(", ")}). Tudo bem: o app divide cada mesa pelo que ela rende.`;
    }
  }
  const pesoTotal = resultado ? num(resultado.peso) : 0;
  const pc = num(pesoCadastro);
  const pesoDif = pc > 0 && pesoTotal > 0 && Math.abs(pesoTotal - pc) > 10 && Math.abs(pesoTotal - pc) / Math.max(pc, pesoTotal) > 0.25;

  return (
    <div className="fat">
      {topo}
      <div className="fat-bloco">
        <div className="fat-pergunta">O que você vende como 1 unidade?</div>
        <div className="fat-opcoes">
          {[
            { v: "peca", t: "Uma peça", s: "ex.: um cortador avulso" },
            { v: "kit", t: "Um kit / conjunto", s: "ex.: kit de 6 cortadores, Leão + letreiro + coroa" },
          ].map((o) => (
            <label key={o.v} className={`fat-op${(kit ? "kit" : "peca") === o.v ? " on" : ""}`}>
              <input type="radio" checked={(kit ? "kit" : "peca") === o.v} onChange={() => mudar({ unidade: { tipo: o.v, nome: d?.unidade?.nome || "" } })} />
              <span>
                <b>{o.t}</b>
                <em>{o.s}</em>
              </span>
            </label>
          ))}
        </div>
        {kit && (
          <div className="field" style={{ maxWidth: 260, marginTop: 6 }}>
            <label>Nome da unidade (aparece nos textos)</label>
            <input type="text" value={d?.unidade?.nome || ""} placeholder="kit, conjunto…" onChange={(e) => mudar({ unidade: { tipo: "kit", nome: e.target.value } })} />
          </div>
        )}
      </div>

      <div className="fat-bloco">
        <div className="fat-pergunta">Como esse produto é impresso?</div>
        <div className="fat-opcoes">
          {MODOS.map((o) => (
            <label key={o.v} className={`fat-op${modo === o.v ? " on" : ""}`}>
              <input type="radio" checked={modo === o.v} onChange={() => trocarModo(o.v)} />
              <span>
                <b>{o.t}</b>
                <em>{o.s}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      {modo === "uma" && (
        <>
          <div className="row2">
            <div className="field">
              <label>Quantos {uns} cabem na mesa{pecasAnterior != null && Number(pecasAnterior) !== nPecas && <span className="campo-anterior"> (era {pecasAnterior})</span>}</label>
              <input type="number" step="1" min="1" value={pecas ?? ""} onChange={(e) => onPecas(e.target.value === "" ? "" : parseFloat(e.target.value))} />
            </div>
            <div className="field">
              <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                Filamento
                {onComparar && (
                  <button type="button" className="link-btn" onClick={onComparar} title="Custo, preço sugerido e lucro em cada filamento cadastrado">
                    ⇄ comparar filamentos
                  </button>
                )}
              </label>
              <select value={d?.materialNome || ""} onChange={(e) => mudar({ materialNome: e.target.value })}>
                {opcoesFil}
              </select>
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Filamento da mesa inteira (m)</label>
              <Num valor={d?.comprimento} step="0.01" anterior={anterior?.comprimento} onChange={(v) => mudar({ comprimento: v })} />
            </div>
            <div className="field">
              <label>Tempo da mesa inteira (min)</label>
              <Num valor={d?.tempo} anterior={anterior?.tempo} onChange={(v) => mudar({ tempo: v })} />
            </div>
          </div>
          <div className="hint" style={{ marginTop: -4 }}>Copie do fatiador com a mesa cheia, do jeito que você imprime. O app divide pelos {uns} da mesa.</div>
        </>
      )}

      {modo === "ams" && (
        <>
          <div className="row2">
            <div className="field">
              <label>Quantos {uns} cabem na mesa</label>
              <input type="number" step="1" min="1" value={pecas ?? ""} onChange={(e) => onPecas(e.target.value === "" ? "" : parseFloat(e.target.value))} />
            </div>
            <div className="field">
              <label>Tempo da mesa inteira (min)</label>
              <Num valor={d?.tempo} anterior={anterior?.tempo} onChange={(v) => mudar({ tempo: v })} />
            </div>
          </div>
          <div className="table-wrap">
            <table className="fat-tabela">
              <thead>
                <tr>
                  <th>Filamento usado</th>
                  <th className="num">Gramas na mesa</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(ams.filamentos || []).map((f, i) => (
                  <tr key={i}>
                    <td>
                      <select value={f.materialNome || filPadrao} onChange={(e) => setAmsFil(i, "materialNome", e.target.value)}>
                        {opcoesFil}
                      </select>
                    </td>
                    <td className="num">
                      <Num valor={f.gramas} step="0.1" largura={90} onChange={(v) => setAmsFil(i, "gramas", v)} />
                    </td>
                    <td>
                      {(ams.filamentos || []).length > 1 && (
                        <button type="button" className="x-btn" aria-label="Tirar filamento" onClick={() => mudar({ ams: { ...ams, filamentos: ams.filamentos.filter((_, k) => k !== i) } })}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Purga / descarte <span className="muted-cel">(o fatiador mostra)</span></td>
                  <td className="num">
                    <Num valor={ams.purga} step="0.1" largura={90} onChange={(v) => mudar({ ams: { ...ams, purga: v } })} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => mudar({ ams: { ...ams, filamentos: [...(ams.filamentos || []), { materialNome: filPadrao, gramas: "" }] } })}>
            + filamento
          </button>
        </>
      )}

      {modo === "varias" && (
        <>
          <div className="fat-leva">
            <b>1 {un} leva:</b>
            {mesas.map((m, i) => (
              <label key={i}>
                {String(m.nome || "").trim() || `Mesa ${i + 1}`}
                <input type="number" min="0" step="1" value={m.leva ?? 1} onChange={(e) => setMesa(i, "leva", e.target.value === "" ? "" : parseFloat(e.target.value))} />
              </label>
            ))}
          </div>
          <div className="fat-mesas">
            {mesas.map((m, i) => (
              <div className="fat-mesa" key={i}>
                <div className="fat-mesa-l1">
                  <input type="text" aria-label="Nome da mesa" value={m.nome || ""} placeholder={`Mesa ${i + 1}`} onChange={(e) => setMesa(i, "nome", e.target.value)} />
                  <select aria-label="Filamento da mesa" value={m.materialNome || filPadrao} onChange={(e) => setMesa(i, "materialNome", e.target.value)}>
                    {opcoesFil}
                  </select>
                  <span className="fat-mesa-acoes">
                    <button type="button" className="link-btn" onClick={() => mudar({ mesas: [...mesas.slice(0, i + 1), { ...m, nome: `${String(m.nome || "").trim() || `Mesa ${i + 1}`} (2)` }, ...mesas.slice(i + 1)] })}>
                      duplicar
                    </button>
                    {mesas.length > 1 && (
                      <button type="button" className="x-btn" aria-label="Tirar mesa" onClick={() => mudar({ mesas: mesas.filter((_, k) => k !== i) })}>
                        ×
                      </button>
                    )}
                  </span>
                </div>
                <div className="fat-mesa-l2">
                  <label>Filamento usado (m)<Num valor={m.comprimento} step="0.01" onChange={(v) => setMesa(i, "comprimento", v)} /></label>
                  <label>Tempo (min)<Num valor={m.tempo} onChange={(v) => setMesa(i, "tempo", v)} /></label>
                  <label>Rende<Num valor={m.rende} onChange={(v) => setMesa(i, "rende", v)} /></label>
                  <span className="fat-mesa-por">
                    por {un}
                    <b>{resultado?.mesas?.[i] ? BRL(resultado.mesas[i].porUnidade) : "—"}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const ult = mesas[mesas.length - 1];
                mudar({ mesas: [...mesas, { nome: `Mesa ${mesas.length + 1}`, materialNome: ult?.materialNome || filPadrao, comprimento: "", tempo: "", rende: ult?.rende || nPecas, leva: 1 }] });
              }}
            >
              + mesa
            </button>
            <span className="hint" style={{ margin: 0 }}>“Rende” = quantas dessa parte saem da mesa. Copie filamento e tempo do fatiador, mesa por mesa.</span>
          </div>
        </>
      )}

      {modo !== "ams" && (
        <div className="row2">
          <div className="field">
            <label>Diâmetro (mm)</label>
            <Num valor={d?.diametro} step="0.01" anterior={anterior?.diametro} onChange={(v) => mudar({ diametro: v })} />
          </div>
          <div className="field">
            <label>Densidade (g/cm³)</label>
            <Num valor={d?.densidade} step="0.01" anterior={anterior?.densidade} onChange={(v) => mudar({ densidade: v })} />
          </div>
        </div>
      )}

      {conferencia && (
        <div className="fat-conf">
          {conferencia}
          {pc > 0 && pesoTotal > 0 && (
            <div className="fat-partes">
              Peso do cadastro: {virg(pc)} g · {pesoDif ? <b className="fat-dif">o fatiador dá {virg(pesoTotal)} g — confira</b> : "✓ bate com o fatiador"}
            </div>
          )}
        </div>
      )}
      {dica && <div className="alerta alerta-warn" style={{ margin: 0 }}>{dica}</div>}
      <div className="hint" style={{ margin: 0 }}>Consumíveis e modelagem contam por {un} (não dividem pela mesa): se cada peça leva um imã, num kit de 6 a quantidade é 6.</div>
    </div>
  );
}
