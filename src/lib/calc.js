// Lógica de custo e precificação — mesma validada na planilha "Precificador Ohra 2.0"
// e no protótipo Claude. Mantida como funções puras para ser fácil de testar.
import { totalItens } from "../components/SeletorItens.jsx";

// Faixas oficiais Shopee (vendedor CNPJ) — conferido em 27/09/2026 direto no
// artigo oficial "Política de Comissão para vendedores CNPJ e CPF"
// (seller.shopee.com.br/edu/article/26839, atualizado 18/09/2026): a partir
// de 01/10/2026 o fixo até R$79,99 sobe de R$4,00 pra R$4,50 (já aplicado —
// preço definido agora vale pras vendas de outubro em diante) e acima de
// R$500 o fixo é R$26. Abaixo de R$9 o adicional vira metade do preço
// (tratado em resolverTaxasNoPreco). Não modela o adicional de R$3/item pra
// vendedor CPF com mais de 450 pedidos em 90 dias.
export const SHOPEE_TIERS = [
  { label: "Até R$79,99", min: 0, max: 79.99, pct: 0.2, fixo: 4.5 },
  { label: "R$80,00–99,99", min: 80, max: 99.99, pct: 0.14, fixo: 16 },
  { label: "R$100,00–199,99", min: 100, max: 199.99, pct: 0.14, fixo: 20 },
  { label: "R$200,00–499,99", min: 200, max: 499.99, pct: 0.14, fixo: 26 },
  { label: "Acima de R$500,00", min: 500, max: 9999999, pct: 0.14, fixo: 26 },
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

// Mercado Livre: desde 02/03/2026 NÃO existe mais taxa fixa por venda — toda
// venda paga a tarifa % da categoria + o "custo dos Envios", que depende do
// PESO (embalagem final) e da FAIXA DE PREÇO, mesmo quando o comprador paga o
// frete (abaixo de R$79 inclui o frete grátis padrão; a partir de R$79 inclui
// o frete grátis rápido obrigatório). Tabela oficial conferida em 27/09/2026
// em mercadolivre.com.br/ajuda/custos-envio-reputacao-verde-mercado-lider_40538
// (MercadoLíder, reputação verde ou sem reputação — já com o desconto da
// reputação verde; envios Full/Coleta/Agências). Produtos abaixo de R$19
// pagam no máximo metade do preço. Kit vendido como um anúncio paga UM custo.
export const ML_ENVIO_FAIXAS_PRECO = [
  { label: "R$0–18,99", min: 0, max: 18.99 },
  { label: "R$19–48,99", min: 19, max: 48.99 },
  { label: "R$49–78,99", min: 49, max: 78.99 },
  { label: "R$79–99,99", min: 79, max: 99.99 },
  { label: "R$100–119,99", min: 100, max: 119.99 },
  { label: "R$120–149,99", min: 120, max: 149.99 },
  { label: "R$150–199,99", min: 150, max: 199.99 },
  { label: "A partir de R$200", min: 200, max: 9999999 },
];
// [peso máximo em kg, valores por faixa de preço (mesma ordem acima)]
export const ML_ENVIO_TABELA = [
  [0.3, [5.65, 6.85, 8.15, 12.95, 14.95, 16.95, 19.05, 21.65]],
  [0.5, [5.95, 6.95, 8.25, 13.85, 16.15, 18.15, 20.45, 23.25]],
  [1, [6.05, 7.15, 8.45, 14.45, 16.85, 19.05, 21.35, 24.45]],
  [1.5, [6.15, 7.35, 8.65, 14.75, 17.15, 19.45, 21.75, 25.45]],
  [2, [6.25, 7.45, 8.75, 15.05, 17.65, 19.85, 22.25, 25.55]],
  [3, [6.35, 8.65, 9.15, 16.45, 19.15, 21.65, 24.35, 27.05]],
  [4, [6.45, 8.75, 9.75, 17.85, 20.75, 23.35, 26.35, 29.25]],
  [5, [6.55, 8.85, 10.25, 19.75, 22.85, 26.05, 29.25, 32.45]],
  [6, [6.65, 8.95, 10.35, 25.95, 29.15, 33.35, 36.45, 40.85]],
  [7, [6.75, 9.05, 10.45, 27.55, 31.65, 36.75, 40.85, 45.25]],
  [8, [6.85, 9.25, 10.55, 29.45, 34.35, 39.25, 44.15, 49.35]],
  [9, [6.95, 9.35, 10.65, 30.25, 35.25, 40.35, 45.35, 50.75]],
  [10, [7.05, 9.45, 10.85, 38.25, 45.05, 51.95, 58.75, 65.85]],
  [11, [7.05, 9.65, 11.05, 41.65, 48.55, 55.45, 62.35, 69.35]],
  [13, [7.15, 10.05, 11.45, 42.55, 49.75, 56.85, 63.85, 70.95]],
  [15, [7.25, 10.25, 11.65, 45.55, 52.95, 60.55, 68.15, 75.65]],
  [17, [7.35, 10.45, 11.85, 48.95, 56.55, 64.05, 71.35, 79.35]],
  [20, [7.45, 10.65, 12.05, 55.15, 64.35, 73.55, 82.75, 91.95]],
  [25, [7.65, 11.05, 12.25, 64.55, 75.75, 85.45, 96.25, 106.85]],
  [30, [7.75, 11.25, 12.45, 66.45, 76.05, 86.25, 97.15, 107.85]],
];
// Sem peso cadastrado, o app assume a faixa mais leve (até 0,3 kg) e avisa.
export const ML_PESO_PADRAO_G = 300;

export function custoEnvioML(pesoG, preco) {
  const kg = Number(pesoG) > 0 ? Number(pesoG) / 1000 : ML_PESO_PADRAO_G / 1000;
  const linha = ML_ENVIO_TABELA.find(([max]) => kg <= max) || ML_ENVIO_TABELA[ML_ENVIO_TABELA.length - 1];
  const p = Number(preco) || 0;
  let idx = ML_ENVIO_FAIXAS_PRECO.findIndex((f) => p >= f.min && p <= f.max);
  if (idx < 0) idx = p < 19 ? 0 : ML_ENVIO_FAIXAS_PRECO.length - 1;
  const v = linha[1][idx];
  return p > 0 && p < 19 ? Math.min(v, p / 2) : v;
}

// Faixas do ML no formato das outras (min/max/fixo) pra um peso — o "fixo" é
// o custo dos Envios daquela faixa de preço.
export function mlFaixas(pesoG) {
  return ML_ENVIO_FAIXAS_PRECO.map((f) => ({ label: f.label, min: f.min, max: f.max, fixo: custoEnvioML(pesoG, f.min > 0 ? f.min : 18.99) }));
}
// Compatibilidade: faixas pro peso padrão (até 0,3 kg).
export const ML_FEE_TIERS = mlFaixas(ML_PESO_PADRAO_G);

// Taxas do TikTok Shop Brasil vigentes desde 15/jul/2026 — só duas faixas,
// definidas pelo preço do item já com desconto aplicado (não por categoria).
export const TIKTOK_TIERS = [
  { label: "Abaixo de R$50,00", min: 0, max: 49.99, pct: 0.1, fixo: 4 },
  { label: "A partir de R$50,00", min: 50, max: 9999999, pct: 0.06, fixo: 6 },
];

// Comissão da Shein Marketplace Brasil — conferida em 27/09/2026 direto na
// página oficial br.shein.com/SHEIN-Commission-Policy-a-1420.html: "Outras
// Categorias — pedidos criados após 1º de março de 2026: taxa ajustada de 16%
// para 18%" (vestuário feminino é 20%, irrelevante pra impressos em 3D). Sem
// taxa fixa por venda e sem variação por faixa de preço.
export const SHEIN_TIERS = [{ label: "Padrão (todas as faixas de preço)", min: 0, max: 9999999, pct: 0.18, fixo: 0 }];

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

// Custo de produção por peça de um produto JÁ CADASTRADO (com detalhamento
// salvo), recalculado ao vivo com o preço ATUAL do material — mesma fórmula
// usada em Produtos.jsx e Custo de Produção, só que reaproveitável por
// qualquer tela que precise só do número final (ex: Registro de Impressões).
// Retorna null se o produto não tiver detalhamento de produção salvo.
export function custoProdutoPorPeca(produto, materiais) {
  const detalhe = produto?.producao_detalhe;
  if (!detalhe) return null;
  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const filamentos = (materiais || []).filter((m) => (m.tipo || "filamento") === "filamento");
  const material = filamentos.find((m) => m.nome === detalhe.materialNome) || filamentos[0] || null;
  const consumiveisCatalogo = (materiais || [])
    .filter((m) => m.tipo === "consumivel")
    .map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));
  const custoConsumiveis = totalItens(consumiveisCatalogo, detalhe.consumiveisItens || []);
  return calcProducao({
    comprimento: n(detalhe.comprimento),
    diametro: n(detalhe.diametro),
    densidade: n(detalhe.densidade),
    tempo: n(detalhe.tempo),
    precoKg: material?.preco ?? 0,
    kwh: n(detalhe.kwh),
    consumo: n(detalhe.consumo),
    falhasPct: n(detalhe.falhasPct) / 100,
    manutencaoPct: n(detalhe.manutencaoPct) / 100,
    acabamentoPct: n(detalhe.acabamentoPct) / 100,
    consumiveis: custoConsumiveis,
    maquina: n(detalhe.maquina),
    prazoMeses: n(detalhe.prazoMeses),
    horasDia: n(detalhe.horasDia),
    diasMes: n(detalhe.diasMes),
    modelagem: n(detalhe.modelagem),
    markupRapido: 0,
    pecasPorPlaca: n(produto.pecas_por_impressao) || 1,
  });
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
// Faixas pra CALCULAR preço (não pra exibir): inclui o trecho de item barato,
// onde o adicional é metade do preço (entra como +50% de comissão, sem fixo).
function faixasCalculoShopee() {
  const [primeira, ...resto] = SHOPEE_TIERS;
  return [{ label: "Abaixo de R$9 (adicional = metade do preço)", min: 0, max: 8.99, pct: primeira.pct + 0.5, fixo: 0 }, { ...primeira, min: 9 }, ...resto];
}
function faixasCalculoML(pesoG) {
  const faixas = mlFaixas(pesoG);
  const f0 = faixas[0];
  const corte = Math.min(18.99, 2 * f0.fixo);
  // abaixo de R$19 o ML cobra no máx. metade do preço: até 2× o valor da tabela é proporcional
  return [{ label: `${f0.label} (metade do preço)`, min: 0, max: corte - 0.01, fixo: 0, meiaPreco: true }, { ...f0, min: corte }, ...faixas.slice(1)];
}

export function resolverFaixaShopee(base) {
  for (const tier of faixasCalculoShopee()) {
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
export function resolverFaixaML(categoria, base, tipoAnuncio = "classico", pesoG = null) {
  const pcts = ML_CATEGORY_PCT[categoria] ?? { classico: 0.13, premium: 0.18 };
  const comissaoPct = tipoAnuncio === "premium" ? pcts.premium : pcts.classico;
  const faixas = faixasCalculoML(pesoG);
  for (const tier of faixas) {
    const resultado = calcCanal({ ...base, comissaoPct: comissaoPct + (tier.meiaPreco ? 0.5 : 0), taxaFixa: tier.fixo, min: tier.min, max: tier.max });
    if (resultado.faixaOk) return { tier, resultado };
  }
  const tier = faixas[faixas.length - 1];
  return { tier, resultado: calcCanal({ ...base, comissaoPct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Única fonte da comissão/taxa fixa da Shein (faixa única, sem categoria) —
// qualquer lugar que precise só do valor "cru" (sem montar um preço via
// calcCanal) chama isso em vez de indexar SHEIN_TIERS[0] direto, pra não
// duplicar a mesma faixa espalhada pelos componentes (Precificação por
// Canal, resolverFaixaShein logo abaixo, resolverTaxasNoPreco).
export function resolverTaxasShein() {
  return SHEIN_TIERS[0];
}

// Shein: uma faixa só, sem categoria — resolve trivial, mas mantido no
// mesmo formato de resolverFaixaX pra encaixar direto onde os outros três
// já são usados (Ranking, Comparativo, Promoções, Taxas Marketplace).
export function resolverFaixaShein(base) {
  const tier = resolverTaxasShein();
  return { tier, resultado: calcCanal({ ...base, comissaoPct: tier.pct, taxaFixa: tier.fixo, min: tier.min, max: tier.max }) };
}

// Comissão/taxa fixa que REALMENTE valem pra um preço já definido (editado à
// mão, com desconto aplicado, preço de um kit/combo etc.) — as resolverFaixaX
// acima acham a faixa a partir do preço TEÓRICO (calculado por custo + margem
// desejada); reaproveitar esse totalPct/taxaFixa (via `.lucroEm(outroPreco)`)
// só dá o resultado certo se os dois preços caírem na MESMA faixa. Shopee, ML
// e TikTok têm comissão e/ou taxa fixa diferentes por faixa de preço final —
// essa função acha a faixa certa pro preço informado, não pra um preço
// diferente calculado antes. Shein tem faixa única (16%, sem taxa fixa) —
// sem risco de cair na faixa errada, mas ainda assim resolvida aqui (e não
// deixada pro "usa a taxa fixa do canal") porque o canal Shein cadastrado
// não guarda comissao_pct/taxa_fixa na tabela `canais` (esses campos só
// existem de verdade pra canal "custom" — Shein usa SHEIN_TIERS direto,
// igual Shopee/ML/TikTok, ver useRankingData.js); devolver null aqui fazia
// `resultadoNoPreco` cair no fallback `canal?.comissao_pct || 0`, ou seja,
// 0% de comissão pra Shein em qualquer lugar que reavalie um preço (clonar
// preço pra outro canal, Promoções, editar preço em Preços por Canal). Só
// canal customizado de verdade não tem faixa nenhuma — devolve null só pra
// esse (quem chama usa a taxa fixa cadastrada no próprio canal).
export function resolverTaxasNoPreco(canalTipo, preco, mlCategoria, mlTipoAnuncio = "classico", pesoG = null) {
  if (canalTipo === "shopee") {
    const tier = SHOPEE_TIERS.find((t) => preco >= t.min && preco <= t.max) || SHOPEE_TIERS[SHOPEE_TIERS.length - 1];
    // abaixo de R$9 o adicional por item é metade do preço (regra oficial)
    return { comissaoPct: tier.pct, taxaFixa: preco > 0 && preco < 9 ? Math.min(tier.fixo, preco / 2) : tier.fixo };
  }
  if (canalTipo === "ml") {
    const pcts = ML_CATEGORY_PCT[mlCategoria] ?? { classico: 0.13, premium: 0.18 };
    return { comissaoPct: mlTipoAnuncio === "premium" ? pcts.premium : pcts.classico, taxaFixa: custoEnvioML(pesoG, preco) };
  }
  if (canalTipo === "tiktok") {
    const tier = TIKTOK_TIERS.find((t) => preco >= t.min && preco <= t.max) || TIKTOK_TIERS[TIKTOK_TIERS.length - 1];
    return { comissaoPct: tier.pct, taxaFixa: tier.fixo };
  }
  if (canalTipo === "shein") {
    const tier = resolverTaxasShein();
    return { comissaoPct: tier.pct, taxaFixa: tier.fixo };
  }
  return null;
}

// Lucro/margem de um preço já definido, com a faixa certa pra ESSE preço (ver
// resolverTaxasNoPreco) — usar no lugar de `.lucroEm(outroPreco)` sempre que o
// preço avaliado pode ser bem diferente do preço que resolveu a faixa
// original (desconto grande, kit com várias unidades, preço editado à mão…).
// `canal` só precisa ter `.tipo` e, quando for canal customizado, `comissao_pct`/`taxa_fixa`.
export function resultadoNoPreco(canal, base, preco, mlCategoria, mlTipoAnuncio = "classico", pesoG = null) {
  if (!(preco > 0)) return null;
  const taxas = resolverTaxasNoPreco(canal?.tipo, preco, mlCategoria, mlTipoAnuncio, pesoG);
  const comissaoPct = taxas ? taxas.comissaoPct : canal?.comissao_pct || 0;
  const taxaFixa = taxas ? taxas.taxaFixa : canal?.taxa_fixa || 0;
  const totalPct = (base.imposto || 0) + comissaoPct + (base.custosFixosPct || 0);
  const custoTotal = base.custoProduto + base.frete + base.embalagem;
  const lucro = preco * (1 - totalPct) - taxaFixa - custoTotal;
  const margem = preco > 0 ? lucro / preco : null;
  return { preco, lucro, margem, comissaoPct, taxaFixa, totalPct, custoTotal };
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

// Reserva de produção por peça (falhas + manutenção + acabamento) — já está
// DENTRO do custo de produção; o app só mostra quanto é, pra no fechamento do
// mês separar esse valor num fundo (lote perdido, peças da máquina, lixa/tinta).
// Não muda preço. null se o produto não tiver detalhamento do Custo de Produção.
export function reservaProducao(produto, materiais) {
  const r = custoProdutoPorPeca(produto, materiais);
  if (!r) return null;
  const falhas = Number(r.falhas) || 0;
  const manutencao = Number(r.manutencao) || 0;
  const acabamento = Number(r.acabamento) || 0;
  return { falhas, manutencao, acabamento, total: falhas + manutencao + acabamento };
}
