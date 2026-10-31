import { useEffect, useState } from "react";
import { pegarPedido } from "../lib/navegar.js";
import PromocaoSimulador from "./PromocaoSimulador.jsx";
import PromocoesSalvas from "./PromocoesSalvas.jsx";
import CupomLoja from "./CupomLoja.jsx";
import CampanhasTiktok from "./CampanhasTiktok.jsx";

const SUBABAS = [
  { key: "simular", label: "Simular promoção" },
  { key: "salvas", label: "Promoções salvas" },
  { key: "cupom", label: "Cupom da loja" },
  { key: "campanhas", label: "Campanhas do TikTok" },
];

export default function Promocoes({ onToast }) {
  const [sub, setSub] = useState(() => pegarPedido("promocoes")?.sub || "simular");
  // "simular cupom da loja" (Produtos precificados / 1º Avulso) abre aqui.
  useEffect(() => {
    const ouvir = (e) => {
      if (e.detail.aba !== "promocoes") return;
      const p = pegarPedido("promocoes");
      if (p?.sub) setSub(p.sub);
    };
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);

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
      {sub === "cupom" && <CupomLoja />}
      {sub === "campanhas" && <CampanhasTiktok />}
    </div>
  );
}
