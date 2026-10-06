// Pedido mínimo pra frete grátis por canal (schema v38: canais.frete_gratis_min;
// Shopee R$ 10). O que conta é o valor que o CLIENTE PAGA no pedido (preço
// real / cliente_paga depois da promo). A comparação fica SÓ aqui: se a
// plataforma passar a exigir "acima de", troque `<` por `<=` em abaixoFreteGratis.
import { BRL } from "./format.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// Mínimo do canal (R$) ou null quando não se aplica.
export function freteGratisMin(canal) {
  const v = canal?.frete_gratis_min;
  if (v == null || v === "") return null;
  const n = num(v);
  return n > 0 ? n : null;
}

// true = o cliente que paga `valor` nesse canal paga o frete.
export function abaixoFreteGratis(canal, valor) {
  const min = freteGratisMin(canal);
  if (min == null || valor == null || !(num(valor) > 0)) return false;
  return num(valor) < min - 1e-9;
}

// Menor preço com final ,49/,99 que já tem frete grátis (pra 1º degrau da rampa).
export function menorFinalComFreteGratis(canal, finalAcima) {
  const min = freteGratisMin(canal);
  if (min == null) return null;
  let p = finalAcima(min);
  for (let i = 0; i < 4 && abaixoFreteGratis(canal, p); i++) p = finalAcima(p + 0.02);
  return p;
}

// Aviso pronto (ou null): { min, valor, texto, curto }.
export function avisoFreteGratis(canal, valor) {
  if (!abaixoFreteGratis(canal, valor)) return null;
  const min = freteGratisMin(canal);
  const minTxt = Number.isInteger(min) ? `R$ ${min}` : BRL(min);
  return {
    min,
    valor: num(valor),
    texto: `${BRL(num(valor))} abaixo do frete grátis (${minTxt}): o cliente paga o frete`,
    curto: `abaixo do frete grátis (${minTxt})`,
  };
}

// Avulso abaixo do mínimo: a 1ª quantidade (variação ou kit) que passa.
// opcoes = [{ n, valor, rotulo? }] (valor = o que o cliente paga nela).
export function dicaKitFreteGratis(canal, valorAvulso, opcoes) {
  if (!abaixoFreteGratis(canal, valorAvulso)) return null;
  const ok = (opcoes || []).filter((o) => o.valor > 0 && !abaixoFreteGratis(canal, o.valor)).sort((a, b) => a.n - b.n)[0];
  if (!ok) return null;
  return `com ${ok.rotulo || `${ok.n} un.`} passa do frete grátis — destaque o kit no anúncio`;
}

// Variações e kits que levam o produto, com o preço salvo no canal — pra dica
// "com 2 un. passa do frete grátis". precos = linhas de precos_canal.
export function opcoesKitDoProduto(produtoId, canal, itens, precos) {
  const tipo = (id) => ({ v: "variacao", k: "kit" })[id[0]];
  return (itens || [])
    .filter((i) => (i.id.startsWith("v:") && i.produtoId === produtoId) || (i.id.startsWith("k:") && (i.componentes || []).some((c) => c.produtoId === produtoId)))
    .map((i) => {
      const s = (precos || []).find((p) => p.item_tipo === tipo(i.id) && p.item_id === i.id.slice(2) && p.canal_id === canal?.id);
      return { n: i.pecas || i.quantidade || 2, valor: s ? num(s.preco) : 0, rotulo: i.id.startsWith("k:") ? i.nome : `${i.quantidade || i.pecas} un.` };
    });
}
