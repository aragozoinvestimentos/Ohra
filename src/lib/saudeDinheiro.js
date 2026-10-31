// Saúde do dinheiro (01/11/2026, aprovado pelo Gustavo) — conta ÚNICA, PURA.
// Indicadores do dinheiro da loja, cada um com estado (ok / atencao / resolver /
// info) e uma frase. SÓ INFORMA: nada é gravado e nenhuma regra muda.
// Os números vêm das contas que já existem: caixa (saldoRealizado), caixinhas
// (saldosCaixinhas), resultado (cascataDoPeriodo) e contas fixas.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (v) => `R$ ${num(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const pct = (r) => `${Math.round(r * 100)}%`;
const um = (v) => num(v).toFixed(1).replace(".", ",");

const PESO = { resolver: 3, atencao: 2, info: 1, ok: 0 };

/**
 * caixa: saldo da loja hoje · saldos: caixinhas · fixasMes: contas fixas por mês ·
 * r3: total do cascataDoPeriodo dos 3 meses FECHADOS (pago, lucroBruto, ads, liquido) ·
 * atrasadas: valor das saídas vencidas · alvoGiro / metaReserva / reservaMeses.
 */
export function saudeDoDinheiro({ caixa = 0, saldos = {}, totalCaixinhas = 0, fixasMes = 0, r3 = null, meses3 = 3, atrasadas = 0, nAtrasadas = 0, alvoGiro = null, reservaMeses = 3 }) {
  const ind = [];
  const add = (chave, titulo, valor, estado, frase) => ind.push({ chave, titulo, valor, estado, frase });

  // 1) Contas atrasadas
  if (nAtrasadas > 0) add("atrasadas", "Contas atrasadas", brl(atrasadas), "resolver", `${nAtrasadas} conta${nAtrasadas === 1 ? "" : "s"} vencida${nAtrasadas === 1 ? "" : "s"} — pague ou mude a data no Caixa.`);
  else add("atrasadas", "Contas atrasadas", "nenhuma", "ok", "Tudo em dia.");

  // 2) Fôlego do caixa: quantos meses de contas fixas o caixa paga
  if (fixasMes > 0) {
    const m = num(caixa) / fixasMes;
    add("folego", "Fôlego do caixa", `${um(m)} meses`, m >= 3 ? "ok" : m >= 1 ? "atencao" : "resolver", `O caixa (${brl(caixa)}) paga ${um(m)} meses das contas fixas (${brl(fixasMes)}/mês) mesmo sem vender nada. Bom: 3 meses ou mais.`);
  } else add("folego", "Fôlego do caixa", "—", "info", "Cadastre as contas fixas (Caixa → Contas fixas) pra medir.");

  // 3) Livre depois das caixinhas
  const livre = num(caixa) - num(totalCaixinhas);
  add("livre", "Livre (fora das caixinhas)", brl(livre), livre >= 0 ? "ok" : "resolver", livre >= 0 ? `Do caixa, ${brl(totalCaixinhas)} já tem destino nas caixinhas.` : `As caixinhas (${brl(totalCaixinhas)}) passaram do dinheiro que existe (${brl(caixa)}): tire de alguma.`);

  // 4) Giro
  if (alvoGiro != null && alvoGiro > 0) {
    const r = num(saldos.giro) / alvoGiro;
    add("giro", "Giro", `${brl(saldos.giro)} de ${brl(alvoGiro)}`, r >= 0.9 ? "ok" : r >= 0.5 ? "atencao" : "resolver", `Precisa de ${brl(alvoGiro)} pra repor o que vende num mês e pagar as contas fixas do mês que vem (${pct(Math.min(1, r))} guardado).`);
  }

  // 5) Reserva de emergência
  if (fixasMes > 0) {
    const meta = fixasMes * reservaMeses;
    const r = num(saldos.reserva) / meta;
    add("reserva", "Reserva de emergência", `${brl(saldos.reserva)} de ${brl(meta)}`, r >= 1 ? "ok" : r >= 0.33 ? "info" : "atencao", r >= 1 ? "Meta batida: o % dela vai pro Reinvestimento." : `Meta: ${reservaMeses} meses de contas fixas. Enche aos poucos com 30% do que sobra.`);
  }

  // 6) Resultado dos 3 últimos meses fechados
  if (r3 && num(r3.pago) > 0) {
    const fat = num(r3.pago) / meses3;
    const margem = r3.liquido != null ? num(r3.liquido) / num(r3.pago) : null;
    if (margem != null) add("margem", "Margem final (3 meses)", pct(margem), margem >= 0.1 ? "ok" : margem >= 0 ? "atencao" : "resolver", `Do que faturou, ${pct(margem)} sobrou pra você depois de taxas, custo, Ads e contas fixas (média ${brl(num(r3.liquido) / meses3)}/mês). Bom: 10% ou mais.`);
    // Ponto de equilíbrio: faturamento por mês que paga as contas fixas
    const mc = (num(r3.lucroBruto) - num(r3.ads)) / num(r3.pago);
    if (fixasMes > 0 && mc > 0) {
      const pe = fixasMes / mc;
      add("equilibrio", "Ponto de equilíbrio", `${brl(pe)}/mês`, fat >= pe ? "ok" : fat >= pe * 0.7 ? "atencao" : "resolver", `Precisa faturar ${brl(pe)} por mês pra pagar as contas fixas (cada R$ 100 vendidos deixam R$ ${um(mc * 100)} depois do Ads). Média dos 3 meses: ${brl(fat)}.`);
    } else if (fixasMes > 0) add("equilibrio", "Ponto de equilíbrio", "não chega", "resolver", "Depois do Ads as vendas não deixam lucro: nenhum faturamento paga as contas fixas. Reveja o Ads e os preços.");
    // Ads sobre o lucro bruto
    if (num(r3.lucroBruto) > 0) {
      const a = num(r3.ads) / num(r3.lucroBruto);
      add("ads", "Ads × lucro bruto (3 meses)", pct(a), a <= 0.3 ? "ok" : a <= 0.5 ? "atencao" : "resolver", `De cada R$ 100 de lucro bruto, R$ ${Math.round(a * 100)} foram pro Ads. Bom: até 30%.`);
    }
  } else add("margem", "Resultado (3 meses)", "—", "info", "Importe os pedidos (Atualizar dados) pra medir margem, ponto de equilíbrio e Ads.");

  // 7) Pró-labore e reinvestimento acumulados (só informação)
  if (num(saldos.prolabore) > 0) add("prolabore", "Pró-labore guardado", brl(saldos.prolabore), "info", "É seu: dá pra usar quando quiser (inclusive no Ads).");
  if (num(saldos.reinvestimento) > 0) add("reinvestimento", "Pra reinvestir", brl(saldos.reinvestimento), "info", "Impressora, filamento novo, estoque de revenda ou Ads.");

  const pior = ind.reduce((p, x) => (PESO[x.estado] > PESO[p] ? x.estado : p), "ok");
  const frase =
    pior === "resolver" ? "Tem coisa pra resolver no dinheiro — comece pelos vermelhos." : pior === "atencao" ? "O dinheiro está ok, com pontos de atenção." : "Dinheiro saudável.";
  return { indicadores: ind, pior, frase };
}
