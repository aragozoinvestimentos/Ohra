import { cupomMaximo } from "../lib/cupomLoja.js";
import { BRL } from "../lib/format.js";
import { irParaAba } from "../lib/navegar.js";

// "Cupom até X%" do item no preço salvo (canal sem rampa = desconto por cupom;
// lib/cupomLoja.js). Produtos precificados (detalhe da célula) e 1º Avulso.
export default function CupomMaximo({ item, canal, preco, cfg, compacto = false }) {
  const m = cupomMaximo({ canal, preco: Number(preco), custo: Number(item?.custoTotal) || 0, peso: Number(item?.peso) || 0, cfg });
  if (!m) return null;
  if (m.semEspaco) return <div className="aviso-cel atencao">Sem espaço pra cupom neste preço: o lucro já está abaixo do seu mínimo.</div>;
  return (
    <div className="aviso-cel">
      <b>Cupom até {m.pct}%</b> ({BRL(m.valor)}) — ainda sobra {BRL(m.lucroNoMax)} de lucro, no seu mínimo. Sugestão: fora da live até <b>{m.foraLive}%</b>, na live até <b>{m.live}%</b>.
      {!compacto && (
        <>
          {" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("promocoes", { sub: "cupom" })}>
            simular cupom da loja
          </button>
        </>
      )}
    </div>
  );
}
