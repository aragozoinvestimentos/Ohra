// Preço por quantidade ("escada") e publicação na Olist — lógica pura.
//
// Regra (combinada com o Gustavo, set/2026):
// - O avulso (1 un.) é escolha dele. Os kits/variações são SUGERIDOS a
//   partir do LUCRO POR PEÇA: o kit 2 mantém `r2` (padrão 100%) do lucro por
//   peça do avulso — toda a economia de taxa fixa/embalagem/frete vai pro
//   cliente —, o kit 10 mantém `r10` (80%) e o resto segue uma curva
//   logarítmica suave entre os dois, nunca abaixo de `piso` (70%).
// - Se o avulso estiver como "atração" (margem abaixo da desejada), a base
//   passa a ser o lucro por peça da margem desejada: o lucro vem dos kits.
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
// salva; a Olist (base + acréscimo do canal + promo) só aparece em Publicar.
import { SHOPEE_TIERS, ML_ENVIO_FAIXAS_PRECO, TIKTOK_TIERS, resolverTaxasNoPreco } from "./calc.js";
import { ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "./constantesCanal.js";

export const ESCADA_PADRAO = {
  r2: 1, // kit 2 mantém 100% do lucro/peça
  r10: 0.8, // kit 10 mantém 80%
  piso: 0.7, // nenhuma quantidade abaixo de 70%
  vantagemMin: 0.05, // cliente economiza pelo menos 5% vs N avulsos
  margemMin: 0.15,
  margemDesejada: 0.3,
  promoMinOlist: 0.1, // Publicar: todo canal com pelo menos 10% de promoção
};

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

// Mescla config da loja + escada própria do produto (se houver) com os padrões.
export function configEscada(configLoja, configProduto) {
  const base = { ...ESCADA_PADRAO, ...(configLoja || {}) };
  if (configProduto) {
    for (const k of ["r2", "r10", "piso", "vantagemMin"]) if (configProduto[k] != null) base[k] = configProduto[k];
  }
  return base;
}

// ,90 pra baixo / pra cima
export const r90 = (x) => Math.floor(x + 0.1 + 1e-9) - 0.1;
export const r90up = (x) => Math.ceil(x + 0.1 - 1e-9) - 0.1;
const centavos = (v) => Math.round(v * 100) / 100;

// Pontos onde a taxa do canal muda (pra resolver preço por faixa).
function limitesDoCanal(canal) {
  const tipo = canal?.tipo;
  let mins = [0];
  if (tipo === "shopee") mins = SHOPEE_TIERS.map((t) => t.min);
  else if (tipo === "ml") mins = ML_ENVIO_FAIXAS_PRECO.map((t) => t.min);
  else if (tipo === "tiktok") mins = TIKTOK_TIERS.map((t) => t.min);
  mins = [...new Set([0, ...mins])].sort((a, b) => a - b);
  return mins.map((lo, i) => [lo, i + 1 < mins.length ? mins[i + 1] : Infinity]);
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
  for (const [lo, hi] of limitesDoCanal(canal)) {
    const probe = lo > 0 ? lo + 0.001 : 1;
    const t = taxasNoPreco(canal, probe, pesoG, cfg);
    const d = 1 - t.totalPct;
    if (d <= 0) continue;
    const p = (num(alvo) + t.taxaFixa + num(custo)) / d;
    const pp = Math.max(p, lo);
    if (pp < hi && (melhor == null || pp < melhor)) melhor = pp;
  }
  return melhor;
}

// Menor preço com margem ≥ m.
export function precoParaMargem(canal, m, custo, pesoG, cfg) {
  let melhor = null;
  for (const [lo, hi] of limitesDoCanal(canal)) {
    const probe = lo > 0 ? lo + 0.001 : 1;
    const t = taxasNoPreco(canal, probe, pesoG, cfg);
    const d = 1 - t.totalPct - m;
    if (d <= 0) continue;
    const p = (t.taxaFixa + num(custo)) / d;
    const pp = Math.max(p, lo);
    if (pp < hi && (melhor == null || pp < melhor)) melhor = pp;
  }
  return melhor;
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
  const pMin = precoParaMargem(canal, cfg.margemMin, custo1, peso1, cfg);
  return {
    margemDesejada: pMargem != null ? r90up(pMargem) : null,
    semPrejuizo: pZero != null ? r90up(pZero) : null,
    margemMinima: pMin != null ? r90up(pMin) : null,
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
export function calcularEscada({ canal, p1, base1, kits, cfg }) {
  const custo1 = num(base1?.custo);
  const peso1 = num(base1?.peso);
  const preco1 = num(p1);
  const l1 = lucroNoPreco(canal, preco1, custo1, peso1, cfg) ?? 0;
  const pRef = precoParaMargem(canal, cfg.margemDesejada, custo1, peso1, cfg);
  const lRef = pRef != null ? lucroNoPreco(canal, pRef, custo1, peso1, cfg) : l1;
  const lBase = Math.max(l1, lRef ?? l1);
  const baseRef = (lRef ?? 0) > l1 + 0.005;

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
    const pMin = precoParaMargem(canal, cfg.margemMin, custo, peso, cfg);
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
    for (const [, hi] of limitesDoCanal(canal)) {
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
        notas.push("segurado pela margem mínima");
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
  return { linhas, l1, lBase, baseRef };
}

// Status de um preço salvo comparado ao sugerido.
export function statusPrecoSalvo(salvo, linha, salvoPorPecaAnterior) {
  if (salvo == null || !linha || linha.base) return null;
  if (linha.pisoMargem != null && salvo < linha.pisoMargem - 0.005) return { tom: "bad", texto: "▼ abaixo do piso" };
  if (salvoPorPecaAnterior != null && salvo / linha.n > salvoPorPecaAnterior + 0.005) return { tom: "warn", texto: "⚠ escada invertida" };
  const d = (salvo - linha.sugerido) / linha.sugerido;
  if (d < -0.03) return { tom: "acc", texto: "↑ dá pra cobrar mais" };
  if (d > 0.03) return { tom: "neu", texto: "↓ caro" };
  return { tom: "good", texto: "✓ ok" };
}

// Alertas do avulso ("atração", barato demais, acima do concorrente).
export function alertasAvulso({ canal, p1, base1, cfg, escada, concorrente }) {
  const out = [];
  const l1 = escada.l1;
  const m1 = p1 > 0 ? l1 / p1 : 0;
  const k2 = escada.linhas.find((l) => l.n === 2) || escada.linhas.find((l) => !l.base);
  if (k2 && k2.margem != null) {
    if (m1 < cfg.margemDesejada && k2.margem >= cfg.margemDesejada - 0.001 && l1 > 0) {
      out.push({ tom: "good", titulo: "🧲 Avulso funcionando como atração", texto: `O avulso está com margem ${(m1 * 100).toFixed(1).replace(".", ",")}% (abaixo da desejada), mas o Kit ${k2.n} dá ${(k2.margem * 100).toFixed(1).replace(".", ",")}%. Tudo bem: o avulso puxa o clique na busca, o lucro vem no kit.` });
    } else if (k2.margem < cfg.margemMin || l1 <= 0) {
      out.push({ tom: "bad", titulo: "Avulso barato demais", texto: `Com esse avulso, nem o Kit ${k2.n} passa da margem mínima. Suba o avulso ou revise o custo.` });
    }
  }
  const c1 = num(concorrente);
  if (c1 > 0) {
    const ref = referenciasAvulso(canal, num(base1?.custo), num(base1?.peso), cfg, c1);
    if (ref.concorrenteAbaixoDoPiso) {
      out.push({ tom: "bad", titulo: "Não dá pra competir nesse preço sem prejuízo", texto: `O concorrente está abaixo da sua margem mínima (${ref.margemMinima != null ? ref.margemMinima.toFixed(2).replace(".", ",") : "—"}). Não acompanhe — diferencie pelo kit, pela foto ou pela qualidade.` });
    } else if (p1 > c1 * 1.05) {
      out.push({ tom: "warn", titulo: "Avulso acima do concorrente", texto: `Seu avulso está ${(((p1 / c1) - 1) * 100).toFixed(0)}% acima do concorrente. Ele é o menor preço que aparece na busca — caro demais perde clique. Dá pra descer até a margem mínima e deixar o lucro pros kits.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Publicar (Olist): uma base por item + promo % por canal.
// precosReais: { [canalId]: preçoReal } só dos canais com acréscimo.
// acrescimos:  { [canalId]: fração } (0.2 = 20%)
// promoMin:    todo canal fica com pelo menos essa promoção (0.1 = 10%) — a
//              base é a maior que ainda garante isso em todos os canais, então
//              nenhum anúncio fica "sem desconto" (o objetivo do acréscimo).
export function calcularPublicacao(precosReais, acrescimos, promoMin = 0.1) {
  const ids = Object.keys(precosReais).filter((id) => acrescimos[id] != null && num(precosReais[id]) > 0);
  if (!ids.length) return null;
  const m = Math.max(0, Math.min(0.9, num(promoMin)));
  // menor base (terminada em ,90) que dá promo ≥ m em TODOS os canais
  const base = r90up(Math.max(...ids.map((id) => num(precosReais[id]) / ((1 + num(acrescimos[id])) * (1 - m)))));
  const canais = {};
  for (const id of ids) {
    const anunciado = base * (1 + num(acrescimos[id]));
    const promo = Math.max(0, Math.floor((1 - num(precosReais[id]) / anunciado) * 100 + 1e-9));
    const clientePaga = centavos(anunciado * (1 - promo / 100));
    canais[id] = { anunciado: centavos(anunciado), promo, clientePaga, real: num(precosReais[id]) };
  }
  return { base: centavos(base), canais };
}

// A publicação salva difere da calculada agora?
export function publicacaoMudou(salva, atual) {
  if (!atual) return false;
  if (!salva) return true;
  if (Math.abs(num(salva.base) - atual.base) >= 0.01) return true;
  const promos = salva.promos || {};
  for (const [id, c] of Object.entries(atual.canais)) if (num(promos[id]) !== c.promo) return true;
  return false;
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
export function escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg, p1Override, quantidadesExtras = [], concorrenteOverrides = {} }) {
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
  const escada = calcularEscada({ canal, p1, base1: { custo: custo1, peso: peso1 }, kits, cfg });
  return { escada, p1, p1Origem, salvo1: salvo1 ? num(salvo1.preco) : null, concorrente1: conc1, itemPai, custo1, peso1 };
}
