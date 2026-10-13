import { lucroNoPreco } from "./escada.js";

// Preço ALVO × preço de AGORA (out/2026) — conta ÚNICA.
// Alvo = o preço salvo (precos_canal), onde se quer chegar.
// Agora = o que o cliente paga hoje: o degrau da Rampa (ou a curva sobre o
// degrau, nas variações/kits que dependem do produto em rampa) ou, fora de
// rampa, o próprio alvo. Tudo que mostra RESULTADO (Ranking, Metas, Início,
// vendas do mês) usa o de agora; o alvo é só referência.
//
// Quebra do lucro: Você recebe (o que o canal repassa, depois das taxas) −
// Repor o produto (custo de hoje: fabricação + embalagem + frete) = Lucro.

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

/** { preco, lucro, margem, recebe, repor } — lucro já com o custo descontado. */
export function quebraLucro(preco, lucro, custo) {
  const p = num(preco);
  if (!(p > 0) || lucro == null || !isFinite(Number(lucro))) return null;
  const l = Number(lucro);
  const c = num(custo);
  return { preco: p, lucro: l, margem: l / p, recebe: l + c, repor: c };
}

/**
 * Alvo e agora de um item × canal.
 * `linha` = precos_canal AO VIVO (precoSalvoAoVivo); `rampa` = entrada do
 * mapaRampa (useEscada) — { real, lucro, acima } — ou null.
 * → { alvo, agora, emRampa, acima, difPreco, difLucro } (alvo/agora = quebraLucro) ou null.
 */
export function alvoEAgora({ item, canal, linha, rampa, cfg }) {
  if (!item || !canal) return null;
  const custo = num(item.custoTotal);
  const alvo = linha && num(linha.preco) > 0 ? quebraLucro(linha.preco, linha.lucro, custo) : null;
  let agora = alvo;
  const emRampa = !!(rampa && num(rampa.real) > 0);
  if (emRampa) {
    const lucro = rampa.lucro ?? lucroNoPreco(canal, num(rampa.real), custo, num(item.peso), cfg);
    agora = quebraLucro(rampa.real, lucro, custo);
  }
  if (!agora) return null;
  return {
    alvo,
    agora,
    emRampa,
    acima: emRampa && !!rampa.acima,
    difPreco: alvo ? alvo.preco - agora.preco : null,
    difLucro: alvo ? alvo.lucro - agora.lucro : null,
  };
}

/** Lucro pelo que o cliente PAGA (Anunciar/Ficha: real + os centavos da promo). */
export function quebraNoValor(item, canal, valor, cfg) {
  if (!item || !canal || !(num(valor) > 0)) return null;
  const custo = num(item.custoTotal);
  return quebraLucro(valor, lucroNoPreco(canal, num(valor), custo, num(item.peso), cfg), custo);
}
