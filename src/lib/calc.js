// Lógica de custo e precificação — mesma validada na planilha "Precificador Ohra 2.0"
// e no protótipo Claude. Mantida como funções puras para ser fácil de testar.

// Faixas oficiais Shopee (vendedor CNPJ) vigentes desde 01/03/2026 — validado
// em 06/09/2026 contra o artigo oficial do Centro de Educação do Vendedor
// (seller.shopee.com.br) e duas fontes independentes que reproduzem a mesma
// tabela. Não modela o caso raro de itens abaixo de R$8 (nesse caso o
// "adicional" vira metade do preço do item em vez do fixo de R$4 — irrelevante
// pra produtos impressos em 3D, que dificilmente vendem abaixo de R$8) nem o
// adicional de R$3/item pra vendedor CPF com mais de 450 pedidos em 90 dias.
export const SHOPEE_TIERS = [
  { label: "Até R$79,99", min: 0, max: 79.99, pct: 0.2, fixo: 4 },
  { label: "R$80,00–99,99", min: 80, max: 99.99, pct: 0.14, fixo: 16 },
  { label: "R$100,00–199,99", min: 100, max: 199.99, pct: 0.14, fixo: 20 },
  { label: "R$200,00–499,99", min: 200, max: 499.99, pct: 0.14, fixo: 26 },
  { label: "Acima de R$500,00", min: 500, max: 9999999, pct: 0.14, fixo: 28 },
];

// Comissão por categoria no Mercado Livre — oficialmente Clássico varia de 10%
// a 14% e Premium de 15% a 19% dependendo da categoria (mercadolivre.com.br/
// ajuda/quanto-custa-vender-um-produto_1338, validado 06/09/2026). Os valores
// abaixo são os percentuais específicos de "Casa, Móveis e Decoração" (onde
// produtos impressos em 3D tipicamente se encaixam); "Beleza" fica de fora
// dessa validação oficial e mantém uma estimativa dentro da faixa divulgada.
export const ML_CATEGORY_PCT = {
  "Casa & Decoração": { classico: 0.13, premium: 0.18 },
  Beleza: { classico: 0.135, premium: 0.185 },
};

// Taxa fixa por venda de baixo valor — validado 06/09/2026 contra fonte
// oficial (mercadolivre.com.br) e confirmado por fontes independentes: os
// valores batem exatamente com o que já estava aqui. Observação: desde
// março/2026 esse valor pode variar por peso/dimensão do produto conforme o
// tipo logístico — não modelado aqui por falta desse dado no cadastro.
export const ML_FEE_TIERS = [
  { label: "R$10,00–20,00", min: 10, max: 20, fixo: 5.5 },
  { label: "R$20,01–78,99", min: 20.01, max: 78.99, fixo: 6.0 },
  { label: "A partir de R$79,00 (frete grátis obrigatório)", min: 79, max: 9999999, fixo: 0.0 },
];

// Taxas do TikTok Shop Brasil vigentes desde 15/jul/2026 — só duas faixas,
// definidas pelo preço do item já com desconto aplicado (não por categoria).
export const TIKTOK_TIERS = [
  { label: "Abaixo de R$50,00", min: 0, max: 49.99, pct: 0.1, fixo: 4 },
  { label: "A partir de R$50,00", min: 50, max: 9999999, pct: 0.06, fixo: 6 },
];

// Comissão da Shein Marketplace Brasil — validada em 07/09/2026 contra três
// fontes independentes (a página oficial de política de comissão da Shein
// devolveu erro de acesso na hora da validação, vale reconferir depois em
// br.shein.com/SHEIN-Commission-Policy-a-1420.html): comissão padrão de 16%
// sobre o valor final da venda, sem taxa fixa por venda e sem diferenciação
// por categoria pra produtos fora de vestuário (algumas categorias de moda
// chegam a ~20%, irrelevante pra produtos impressos em 3D). Só uma faixa —
// bem mais simples que Shopee/ML/TikTok.
export const SHEIN_TIERS = [{ label: "Padrão (todas as faixas de preço)", min: 0, max: 9999999, pct: 0.16, fixo: 0 }];

// Valores padrão dos campos de Custo de Produção — usados tanto na primeira
// vez que a aba abre quanto quando alguém preenche o detalhamento de um
// produto antigo que foi cadastrado sem essa informação (ver Produtos.jsx).
export const DEFAULTS_PRODUCAO = {
  comprimento: 5,
  diametro: 1.75,
  densidade: 1.24,
  tempo: 35,
  kwh: 1.05,
  consumo: 350,
  falhasPct: 10,
  manutencaoPct: 15,
  acabamentoPct: 10,
  consumiveisItens: [],
  maquina: 3198,
  prazoMeses: 12,
  horasDia: 6,
  diasMes: 26,
  modelagem: 0,
};

// Quando "Peças por placa" (pecasPorPlaca) é maior que 1, comprimento e
// tempo de impressão são tratados como o TOTAL gasto pra imprimir a chapa
// inteira de uma vez (várias peças juntas, aproveitando o espaço da mesa) —
// daí o custo de material/energia/manutenção/falhas/acabamento/ROI da
// chapa é dividido pelo número de peças pra chegar no custo de cada uma.
// Consumíveis e modelagem continuam por peça (já têm sua própria
// quantidade em SeletorItens), não entram nessa divisão.
export function calcProducao(i) {
  const pecas = Math.max(1, Number(i.pecasPorPlaca) || 1);
  const pesoChapa = Math.PI * Math.pow(i.diametro / 2, 2) * i.comprimento * i.densidade;
  const materialChapa = (i.precoKg / 1000) * pesoChapa;
  const energiaChapa = ((i.kwh / 1000) * i.consumo) * (i.tempo / 60);
  const manutencaoChapa = materialChapa * (i.manutencaoPct ?? 0.15);
  const falhasChapa = materialChapa * i.falhasPct;
  const acabamentoChapa = materialChapa * (i.acabamentoPct ?? 0.1);
  const roiHora = i.maquina / ((i.horasDia * i.diasMes * i.prazoMeses) || 1);
  const roiPecaChapa = (roiHora / 60) * i.tempo;
  const peso = pesoChapa / pecas;
  const material = materialChapa / pecas;
  const energia = energiaChapa / pecas;
  const manutencao = manutencaoChapa / pecas;
  const falhas = falhasChapa / pecas;
  const acabamento = acabamentoChapa / pecas;
  const roiPeca = roiPecaChapa / pecas;
  const total = material + energia + manutencao + falhas + acabamento + i.consumiveis + roiPeca + i.modelagem;
  const precoRapido = total * (1 + i.markupRapido);
  return { peso, material, energia, manutencao, falhas, acabamento, roiPeca, total, precoRapido };
}

// comissao/fixo já resolvidos (pct 0-1, fixo em R$); min/max só existem quando a faixa é conhecida (Shopee/ML)
export function calcCanal({ imposto, comissaoPct, taxaFixa, custosFixosPct, lucratividadePct, custoProduto, frete, embalagem, min, max }) {
  const custoTotal = custoProduto + frete + embalagem;
  const totalPct = imposto + comissaoPct + custosFixosPct;
  // Se comissão + imposto + custos fixos + lucratividade desejada passar de
  // 100%, não existe preço que feche a conta — vira "—" na tela em vez de um
  // preço negativo sem aviso.
  const denom = 1 - (totalPct + lucratividadePct);
  const markup = denom > 0 ? 1 / denom : null;
  const preco = markup != null ? (custoTotal + taxaFixa) * markup : null;
  const lucro = preco != null ? preco * (1 - totalPct) - taxaFixa - custoTotal : null;
  const margem = preco != null && preco > 0 ? lucro / preco : null;
  const faixaOk = min == null ? null : preco != null && preco >= min && preco <= max;
  const lucroEm = (p) => (p > 0 ? p * (1 - totalPct) - taxaFixa - custoTotal : null);
  return { custoTotal, totalPct, markup, preco, lucro, margem, faixaOk, lucroEm };
}

// Anúncio patrocinado (Shopee Ads / Mercado Ads): o preço no anúncio não muda,
// só o lucro daquela venda específica cai pelo % investido em Ads sobre o preço.
export function aplicarAds(resultadoCanal, adsPct) {
  const pct = adsPct || 0;
  const custoAds = resultadoCanal.preco * pct;
  const lucroComAds = resultadoCanal.lucro - custoAds;
  const margemComAds = resultadoCanal.preco > 0 ? lucroComAds / resultadoCanal.preco : null;
  return { custoAds, lucroComAds, margemComAds };
}

// Testa as faixas da Shopee em ordem e fica com a primeira que "fecha"
// (preço calculado cai dentro da própria faixa usada pra calcular).
export function resolverFaixaShopee(base) {
  for (const tier of SHOPEE_TIERS) {
    const resultado = calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max });
    if (resultado.faixaOk) return { tier, resultado };
  }
  const tier = SHOPEE_TIERS[SHOPEE_TIERS.length - 1];
  return { tier, resultado: calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Mesma ideia pro TikTok Shop — só duas faixas, sem categoria.
export function resolverFaixaTikTok(base) {
  for (const tier of TIKTOK_TIERS) {
    const resultado = calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max });
    if (resultado.faixaOk) return { tier, resultado };
  }
  const tier = TIKTOK_TIERS[TIKTOK_TIERS.length - 1];
  return { tier, resultado: calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Mesma ideia para o Mercado Livre, dada a categoria e o tipo de anúncio
// (Clássico ou Premium — Premium cobra mais mas permite parcelamento sem
// juros pro comprador).
export function resolverFaixaML(categoria, base, tipoAnuncio = "classico") {
  const pcts = ML_CATEGORY_PCT[categoria] ?? { classico: 0.13, premium: 0.18 };
  const comissaoPct = tipoAnuncio === "premium" ? pcts.premium : pcts.classico;
  for (const tier of ML_FEE_TIERS) {
    const resultado = calcCanal({ ...base, comissaoPct, taxaFixa: tier.fixo, min: tier.min, max: tier.max });
    if (resultado.faixaOk) return { tier, resultado };
  }
  const tier = ML_FEE_TIERS[ML_FEE_TIERS.length - 1];
  return { tier, resultado: calcCanal({ ...base, comissaoPct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Shein: uma faixa só, sem categoria — resolve trivial, mas mantido no
// mesmo formato de resolverFaixaX pra encaixar direto onde os outros três
// já são usados (Ranking, Promoções, Produtos, Taxas Marketplace).
export function resolverFaixaShein(base) {
  const tier = SHEIN_TIERS[0];
  return { tier, resultado: calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Canal customizado (Site Próprio, TikTok Shop etc.): comissão/taxa fixas, sem faixas.
export function calcCanalCustom(canal, base) {
  return calcCanal({
    ...base,
    comissaoPct: canal.comissao_pct || 0,
    taxaFixa: canal.taxa_fixa || 0,
    min: null,
    max: null,
  });
}
