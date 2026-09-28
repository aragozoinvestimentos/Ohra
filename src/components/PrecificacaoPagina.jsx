import { useLoja } from "../lib/LojaContext.jsx";
import PrecificacaoCanal from "./PrecificacaoCanal.jsx";
import PrecoPorQuantidade from "./PrecoPorQuantidade.jsx";
import Comparativo from "./Comparativo.jsx";
import Publicar from "./Publicar.jsx";
import FichaAnuncio from "./FichaAnuncio.jsx";

// Precificação por Canal: sub-abas NUMERADAS na ordem de preenchimento
// (1º preço da unidade → 2º preço por volume → 3º montar o anúncio → 4º manter
// atualizado) + "Comparar canais" separada no fim (consulta, não etapa).
// Todas ficam montadas (só escondidas) pra não perder o que foi digitado ao
// trocar de sub-aba. "Comparar canais" é o antigo item "Comparativo" do menu.
const SUBABAS = [
  { key: "avulso", label: "Avulso", ordem: "1º" },
  { key: "quantidade", label: "Por quantidade", ordem: "2º" },
  { key: "ficha", label: "Ficha do anúncio", ordem: "3º" },
  { key: "publicar", label: "Anunciar", ordem: "4º" },
  { key: "comparar", label: "Comparar canais", separada: true },
];

export default function PrecificacaoPagina({ sub, onSub, ativo, custoRecebido, produtoParaSelecionar, onToast }) {
  const { lojaId } = useLoja();
  return (
    <div>
      <div className="subabas">
        {SUBABAS.map((s) => (
          <button key={s.key} type="button" data-sub={s.key} className={`btn${sub === s.key ? " primary" : ""}${s.separada ? " subaba-separada" : ""}`} onClick={() => onSub(s.key)}>
            {s.ordem && <span className="subaba-ordem">{s.ordem}</span>}
            {s.label}
          </button>
        ))}
      </div>
      <div hidden={sub !== "avulso"} data-subview="avulso">
        <PrecificacaoCanal ativo={ativo && sub === "avulso"} custoRecebido={custoRecebido} produtoParaSelecionar={produtoParaSelecionar} onToast={onToast} />
      </div>
      <div hidden={sub !== "quantidade"} data-subview="quantidade">
        <PrecoPorQuantidade onToast={onToast} />
      </div>
      <div hidden={sub !== "comparar"} data-subview="comparar">
        <Comparativo key={lojaId || "sem-loja"} />
      </div>
      <div hidden={sub !== "ficha"} data-subview="ficha">
        <FichaAnuncio onToast={onToast} onIrPara={onSub} />
      </div>
      <div hidden={sub !== "publicar"} data-subview="publicar">
        <Publicar onToast={onToast} />
      </div>
    </div>
  );
}
