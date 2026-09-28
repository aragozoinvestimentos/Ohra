// Ordem e nome dos canais em todo o app — Shopee (onde o Gustavo mais vende)
// primeiro, depois ML, TikTok, Shein e canais próprios.
export const ORDEM_CANAL = { shopee: 0, ml: 1, tiktok: 2, shein: 3 };
export const NOME_CANAL = { shopee: "Shopee", ml: "Mercado Livre", tiktok: "TikTok Shop", shein: "Shein" };
export const nomeCanal = (c) => c?.nome || NOME_CANAL[c?.tipo] || "Canal";
export function ordenarCanais(lista) {
  return [...(lista || [])].sort((a, b) => (ORDEM_CANAL[a.tipo] ?? 9) - (ORDEM_CANAL[b.tipo] ?? 9) || String(a.nome || "").localeCompare(String(b.nome || "")));
}

// Tipo do canal pelo nome (pra textos salvos só com o nome, ex.: promoções).
export function tipoDoNome(nome) {
  const t = String(nome || "").toLowerCase();
  if (t.includes("shopee")) return "shopee";
  if (t.includes("mercado") || t === "ml") return "ml";
  if (t.includes("tiktok")) return "tiktok";
  if (t.includes("shein")) return "shein";
  return "custom";
}
