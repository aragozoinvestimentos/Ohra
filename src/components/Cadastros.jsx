import { useState } from "react";
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

export default function Cadastros({ produtoRecebido, onToast }) {
  const [sub, setSub] = useState("materiais");

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
      {sub === "produtos" && <Produtos produtoRecebido={produtoRecebido} onToast={onToast} />}
      {sub === "kits" && <Kits onToast={onToast} />}
      {sub === "canais" && <Canais onToast={onToast} />}
      {sub === "taxas" && <TaxasMarketplace />}
    </div>
  );
}
