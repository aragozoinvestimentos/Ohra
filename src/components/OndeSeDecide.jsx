import { useLembrado } from "../hooks/useLembrado.js";
import { irParaAba } from "../lib/navegar.js";

// Linha discreta (recolhível, lembrada no navegador) que diz onde cada preço é
// decidido. Mesma linha em Produtos precificados, Crescimento e Anunciar.
export default function OndeSeDecide() {
  const [aberto, setAberto] = useLembrado("ohra:onde-se-decide", "1");
  const link = (aba, txt) => (
    <button type="button" className="link-btn onde-decide-link" onClick={() => irParaAba(aba)}>
      {txt}
    </button>
  );
  if (aberto !== "1") {
    return (
      <div className="onde-decide recolhida">
        <button type="button" className="onde-decide-tog" onClick={() => setAberto("1")} aria-expanded="false">
          ▸ Onde se decide cada preço
        </button>
      </div>
    );
  }
  return (
    <div className="onde-decide">
      <button type="button" className="onde-decide-tog" onClick={() => setAberto("0")} aria-expanded="true" title="Recolher">
        ▾
      </button>
      <span>
        <b>Preço alvo</b> = {link("historico", "Produtos precificados")}
        <span className="onde-decide-sep">·</span>
        <b>Preço de agora</b> = {link("crescimento", "Crescimento")} (produtos em rampa)
        <span className="onde-decide-sep">·</span>
        <b>O que digitar</b> = {link("publicar", "Anunciar")} (só muda a promo; o preço original fica fixo)
      </span>
    </div>
  );
}
