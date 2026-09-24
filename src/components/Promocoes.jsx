import { useState } from "react";
import PromocaoSimulador from "./PromocaoSimulador.jsx";
import PromocoesSalvas from "./PromocoesSalvas.jsx";

const SUBABAS = [
  { key: "simular", label: "Simular promoção" },
  { key: "salvas", label: "Promoções salvas" },
];

export default function Promocoes({ onToast }) {
  const [sub, setSub] = useState("simular");

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

      {sub === "simular" && <PromocaoSimulador onToast={onToast} />}
      {sub === "salvas" && <PromocoesSalvas onToast={onToast} />}
    </div>
  );
}
