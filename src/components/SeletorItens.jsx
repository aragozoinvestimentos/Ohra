import { BRL } from "../lib/format.js";

// Lista de itens escolhidos de um catálogo (consumíveis na fabricação,
// itens de embalagem no produto, itens de um kit...) com quantidade cada.
// Componente genérico de propósito — a mesma ideia de "escolha o item e
// quantas unidades ele gasta" se repete em vários lugares do app, e cada
// um só passa o catálogo (materiais, embalagens...) e onde guardar a lista.
export function totalItens(catalogo, itens) {
  return (itens || []).reduce((soma, it) => {
    const item = catalogo.find((c) => c.id === it.itemId);
    const qtd = Number(it.quantidade) || 0;
    return soma + (item ? Number(item.preco) * qtd : 0);
  }, 0);
}

export default function SeletorItens({ catalogo, itens, onChange, rotuloVazio = "Nenhum item cadastrado ainda." }) {
  const lista = itens || [];

  function atualizarLinha(idx, campo, valor) {
    const novo = lista.slice();
    novo[idx] = { ...novo[idx], [campo]: valor };
    onChange(novo);
  }
  function remover(idx) {
    onChange(lista.filter((_, i) => i !== idx));
  }
  function adicionar() {
    if (catalogo.length === 0) return;
    onChange([...lista, { itemId: catalogo[0].id, quantidade: 1 }]);
  }

  if (catalogo.length === 0) {
    return <div className="hint" style={{ marginBottom: 0 }}>{rotuloVazio}</div>;
  }

  return (
    <div>
      {lista.map((it, idx) => {
        const item = catalogo.find((c) => c.id === it.itemId);
        const qtd = Number(it.quantidade) || 0;
        const subtotal = item ? Number(item.preco) * qtd : 0;
        return (
          <div className="seletor-linha" key={idx}>
            <select value={it.itemId} onChange={(e) => atualizarLinha(idx, "itemId", e.target.value)}>
              {catalogo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} — {BRL(c.preco)}/{c.unidade}
                </option>
              ))}
            </select>
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
