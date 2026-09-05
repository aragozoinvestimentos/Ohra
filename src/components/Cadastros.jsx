import { useState } from "react";
import Materiais from "./Materiais.jsx";
import Produtos from "./Produtos.jsx";
import Canais from "./Canais.jsx";

const SUBABAS = [
  { key: "materiais", label: "Materiais" },
  { key: "produtos", label: "Produtos" },
  { key: "canais", label: "Canais" },
];

export default function Cadastros({ produtoRecebido, onToast }) {
  const [sub, setSub] = useState("materiais");

  return (
    <div>
      <div className="save-row" style={{ marginBottom: 18, gap: 6 }}>
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
      {sub === "produtos" && <Produtos produtoRecebido={produtoRecebido} onToast={onToast} />}
      {sub === "canais" && <Canais onToast={onToast} />}
    </div>
  );
}
