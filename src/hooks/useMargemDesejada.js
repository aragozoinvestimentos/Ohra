import { useLoja } from "../lib/LojaContext.jsx";
import { configEscada } from "../lib/escada.js";

// Margem desejada ÚNICA do app (em %, ex.: 30): a da loja, configurada em
// Precificação por Canal → Por quantidade → Regras da escada. Todas as telas
// partem dela (Avulso, Comparar canais, Promoções, Orçamento em volume) —
// continua editável na hora em cada tela, só pra simular.
export function useMargemDesejada() {
  const { lojas, lojaId } = useLoja();
  const cfg = lojas.find((l) => l.id === lojaId)?.config_escada || null;
  return Math.round(configEscada(cfg).margemDesejada * 1000) / 10;
}
