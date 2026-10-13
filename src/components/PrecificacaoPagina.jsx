import { useLoja } from "../lib/LojaContext.jsx";
import PrecificacaoCanal from "./PrecificacaoCanal.jsx";
import PrecoPorQuantidade from "./PrecoPorQuantidade.jsx";
import Comparativo from "./Comparativo.jsx";
import Publicar from "./Publicar.jsx";
import FichaAnuncio from "./FichaAnuncio.jsx";
import Lancamento from "./Lancamento.jsx";

// Precificação por Canal: sub-abas NUMERADAS na ordem de preenchimento
// (1º preço da unidade → 2º preço por volume → 3º montar o anúncio → 4º
// lançamento (rampa ou alvo) → 5º anunciar e manter atualizado) + "Comparar
// canais" separada no fim (consulta, não etapa). Todas ficam montadas (só
// escondidas) pra não perder o que foi digitado ao trocar de sub-aba. Rodapé
// "Próximo →" (ProximoPasso) leva produto e canal de um passo pro outro.
// As sub-abas ficam no cabeçalho do App (menu Preços, out/2026).

export default function PrecificacaoPagina({ sub, onSub, ativo, custoRecebido, produtoParaSelecionar, onToast }) {
  const { lojaId } = useLoja();
  return (
    <div>
      <div hidden={sub !== "avulso"} data-subview="avulso">
        <PrecificacaoCanal ativo={ativo && sub === "avulso"} custoRecebido={custoRecebido} produtoParaSelecionar={produtoParaSelecionar} onToast={onToast} onSub={onSub} />
      </div>
      <div hidden={sub !== "quantidade"} data-subview="quantidade">
        <PrecoPorQuantidade onToast={onToast} onSub={onSub} />
      </div>
      <div hidden={sub !== "comparar"} data-subview="comparar">
        <Comparativo key={lojaId || "sem-loja"} />
      </div>
      <div hidden={sub !== "ficha"} data-subview="ficha">
        <FichaAnuncio onToast={onToast} onIrPara={onSub} />
      </div>
      <div hidden={sub !== "lancamento"} data-subview="lancamento">
        <Lancamento onToast={onToast} onSub={onSub} />
      </div>
      <div hidden={sub !== "publicar"} data-subview="publicar">
        <Publicar onToast={onToast} onSub={onSub} />
      </div>
    </div>
  );
}
