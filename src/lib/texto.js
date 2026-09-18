// Helpers de comparação de texto "tolerante" — usados em Promoções (nome já
// cadastrado x nome novo) pra sugerir "você quis dizer X?" e pra busca/
// agrupamento em Promoções salvas, sem depender de acento/maiúscula/espaço
// extra bater exatamente.

export function normalizarTexto(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Distância de edição (Levenshtein) entre duas strings já normalizadas —
// quantos caracteres precisam mudar pra uma virar a outra. Usado só como
// heurística de "nome parecido" (não é correção ortográfica de verdade),
// com um limite proporcional ao tamanho do nome em vez de um número fixo.
export function distanciaLevenshtein(a, b) {
  const m = a.length;
  const nLen = b.length;
  if (m === 0) return nLen;
  if (nLen === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(nLen + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= nLen; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= nLen; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][nLen];
}

// "Nome parecido": normaliza os dois lados e considera parecido se a
// distância de edição está dentro de ~25% do tamanho do maior nome (mínimo
// 1 caractere de tolerância) — pega erro de digitação tipo "Balck Friday"
// vs "Black Friday" sem confundir nomes genuinamente diferentes.
export function nomesParecidos(a, b) {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const limite = Math.max(1, Math.ceil(Math.max(na.length, nb.length) * 0.25));
  return distanciaLevenshtein(na, nb) <= limite;
}
