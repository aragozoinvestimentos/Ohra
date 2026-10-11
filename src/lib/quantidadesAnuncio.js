// Quantidades ANUNCIADAS por canal (schema v41) — conta ÚNICA, usada por
// Por quantidade (chips + Aplicar/Criar), Produtos precificados (filtro
// "Sugerido ≠ salvo"), Anunciar, Ficha, "O que digitar" da Rampa e Início.
// produtos_cadastro.quantidades_anuncio = { canal_id: [1, 2, 3] }. Sem
// escolha gravada pro canal = padrão: Shopee = as quantidades que cabem no
// anúncio do avulso pela regra de 4× (gruposRegra4x, grupo 1); outros canais =
// todas. Sem a coluna (v41 não rodado) = tudo anunciado, como antes.
import { gruposRegra4x } from "./escada.js";

export const temColunaQuantidades = (produto) => !!produto && Object.prototype.hasOwnProperty.call(produto, "quantidades_anuncio");

// Lista gravada pro canal (ordenada) ou null.
export function quantidadesGravadas(produto, canalId) {
  const q = produto?.quantidades_anuncio;
  const lista = q && typeof q === "object" ? q[canalId] : null;
  return Array.isArray(lista) ? [...new Set(lista.map(Number).filter((n) => n > 0))].sort((a, b) => a - b) : null;
}

// Padrão do canal: Shopee → quantidades do 1º grupo da regra de 4× (linhas4x =
// [{ n, promo, original }]); outros canais (ou sem linhas) → null (= todas).
export function quantidadesPadrao(canal, linhas4x) {
  if (canal?.tipo !== "shopee" || !linhas4x?.length) return null;
  const r = gruposRegra4x(linhas4x);
  return r.grupos.length ? r.grupos[0] : null;
}

// A quantidade n está anunciada no canal?
export function quantidadeAnunciada({ produto, canal, n, linhas4x = null }) {
  if (!produto || !canal || !temColunaQuantidades(produto)) return true;
  const gravadas = quantidadesGravadas(produto, canal.id);
  if (gravadas) return gravadas.includes(Number(n));
  const padrao = quantidadesPadrao(canal, linhas4x);
  return padrao ? padrao.includes(Number(n)) : true;
}

// Liga/desliga n na lista do canal (parte da gravada, ou do padrão de hoje).
export function alternarQuantidade(produto, canal, n, todas, linhas4x = null) {
  const atual = quantidadesGravadas(produto, canal.id) ?? (todas || []).filter((q) => quantidadeAnunciada({ produto: { quantidades_anuncio: null }, canal, n: q, linhas4x }));
  const set = new Set(atual);
  if (set.has(n)) set.delete(n);
  else set.add(n);
  return { ...(produto?.quantidades_anuncio || {}), [canal.id]: [...set].sort((a, b) => a - b) };
}
