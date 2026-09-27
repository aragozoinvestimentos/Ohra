import { useLoja } from "../lib/LojaContext.jsx";
import PrecificacaoCanal from "./PrecificacaoCanal.jsx";
import PrecoPorQuantidade from "./PrecoPorQuantidade.jsx";
import Comparativo from "./Comparativo.jsx";
import Publicar from "./Publicar.jsx";

// Precificação por Canal em 4 sub-abas, na ordem do fluxo: preço do avulso →
// preço dos kits → conferir nos outros canais → publicar na Olist. Todas
// ficam montadas (só escondidas) pra não perder o que foi digitado ao trocar
// de sub-aba. "Comparar canais" é o antigo item "Comparativo" do menu.
const SUBABAS = [
  { key: "avulso", label: "Avulso" },
  { key: "quantidade", label: "Por quantidade" },
  { key: "comparar", label: "Comparar canais" },
  { key: "publicar", label: "Publicar" },
];

export default function PrecificacaoPagina({ sub, onSub, ativo, custoRecebido, produtoParaSelecionar, onToast }) {
  const { lojaId } = useLoja();
  return (
    <div>
      <div className="subabas">
        {SUBABAS.map((s) => (
          <button key={s.key} type="button" data-sub={s.key} className={`btn${sub === s.key ? " primary" : ""}`} onClick={() => onSub(s.key)}>
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
      <div hidden={sub !== "publicar"} data-subview="publicar">
        <Publicar onToast={onToast} />
      </div>
    </div>
  );
}
