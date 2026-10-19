import { adsNaJanela, pausasDoPeriodo, periodoLigado, valoresAtuais } from "./ads.js";

// Saldo de Ads na Shopee (17/10/2026, combinado com o Gustavo): a Shopee pede
// o dinheiro ANTES (recarga). No caixa a recarga é uma SAÍDA na data do
// depósito (categoria "anuncios" — o dinheiro saiu da conta); o gasto que os
// CSVs do Shopee Ads mostram NÃO vira saída de novo (já está no lucro de
// Vendas do mês). Saldo de Ads = recargas − gasto dos CSVs (todos os
// períodos, inclusive a GMV Max da Loja).
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const DIAS_AVISO_RECARGA = 5;

export function ehRecargaAds(l) {
  return l && l.tipo === "saida" && l.categoria === "anuncios" && l.recorrencia !== "mensal";
}

// Saldo acertado à mão (17/10/2026, pedido do Gustavo: "corrija meu saldo,
// pra começar a acertar de novo"): `base` = { valor, data, gastoBase } —
// a partir daí saldo = valor + recargas DEPOIS da data − gasto dos CSVs que
// passar do total que havia no dia do acerto (gastoBase).
// → { recargas, gasto, saldo, gastoDia, dias, ate, primeira, temRecarga, base }
export function saldoAds({ lancamentos = [], periodos = [], hoje, base = null }) {
  const temBase = base && base.valor != null && base.data;
  const rec = lancamentos.filter((l) => ehRecargaAds(l) && l.data_realizada && l.data_realizada <= hoje && (!temBase || l.data_realizada > base.data));
  const recargas = rec.reduce((t, l) => t + num(l.valor), 0) + (temBase ? num(base.valor) : 0);
  const tudo = adsNaJanela(periodos, [], "2000-01-01", hoje);
  const gastoTotal = tudo.gasto;
  const gasto = temBase ? Math.max(0, Math.round((gastoTotal - num(base.gastoBase)) * 100) / 100) : gastoTotal;
  // Ritmo: gasto dos últimos 7 dias (pelos CSVs); sem isso, os orçamentos diários ligados.
  const g7 = adsNaJanela(periodos, [], somarDias(hoje, -6), hoje).gasto / 7;
  const orcDia = periodos
    .filter((p) => periodoLigado(p, hoje) && p.item_tipo !== "loja" && !pausasDoPeriodo(p, hoje).pausado)
    .reduce((t, p) => t + num(valoresAtuais(p).orcamento), 0);
  const gastoDia = g7 > 0 ? g7 : orcDia;
  const saldo = Math.round((recargas - gasto) * 100) / 100;
  // De onde vem o gasto (19/10/2026): por período, o que entra na conta —
  // total e nos últimos 7 dias (mesma adsNaJanela, então soma o mesmo total).
  const de7 = somarDias(hoje, -6);
  const vistos = new Set();
  const porPeriodo = [];
  for (const p of periodos) {
    const par = p?.parcial;
    if (!par?.ate || !(num(par.gasto) > 0)) continue;
    const sig = `${p.item_tipo}|${p.item_id}|${p.canal_id}|${par.ate}|${num(par.gasto)}`;
    if (vistos.has(sig)) continue;
    vistos.add(sig);
    const t = adsNaJanela([p], [], "2000-01-01", hoje).gasto;
    const g7 = adsNaJanela([p], [], de7, hoje).gasto;
    porPeriodo.push({ periodo: p, chave: `${p.item_tipo}|${p.item_id}|${p.canal_id}`, gasto: t, gasto7: g7, ligado: periodoLigado(p, hoje) });
  }
  // Mesmo anúncio com mais de um período com gasto: vale conferir se a
  // campanha antiga não entrou nos dois.
  const nPorItem = porPeriodo.reduce((m, x) => m.set(x.chave, (m.get(x.chave) || 0) + 1), new Map());
  for (const x of porPeriodo) x.variosPeriodos = nPorItem.get(x.chave) > 1;
  porPeriodo.sort((a, b) => b.gasto7 - a.gasto7 || b.gasto - a.gasto);
  return {
    porPeriodo,
    recargas: Math.round(recargas * 100) / 100,
    gasto,
    saldo,
    gastoDia,
    dias: gastoDia > 0 ? saldo / gastoDia : null,
    ate: tudo.ate,
    primeira: rec.map((l) => l.data_realizada).sort()[0] || null,
    temRecarga: rec.length > 0 || !!temBase,
    gastoTotal,
    base: temBase ? base : null,
  };
}

// Recarregar? Só com recarga registrada e Ads gastando.
export function precisaRecarregar(s) {
  return !!s && s.temRecarga && s.gastoDia > 0 && s.dias != null && s.dias < DIAS_AVISO_RECARGA;
}
