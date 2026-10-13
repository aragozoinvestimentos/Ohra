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

// Canal de VENDA DIRETA (o "Orgânico", out/2026): canal próprio (custom) por
// markup ou sem desconto de anúncio. Não tem rampa, Ads nem riscado/promo pra
// digitar — fica fora do Lançamento (pergunta da rampa), da Anunciar, da Rampa,
// do Ads e dos avisos de anúncio do Início. Revisão de preço = lib/revisarPreco.js.
export function canalDireto(canal) {
  if (!canal || canal.tipo !== "custom") return false;
  return canal.modo_preco === "markup" || !(Number(canal.desconto_anuncio_pct) > 0);
}
