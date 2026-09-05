// Lógica de custo e precificação — mesma validada na planilha "Precificador Ohra 2.0"
// e no protótipo Claude. Mantida como funções puras para ser fácil de testar.

export const FILAMENTOS = [
  { nome: "ABS Comum", preco: 99 },
  { nome: "ABS barato", preco: 68 },
  { nome: "Nylon", preco: 320 },
  { nome: "PETG", preco: 90 },
  { nome: "ABS Wood", preco: 150 },
  { nome: "PLA (seu custo real)", preco: 90.16 },
];

export const SHOPEE_TIERS = [
  { label: "Até R$79,99", min: 0, max: 79.99, pct: 0.2, fixo: 4 },
  { label: "R$80,00–99,99", min: 80, max: 99.99, pct: 0.14, fixo: 16 },
  { label: "R$100,00–199,99", min: 100, max: 199.99, pct: 0.14, fixo: 20 },
  { label: "Acima de R$200,00", min: 200, max: 9999999, pct: 0.14, fixo: 26 },
];

export const ML_CATEGORY_PCT = { "Casa & Decoração": 0.13, Beleza: 0.135 };

export const ML_FEE_TIERS = [
  { label: "R$10,00–20,00", min: 10, max: 20, fixo: 5.5 },
  { label: "R$20,01–78,99", min: 20.01, max: 78.99, fixo: 6.0 },
  { label: "A partir de R$79,00 (frete grátis obrigatório)", min: 79, max: 9999999, fixo: 0.0 },
];

export function calcProducao(i) {
  const peso = Math.PI * Math.pow(i.diametro / 2, 2) * i.comprimento * i.densidade;
  const material = (i.precoKg / 1000) * peso;
  const energia = ((i.kwh / 1000) * i.consumo) * (i.tempo / 60);
  const manutencao = material * 0.15;
  const falhas = material * i.falhasPct;
  const acabamento = material * 0.1;
  const roiHora = i.maquina / ((i.horasDia * i.diasMes * i.prazoMeses) || 1);
  const roiPeca = (roiHora / 60) * i.tempo;
  const total = material + energia + manutencao + falhas + acabamento + i.fixacao + roiPeca + i.modelagem;
  const precoRapido = total * (1 + i.markupRapido);
  return { peso, material, energia, manutencao, falhas, acabamento, roiPeca, total, precoRapido };
}

// comissao/fixo já resolvidos (pct 0-1, fixo em R$); min/max só existem quando a faixa é conhecida (Shopee/ML)
export function calcCanal({ imposto, comissaoPct, taxaFixa, custosFixosPct, lucratividadePct, custoProduto, frete, embalagem, min, max }) {
  const custoTotal = custoProduto + frete + embalagem;
  const totalPct = imposto + comissaoPct + custosFixosPct;
  const markup = 1 / (1 - (totalPct + lucratividadePct));
  const preco = (custoTotal + taxaFixa) * markup;
  const lucro = preco * (1 - totalPct) - taxaFixa - custoTotal;
  const margem = lucro / preco;
  const faixaOk = min == null ? null : preco >= min && preco <= max;
  const lucroEm = (p) => (p > 0 ? p * (1 - totalPct) - taxaFixa - custoTotal : null);
  return { custoTotal, totalPct, markup, preco, lucro, margem, faixaOk, lucroEm };
}
