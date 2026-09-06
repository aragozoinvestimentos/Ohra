import { useState } from "react";

// Botão "?" que abre uma explicação curta sobre os campos daquele painel.
// Fica ao lado do h3 de cada seção (ver .panel h3 no index.css).
export default function Ajuda({ texto }) {
  const [aberto, setAberto] = useState(false);

  return (
    <span className="ajuda-wrap">
      <button
        type="button"
        className="ajuda-btn"
        onClick={() => setAberto((v) => !v)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        aria-label="Ajuda sobre esta seção"
        title="O que significa isso?"
      >
        ?
      </button>
      {aberto && <div className="ajuda-popover">{texto}</div>}
    </span>
  );
}
