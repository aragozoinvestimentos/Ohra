// Preço por quantidade ("escada") e anúncio nas plataformas — lógica pura.
//
// Regra (combinada com o Gustavo, set/2026):
// - O avulso (1 un.) é escolha dele. Os kits/variações são SUGERIDOS a
//   partir do LUCRO POR PEÇA: o kit 2 mantém `r2` (padrão 100%) do lucro por
//   peça do avulso — toda a economia de taxa fixa/embalagem/frete vai pro
//   cliente —, o kit 10 mantém `r10` (80%) e o resto segue uma curva
//   logarítmica suave entre os dois, nunca abaixo de `piso` (70%).
// - Base do lucro por peça (estratégia do preço, schema v37): avulso em
//   Atração/Crescimento escolhidos ou em rampa → o maior entre o lucro do
//   avulso e o da margem desejada (o lucro vem dos kits); Normal escolhido de
//   propósito → o lucro do próprio avulso; nada escolhido → o maior (como
//   sempre foi) e a tela só SUGERE marcar como atração.
// - Travas: o cliente sempre economiza pelo menos `vantagemMin` vs. N
//   avulsos; preço por peça sempre cai conforme a quantidade; nunca abaixo da
//   margem mínima; concorrente (se houver) é teto, mas NUNCA derruba abaixo
//   da margem mínima; se ficar logo acima de uma troca de faixa do canal e
//   descer der mais lucro, desce.
// - Tudo na faixa REAL do canal pro preço do kit (o kit é um anúncio só:
//   comissão e taxa fixa uma vez); no ML, o custo dos Envios oficial por
//   peso × faixa de preço (calc.js).
//
// "Preço real" = o que o cliente paga. É o único preço que o app mostra e
// salva; o preço original (riscado) + promo % só aparece em Anunciar.
import { SHOPEE_TIERS, ML_ENVIO_FAIXAS_PRECO, TIKTOK_TIERS, resolverTaxasNoPreco, custoEnvioML } from "./calc.js";
import { ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "./constantesCanal.js";
import { estrategiaGravada } from "./estrategia.js";

export const ESCADA_PADRAO = {
  r2: 1, // kit 2 mantém 100% do lucro/peça
  r10: 0.8, // kit 10 mantém 80%
  piso: 0.7, // nenhuma quantidade abaixo de 70%
  vantagemMin: 0.05, // cliente economiza pelo menos 5% vs N avulsos
  margemMin: 0.15,
  margemDesejada: 0.3,
  lucroMinimo: 0, // R$ por venda (0 = sem piso em reais)
  promoMinOlist: 0.1, // (antigo — Publicar/Olist; sem uso)
};

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

// Mescla config da loja + escada própria do produto (se houver) com os padrões.
export function configEscada(configLoja, configProduto) {
  const base = { ...ESCADA_PADRAO, ...(configLoja || {}) };
  if (configProduto) {
    // escada própria do produto + margens próprias (desejada, mínima, lucro mínimo em R$)
    for (const k of ["r2", "r10", "piso", "vantagemMin", "margemDesejada", "margemMin", "lucroMinimo"]) if (configProduto[k] != null && configProduto[k] !== "") base[k] = configProduto[k];
  }
  return base;
}

// ,90 pra baixo / pra cima
export const r90 = (x) => Math.floor(x + 0.1 + 1e-9) - 0.1;
export const r90up = (x) => Math.ceil(x + 0.1 - 1e-9) - 0.1;
const centavos = (v) => Math.round(v * 100) / 100;

// Pontos onde a taxa do canal muda (pra resolver preço por faixa). Inclui os
// "degraus" das regras de item barato: Shopee abaixo de R$9 e ML abaixo de
// R$19 cobram no máximo METADE do preço no lugar do fixo — nesses trechos a
// taxa é proporcional ao preço, não um valor fixo.
function limitesDoCanal(canal, pesoG) {
  const tipo = canal?.tipo;
  let mins = [0];
  if (tipo === "shopee") mins = [...SHOPEE_TIERS.map((t) => t.min), 9];
  else if (tipo === "ml") {
    const fixoBaixo = custoEnvioML(pesoG, 18.99); // valor da tabela na faixa até R$18,99
    mins = [...ML_ENVIO_FAIXAS_PRECO.map((t) => t.min), 2 * fixoBaixo < 19 ? 2 * fixoBaixo : 19];
  } else if (tipo === "tiktok") mins = TIKTOK_TIERS.map((t) => t.min);
  mins = [...new Set([0, ...mins])].sort((a, b) => a - b);
  return mins.map((lo, i) => [lo, i + 1 < mins.length ? mins[i + 1] : Infinity]);
}

// Modelo linear da taxa dentro de um trecho: taxa(p) = pctTotal·p + fixo.
function modeloDoTrecho(canal, lo, hi, pesoG, cfg) {
  const probe = isFinite(hi) ? (lo + hi) / 2 : lo + 1;
  const t = taxasNoPreco(canal, probe, pesoG, cfg);
  const meiaPreco = Math.abs(t.taxaFixa - probe / 2) < 1e-6 && ((canal?.tipo === "shopee" && probe < 9) || (canal?.tipo === "ml" && probe < 19));
  return meiaPreco ? { pct: t.totalPct + 0.5, fixo: 0 } : { pct: t.totalPct, fixo: t.taxaFixa };
}

// Taxas do canal num preço (comissão %, taxa fixa, imposto, custos fixos).
// No ML a "taxa fixa" é o custo dos Envios oficial por peso × faixa de preço
// (inclui o frete grátis a partir de R$79) — ver calc.js.
// eslint-disable-next-line no-unused-vars
export function taxasNoPreco(canal, preco, pesoG, cfg) {
  const t = resolverTaxasNoPreco(canal?.tipo, preco, ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO, pesoG);
  const comissaoPct = t ? t.comissaoPct : num(canal?.comissao_pct);
  const taxaFixa = t ? t.taxaFixa : num(canal?.taxa_fixa);
  const totalPct = comissaoPct + num(canal?.imposto_pct) + num(canal?.custos_fixos_pct);
  return { comissaoPct, taxaFixa, totalPct, envioMl: canal?.tipo === "ml" };
}

export function lucroNoPreco(canal, preco, custo, pesoG, cfg) {
  if (!(preco > 0)) return null;
  const t = taxasNoPreco(canal, preco, pesoG, cfg);
  return preco * (1 - t.totalPct) - t.taxaFixa - num(custo);
}

// Menor preço que dá pelo menos `alvo` de lucro (resolve faixa por faixa).
export function precoParaLucro(canal, alvo, custo, pesoG, cfg) {
  let melhor = null;
  for (const [lo, hi] of limitesDoCanal(canal, pesoG)) {
    const m = modeloDoTrecho(canal, lo, hi, pesoG, cfg);
    const d = 1 - m.pct;
    if (d <= 0) continue;
    const p = (num(alvo) + m.fixo + num(custo)) / d;
    const pp = Math.max(p, lo);
    if (pp < hi && (melhor == null || pp < melhor)) melhor = pp;
  }
  return melhor;
}

// Menor preço com margem ≥ m.
export function precoParaMargem(canal, m, custo, pesoG, cfg) {
  let melhor = null;
  for (const [lo, hi] of limitesDoCanal(canal, pesoG)) {
    const mt = modeloDoTrecho(canal, lo, hi, pesoG, cfg);
    const d = 1 - mt.pct - m;
    if (d <= 0) continue;
    const p = (mt.fixo + num(custo)) / d;
    const pp = Math.max(p, lo);
    if (pp < hi && (melhor == null || pp < melhor)) melhor = pp;
  }
  return melhor;
}

// Menor preço ACEITÁVEL: o maior entre o da margem mínima e o do lucro mínimo
// em R$ por venda (cfg.lucroMinimo) — o piso em reais protege os itens
// baratos, onde a % engana por causa da taxa fixa.
export function precoMinimoAceitavel(canal, custo, pesoG, cfg) {
  const pM = precoParaMargem(canal, cfg.margemMin, custo, pesoG, cfg);
  const pL = num(cfg.lucroMinimo) > 0 ? precoParaLucro(canal, num(cfg.lucroMinimo), custo, pesoG, cfg) : null;
  if (pM == null) return pL;
  if (pL == null) return pM;
  return Math.max(pM, pL);
}

// Rótulo do piso nas referências: "margem mínima (15%)" ou, com lucro mínimo
// em R$, "mínimo (15% ou R$ 4,00 de lucro)".
export function rotuloMinimo(cfg) {
  const pct = Math.round(num(cfg.margemMin) * 100);
  return num(cfg.lucroMinimo) > 0 ? `mínimo (${pct}% ou R$ ${num(cfg.lucroMinimo).toFixed(2).replace(".", ",")} de lucro)` : `margem mínima (${pct}%)`;
}

export function retencao(n, cfg) {
  if (n <= 1) return 1;
  const r = cfg.r2 + (cfg.r10 - cfg.r2) * (Math.log(n / 2) / Math.log(5));
  return Math.max(cfg.piso, Math.min(Math.max(cfg.r2, cfg.r10), r));
}

// Referências pro avulso (ao lado do campo de preço).
export function referenciasAvulso(canal, custo1, peso1, cfg, concorrente) {
  const pMargem = precoParaMargem(canal, cfg.margemDesejada, custo1, peso1, cfg);
  const pZero = precoParaMargem(canal, 0, custo1, peso1, cfg);
  const pMin = precoMinimoAceitavel(canal, custo1, peso1, cfg);
  return {
    margemDesejada: pMargem != null ? r90up(pMargem) : null,
    // ponto exato (centavo pra cima), não arredondado pra ,90 — é referência, não preço sugerido
    semPrejuizo: pZero != null ? Math.ceil(pZero * 100 - 1e-6) / 100 : null,
    margemMinima: pMin != null ? Math.ceil(pMin * 100 - 1e-6) / 100 : null,
    concorrente: num(concorrente) > 0 ? num(concorrente) : null,
    concorrenteAbaixoDoPiso: num(concorrente) > 0 && pMin != null && num(concorrente) < pMin,
  };
}

/**
 * Monta a escada de preços sugerida.
 * @param canal     canal cadastrado (tipo, imposto_pct, custos_fixos_pct, comissao_pct, taxa_fixa)
 * @param p1        preço avulso (escolhido pelo usuário)
 * @param base1     { custo, peso } do avulso
 * @param kits      [{ n, custo, peso, id?, nome?, salvo?, concorrente? }] quantidades > 1
 * @param cfg       configEscada(...)
 */
export function calcularEscada({ canal, p1, base1, kits, cfg, estrategia = null, emRampa = false }) {
  const custo1 = num(base1?.custo);
  const peso1 = num(base1?.peso);
  const preco1 = num(p1);
  const l1 = lucroNoPreco(canal, preco1, custo1, peso1, cfg) ?? 0;
  const pRef = precoParaMargem(canal, cfg.margemDesejada, custo1, peso1, cfg);
  const lRef = pRef != null ? lucroNoPreco(canal, pRef, custo1, peso1, cfg) : l1;
  const lBase = estrategia === "normal" && !emRampa ? l1 : Math.max(l1, lRef ?? l1);
  const baseRef = lBase > l1 + 0.005;
  // Por que a base é a margem desejada (pra tela explicar).
  const baseMotivo = !baseRef ? null : emRampa ? "rampa" : estrategia === "atracao" ? "atracao" : estrategia === "crescimento" ? "crescimento" : "sugerido";

  const linhas = [
    {
      n: 1,
      base: true,
      custo: custo1,
      peso: peso1,
      sugerido: preco1,
      lucro: l1,
      margem: preco1 > 0 ? l1 / preco1 : null,
      lBase,
      baseRef,
      taxas: preco1 > 0 ? taxasNoPreco(canal, preco1, peso1, cfg) : null,
    },
  ];
  let prevPP = preco1;
  let prevSug = preco1;
  let prevN = 1;
  const ordenados = [...(kits || [])].filter((k) => k.n > 1).sort((a, b) => a.n - b.n);
  for (const k of ordenados) {
    const n = k.n;
    const custo = num(k.custo);
    const peso = num(k.peso);
    const teto = n * preco1;
    const notas = [];
    const ret = retencao(n, cfg);
    const alvoLpp = ret * lBase;
    let p = precoParaLucro(canal, alvoLpp * n, custo, peso, cfg);
    p = p != null ? r90up(p) : r90(teto);
    const maxVant = r90(teto * (1 - cfg.vantagemMin));
    if (p > maxVant) {
      p = maxVant;
      notas.push(`desceu pra dar ≥${Math.round(cfg.vantagemMin * 100)}% de vantagem`);
    }
    const pMin = precoMinimoAceitavel(canal, custo, peso, cfg);
    let concorrenteAbaixoDoPiso = false;
    if (num(k.concorrente) > 0) {
      const cap = r90(num(k.concorrente) * 0.98);
      if (pMin != null && cap < pMin) concorrenteAbaixoDoPiso = true;
      else if (cap < p) {
        p = cap;
        notas.push("limitado pelo concorrente");
      }
    }
    if (p / n >= prevPP - 0.005) {
      p = r90(prevPP * n - 0.2);
      notas.push("ajustado pela escada");
    }
    const descontoCurva = teto > 0 ? (teto - p) / teto : 0;
    for (const [, hi] of limitesDoCanal(canal, peso)) {
      if (!isFinite(hi) || hi <= 0) continue;
      const b = hi - 0.01;
      if (b < p && b >= p * 0.85) {
        const cand = r90(b + 0.001);
        const lc = lucroNoPreco(canal, cand, custo, peso, cfg);
        const lp = lucroNoPreco(canal, p, custo, peso, cfg);
        if (cand < p && lc > lp + 0.5 && (teto - cand) / teto <= descontoCurva + 0.1) {
          notas.push("evita a troca de faixa do canal");
          p = cand;
        }
      }
    }
    let naoCompensa = false;
    if (pMin != null && p < pMin) {
      const np = r90up(pMin);
      if (np < teto) {
        p = np;
        notas.push("segurado pelo mínimo aceitável");
      } else naoCompensa = true;
    }
    p = centavos(p);
    const lucro = lucroNoPreco(canal, p, custo, peso, cfg);
    const taxas = taxasNoPreco(canal, p, peso, cfg);
    linhas.push({
      ...k,
      n,
      custo,
      peso,
      teto,
      sugerido: p,
      porPeca: p / n,
      economia: teto - p,
      economiaPct: teto > 0 ? (teto - p) / teto : 0,
      lucro,
      lucroPorPeca: lucro / n,
      margem: p > 0 ? lucro / p : null,
      alvoLpp,
      ret,
      notas,
      taxas,
      naoCompensa,
      concorrenteAbaixoDoPiso,
      pisoMargem: pMin,
      maisQueAnterior: p - prevSug,
      nAnterior: prevN,
    });
    prevPP = p / n;
    prevSug = p;
    prevN = n;
  }
  return { linhas, l1, lBase, baseRef, baseMotivo, estrategia };
}

// O avulso "parece atração": margem abaixo da desejada mas o kit 2 compensa.
// Só SUGESTÃO — quem decide é a estratégia escolhida (estrategia.js).
export function pareceAtracao(escada, p1, cfg) {
  if (!escada || !(p1 > 0)) return false;
  const m1 = escada.l1 / p1;
  const k2 = escada.linhas.find((l) => l.n === 2) || escada.linhas.find((l) => !l.base);
  return !!(k2 && k2.margem != null && escada.l1 > 0 && m1 < cfg.margemDesejada && k2.margem >= cfg.margemDesejada - 0.001);
}

// Status de um preço salvo comparado ao sugerido.
// silenciarPiso = a estratégia do item (crescimento/atração/rampa) explica o
// preço abaixo do mínimo — não marca "abaixo do piso" (alertaPreco decide).
export function statusPrecoSalvo(salvo, linha, salvoPorPecaAnterior, { silenciarPiso = false } = {}) {
  if (salvo == null || !linha || linha.base) return null;
  if (!silenciarPiso && linha.pisoMargem != null && salvo < linha.pisoMargem - 0.005) return { tom: "bad", texto: "▼ abaixo do piso" };
  if (salvoPorPecaAnterior != null && salvo / linha.n > salvoPorPecaAnterior + 0.005) return { tom: "warn", texto: "⚠ escada invertida" };
  const d = (salvo - linha.sugerido) / linha.sugerido;
  if (d < -0.03) return { tom: "acc", texto: "↑ dá pra cobrar mais" };
  if (d > 0.03) return { tom: "neu", texto: "↓ caro" };
  return { tom: "good", texto: "✓ ok" };
}

// Alertas do avulso ("atração", barato demais, acima do concorrente).
// estrategia = estratégia efetiva do avulso no canal (estrategia.js).
export function alertasAvulso({ canal, p1, base1, cfg, escada, concorrente, estrategia = null }) {
  const out = [];
  if (canal?.tipo === "ml" && !(num(base1?.peso) > 0)) {
    out.push({ tom: "warn", titulo: "Produto sem peso cadastrado", texto: "No Mercado Livre o custo de envio depende do peso (peça + embalagem). Sem peso, o app está usando a faixa mais leve (até 300 g) — preencha o peso no cadastro do produto e das embalagens pra conta ficar exata." });
  }
  const l1 = escada.l1;
  const m1 = p1 > 0 ? l1 / p1 : 0;
  const k2 = escada.linhas.find((l) => l.n === 2) || escada.linhas.find((l) => !l.base);
  if (k2 && k2.margem != null) {
    if (m1 < cfg.margemDesejada && k2.margem >= cfg.margemDesejada - 0.001 && l1 > 0) {
      const pctTxt = (v) => (v * 100).toFixed(1).replace(".", ",");
      if (estrategia?.origem === "escolhida" && estrategia.chave === "atracao")
        out.push({ tom: "good", titulo: "🧲 Avulso como atração (escolhido)", texto: `Margem ${pctTxt(m1)}% no avulso; o Kit ${k2.n} dá ${pctTxt(k2.margem)}%. O avulso puxa o clique na busca, o lucro vem no kit.` });
      else if (!estrategia || (estrategia.origem === "padrao" && !estrategia.linha?.estrategia) || estrategia.vencida)
        out.push({ tom: "neutro", titulo: "🧲 Parece atração — marcar?", texto: `O avulso está com margem ${pctTxt(m1)}% (abaixo da desejada), mas o Kit ${k2.n} dá ${pctTxt(k2.margem)}%. Se for de propósito (o avulso puxa o clique, o lucro vem no kit), marque como atração.`, acao: "marcar-atracao" });
    } else if (k2.margem < cfg.margemMin || l1 <= 0) {
      out.push({ tom: "bad", titulo: "Avulso barato demais", texto: `Com esse avulso, nem o Kit ${k2.n} passa da margem mínima. Suba o avulso ou revise o custo.` });
    }
  }
  const c1 = num(concorrente);
  if (c1 > 0) {
    const ref = referenciasAvulso(canal, num(base1?.custo), num(base1?.peso), cfg, c1);
    if (ref.concorrenteAbaixoDoPiso) {
      out.push({ tom: "bad", titulo: "Não dá pra competir nesse preço sem prejuízo", texto: `O concorrente está abaixo do seu mínimo aceitável (${ref.margemMinima != null ? ref.margemMinima.toFixed(2).replace(".", ",") : "—"}). Não acompanhe — diferencie pelo kit, pela foto ou pela qualidade.` });
    } else if (p1 > c1 * 1.05) {
      out.push({ tom: "warn", titulo: "Avulso acima do concorrente", texto: `Seu avulso está ${(((p1 / c1) - 1) * 100).toFixed(0)}% acima do concorrente. Ele é o menor preço que aparece na busca — caro demais perde clique. Dá pra descer até a margem mínima e deixar o lucro pros kits.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anunciar (anúncio criado direto em cada marketplace; a Olist só cuida de
// estoque/pedidos/nota, com "preço fixo" na integração — decisão do Gustavo,
// set/2026). Por item × canal: PREÇO ORIGINAL (o riscado) pra digitar na
// plataforma + PROMOÇÃO % → o cliente paga o preço real salvo.
// Desconto exibido: padrão do canal (`canais.desconto_anuncio_pct`) ou o
// próprio do produto/kit (`desconto_anuncio` jsonb { canal_id: fração }) —
// variação usa o do produto pai.

// Desconto padrão do canal. Sem a coluna nova (SQL v30 não rodado), usa o
// acréscimo antigo da Olist ("por dentro" a = desconto a; "simples" a/(1+a)).
export function descontoPadraoCanal(canal) {
  if (!canal) return 0;
  if (canal.desconto_anuncio_pct != null && canal.desconto_anuncio_pct !== "") return Math.max(0, Math.min(0.9, num(canal.desconto_anuncio_pct)));
  const a = canal.acrescimo_olist_pct;
  if (a == null || a === "") return 0;
  return Math.max(0, Math.min(0.9, canal.acrescimo_olist_modo === "simples" ? num(a) / (1 + num(a)) : num(a)));
}

// Desconto do item (id "p:" | "v:" | "k:") no canal: o próprio do produto/kit
// quando houver, senão o padrão do canal. Devolve { desconto, proprio }.
export function descontoDoItem(itemId, canal, { itens = [], produtos = [], kits = [] } = {}) {
  const padrao = descontoPadraoCanal(canal);
  if (!itemId || !canal) return { desconto: padrao, proprio: false };
  let dono = null;
  if (itemId.startsWith("k:")) dono = kits.find((k) => k.id === itemId.slice(2));
  else {
    const pid = itemId.startsWith("v:") ? itens.find((i) => i.id === itemId)?.produtoId : itemId.slice(2);
    dono = produtos.find((p) => p.id === pid);
  }
  const v = dono?.desconto_anuncio?.[canal.id];
  if (v != null && v !== "") return { desconto: Math.max(0, Math.min(0.9, num(v))), proprio: true };
  return { desconto: padrao, proprio: false };
}

const centavoAcima = (x) => Math.ceil(x * 100 - 1e-6) / 100;

// Preço original (riscado) + promo % pra o cliente pagar o preço real.
// Original = real ÷ (1 − desconto), no centavo pra cima (ex.: R$11,90 com
// 30% → R$17,00); promo = % inteiro pra baixo — o cliente paga o preço real
// ou, no máximo, alguns centavos a mais.
export function calcularAnuncio(real, desconto) {
  const r = num(real);
  if (!(r > 0)) return null;
  const d = Math.max(0, Math.min(0.9, num(desconto)));
  if (d < 0.005) return { original: r, promo: 0, clientePaga: r, real: r, desconto: 0 };
  const original = centavoAcima(r / (1 - d));
  const promo = Math.max(0, Math.floor((1 - r / original) * 100 + 1e-9));
  const clientePaga = centavos(original * (1 - promo / 100));
  return { original, promo, clientePaga, real: r, desconto: d };
}

// O que foi marcado como atualizado na plataforma difere do calculado agora?
export function anuncioMudou(salvo, atual) {
  if (!atual) return false;
  if (!salvo) return true;
  return Math.abs(num(salvo.preco_original) - atual.original) >= 0.01 || num(salvo.promo) !== atual.promo;
}

// Campanha temporária a partir do preço anunciado (a campanha SUBSTITUI a
// promo base — não soma): % pra chegar num preço final desejado.
export function promoParaPreco(anunciado, precoFinal) {
  if (!(anunciado > 0) || !(precoFinal > 0)) return null;
  return Math.max(0, (1 - precoFinal / anunciado) * 100);
}

// ---------------------------------------------------------------------------
// Escada de um produto cadastrado num canal, a partir do catálogo ao vivo.
// - avulso = preço salvo do produto nesse canal (ou `p1Override`); sem
//   preço salvo, parte do preço da margem desejada.
// - kits = variações do produto (+ quantidades extras simuladas).
export function escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg, p1Override, quantidadesExtras = [], concorrenteOverrides = {}, emRampa = false }) {
  const itemPai = itens.find((i) => i.id === `p:${produtoId}`);
  if (!itemPai || !canal) return null;
  const salvoDe = (tipo, id) => precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id) || null;
  const concDe = (tipo, id) => concorrentes.find((c) => c.item_tipo === tipo && c.item_id === id && c.canal_id === canal.id) || null;
  const custo1 = num(itemPai.custoTotal);
  const peso1 = num(itemPai.peso);
  const salvo1 = salvoDe("produto", produtoId);
  const conc1 = concorrenteOverrides[1] ?? concDe("produto", produtoId)?.preco ?? null;
  let p1 = num(p1Override) > 0 ? num(p1Override) : salvo1 ? num(salvo1.preco) : null;
  let p1Origem = num(p1Override) > 0 ? "manual" : salvo1 ? "salvo" : "margem";
  if (!(p1 > 0)) {
    const pm = precoParaMargem(canal, cfg.margemDesejada, custo1, peso1, cfg);
    p1 = pm != null ? r90up(pm) : 0;
  }
  const variacoes = itens.filter((i) => i.id.startsWith("v:") && i.produtoId === produtoId);
  const porN = new Map();
  for (const v of variacoes) {
    const n = num(v.pecas || v.quantidade);
    if (n <= 1 || porN.has(n)) continue;
    const vid = v.id.slice(2);
    const salvo = salvoDe("variacao", vid);
    porN.set(n, {
      n,
      custo: num(v.custoTotal),
      peso: num(v.peso),
      itemId: v.id,
      variacaoId: vid,
      nome: v.nomeVariacao || v.nome,
      cadastrada: true,
      salvo: salvo ? num(salvo.preco) : null,
      concorrente: concorrenteOverrides[n] ?? concDe("variacao", vid)?.preco ?? null,
    });
  }
  // Quantidades simuladas que ainda não são variação: custo ESTIMADO =
  // produção por peça × n + embalagem/frete do pai uma vez. É só pra
  // simular — o custo real (caixa maior, chapa) vale quando a variação for
  // criada, e a tela avisa que é estimativa.
  const custoProdPeca = num(itemPai.custoProducao);
  const custoFixoPai = custo1 - custoProdPeca;
  for (const n of quantidadesExtras) {
    const q = Math.round(num(n));
    if (q <= 1 || porN.has(q)) continue;
    porN.set(q, {
      n: q,
      custo: custoProdPeca * q + custoFixoPai,
      peso: peso1 * q,
      cadastrada: false,
      nome: `Kit ${q}`,
      salvo: null,
      concorrente: concorrenteOverrides[q] ?? null,
      estimado: true,
    });
  }
  const kits = [...porN.values()];
  // Estratégia escolhida pro avulso nesse canal (vencida = como se não houvesse).
  const g = salvo1 ? estrategiaGravada(salvo1, lucroNoPreco(canal, num(salvo1.preco), custo1, peso1, cfg)) : null;
  const estrategia = g && !g.vencida ? g.chave : null;
  const escada = calcularEscada({ canal, p1, base1: { custo: custo1, peso: peso1 }, kits, cfg, estrategia, emRampa });
  return { escada, p1, p1Origem, salvo1: salvo1 ? num(salvo1.preco) : null, concorrente1: conc1, itemPai, custo1, peso1 };
}

// ---------------------------------------------------------------------------
// Kit de produtos diferentes (ex.: Gato + Cachorro): preço sugerido comparando
// com as PEÇAS VENDIDAS SEPARADAS no mesmo canal. Mesma lógica da escada:
// - separado = Σ qtd × preço salvo da peça no canal (sem salvo, o preço da
//   margem desejada dela);
// - lucro base de cada peça = o do preço salvo, ou o da margem desejada se o
//   avulso estiver como "atração" (igual à escada);
// - alvo = retencao(peças do kit) × Σ lucros (kit de 2 peças = 100%: toda a
//   economia de taxa fixa/embalagem vai pro cliente, você lucra o mesmo);
// - menor ,90 que dá o alvo na faixa real do canal pro preço do kit; travas:
//   cliente economiza ≥ vantagemMin vs separado, margem mínima, desce pra
//   antes de troca de faixa se der mais lucro.
// kitItem = item "k:" do catálogo (custoTotal, peso, pecas, componentes).
export function sugestaoKit({ canal, kitItem, itens, precos, cfg }) {
  if (!canal || !kitItem?.componentes?.length) return null;
  const custo = num(kitItem.custoTotal);
  const peso = num(kitItem.peso);
  const componentes = [];
  let separado = 0;
  let lucroSeparado = 0;
  let lucroBase = 0;
  for (const c of kitItem.componentes) {
    const q = num(c.quantidade);
    const it = itens.find((i) => i.id === `p:${c.produtoId}`);
    if (!it || q <= 0) continue;
    const c1 = num(it.custoTotal);
    const p1peso = num(it.peso);
    const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === c.produtoId && p.canal_id === canal.id);
    const pRef = precoParaMargem(canal, cfg.margemDesejada, c1, p1peso, cfg);
    const preco = salvo && num(salvo.preco) > 0 ? num(salvo.preco) : pRef != null ? r90up(pRef) : 0;
    if (!(preco > 0)) return null;
    const l = lucroNoPreco(canal, preco, c1, p1peso, cfg) ?? 0;
    const lRef = pRef != null ? lucroNoPreco(canal, pRef, c1, p1peso, cfg) ?? l : l;
    componentes.push({ produtoId: c.produtoId, nome: it.nome, quantidade: q, preco, origem: salvo ? "salvo" : "margem", lucro: l });
    separado += q * preco;
    lucroSeparado += q * l;
    // Normal escolhido de propósito → lucro da própria peça; senão o maior.
    const g = salvo ? estrategiaGravada(salvo, l) : null;
    lucroBase += q * (g && !g.vencida && g.chave === "normal" ? l : Math.max(l, lRef));
  }
  if (!componentes.length || !(separado > 0)) return null;
  const pecas = componentes.reduce((s, c) => s + c.quantidade, 0);
  const alvo = retencao(pecas, cfg) * lucroBase;
  const notas = [];
  let p = precoParaLucro(canal, alvo, custo, peso, cfg);
  p = p != null ? r90up(p) : r90(separado);
  const maxVant = r90(separado * (1 - cfg.vantagemMin));
  if (p > maxVant) {
    p = maxVant;
    notas.push(`desceu pra dar ≥${Math.round(cfg.vantagemMin * 100)}% de economia`);
  }
  const descontoCurva = (separado - p) / separado;
  for (const [, hi] of limitesDoCanal(canal, peso)) {
    if (!isFinite(hi) || hi <= 0) continue;
    const b = hi - 0.01;
    if (b < p && b >= p * 0.85) {
      const cand = r90(b + 0.001);
      const lc = lucroNoPreco(canal, cand, custo, peso, cfg);
      const lp = lucroNoPreco(canal, p, custo, peso, cfg);
      if (cand < p && lc > lp + 0.5 && (separado - cand) / separado <= descontoCurva + 0.1) {
        notas.push("evita a troca de faixa do canal");
        p = cand;
      }
    }
  }
  const pMin = precoMinimoAceitavel(canal, custo, peso, cfg);
  let naoCompensa = false;
  if (pMin != null && p < pMin) {
    const np = r90up(pMin);
    if (np < separado) {
      p = np;
      notas.push("segurado pelo mínimo aceitável");
    } else naoCompensa = true;
  }
  p = centavos(p);
  const lucro = lucroNoPreco(canal, p, custo, peso, cfg);
  return {
    n: pecas,
    custo,
    peso,
    componentes,
    separado: centavos(separado),
    lucroSeparado,
    alvo,
    sugerido: p,
    lucro,
    lucroPorPeca: lucro / pecas,
    margem: p > 0 ? lucro / p : null,
    economia: separado - p,
    economiaPct: (separado - p) / separado,
    pisoMargem: pMin,
    notas,
    naoCompensa,
    kit: true,
  };
}

// Lucro de um preço qualquer do kit comparado a vender as peças separadas.
export function kitVsSeparado(sug, canal, preco, cfg) {
  if (!sug || !(num(preco) > 0)) return null;
  const lucro = lucroNoPreco(canal, num(preco), sug.custo, sug.peso, cfg);
  return {
    lucro,
    diferenca: lucro - sug.lucroSeparado,
    // só avisa quando está ABAIXO do sugerido E lucra menos que as peças separadas
    menosQueSeparado: lucro < sug.lucroSeparado - 0.05 && num(preco) < sug.sugerido - 0.005,
    economiaCliente: (sug.separado - num(preco)) / sug.separado,
  };
}

// ---------------------------------------------------------------------------
// Regra da Shopee: num mesmo anúncio, o preço da variação mais cara não pode
// passar de 4× o da mais barata — contando o preço com promoção (o que o
// cliente paga) e o preço original (o riscado do anúncio). Recebe as
// variações [{ n, promo, original }] e divide em grupos (anúncios) que
// respeitam a regra, na ordem das quantidades.
export const SHOPEE_RAZAO_MAX_VARIACOES = 4;
export function gruposRegra4x(linhas) {
  const ord = [...(linhas || [])].filter((l) => num(l.promo) > 0).sort((a, b) => a.n - b.n);
  const grupos = [];
  let atual = [];
  const cabe = (g) => {
    const precos = g.flatMap((l) => [num(l.promo), num(l.original) || num(l.promo)]);
    return Math.max(...precos) / Math.min(...precos) <= SHOPEE_RAZAO_MAX_VARIACOES + 1e-9;
  };
  for (const l of ord) {
    if (!atual.length || cabe([...atual, l])) atual.push(l);
    else {
      grupos.push(atual);
      atual = [l];
    }
  }
  if (atual.length) grupos.push(atual);
  const primeiro = grupos[0] || [];
  const precosPrimeiro = primeiro.flatMap((l) => [num(l.promo), num(l.original) || num(l.promo)]);
  return {
    grupos: grupos.map((g) => g.map((l) => l.n)),
    ok: grupos.length <= 1,
    limite: precosPrimeiro.length ? Math.min(...precosPrimeiro) * SHOPEE_RAZAO_MAX_VARIACOES : null,
    maxNoPrimeiro: primeiro.length ? primeiro[primeiro.length - 1].n : null,
  };
}

// Fator do preço original (riscado) a partir do preço real: 1 ÷ (1 − desconto).
export function fatorOriginal(desconto) {
  const d = Math.max(0, Math.min(0.9, num(desconto)));
  return 1 / (1 - d);
}
