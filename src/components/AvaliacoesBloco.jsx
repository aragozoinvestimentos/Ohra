import { useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { MODO_SIMPLES_MIN, MODO_SIMPLES_NOTA, notaDasEstrelas, situacaoAvaliacoes, vendeuSemAvaliacao } from "../lib/semanasAuto.js";
import { excluirAvaliacao, salvarAvaliacao } from "../lib/avaliacoesAcoes.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Bloco "Avaliações" de cada plataforma (Atualizar dados, schema
// v58): avaliação não vem em nenhum arquivo, então é o único dado digitado.
// 1º a plataforma (o bloco já é dela), depois o anúncio — os chips são os que
// VENDERAM desde a última atualização; "+ outro" escolhe qualquer um.
// Digita o TOTAL de cada estrela que a plataforma mostra; o app tira a
// diferença. Modo simples (30+ avaliações e nota ≥ 4,7): só avisar quando
// aparecer avaliação de 3★ ou menos.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const virg = (v) => (v == null ? "—" : String(v).replace(".", ","));
const ESTRELAS = ["5★", "4★", "3★", "2★", "1★"];

export default function AvaliacoesBloco({ canal, cres, esc, hoje, onToast }) {
  const { lojaId } = useLoja();
  const avalH = cres.avalH;
  const [sel, setSel] = useState(null); // "tipo|id"
  const [outro, setOutro] = useState(false);
  const [estrelas, setEstrelas] = useState(["", "", "", "", ""]);
  const [totalSimples, setTotalSimples] = useState("");
  const [completo, setCompleto] = useState(false); // modo simples → "Apareceu: informar…"
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState(null);

  const nomeDe = (tipo, id) => {
    if (tipo === "grupo") return `Anúncio: ${(esc.gruposAnuncio || []).find((g) => g.id === id)?.nome || "—"}`;
    if (tipo === "kit") return (esc.kits || []).find((k) => k.id === id)?.nome || "Kit";
    return (esc.produtos || []).find((p) => p.id === id)?.nome || "Produto";
  };
  const vendeu = useMemo(
    () => vendeuSemAvaliacao({ pedidos: cres.pedidosValidos, canalId: canal.id, anuncioDoPedido: cres.anuncioDoPedido, avaliacoes: avalH.registros, hoje }),
    [cres.pedidosValidos, canal.id, cres.anuncioDoPedido, avalH.registros, hoje]
  );
  const opcoesOutro = useMemo(
    () => [
      ...(esc.produtos || []).map((p) => ({ k: `produto|${p.id}`, n: p.nome })),
      ...(esc.kits || []).map((k) => ({ k: `kit|${k.id}`, n: `${k.nome} (kit)` })),
      ...(esc.gruposAnuncio || []).map((g) => ({ k: `grupo|${g.id}`, n: `Anúncio: ${g.nome}` })),
    ].sort((a, b) => a.n.localeCompare(b.n)),
    [esc.produtos, esc.kits, esc.gruposAnuncio]
  );

  const [tipo, id] = sel ? sel.split("|") : [null, null];
  const linhasItem = useMemo(() => (sel ? (avalH.registros || []).filter((a) => a.item_tipo === tipo && a.item_id === id && a.canal_id === canal.id) : []), [sel, tipo, id, avalH.registros, canal.id]);
  const sit = useMemo(() => situacaoAvaliacoes(linhasItem), [linhasItem]);
  const modoSimples = sit.simples && !completo;
  // Campo em branco = o total da última atualização (ou 0 na primeira) — dá
  // pra lançar só a estrela que mudou (ex.: chegou 1 avaliação de 5★).
  const base = sit.estrelas || [0, 0, 0, 0, 0];
  const est = estrelas.map((x, i) => (x === "" ? base[i] : Math.max(0, Math.round(num(x)))));
  const digitou = estrelas.some((x) => x !== "");
  const cheio = digitou || !!sit.estrelas;
  const mais1 = (i) => setEstrelas((p) => p.map((x, j) => (j === i ? String((x === "" ? base[i] : Math.max(0, Math.round(num(x)))) + 1) : x)));
  const novas = cheio && sit.estrelas ? est.map((x, i) => x - sit.estrelas[i]) : null;
  const totalNovo = cheio ? est.reduce((t, x) => t + x, 0) : null;
  const notaNova = cheio ? notaDasEstrelas(est) : null;

  const escolher = (k) => {
    setSel(k);
    setEstrelas(["", "", "", "", ""]);
    setTotalSimples("");
    setCompleto(false);
  };

  async function salvar(dados, ok) {
    setSalvando(true);
    const r = await salvarAvaliacao({ lojaId, tipo, id, canalId: canal.id, data: hoje, ...dados });
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg);
    onToast?.(ok);
    escolher(null);
  }

  if (!avalH.disponivel)
    return (
      <div className="ana-relat">
        <div className="ana-relat-nome">Avaliações</div>
        <div className="ana-relat-onde">Falta rodar o <b>supabase/schema_v58.sql</b> no SQL Editor do Supabase (tabela das avaliações). Depois recarregue a página.</div>
      </div>
    );

  return (
    <div className="ana-relat ana-aval">
      <div className="ana-relat-nome">
        Avaliações{" "}
        <Ajuda texto={`Avaliação não vem em nenhum arquivo: copie o total de cada estrela que a ${canal.nome} mostra no anúncio — o app tira a diferença pra saber as novas e a nota. Com ${MODO_SIMPLES_MIN}+ avaliações e nota ≥ ${virg(MODO_SIMPLES_NOTA)}, só precisa avisar quando aparecer avaliação de 3★ ou menos. Os portões da Rampa leem daqui.`} />
      </div>
      <span />
      <div className={`ana-status ${vendeu.length ? "velho" : "ok"}`}>
        <span className="ic">{vendeu.length ? "!" : "✓"}</span>
        <span>{vendeu.length ? `${vendeu.length} anúncio${vendeu.length > 1 ? "s venderam" : " vendeu"} desde a última atualização — confira as avaliações` : "em dia"}</span>
      </div>
      <div className="ana-aval-chips">
        {vendeu.map((v) => (
          <button key={v.chave} type="button" className={`chip-aval${sel === v.chave ? " ativo" : ""}`} onClick={() => escolher(v.chave)}>
            {nomeDe(v.tipo, v.id)} <span className="faint">· {v.vendas} venda{v.vendas > 1 ? "s" : ""} desde {dm(v.desde)}</span>
          </button>
        ))}
        {!outro ? (
          <button type="button" className="chip-aval chip-outro" onClick={() => setOutro(true)}>
            + outro produto
          </button>
        ) : (
          <select value={sel && !vendeu.some((v) => v.chave === sel) ? sel : ""} onChange={(e) => escolher(e.target.value || null)} aria-label="Outro produto" style={{ width: "auto", maxWidth: 280 }}>
            <option value="">— escolha o anúncio —</option>
            {opcoesOutro.map((o) => (
              <option key={o.k} value={o.k}>{o.n}</option>
            ))}
          </select>
        )}
      </div>
      {!vendeu.length && !sel && <div className="ana-relat-onde">Nada vendeu na {canal.nome} desde a última atualização das avaliações — nada a fazer aqui hoje.</div>}

      {sel && (
        <div className="ana-aval-form">
          <div className="ana-aval-tit">
            <b>{nomeDe(tipo, id)}</b> · {canal.nome}
            {sit.ultima ? (
              <span className="faint">
                {" "}· última: {dm(sit.ultima.data)} — {sit.ultima.avaliacoes ?? "—"} avaliações{sit.ultima.nota != null ? ` · nota ${virg(sit.ultima.nota)}` : ""}{" "}
                <button type="button" className="link-btn" title="Apagar esta atualização" onClick={() => setExcluir(sit.ultimaLinha)}>
                  ×
                </button>
              </span>
            ) : (
              <span className="faint"> · primeira atualização</span>
            )}
          </div>

          {modoSimples ? (
            <>
              <div className="ana-aval-simples">
                <span className="badge good">modo simples</span> {sit.ultima.avaliacoes} avaliações · nota {virg(sit.ultima.nota)} — só avise se aparecer avaliação de <b>3★ ou menos</b>.
              </div>
              <div className="ana-aval-linha">
                <label className="faint">
                  Total de avaliações hoje (opcional){" "}
                  <input type="number" min="0" value={totalSimples} onChange={(e) => setTotalSimples(e.target.value)} placeholder={String(sit.ultima.avaliacoes ?? "")} style={{ width: 90 }} />
                </label>
                <button
                  type="button"
                  className="btn btn-mini primary"
                  disabled={salvando}
                  onClick={() => salvar({ total: totalSimples === "" ? sit.ultima.avaliacoes : Math.round(num(totalSimples)), nota: sit.ultima.nota, ruinsNovas: 0, tresNovas: 0 }, `${nomeDe(tipo, id)}: nada de 3★ ou menos ✓`)}
                >
                  Nada de 3★ ou menos ✓
                </button>
                <button type="button" className="btn btn-mini" onClick={() => setCompleto(true)}>
                  Apareceu: informar…
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ana-aval-estrelas">
                {ESTRELAS.map((r, i) => (
                  <label key={r}>
                    <span>{r}</span>
                    <input
                      type="number"
                      min="0"
                      value={estrelas[i]}
                      placeholder={sit.estrelas ? String(sit.estrelas[i]) : "0"}
                      onChange={(e) => setEstrelas((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <button type="button" className="btn btn-mini aval-mais1" title={`Chegou mais 1 de ${r}`} onClick={() => mais1(i)}>
                      +1
                    </button>
                  </label>
                ))}
              </div>
              <div className="ana-aval-linha">
                <span className="faint">
                  {!cheio
                    ? "Copie o total de cada estrela que aparece no anúncio (em branco = 0)."
                    : !digitou
                      ? "Sem avaliação nova? Salve assim. Chegou alguma: clique +1 na estrela (ou digite o total) — o que ficar em branco continua igual."
                      : novas
                      ? (() => {
                          const n = novas.reduce((t, x) => t + Math.max(0, x), 0);
                          const desc = novas.map((x, i) => (x > 0 ? `${x}× ${ESTRELAS[i]}` : null)).filter(Boolean).join(", ");
                          const caiu = novas.some((x) => x < 0);
                          return `${n} nova${n === 1 ? "" : "s"}${desc ? ` (${desc})` : ""} · ${totalNovo} no total · nota ${virg(notaNova)}${caiu ? " · ⚠ alguma estrela diminuiu (a plataforma tirou avaliação?)" : ""}`;
                        })()
                      : `${totalNovo} avaliações · nota ${virg(notaNova)}`}
                </span>
                <button type="button" className="btn btn-mini primary" disabled={!cheio || salvando} onClick={() => salvar({ estrelas: est, total: totalNovo, nota: notaNova }, `Avaliações de ${nomeDe(tipo, id)} atualizadas`)}>
                  {cheio && !digitou ? "Sem avaliação nova ✓" : "Salvar avaliações"}
                </button>
                <button type="button" className="btn btn-mini" onClick={() => escolher(null)}>
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Apagar esta atualização de avaliações?"
          mensagem={`A atualização de ${dm(excluir.data)} sai (os portões da Rampa voltam a usar a anterior).`}
          confirmarLabel="Apagar"
          perigo
          onCancel={() => setExcluir(null)}
          onConfirm={async () => {
            const r = await excluirAvaliacao(excluir.id);
            setExcluir(null);
            onToast?.(r.ok ? "Atualização apagada" : r.msg);
          }}
        />
      )}
    </div>
  );
}
