// Simples Nacional (28/10/2026, pra loja que é ME — ex.: Trebub; MEI não usa nada daqui).
// PURO. Tabelas da LC 123/2006 com a redação da LC 155/2016 (Anexo I = comércio,
// Anexo II = indústria). Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12.
// Segregação: venda de mercadoria com ICMS-ST tira a parte do ICMS do DAS; produto com
// PIS/COFINS monofásico tira PIS e COFINS. ESTIMATIVA — o valor oficial é o do PGDAS
// (confira com o contador).
const num = (v) => Number(v) || 0;
const centavos = (v) => Math.round(num(v) * 100) / 100;

// partilha = fração do imposto de cada tributo na faixa (só os que podem sair na segregação)
export const ANEXOS = {
  I: {
    nome: "Anexo I — comércio (revenda)",
    faixas: [
      { ate: 180000, aliq: 0.04, ded: 0, icms: 0.34, pis: 0.0276, cofins: 0.1274 },
      { ate: 360000, aliq: 0.073, ded: 5940, icms: 0.34, pis: 0.0276, cofins: 0.1274 },
      { ate: 720000, aliq: 0.095, ded: 13860, icms: 0.335, pis: 0.0276, cofins: 0.1274 },
      { ate: 1800000, aliq: 0.107, ded: 22500, icms: 0.335, pis: 0.0276, cofins: 0.1274 },
      { ate: 3600000, aliq: 0.143, ded: 87300, icms: 0.335, pis: 0.0276, cofins: 0.1274 },
      { ate: 4800000, aliq: 0.19, ded: 378000, icms: 0, pis: 0.0613, cofins: 0.2827 },
    ],
  },
  II: {
    nome: "Anexo II — indústria (o que você fabrica)",
    faixas: [
      { ate: 180000, aliq: 0.045, ded: 0, icms: 0.32, pis: 0.0249, cofins: 0.1151 },
      { ate: 360000, aliq: 0.078, ded: 5940, icms: 0.32, pis: 0.0249, cofins: 0.1151 },
      { ate: 720000, aliq: 0.1, ded: 13860, icms: 0.32, pis: 0.0249, cofins: 0.1151 },
      { ate: 1800000, aliq: 0.112, ded: 22500, icms: 0.32, pis: 0.0249, cofins: 0.1151 },
      { ate: 3600000, aliq: 0.147, ded: 85500, icms: 0.32, pis: 0.0249, cofins: 0.1151 },
      { ate: 4800000, aliq: 0.3, ded: 720000, icms: 0, pis: 0.0454, cofins: 0.2096 },
    ],
  },
};
export const LIMITE_SIMPLES = 4800000;
export const SUBLIMITE_ICMS = 3600000;

/** Config da loja (lojas.config_escada.impostos): anexo da revenda, do fabricado e o RBT12 informado. */
export function configSimples(cfgLoja) {
  const i = cfgLoja?.impostos || {};
  return {
    anexoRevenda: i.anexoRevenda === "II" ? "II" : "I",
    anexoFabricado: i.anexoFabricado === "I" ? "I" : "II",
    rbt12Manual: num(i.rbt12Manual) > 0 ? num(i.rbt12Manual) : null,
  };
}

const mesesAntes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Receita bruta dos 12 meses ANTES do mês (`mes` 'YYYY-MM'), pelos pedidos válidos (o que o cliente pagou).
 * Menos de 12 meses de pedidos = média dos meses que tem × 12 (regra do início de atividade).
 * `manual` (informado em Regras) vale por cima — use quando a loja vendia antes de importar pedidos.
 */
export function rbt12({ pedidos = [], mes, manual = null }) {
  if (manual) return { valor: manual, meses: 12, origem: "informado" };
  const ini = mesesAntes(mes, 12);
  const porMes = new Map();
  let primeiro = null;
  for (const p of pedidos) {
    if (!p.valido) continue;
    const m = String(p.data || "").slice(0, 7);
    if (!m) continue;
    if (!primeiro || m < primeiro) primeiro = m;
    if (m >= ini && m < mes) porMes.set(m, (porMes.get(m) || 0) + num(p.pago));
  }
  if (!primeiro || primeiro >= mes) return { valor: 0, meses: 0, origem: "sem-historico" };
  let meses = 0;
  for (let k = 1; k <= 12; k++) if (mesesAntes(mes, k) >= primeiro) meses++;
  const soma = [...porMes.values()].reduce((s, v) => s + v, 0);
  return meses >= 12 ? { valor: centavos(soma), meses: 12, origem: "pedidos" } : { valor: centavos((soma / meses) * 12), meses, origem: "proporcional" };
}

export function faixaDe(anexo, rbt) {
  const fx = ANEXOS[anexo]?.faixas || ANEXOS.I.faixas;
  const i = fx.findIndex((f) => num(rbt) <= f.ate);
  return { ...fx[i < 0 ? fx.length - 1 : i], n: (i < 0 ? fx.length - 1 : i) + 1 };
}
/** Alíquota efetiva do anexo pro RBT12 (sem histórico = a nominal da 1ª faixa). */
export function aliquotaEfetiva(anexo, rbt) {
  const f = faixaDe(anexo, rbt);
  if (!(num(rbt) > 0)) return f.aliq;
  return Math.max(0, (num(rbt) * f.aliq - f.ded) / num(rbt));
}
/** Alíquota de UMA venda: a efetiva menos o ICMS (com ST) e o PIS/COFINS (monofásico). */
export function aliquotaDaVenda({ anexo, rbt, st = false, monofasico = false }) {
  const f = faixaDe(anexo, rbt);
  const ef = aliquotaEfetiva(anexo, rbt);
  const tira = (st ? f.icms : 0) + (monofasico ? f.pis + f.cofins : 0);
  return ef * (1 - tira);
}

/** Produto (raw) de um item do catálogo p:/v:/k: — pra ler origem, ST e monofásico. */
function produtoDoItem(item, produtosPorId) {
  if (!item) return null;
  const id = item.produtoId || (String(item.id || "").startsWith("p:") ? String(item.id).slice(2) : null);
  return id ? produtosPorId.get(id) || null : null;
}

/**
 * DAS estimado do mês, separado por anexo e por tipo (normal / com ST / monofásico).
 * pedidos = enriquecer() (válidos). → { rbt, linhas: [{ anexo, tipo, faturamento, aliquota, imposto }], faturamento, das, efetivaMedia, semNcm: [produtos] }
 */
export function dasDoMes({ pedidos = [], todosPedidos = pedidos, mes, cfgLoja, produtos = [] }) {
  const cfg = configSimples(cfgLoja);
  const r = rbt12({ pedidos: todosPedidos, mes, manual: cfg.rbt12Manual });
  const porId = new Map((produtos || []).map((p) => [p.id, p]));
  const grupos = new Map();
  const semNcm = new Map();
  for (const p of pedidos) {
    if (!p.valido || String(p.data || "").slice(0, 7) !== mes) continue;
    const prod = produtoDoItem(p.item, porId);
    const anexo = prod?.origem === "revenda" ? cfg.anexoRevenda : cfg.anexoFabricado;
    const st = prod?.imposto_st === true;
    const mono = prod?.monofasico === true;
    const tipo = st && mono ? "st-mono" : st ? "st" : mono ? "mono" : "normal";
    const k = `${anexo}|${tipo}`;
    const g = grupos.get(k) || { anexo, tipo, faturamento: 0, aliquota: aliquotaDaVenda({ anexo, rbt: r.valor, st, monofasico: mono }) };
    g.faturamento += num(p.pago);
    grupos.set(k, g);
    if (prod && prod.origem === "revenda" && "ncm" in prod && !prod.ncm) semNcm.set(prod.id, prod);
  }
  const linhas = [...grupos.values()].map((g) => ({ ...g, faturamento: centavos(g.faturamento), imposto: centavos(g.faturamento * g.aliquota) })).sort((a, b) => b.faturamento - a.faturamento);
  const faturamento = centavos(linhas.reduce((s, l) => s + l.faturamento, 0));
  const das = centavos(linhas.reduce((s, l) => s + l.imposto, 0));
  return { rbt: r, cfg, linhas, faturamento, das, efetivaMedia: faturamento > 0 ? das / faturamento : null, semNcm: [...semNcm.values()] };
}

export const NOME_TIPO = { normal: "tributação normal", st: "com ICMS-ST (sem ICMS no DAS)", mono: "monofásico (sem PIS/COFINS no DAS)", "st-mono": "ST + monofásico" };
