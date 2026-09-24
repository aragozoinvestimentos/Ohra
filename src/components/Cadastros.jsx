import { useEffect, useState } from "react";
import Materiais from "./Materiais.jsx";
import Embalagens from "./Embalagens.jsx";
import Produtos from "./Produtos.jsx";
import Kits from "./Kits.jsx";

const SUBABAS = [
  { key: "materiais", label: "Materiais (Fabricação)" },
  { key: "embalagens", label: "Embalagens" },
  { key: "produtos", label: "Produtos" },
  { key: "kits", label: "Kits" },
];

export default function Cadastros({ produtoRecebido, abrirItem, onToast, onProdutoCriado }) {
  const [sub, setSub] = useState("materiais");

  // Veio de "Salvar como Produto" (Simular Custo de Produção) — troca pra
  // sub-aba Produtos automaticamente, mesmo se Cadastros já estava aberto
  // numa outra sub-aba (sem isso, o efeito que carrega o produto em
  // Produtos.jsx só dispara se ele já estiver montado).
  useEffect(() => {
    (() => {
      if (produtoRecebido?.seq) setSub("produtos");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoRecebido?.seq]);

  // Veio de "Editar completo" em Preços por Canal — troca pra Produtos ou
  // Kits conforme o tipo do item.
  useEffect(() => {
    (() => {
      if (abrirItem?.seq) setSub(abrirItem.tipo === "kit" ? "kits" : "produtos");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirItem?.seq]);

  const abrirProdutoId = abrirItem?.id && abrirItem.tipo !== "kit" ? { id: abrirItem.id, seq: abrirItem.seq } : null;
  const abrirKitId = abrirItem?.id && abrirItem.tipo === "kit" ? { id: abrirItem.id, seq: abrirItem.seq } : null;

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

      {sub === "materiais" && <Materiais onToast={onToast} />}
      {sub === "embalagens" && <Embalagens onToast={onToast} />}
      {sub === "produtos" && (
        <Produtos produtoRecebido={produtoRecebido} abrirProdutoId={abrirProdutoId} onToast={onToast} onProdutoCriado={onProdutoCriado} />
      )}
      {sub === "kits" && <Kits abrirKitId={abrirKitId} onToast={onToast} />}
    </div>
  );
}
