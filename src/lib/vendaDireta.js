// Venda direta (out/2026, schema v43) — conta ÚNICA de ATACADO por faixas e
// de PERSONALIZAÇÃO. Varejo direto (canal próprio em markup) fica em
// escada.js (canalEmMarkup/precoPorMarkup/markupDoCanal).
//
// Atacado: faixas na loja (lojas.config_escada.atacado) — preço por peça =
// custo da peça × multiplicador da faixa (centavos), com trava: nunca abaixo
// do mínimo aceitável por peça (margem mínima da loja + % do canal, e o lucro
// mínimo por peça da faixa de atacado). Abaixo da 1ª faixa = varejo direto.
// Personalização: arte/preparação (fixo por pedido, isenta a partir de N
// peças se ligado) + adicional por peça (0 quando não aumenta tempo).

export const ATACADO_PADRAO = {
  faixas: [
    { min: 10, mult: 2.0 },
    { min: 50, mult: 1.8 },
    { min: 100, mult: 1.6 },
  ],
  lucroMinPeca: 0, // R$ por peça (0 = só a margem mínima)
  arte: 20, // R$ por pedido
  porPeca: 0.5, // R$ por peça personalizada
  isentarArte: false,
  isentarArteMin: 100,
};

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const centavos = (v) => Math.round(v * 100) / 100;
const centavosAcima = (v) => Math.ceil(v * 100 - 1e-6) / 100;

// Config da loja mesclada com o padrão (faixas válidas, em ordem).
export function configAtacado(configLoja) {
  const a = { ...ATACADO_PADRAO, ...(configLoja?.atacado || {}) };
  const faixas = (Array.isArray(a.faixas) && a.faixas.length ? a.faixas : ATACADO_PADRAO.faixas)
    .map((f) => ({ min: Math.round(num(f.min)), mult: num(f.mult) }))
    .filter((f) => f.min > 0 && f.mult > 0)
    .sort((x, y) => x.min - y.min);
  return { ...a, faixas: faixas.length ? faixas : ATACADO_PADRAO.faixas, arte: num(a.arte), porPeca: num(a.porPeca), lucroMinPeca: num(a.lucroMinPeca), isentarArte: !!a.isentarArte, isentarArteMin: Math.round(num(a.isentarArteMin)) || 100 };
}

// Faixa em que a quantidade cai (null = abaixo da 1ª → varejo direto).
export function faixaAtacado(qtd, cfgA) {
  let f = null;
  for (const x of cfgA.faixas) if (num(qtd) >= x.min) f = x;
  return f;
}
export function proximaFaixa(qtd, cfgA) {
  return cfgA.faixas.find((x) => x.min > num(qtd)) || null;
}
// "10–49 un." / "100+ un."
export function rotuloFaixa(f, cfgA) {
  const i = cfgA.faixas.indexOf(f);
  const prox = cfgA.faixas[i + 1];
  return prox ? `${f.min}–${prox.min - 1} un.` : `${f.min}+ un.`;
}

// Preço por peça numa faixa: custo × mult, nunca abaixo do mínimo por peça.
// totalPct = imposto + custos fixos (+ comissão) do pedido; margemMin da loja.
export function precoPecaAtacado(custoPeca, faixa, { margemMin = 0, totalPct = 0, lucroMinPeca = 0 } = {}) {
  const c = num(custoPeca);
  if (!(c > 0) || !faixa) return null;
  const base = centavos(c * faixa.mult);
  const den = 1 - num(margemMin) - num(totalPct);
  const minMargem = den > 0 ? c / den : Infinity;
  const minLucro = num(lucroMinPeca) > 0 ? (c + num(lucroMinPeca)) / Math.max(0.01, 1 - num(totalPct)) : 0;
  const minimo = centavosAcima(Math.max(minMargem, minLucro));
  return base >= minimo ? { preco: base, travado: false, minimo } : { preco: minimo, travado: true, minimo };
}

// Personalização do pedido: adicional por peça + arte (isenta a partir de N).
export function personalizacaoDoPedido(pecas, p) {
  if (!p?.ativa) return { adicional: 0, arte: 0, arteIsenta: false };
  const pc = num(pecas);
  const arteIsenta = !!p.isentarArte && pc >= num(p.isentarArteMin);
  return { adicional: centavos(num(p.porPeca) * pc), arte: arteIsenta ? 0 : centavos(num(p.arte)), arteIsenta };
}

// Orçamento de um pedido direto (Encomenda em volume). linhas = [{ id, nome,
// custo (por unidade, sem frete), qtd }]. A faixa é pelo TOTAL de peças do
// pedido; abaixo da 1ª faixa cada linha usa o varejo direto (varejoDe(linha) →
// valor total da linha, mesma conta do canal próprio em markup). Frete do
// pedido é repassado (entra no total, não no lucro); personalização e arte
// entram no total e no lucro (sem custo de material), descontado o % do pedido.
export function orcarPedido({ linhas, cfgA, totalPct = 0, margemMin = 0, pers = null, frete = 0, varejoDe }) {
  const validas = (linhas || []).filter((l) => num(l.qtd) > 0 && num(l.custo) >= 0);
  const pecas = validas.reduce((s, l) => s + num(l.qtd), 0);
  if (!(pecas > 0)) return null;
  const faixa = faixaAtacado(pecas, cfgA);
  const opts = { margemMin, totalPct, lucroMinPeca: cfgA.lucroMinPeca };
  const porLinha = validas.map((l) => {
    if (faixa) {
      const r = precoPecaAtacado(l.custo, faixa, opts);
      const peca = r ? r.preco : 0;
      return { ...l, precoPeca: peca, subtotal: centavos(peca * num(l.qtd)), travado: !!r?.travado, varejo: false };
    }
    const sub = num(varejoDe?.(l)) || 0;
    return { ...l, precoPeca: sub / num(l.qtd), subtotal: centavos(sub), travado: false, varejo: true };
  });
  const valorPecas = centavos(porLinha.reduce((s, l) => s + l.subtotal, 0));
  const custo = porLinha.reduce((s, l) => s + num(l.custo) * num(l.qtd), 0);
  const p = personalizacaoDoPedido(pecas, pers);
  const receita = valorPecas + p.adicional + p.arte;
  const total = centavos(receita + num(frete));
  const lucro = receita * (1 - num(totalPct)) - custo;
  return { pecas, faixa, linhas: porLinha, valorPecas, custo, personalizacao: p.adicional, arte: p.arte, arteIsenta: p.arteIsenta, frete: num(frete), total, lucro, margem: receita > 0 ? lucro / receita : null };
}

// Preço médio por peça do mesmo pedido numa faixa (pra tabela e "próxima faixa").
export function precoMedioNaFaixa(linhas, faixa, opts) {
  let soma = 0;
  let q = 0;
  for (const l of linhas || []) {
    const r = precoPecaAtacado(l.custo, faixa, opts);
    if (!r) continue;
    soma += r.preco * num(l.qtd);
    q += num(l.qtd);
  }
  return q > 0 ? soma / q : null;
}
