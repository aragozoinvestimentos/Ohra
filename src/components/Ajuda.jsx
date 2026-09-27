import { useEffect, useRef, useState } from "react";
import Portal from "./Portal.jsx";

// Botão "?" que abre uma explicação curta sobre os campos daquele painel.
// Fica ao lado do h3 de cada seção (ver .panel h3 no index.css).
// O balão é desenhado no <body> com posição fixa calculada a partir do botão
// (e limitada às bordas da tela): antes ele ficava dentro do painel/tabela e
// era cortado por quem tinha rolagem lateral, ou saía da tela na direita.
export default function Ajuda({ texto }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  function calcularPos() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return null;
    const largura = Math.min(270, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
    return { left, top: r.bottom + 6, largura };
  }

  useEffect(() => {
    if (!aberto) return;
    const posicionar = () => setPos(calcularPos());
    window.addEventListener("scroll", posicionar, true);
    window.addEventListener("resize", posicionar);
    return () => {
      window.removeEventListener("scroll", posicionar, true);
      window.removeEventListener("resize", posicionar);
    };
  }, [aberto]);

  return (
    <span className="ajuda-wrap">
      <button
        ref={btnRef}
        type="button"
        className="ajuda-btn"
        onClick={() => {
          setPos(calcularPos());
          setAberto((v) => !v);
        }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        aria-label="Ajuda sobre esta seção"
        title="O que significa isso?"
      >
        ?
      </button>
      {aberto && pos && (
        <Portal>
          <div className="ajuda-popover ajuda-popover-fixo" style={{ left: pos.left, top: pos.top, width: pos.largura }}>
            {texto}
          </div>
        </Portal>
      )}
    </span>
  );
}
