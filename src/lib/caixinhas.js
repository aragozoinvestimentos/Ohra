// Caixinhas do Dinheiro (01/11/2026, aprovado pelo Gustavo, schema v72) — conta
// ÚNICA, PURA. Separações VIRTUAIS do caixa da loja: nada sai do caixa; a tela
// mostra quanto do saldo já tem destino e quanto está livre.
//
// Movimentos na tabela reserva_producao (v51 + coluna `caixinha` do v72):
//   tipo 'separar' (guardou) | 'usar' (tirou); linha sem caixinha = giro.
//
// Três caixinhas CALCULADAS (saem do dinheiro que NÃO é lucro):
//   giro         = repor o que vendeu (material/embalagem — o custo das vendas,
//                  menos a parte máquina) + as contas fixas do próximo mês.
//                  Completa só o que falta; giro acima do alvo = sobra liberada.
//   impostos     = o imposto das vendas do mês (o % dos canais — Simples). No MEI
//                  o DAS é fixo e já é uma conta fixa (entra no giro).
//   equipamentos = a parte "máquina" do custo de cada venda (fundo da próxima
//                  impressora). Acumula.
// Três por % (só o "Sobrou pra você" do mês, se for positivo):
//   prolabore 10% · reserva 30% (até 3 meses de contas fixas; passou, vai pro
//   reinvestimento) · reinvestimento 60%. Editáveis; aviso se a soma ≠ 100%.

export const CAIXINHAS = [
  { chave: "giro", nome: "Giro", calc: true, ajuda: "Repor o material e a embalagem do que vendeu + as contas fixas do próximo mês. É o dinheiro que roda a operação." },
  { chave: "impostos", nome: "Impostos", calc: true, ajuda: "O imposto das vendas do mês (no Simples). No MEI o DAS é fixo e já entra no Giro como conta fixa." },
  { chave: "equipamentos", nome: "Equipamentos", calc: true, ajuda: "A parte da máquina que vai no custo de cada peça vendida — o fundo da próxima impressora (ou do conserto)." },
  { chave: "reserva", nome: "Reserva de emergência", calc: false, ajuda: "Só pra emergência. Enche até 3 meses de contas fixas; depois o % dela vai pro Reinvestimento." },
  { chave: "reinvestimento", nome: "Reinvestimento", calc: false, ajuda: "Pra crescer: impressora nova, filamento novo, estoque de revenda, Ads." },
  { chave: "prolabore", nome: "Pró-labore", calc: false, ajuda: "O seu salário. Acumula — dá pra usar quando quiser (inclusive no Ads)." },
];
export const NOME_CAIXINHA = Object.fromEntries(CAIXINHAS.map((c) => [c.chave, c.nome]));

export const DIVISAO_PADRAO = { prolabore: 0.1, reserva: 0.3, reinvestimento: 0.6, reservaMeses: 3 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cent = (v) => Math.round(num(v) * 100) / 100;

export function divisaoDaLoja(pref) {
  const p = pref || {};
  const pct = (k) => (p[k] != null && Number.isFinite(Number(p[k])) ? Math.max(0, Number(p[k])) : DIVISAO_PADRAO[k]);
  const d = { prolabore: pct("prolabore"), reserva: pct("reserva"), reinvestimento: pct("reinvestimento"), reservaMeses: num(p.reservaMeses) > 0 ? num(p.reservaMeses) : DIVISAO_PADRAO.reservaMeses };
  d.soma = Math.round((d.prolabore + d.reserva + d.reinvestimento) * 1000) / 1000;
  d.somaOk = Math.abs(d.soma - 1) < 0.005;
  return d;
}

export const caixinhaDe = (r) => r?.caixinha || "giro";

/** Saldo de cada caixinha + total separado. */
export function saldosCaixinhas(registros = []) {
  const saldos = Object.fromEntries(CAIXINHAS.map((c) => [c.chave, 0]));
  for (const r of registros) {
    const k = caixinhaDe(r);
    if (!(k in saldos)) continue;
    saldos[k] += (r.tipo === "usar" ? -1 : 1) * num(r.valor);
  }
  for (const k of Object.keys(saldos)) saldos[k] = cent(saldos[k]);
  const total = cent(Object.values(saldos).reduce((t, v) => t + v, 0));
  return { saldos, total };
}

export const jaDistribuiu = (registros = [], mes) => registros.some((r) => r.origem === "distribuir" && r.mes === mes);

/**
 * Sugestão do mês fechado (o que separar em cada caixinha, em ordem de prioridade,
 * nunca passando do dinheiro livre do caixa).
 * - c: total do cascataDoPeriodo do mês (pago, custo, imposto, liquido…)
 * - maquina: parte máquina das vendas do mês (Σ unidades × maquinaDoItem)
 * - fixasProximo: contas fixas do mês seguinte
 * - fixasMes: contas fixas do mês (meta da reserva = fixasMes × reservaMeses)
 * - saldos: saldosCaixinhas().saldos; caixa: saldo da loja hoje
 * → { linhas: [{ caixinha, valor, conta, liberar? }], livreAntes, livreDepois, sobrou, faltou, limitado }
 */
export function sugestaoDistribuicao({ c, maquina = 0, fixasProximo = 0, fixasMes = 0, saldos = {}, caixa = 0, divisao = DIVISAO_PADRAO }) {
  const d = divisao.somaOk === undefined ? divisaoDaLoja(divisao) : divisao;
  const separado = Object.values(saldos).reduce((t, v) => t + num(v), 0);
  let livre = cent(num(caixa) - separado);
  const livreAntes = livre;
  const linhas = [];
  let limitado = false;
  const por = (caixinha, querido, conta) => {
    const q = cent(Math.max(0, querido));
    if (q <= 0) return 0;
    const v = cent(Math.min(q, Math.max(0, livre)));
    if (v < q) limitado = true;
    if (v > 0) {
      linhas.push({ caixinha, valor: v, querido: q, conta });
      livre = cent(livre - v);
    }
    return v;
  };
  const brl = (v) => `R$ ${num(v).toFixed(2).replace(".", ",")}`;
  // 1) Impostos
  por("impostos", num(c?.imposto), `imposto das vendas do mês ${brl(c?.imposto)}`);
  // 2) Giro: alvo = repor (custo − máquina) + contas fixas do próximo mês
  const repor = Math.max(0, num(c?.custo) - num(maquina));
  const alvoGiro = cent(repor + num(fixasProximo));
  const faltaGiro = cent(alvoGiro - num(saldos.giro));
  if (faltaGiro > 0) por("giro", faltaGiro, `alvo ${brl(alvoGiro)} (repor ${brl(repor)} + contas fixas do mês que vem ${brl(fixasProximo)}) − já no giro ${brl(saldos.giro)}`);
  else if (faltaGiro < -0.009) {
    linhas.push({ caixinha: "giro", valor: cent(-faltaGiro), liberar: true, conta: `o giro (${brl(saldos.giro)}) passou do alvo (${brl(alvoGiro)}) — libera ${brl(-faltaGiro)}` });
    livre = cent(livre - faltaGiro);
  }
  // 3) Equipamentos
  por("equipamentos", maquina, `parte máquina das peças vendidas ${brl(maquina)}`);
  // 4) Sobrou pra você
  const sobrou = num(c?.liquido);
  if (sobrou > 0) {
    const metaReserva = cent(num(fixasMes) * d.reservaMeses);
    const faltaReserva = Math.max(0, metaReserva - num(saldos.reserva));
    const pReserva = sobrou * d.reserva;
    const vReserva = metaReserva > 0 ? Math.min(pReserva, faltaReserva) : pReserva;
    const excedente = pReserva - vReserva;
    por("prolabore", sobrou * d.prolabore, `${Math.round(d.prolabore * 100)}% de ${brl(sobrou)}`);
    por("reserva", vReserva, metaReserva > 0 ? `${Math.round(d.reserva * 100)}% de ${brl(sobrou)}, até a meta de ${brl(metaReserva)} (${d.reservaMeses} meses de contas fixas)` : `${Math.round(d.reserva * 100)}% de ${brl(sobrou)}`);
    por("reinvestimento", sobrou * d.reinvestimento + excedente, `${Math.round(d.reinvestimento * 100)}% de ${brl(sobrou)}${excedente > 0.009 ? ` + ${brl(excedente)} que passou da meta da reserva` : ""}`);
  }
  return { linhas, livreAntes, livreDepois: livre, sobrou, faltou: sobrou < 0 ? -sobrou : 0, limitado, alvoGiro, repor };
}
