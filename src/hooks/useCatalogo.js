import { useEffect, useSyncExternalStore } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { usarCatalogo, assinarCatalogo, lerCatalogo } from "../lib/catalogoStore.js";

// Dados CRUS do catálogo da loja atual (como estão no banco), do store único
// — uma busca + um realtime pra todas as telas. Telas de cadastro/edição usam
// este; telas que mostram custo/lucro usam useRankingData (valores ao vivo).
// Depois de gravar algo, chame recarregarCatalogo() pra não esperar o realtime.
export function useCatalogo() {
  const { lojaId } = useLoja();
  const cat = useSyncExternalStore(assinarCatalogo, lerCatalogo, lerCatalogo);
  useEffect(() => usarCatalogo(lojaId), [lojaId]);
  return cat;
}
