import { useEffect, useState } from "react";
import Materiais from "./Materiais.jsx";
import Embalagens from "./Embalagens.jsx";
import Produtos from "./Produtos.jsx";
import Kits from "./Kits.jsx";
import Canais from "./Canais.jsx";
import TaxasMarketplace from "./TaxasMarketplace.jsx";

const SUBABAS = [
  { key: "materiais", label: "Materiais (Fabricação)" },
  { key: "embalagens", label: "Embalagens" },
  { key: "produtos", label: "Produtos" },
  { key: "kits", label: "Kits" },
  { key: "canais", label: "Canais" },
  { key: "taxas", label: "Taxas Marketplace" },
];

export default function Cadastros({ produtoRecebido, abrirItem, onToast }) {
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
      <div className="save-row" style={{ marginBottom: 18, gap: 6, flexWrap: "wrap" }}>
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
      {sub === "produtos" && <Produtos produtoRecebido={produtoRecebido} abrirProdutoId={abrirProdutoId} onToast={onToast} />}
      {sub === "kits" && <Kits abrirKitId={abrirKitId} onToast={onToast} />}
      {sub === "canais" && <Canais onToast={onToast} />}
      {sub === "taxas" && <TaxasMarketplace />}
    </div>
  );
}
