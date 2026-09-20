// Lógica da aba "Registro de Impressões" — taxa de falha real e recomendação
// de lote máximo seguro, a partir do histórico de impressões registradas.
//
// Modelo assumido (confirmado com o Gustavo): cada registro é UM job de
// impressão (uma "chapa"/lote); se ela falha, o LOTE INTEIRO é considerado
// perdido — não dá pra separar peças boas de uma chapa que deu errado. O
// campo "em que % a impressão falhou" mede quanto do material/tempo
// realmente foi gasto até o problema acontecer (uma impressão que falha aos
// 90% desperdiçou muito mais recurso do que uma que falha aos 10%), então é
// isso que usamos pra estimar o prejuízo em R$ — não simplesmente "perdeu
// tudo" pro cálculo de custo, só pra contagem de peças perdidas.

// Taxa de falha inicial (conservadora, igual ao padrão já usado no campo
// "Média de falhas" de Custo de Produção) e o "peso" dela em número
// equivalente de registros reais — evita que a taxa pule pra 0% ou 100%
// só com 1 ou 2 registros; ela vai perdendo peso conforme registros de
// verdade entram, até ficar guiada quase inteiramente pelos dados reais.
export const TAXA_FALHA_PRIOR_PCT = 12.5;
export const TAXA_FALHA_PRIOR_PESO = 15;

// Blend bayesiano simples: começa perto do "chute" conservador e desliza
// pra taxa real conforme o histórico cresce.
export function calcTaxaFalhaAtual(registros, { priorPct = TAXA_FALHA_PRIOR_PCT, priorPeso = TAXA_FALHA_PRIOR_PESO } = {}) {
  const total = registros.length;
  const falhas = registros.filter((r) => r.status === "falha").length;
  const taxa = (((priorPct / 100) * priorPeso) + falhas) / (priorPeso + total);
  return { taxa, total, falhas };
}

// Fração média de quanto uma impressão costuma avançar antes de falhar
// (0–1). Sem nenhuma falha registrada ainda, assume o pior caso (100% do
// custo perdido) como ponto de partida conservador — vai caindo conforme
// falhas reais, com seu "% que avançou", entrarem no histórico.
export function calcFracaoMediaFalha(registros) {
  const falhas = registros.filter((r) => r.status === "falha" && r.falha_pct != null);
  if (falhas.length === 0) return 1;
  const soma = falhas.reduce((s, r) => s + Number(r.falha_pct) / 100, 0);
  return soma / falhas.length;
}

// Prejuízo médio real por impressão perdida (R$) — média do custo do lote
// no momento de cada falha, ponderado por quanto daquela impressão específica
// já tinha avançado. null enquanto não há nenhuma falha registrada.
export function calcPrejuizoMedioPorFalha(registros) {
  const falhas = registros.filter((r) => r.status === "falha" && r.custo_lote_estimado != null);
  if (falhas.length === 0) return null;
  const soma = falhas.reduce((s, r) => s + Number(r.custo_lote_estimado) * (r.falha_pct != null ? Number(r.falha_pct) / 100 : 1), 0);
  return soma / falhas.length;
}

// Pra um tamanho de lote N: quanto se espera perder, em média, todas as
// vezes que se imprime esse tamanho (probabilidade de falhar × prejuízo se
// falhar) — é o "custo médio de fazer esse tamanho de lote no longo prazo".
export function calcPrejuizoEsperado({ custoPorPeca, quantidade, taxaFalha, fracaoMediaFalha }) {
  const custoLote = custoPorPeca * quantidade;
  const prejuizoSeFalhar = custoLote * fracaoMediaFalha;
  return { custoLote, prejuizoSeFalhar, prejuizoEsperado: taxaFalha * prejuizoSeFalhar };
}

// Maior lote (nº de peças) cujo prejuízo SE FALHAR (não o médio ponderado —
// o de "deu errado essa noite específica") ainda fica dentro do teto em R$
// que você está disposto a arriscar de uma vez. É essa conta, e não a
// média, que decide o tamanho seguro: a média dilui o risco ao longo de
// muitas impressões, mas numa impressora rodando sozinha de madrugada o que
// importa é quanto se perde SE der errado dessa vez.
export function calcLoteMaximoSeguro({ custoPorPeca, fracaoMediaFalha, tetoReais }) {
  if (!custoPorPeca || custoPorPeca <= 0 || !fracaoMediaFalha || fracaoMediaFalha <= 0) return null;
  const maximo = Math.floor(tetoReais / (custoPorPeca * fracaoMediaFalha));
  return Math.max(0, maximo);
}
