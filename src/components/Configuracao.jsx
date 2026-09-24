import Lojas from "./Lojas.jsx";
import Canais from "./Canais.jsx";
import TaxasMarketplace from "./TaxasMarketplace.jsx";

// Lojas, Canais e Taxas Marketplace numa aba só — são configurações feitas
// uma vez (ou raramente), então ficam juntas num item do menu, em sub-abas.
const SUBABAS = [
  { key: "lojas", label: "Lojas" },
  { key: "canais", label: "Canais" },
  { key: "taxas", label: "Taxas Marketplace" },
];

export default function Configuracao({ sub, onSub, onToast }) {
  return (
    <div>
      <div className="subabas">
        {SUBABAS.map((s) => (
          <button key={s.key} className={`btn${sub === s.key ? " primary" : ""}`} onClick={() => onSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === "lojas" && <Lojas onToast={onToast} />}
      {sub === "canais" && <Canais onToast={onToast} />}
      {sub === "taxas" && <TaxasMarketplace />}
    </div>
  );
}
