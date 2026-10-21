import Lojas from "./Lojas.jsx";
import Canais from "./Canais.jsx";
import TaxasMarketplace from "./TaxasMarketplace.jsx";
import Regras from "./Regras.jsx";

// Lojas, Canais e Taxas Marketplace numa aba só — são configurações feitas
// uma vez (ou raramente), então ficam juntas num item do menu, em sub-abas.
// As sub-abas (Lojas / Canais / Taxas) ficam no cabeçalho do App.

export default function Configuracao({ sub, onToast }) {
  return (
    <div>
      {sub === "lojas" && <Lojas onToast={onToast} />}
      {sub === "canais" && <Canais onToast={onToast} />}
      {sub === "taxas" && <TaxasMarketplace />}
      {sub === "regras" && <Regras onToast={onToast} />}
    </div>
  );
}
