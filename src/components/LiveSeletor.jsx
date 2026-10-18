import { useMemo, useState } from "react";
import { normalizarTexto } from "../lib/texto.js";
import { BRL } from "../lib/format.js";

// Escolher produtos da live (18/10/2026, pedido do Gustavo): só o que está
// cadastrado NA PLATAFORMA da live (preço salvo no canal; variação anunciada
// no canal — `cobraNoCanal`), nome completo, busca larga e "+ todos" ao lado
// do produto principal (adiciona ele e as variações dele de uma vez).
export default function LiveSeletor({ itens, canal, precos, cobraNoCanal, naLive, onAdd }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const salvoNo = (item) => {
    if (!canal) return null;
    const tipo = item.id.startsWith("k:") ? "kit" : item.id.startsWith("v:") ? "variacao" : "produto";
    const s = (precos || []).find((x) => x.item_tipo === tipo && x.item_id === item.id.slice(2) && x.canal_id === canal.id);
    return s && Number(s.preco) > 0 ? Number(s.preco) : null;
  };
  const grupos = useMemo(() => {
    if (!canal) return [];
    const noCanal = (i) => salvoNo(i) != null || (i.id.startsWith("v:") && !!cobraNoCanal?.(i, canal));
    const prods = itens.filter((i) => i.id.startsWith("p:"));
    const out = [];
    for (const p of prods) {
      const vars = itens.filter((v) => v.id.startsWith("v:") && v.produtoId === p.id.slice(2) && noCanal(v)).sort((a, b) => (a.quantidade || 0) - (b.quantidade || 0));
      const pai = noCanal(p);
      if (!pai && !vars.length) continue;
      out.push({ id: p.id, nome: p.nome, sku: p.sku, filhos: [...(pai ? [{ item: p, rotulo: "1 unidade" }] : []), ...vars.map((v) => ({ item: v, rotulo: v.nomeVariacao || v.nome }))] });
    }
    const kits = itens.filter((k) => k.id.startsWith("k:") && noCanal(k));
    if (kits.length) out.push({ id: "kits", nome: "Kits", kits: true, filhos: kits.map((k) => ({ item: k, rotulo: k.nome })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, canal, precos, cobraNoCanal]);
  const termos = normalizarTexto(busca).split(" ").filter(Boolean);
  const bate = (txt) => termos.every((t) => normalizarTexto(txt).includes(t));
  const vis = grupos
    .map((g) => {
      if (!termos.length) return g;
      if (!g.kits && bate(`${g.nome} ${g.sku || ""}`)) return g;
      const filhos = g.filhos.filter((f) => bate(`${g.kits ? "" : g.nome} ${f.rotulo} ${f.item.nome} ${f.item.sku || ""}`));
      return filhos.length ? { ...g, filhos } : null;
    })
    .filter(Boolean);
  const total = grupos.reduce((t, g) => t + g.filhos.length, 0);
  if (!canal) return null;
  if (!aberto)
    return (
      <div className="toolbar">
        <button type="button" className="btn btn-sm primary" onClick={() => setAberto(true)}>
          + Adicionar produtos
        </button>
        <span className="faint">{total} itens cadastrados em {canal.nome}</span>
      </div>
    );
  return (
    <div className="live-escolher">
      <div className="live-escolher-topo">
        <input autoFocus className="live-escolher-busca" placeholder={`Digite o nome ou o SKU — só o que está cadastrado em ${canal.nome}`} value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button type="button" className="btn btn-sm" onClick={() => (setAberto(false), setBusca(""))}>
          Fechar
        </button>
      </div>
      <div className="live-escolher-lista">
        {!vis.length && <div className="faint" style={{ padding: 8 }}>Nada encontrado em {canal.nome}.</div>}
        {vis.map((g) => {
          const faltam = g.filhos.filter((f) => !naLive.has(f.item.id));
          return (
            <div key={g.id} className="live-escolher-grupo">
              <div className="live-escolher-pai">
                <b>{g.nome}</b>
                {!g.kits && g.sku && <span className="faint"> · {g.sku}</span>}
                {g.filhos.length > 1 && (
                  <button type="button" className="btn btn-mini primary" disabled={!faltam.length} onClick={() => onAdd(faltam.map((f) => f.item.id))}>
                    {faltam.length ? `+ todos (${faltam.length})` : "✓ todos na live"}
                  </button>
                )}
              </div>
              {g.filhos.map((f) => {
                const ja = naLive.has(f.item.id);
                const preco = salvoNo(f.item);
                return (
                  <div key={f.item.id} className="live-escolher-filho">
                    <span>
                      {f.rotulo}
                      {g.kits && f.item.sku && <span className="faint"> · {f.item.sku}</span>}
                      {!g.kits && f.item.id.startsWith("v:") && f.item.sku && <span className="faint"> · {f.item.sku}</span>}
                      {preco != null && <span className="faint"> · {BRL(preco)}</span>}
                    </span>
                    {ja ? (
                      <span className="faint">✓ na live</span>
                    ) : (
                      <button type="button" className="btn btn-mini" onClick={() => onAdd([f.item.id])}>
                        + adicionar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
