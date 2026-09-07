// Falhas, manutenção e acabamento tendem a se repetir de produto pra produto
// (mesma impressora, processo parecido) — em vez de sempre voltar pro padrão
// genérico, lembra o último valor de fato REGISTRADO (salvo) num produto, pra
// já vir preenchido da próxima vez e evitar ficar reajustando toda hora.
const CHAVE = "ohra:ultimos-percentuais-producao";

export function lerUltimosPercentuais(padrao) {
  try {
    const raw = localStorage.getItem(CHAVE);
    if (!raw) return padrao;
    const obj = JSON.parse(raw);
    return {
      falhasPct: obj.falhasPct ?? padrao.falhasPct,
      manutencaoPct: obj.manutencaoPct ?? padrao.manutencaoPct,
      acabamentoPct: obj.acabamentoPct ?? padrao.acabamentoPct,
    };
  } catch {
    return padrao;
  }
}

export function salvarUltimosPercentuais({ falhasPct, manutencaoPct, acabamentoPct }) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ falhasPct, manutencaoPct, acabamentoPct }));
  } catch {
    // localStorage indisponível — só perde a conveniência, não quebra nada
  }
}
