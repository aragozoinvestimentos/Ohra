import { useLoja } from "../lib/LojaContext.jsx";
import { configEscada } from "../lib/escada.js";

// Margem desejada (em %, ex.: 30) usada como ponto de partida nas telas: a da
// loja (Configuração → Lojas → Metas de preço) ou, se o produto tiver regras
// próprias com margem (escada_config do produto), a dele. Continua editável
// na hora em cada tela, só pra simular.
export function useMargemDesejada(escadaConfigProduto = null) {
  const { lojas, lojaId } = useLoja();
  const cfg = lojas.find((l) => l.id === lojaId)?.config_escada || null;
  return Math.round(configEscada(cfg, escadaConfigProduto).margemDesejada * 1000) / 10;
}
