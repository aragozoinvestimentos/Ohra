import { useEffect, useRef, useState } from "react";
import { BRL } from "../lib/format.js";

// Lista de itens escolhidos de um catálogo (consumíveis na fabricação,
// itens de embalagem no produto, itens de um kit...) com quantidade cada.
// Componente genérico de propósito — a mesma ideia de "escolha o item e
// quantas unidades ele gasta" se repete em vários lugares do app, e cada
// um só passa o catálogo (materiais, embalagens, produtos...) e onde
// guardar a lista.
export function totalItens(catalogo, itens) {
  return (itens || []).reduce((soma, it) => {
    const item = catalogo.find((c) => c.id === it.itemId);
    const qtd = Number(it.quantidade) || 0;
    return soma + (item ? Number(item.preco) * qtd : 0);
  }, 0);
}

// Escolher o item de cada linha é uma busca (por nome, e por SKU quando o
// catálogo tiver) em vez de uma lista suspensa — fica ruim de usar assim
// que o catálogo cresce, e agora que produto/kit têm SKU faz sentido achar
// por ele também. Só uma linha por vez fica em modo de busca (buscandoIdx),
// guardado aqui no componente pai — cada linha só exibe o que já está
// escolhido (via props), então remover/reordenar linhas nunca deixa estado
// de busca "grudado" na linha errada.
export default function SeletorItens({ catalogo, itens, onChange, rotuloVazio = "Nenhum item cadastrado ainda." }) {
  const lista = itens || [];
  const [buscandoIdx, setBuscandoIdx] = useState(null);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (buscandoIdx == null) return;
    function aoClicarFora(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setBuscandoIdx(null);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [buscandoIdx]);

  function atualizarLinha(idx, campo, valor) {
    const novo = lista.slice();
    novo[idx] = { ...novo[idx], [campo]: valor };
    onChange(novo);
  }
  function remover(idx) {
    onChange(lista.filter((_, i) => i !== idx));
    // Remover uma linha antes da que está em busca desloca os índices — sem
    // isso, buscandoIdx continuaria apontando pra posição antiga e a busca
    // "pularia" pra linha errada depois da remoção.
    if (buscandoIdx === idx) {
      setBuscandoIdx(null);
      setQuery("");
    } else if (buscandoIdx != null && buscandoIdx > idx) {
      setBuscandoIdx(buscandoIdx - 1);
    }
  }
  function adicionar() {
    if (catalogo.length === 0) return;
    setBuscandoIdx(lista.length);
    setQuery("");
    onChange([...lista, { itemId: "", quantidade: 1 }]);
  }
  function abrirBusca(idx) {
    setBuscandoIdx(idx);
    setQuery("");
  }
  function escolher(idx, item) {
    atualizarLinha(idx, "itemId", item.id);
    setBuscandoIdx(null);
    setQuery("");
  }

  if (catalogo.length === 0) {
    return <div className="hint" style={{ marginBottom: 0 }}>{rotuloVazio}</div>;
  }

  // Sem corte de quantidade — a lista rola dentro do dropdown (ver
  // .seletor-item-sugestoes no CSS). Um corte fixo aqui já escondeu item
  // cadastrado (ficava fora dos primeiros N em ordem alfabética) sem
  // nenhum aviso de "digite pra ver mais".
  const alvo = query.trim().toLowerCase();
  const sugestoes = alvo
    ? catalogo.filter((c) => c.nome.toLowerCase().includes(alvo) || (c.sku || "").toLowerCase().includes(alvo))
    : catalogo;

  return (
    <div ref={ref}>
      {lista.map((it, idx) => {
        const item = catalogo.find((c) => c.id === it.itemId);
        const qtd = Number(it.quantidade) || 0;
        const subtotal = item ? Number(item.preco) * qtd : 0;
        return (
          <div className="seletor-linha" key={idx}>
            <div className="seletor-item-busca">
              {buscandoIdx === idx ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar por nome ou SKU…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="seletor-item-sugestoes">
                    {sugestoes.length === 0 ? (
                      <div className="seletor-item-vazio">Nenhum item encontrado</div>
                    ) : (
                      sugestoes.map((c) => (
                        <button type="button" key={c.id} onClick={() => escolher(idx, c)}>
                          {c.nome}
                          {c.sku ? <span className="seletor-item-sku"> · SKU {c.sku}</span> : ""} — {BRL(c.preco)}/{c.unidade}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <button type="button" className="seletor-item-escolhido" onClick={() => abrirBusca(idx)}>
                  {item ? `${item.nome}${item.sku ? ` · SKU ${item.sku}` : ""}` : "— escolher item —"}
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              className="seletor-qtd"
              value={it.quantidade}
              onChange={(e) => atualizarLinha(idx, "quantidade", e.target.value)}
            />
            <span className="seletor-subtotal">{BRL(subtotal)}</span>
            <button type="button" className="del" title="Remover" onClick={() => remover(idx)}>×</button>
          </div>
        );
      })}
      <button type="button" className="btn" style={{ marginTop: lista.length ? 8 : 0 }} onClick={adicionar}>
        + Adicionar item
      </button>
    </div>
  );
}
