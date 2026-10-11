import { createContext, useContext } from "react";

// Semana pendente (lib/semanaPendente.js), calculada UMA vez no
// SemanaPendenteProvider (só depois da loja liberada) e lida pela bolinha do
// menu, pelo Início e pelo Crescimento.
export const SemanaPendenteContext = createContext({ itens: [], pendentes: [], adiados: [], porChave: new Map(), adiar: async () => false, desfazer: async () => false, disponivel: false });

export function useSemanaPendente() {
  return useContext(SemanaPendenteContext);
}
