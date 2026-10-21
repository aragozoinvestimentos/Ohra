import { lucroNoPreco, lucroMinimoAceitavel } from "./escada.js";

// Cupom de desconto da loja FORA da live (19/10/2026, decisão do Gustavo): no
// canal sem rampa (ex.: TikTok — canal da live) o produto fica no preço pela
// margem e todo desconto é por CUPOM. Conta ÚNICA aqui:
// - cupomMaximo: maior % inteiro que ainda deixa o lucro ≥ o mínimo aceitável
//   (margem mínima ou lucro mínimo em R$, o maior), com as taxas do canal no
//   preço COM o cupom (a comissão cai junto; a faixa pode mudar);
// - sugestão: fora da live até metade do máximo, na live até 80% — a live
//   precisa ser sempre o melhor negócio;
// - simularCupom: um cupom (% ou R$, pedido mínimo opcional) em UMA unidade do
//   item (o pior caso: pedido de 1 peça paga a taxa fixa inteira).
export const FRACAO_FORA_LIVE = 0.5;
export const FRACAO_LIVE = 0.8;
export const PCT_MAX = 90;
const cent = (v) => Math.round(v * 100) / 100;

function noPreco({ canal, preco, custo, peso, cfg }, desconto) {
  const novo = cent(preco - desconto);
  if (!(novo > 0)) return { novo, lucro: -Infinity, minimo: 0 };
  const lucro = lucroNoPreco(canal, novo, custo, peso, cfg);
  return { novo, lucro: lucro == null ? null : cent(lucro), minimo: cent(lucroMinimoAceitavel(novo, cfg)) };
}

export function cupomMaximo(x) {
  if (!(x?.preco > 0) || !x.canal) return null;
  const sem = noPreco(x, 0);
  if (sem.lucro == null) return null;
  let pct = 0;
  for (let d = 1; d <= PCT_MAX; d++) {
    const r = noPreco(x, (x.preco * d) / 100);
    if (r.lucro == null || r.lucro < r.minimo - 0.004) break;
    pct = d;
  }
  const r = noPreco(x, (x.preco * pct) / 100);
  return {
    pct,
    valor: cent((x.preco * pct) / 100),
    lucroSem: sem.lucro,
    minimoSem: sem.minimo,
    semEspaco: sem.lucro < sem.minimo - 0.004,
    lucroNoMax: r.lucro,
    foraLive: Math.floor(pct * FRACAO_FORA_LIVE),
    live: Math.floor(pct * FRACAO_LIVE),
  };
}

// cupom = { tipo: "pct" | "valor", valor, minimo? (pedido mínimo em R$) }
export function descontoDoCupom(cupom, total) {
  const v = Number(cupom?.valor) || 0;
  if (!(v > 0)) return 0;
  if (Number(cupom.minimo) > 0 && total < Number(cupom.minimo) - 0.004) return 0;
  return cent(cupom.tipo === "valor" ? Math.min(v, total) : (total * v) / 100);
}

export function simularCupom(x, cupom) {
  if (!(x?.preco > 0) || !x.canal) return null;
  const alcanca = !(Number(cupom?.minimo) > 0) || x.preco >= Number(cupom.minimo) - 0.004;
  const desconto = descontoDoCupom(cupom, x.preco);
  const r = noPreco(x, desconto);
  const estado = !alcanca ? "nao-alcanca" : r.lucro == null ? "sem-dado" : r.lucro < 0 ? "prejuizo" : r.lucro < r.minimo - 0.004 ? "abaixo" : "cabe";
  return { alcanca, desconto, clientePaga: r.novo, lucro: r.lucro, minimo: r.minimo, estado };
}

// O cupom de fora da live não pode ser tão bom quanto o da live.
export function comparaComLive(cupom, pctLive) {
  const live = Number(pctLive) || 0;
  if (!(live > 0) || !(Number(cupom?.valor) > 0)) return null;
  if (cupom.tipo === "pct") return Number(cupom.valor) >= live ? "igual-ou-maior" : "menor";
  return null; // R$ fixo × % — a tabela mostra item a item
}
