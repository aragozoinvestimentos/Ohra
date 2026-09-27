import { useEffect, useMemo, useRef, useState } from "react";
import { normalizarTexto } from "../lib/texto.js";

// Campo de escolher produto/variação/kit digitando — busca pelo NOME ou pelo
// SKU (o SKU do app é o mesmo das plataformas), no lugar da lista suspensa
// que ficava ruim de usar com o catálogo crescendo. Recebe os grupos no
// formato de gruposDoSeletor ({ label, itens: [{ id, rotulo }] }) — o nome do
// grupo (ex.: o produto pai) também entra na busca, então digitar "gato kit 3"
// acha a variação. `vazio` = rótulo da opção "nenhum" (ex.: "— usar custo
// manual —"); sem ele, não dá pra voltar pra vazio.
export default function BuscaItem({ grupos, value, onChange, vazio, placeholder = "Digite o nome ou o SKU…", id }) {
  const [aberto, setAberto] = useState(false);
  const [query, setQuery] = useState("");
  const [ativo, setAtivo] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);

  const opcoes = useMemo(
    () => grupos.flatMap((g) => g.itens.map((it) => ({ ...it, grupo: g.label, busca: normalizarTexto(`${g.label} ${it.rotulo}`) }))),
    [grupos]
  );
  const selecionado = opcoes.find((o) => o.id === value) || null;
  const rotuloSelecionado = selecionado ? (["Produtos", "Kits"].includes(selecionado.grupo) ? selecionado.rotulo : `${selecionado.grupo} — ${selecionado.rotulo}`) : vazio || "Escolha um item";

  const termos = normalizarTexto(query).split(" ").filter(Boolean);
  const filtradas = termos.length ? opcoes.filter((o) => termos.every((t) => o.busca.includes(t))) : opcoes;
  const lista = vazio && !termos.length ? [{ id: "", rotulo: vazio, grupo: "" }, ...filtradas] : filtradas;

  useEffect(() => {
    if (!aberto) return;
    function fora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function abrir() {
    setQuery("");
    setAtivo(0);
    setAberto(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function escolher(o) {
    onChange(o.id);
    setAberto(false);
  }

  return (
    <div className="busca-item" ref={ref}>
      {!aberto ? (
        <button type="button" id={id} className={`seletor-item-escolhido${selecionado ? "" : " vazio"}`} onClick={abrir} title="Clique e digite o nome ou o SKU">
          {rotuloSelecionado}
          <span className="busca-item-caret">▾</span>
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            className="busca-item-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((a) => Math.min(a + 1, lista.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (lista[ativo]) escolher(lista[ativo]);
              } else if (e.key === "Escape") setAberto(false);
            }}
          />
          <div className="seletor-item-sugestoes busca-item-lista" role="listbox">
            {lista.length ? (
              lista.map((o, i) => {
                const mostrarGrupo = o.grupo && (i === 0 || lista[i - 1].grupo !== o.grupo);
                return (
                  <div key={o.id || "vazio"}>
                    {mostrarGrupo && <div className="busca-item-grupo">{o.grupo}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={o.id === value}
                      className={`busca-item-opcao${i === ativo ? " ativo" : ""}${o.id === value ? " escolhido" : ""}`}
                      onMouseEnter={() => setAtivo(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => escolher(o)}
                    >
                      {o.rotulo}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="busca-item-nada">Nada encontrado com “{query}”</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
