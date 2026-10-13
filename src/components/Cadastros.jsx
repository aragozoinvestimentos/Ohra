import { useEffect, useState } from "react";
import Materiais from "./Materiais.jsx";
import Embalagens from "./Embalagens.jsx";
import Produtos from "./Produtos.jsx";
import Kits from "./Kits.jsx";
import CatalogoLista from "./CatalogoLista.jsx";

const SUBABAS = [
  { key: "catalogo", label: "Catálogo" },
  { key: "materiais", label: "Materiais (Fabricação)" },
  { key: "embalagens", label: "Embalagens" },
  { key: "produtos", label: "Produtos" },
  { key: "kits", label: "Kits" },
];

export default function Cadastros({ produtoRecebido, abrirItem, onToast, onProdutoCriado }) {
  const [sub, setSub] = useState("catalogo");
  // "✎ editar cadastro" vindo do Catálogo (mesmo caminho do "Editar completo").
  const [abrirLocal, setAbrirLocal] = useState(null);

  // Veio de "Salvar como Produto" (Custo de Produção) — troca pra
  // sub-aba Produtos automaticamente, mesmo se Cadastros já estava aberto
  // numa outra sub-aba (sem isso, o efeito que carrega o produto em
  // Produtos.jsx só dispara se ele já estiver montado).
  useEffect(() => {
    (() => {
      if (produtoRecebido?.seq) setSub("produtos");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoRecebido?.seq]);

  // Veio de "Editar completo" em Produtos precificados — troca pra Produtos ou
  // Kits conforme o tipo do item.
  useEffect(() => {
    (() => {
      if (abrirItem?.seq) {
        setAbrirLocal(null);
        setSub(abrirItem.tipo === "kit" ? "kits" : "produtos");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirItem?.seq]);

  const abrir = abrirLocal || abrirItem;
  const abrirProdutoId = abrir?.id && abrir.tipo !== "kit" ? { id: abrir.id, seq: abrir.seq } : null;
  const abrirKitId = abrir?.id && abrir.tipo === "kit" ? { id: abrir.id, seq: abrir.seq } : null;
  const editarDoCatalogo = (alvo) => {
    setAbrirLocal({ ...alvo, seq: `c${Date.now()}` });
    setSub(alvo.tipo === "kit" ? "kits" : "produtos");
  };

  return (
    <div>
      <div className="subabas">
        {SUBABAS.map((s) => (
          <button
            key={s.key}
            className={`btn${sub === s.key ? " primary" : ""}`}
            onClick={() => setSub(s.key)}
            style={{ flex: "none" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === "catalogo" && <CatalogoLista onEditar={editarDoCatalogo} onToast={onToast} />}
      {sub === "materiais" && <Materiais onToast={onToast} />}
      {sub === "embalagens" && <Embalagens onToast={onToast} />}
      {sub === "produtos" && (
        <Produtos produtoRecebido={produtoRecebido} abrirProdutoId={abrirProdutoId} onToast={onToast} onProdutoCriado={onProdutoCriado} />
      )}
      {sub === "kits" && <Kits abrirKitId={abrirKitId} onToast={onToast} />}
    </div>
  );
}
