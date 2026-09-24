import { useState } from "react";
import OrcamentoAvulso from "./OrcamentoAvulso.jsx";
import OrcamentoVolume from "./OrcamentoVolume.jsx";
import Orcamentos from "./Orcamentos.jsx";

const SUBABAS = [
  { key: "avulso", label: "Encomenda avulsa" },
  { key: "volume", label: "Encomenda em volume" },
  { key: "salvos", label: "Orçamentos salvos" },
];

export default function Orcamento({ onToast }) {
  const [sub, setSub] = useState("avulso");

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

      {sub === "avulso" && <OrcamentoAvulso onToast={onToast} />}
      {sub === "volume" && <OrcamentoVolume onToast={onToast} />}
      {sub === "salvos" && <Orcamentos onToast={onToast} />}
    </div>
  );
}
