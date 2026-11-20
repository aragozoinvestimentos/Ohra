// Preço "que atrai" (20/11/2026, pedido do Gustavo): quando o app calcula um
// preço novo por % (Otimizar preço, rampa do anúncio inteiro, variações que
// sobem junto com o avulso), o número exato sai quebrado (R$ 18,79, 31,40).
// Como o preço da promoção é DIGITADO na plataforma, dá pra escolher um final
// que vende melhor: ,49 ou ,90, o mais perto do alvo (empate = pra baixo).
// Efeito do 1º dígito: se o mais perto passa de uma dezena (40,49) e o ,90 de
// antes dela (39,90) está a até 2% do alvo, fica o de baixo.
// Limites: `acima` = tem que ficar acima disso (subir de verdade); `abaixo` =
// tem que ficar abaixo (descer de verdade). Sem candidato no intervalo, o
// preço exato no centavo.
const FINAIS = [0.49, 0.9];
const DEZENA_TOL = 0.02;
const cent = (v) => Math.round(v * 100) / 100;

export function precoAtraente(alvo, { acima = null, abaixo = null } = {}) {
  const a = Number(alvo);
  if (!(a > 0)) return null;
  const ok = (c) => c > 0 && (acima == null || c > acima + 0.004) && (abaixo == null || c < abaixo - 0.004);
  const cands = [];
  for (let n = Math.max(0, Math.floor(a) - 4); n <= Math.ceil(a) + 4; n++) for (const f of FINAIS) if (ok(cent(n + f))) cands.push(cent(n + f));
  if (!cands.length) return cent(a);
  cands.sort((x, y) => Math.abs(x - a) - Math.abs(y - a) || x - y);
  let melhor = cands[0];
  const dezena = Math.floor(melhor / 10) * 10;
  if (melhor > a && dezena > 0 && dezena > a - a * DEZENA_TOL) {
    const antes = cent(dezena - 1 + 0.9);
    if (antes < melhor && ok(antes) && antes >= a * (1 - DEZENA_TOL)) melhor = antes;
  }
  return melhor;
}
