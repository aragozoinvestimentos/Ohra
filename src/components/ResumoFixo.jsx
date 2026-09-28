import { useEffect, useRef, useState } from "react";

// Resumo que gruda embaixo do cabeçalho ao rolar (só no PC — ver
// .resumo-fixo no index.css) e fica mais compacto enquanto está grudado,
// pra conferir os números sem subir a tela ao mexer nos campos.
export default function ResumoFixo({ children }) {
  const sentinela = useRef(null);
  const [grudado, setGrudado] = useState(false);
  useEffect(() => {
    const el = sentinela.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const topo = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"), 10) || 61;
    const io = new IntersectionObserver(([e]) => setGrudado(!e.isIntersecting && e.boundingClientRect.top < topo + 1), { rootMargin: `-${topo + 1}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinela} className="resumo-sentinela" aria-hidden="true" />
      <div className={`resumo-fixo${grudado ? " grudado" : ""}`}>{children}</div>
    </>
  );
}
