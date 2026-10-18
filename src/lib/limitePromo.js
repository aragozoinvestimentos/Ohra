// Limite de desconto (promo %) por plataforma — conta ÚNICA (18/10/2026).
// TikTok Shop: a plataforma recusa desconto acima de 80% ("A taxa de desconto
// não deve ser superior a 80%") e avisa acima de 40% ("A taxa de desconto
// atual é maior do que 40%"). Só informa: nenhum preço muda sozinho.
export const LIMITES_PROMO = {
  tiktok: { max: 80, aviso: 40, nome: "TikTok" },
};

export function limitePromoDoCanal(canal) {
  return LIMITES_PROMO[canal?.tipo] || null;
}

// → null | { nivel: "resolver" | "atencao", curto, texto }
export function avisoPromo(canal, promo) {
  const lim = limitePromoDoCanal(canal);
  const p = Number(promo) || 0;
  if (!lim || !(p > lim.aviso)) return null;
  if (p > lim.max)
    return {
      nivel: "resolver",
      curto: `acima de ${lim.max}%`,
      texto: `O ${lim.nome} não aceita desconto acima de ${lim.max}% (aqui dá ${p}%). Pra o cliente pagar esse valor, o preço original teria que baixar — ou use um preço maior.`,
    };
  return {
    nivel: "atencao",
    curto: `acima de ${lim.aviso}%`,
    texto: `O ${lim.nome} avisa quando o desconto passa de ${lim.aviso}% (aqui dá ${p}%). Aceita até ${lim.max}%.`,
  };
}

// Desconto do anúncio configurado (fração 0–1) acima do aviso da plataforma.
export function avisoDescontoConfig(canal, desconto) {
  return avisoPromo(canal, Math.round((Number(desconto) || 0) * 100));
}
