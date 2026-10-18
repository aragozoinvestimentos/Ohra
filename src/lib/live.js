import { lucroMinimoAceitavel, lucroNoPreco, precoParaMargem, r90up } from "./escada.js";
import { anuncioNoRiscado } from "./rampaAnuncio.js";
import { pascoa } from "./calendario.js";
import { dataSP } from "./datas.js";

// Aba Live (schema v61) — conta ÚNICA da live. A live é um plano PARALELO:
// cada produto que entra nela vira uma CÓPIA (preço salvo, custo, peso,
// riscado e as peças daquele dia, `copiaDoItem`); daí pra frente tudo é
// calculado sobre a cópia. Nada daqui grava fora da live.
//
// Produto da live: { key, item_id, nome, sku, custo, peso, salvo, riscado,
// pecas: [{ produto_id, nome, sku, q }], estrategia: { tipo, … }, ordem }.
// Eventos (live_eventos): venda (quantidade ±, preço do momento), preco
// (preço novo; info.relampago), estrategia (troca no meio da live).

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const cent = (x) => Math.round(x * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Final ,49/,99 pra cima (o mesmo jeito da Rampa).
const final4999 = (x) => cent(Math.ceil(num(x) * 2 - 1e-9) / 2 - 0.01);

export const ESTRATEGIAS = [
  { id: "escada", nome: "Escada subindo", desc: "Abre no piso e sobe em passos até o alvo, por vendas ou por tempo." },
  { id: "primeiros", nome: "Primeiros N compradores", desc: "Preço especial pros N primeiros; depois volta ao normal." },
  { id: "relampago", nome: "Relâmpago", desc: "Preço especial por alguns minutos, quando você soltar." },
  { id: "brinde", nome: "Preço cheio + brinde", desc: "Preço normal com um brinde — o custo do brinde sai do lucro." },
  { id: "fixo", nome: "Preço fixo da live", desc: "Um preço só durante a live (serve pro kit da live)." },
];
export const nomeEstrategia = (tipo) => ESTRATEGIAS.find((e) => e.id === tipo)?.nome || "—";

// Prazo de envio padrão (dias úteis) — editável em cada live.
export const PRAZO_PADRAO = { tiktok: 1, shopee: 2 };
export const MIN_SEM_VENDA = 5; // minutos sem venda → "segura ou volta um degrau"
export const TOLERANCIA_PRECO = 0.1; // cruzamento: preço pago × preço da live

export const pecasDoItem = (item, produtos) => {
  if (!item) return [];
  const prod = (pid) => (produtos || []).find((p) => p.id === pid);
  const peca = (pid, q) => ({ produto_id: pid, nome: prod(pid)?.nome || "Produto", sku: prod(pid)?.sku || "", q });
  if (item.id.startsWith("k:")) return (item.componentes || []).map((c) => peca(c.produtoId, num(c.quantidade) || 1));
  if (item.id.startsWith("v:")) return [peca(item.produtoId, num(item.quantidade || item.pecas) || 1)];
  return [peca(item.id.slice(2), 1)];
};

// Lucro de UMA venda na live: lucro no canal − brinde − taxa extra da live.
export function lucroNaLive(prod, preco, { canal, cfg, cfgDe, taxaExtra = 0 }) {
  const p = num(preco);
  if (!(p > 0) || !canal) return null;
  if (cfgDe) cfg = cfgDe(prod);
  const base = lucroNoPreco(canal, p, num(prod.custo), num(prod.peso), cfg);
  if (base == null) return null;
  const brinde = prod.estrategia?.tipo === "brinde" ? num(prod.estrategia.brindeCusto) : 0;
  return cent(base - brinde - p * num(taxaExtra));
}

// Preço de referência da cópia: o salvo no canal; sem salvo, o sugerido pela
// margem desejada (só pra live — nada é gravado no preço salvo).
export const refDe = (prod) => num(prod?.salvo) || num(prod?.sugerido) || null;

/** Sugerido pela margem desejada no canal (pra item sem preço salvo nele). */
export function sugeridoNoCanal(prod, ctx) {
  const cfg = ctx?.cfgDe ? ctx.cfgDe(prod) : ctx?.cfg;
  if (!ctx?.canal || !cfg) return null;
  const p = precoParaMargem(ctx.canal, cfg.margemDesejada ?? 0.3, num(prod.custo), num(prod.peso), cfg);
  return p ? r90up(p) : null;
}

/** Completa a cópia com o sugerido quando falta o preço salvo (cópias antigas). */
export function completarCopia(prod, ctx) {
  if (num(prod.salvo) > 0 || num(prod.sugerido) > 0) return prod;
  const sug = sugeridoNoCanal(prod, ctx);
  return sug ? { ...prod, sugerido: sug } : prod;
}

// Menor preço (final ,49/,99) com pelo menos R$ 0,50 de lucro — piso sugerido.
export function pisoSugerido(prod, ctx) {
  const alvo = refDe(prod);
  if (!(alvo > 0)) return null;
  for (let p = Math.max(1, alvo * 0.4); p <= alvo; p += 0.5) {
    const x = final4999(p);
    const l = lucroNaLive({ ...prod, estrategia: null }, x, ctx);
    if (l != null && l >= 0.5) return Math.min(x, alvo);
  }
  return alvo;
}

/** Estratégia nova com os valores padrão a partir da cópia do produto. */
export function estrategiaPadrao(tipo, prod, ctx) {
  const alvo = refDe(prod);
  const piso = pisoSugerido(prod, ctx) || alvo;
  // Passo: ~8 degraus do piso ao alvo, em múltiplos de R$ 0,50 (mínimo R$ 0,50).
  const passo = alvo && piso ? Math.max(0.5, Math.round(((alvo - piso) / 8) * 2) / 2) : 0.5;
  if (tipo === "escada") return { tipo, piso, alvo, passo, subirPor: "vendas", aCada: 3, minutos: 5 };
  if (tipo === "primeiros") return { tipo, preco: piso, n: 10, normal: alvo };
  if (tipo === "relampago") return { tipo, preco: piso, minutos: 5, normal: alvo };
  if (tipo === "brinde") return { tipo, preco: alvo, brindeNome: "", brindeCusto: 0 };
  return { tipo: "fixo", preco: alvo };
}

export function precoInicial(prod) {
  const e = prod.estrategia || {};
  if (e.tipo === "escada") return num(e.piso) || refDe(prod);
  if (e.tipo === "primeiros") return num(e.preco) || null;
  if (e.tipo === "relampago") return num(e.normal) || refDe(prod); // o relâmpago só começa quando você solta
  return num(e.preco) || refDe(prod);
}

const ms = (iso) => new Date(iso).getTime();

/** Preço da live do produto agora (último preço/troca registrado, senão o inicial). */
export function precoAtual(prod, eventos) {
  const ult = (eventos || [])
    .filter((e) => e.produto_key === prod.key && (e.tipo === "preco" || e.tipo === "estrategia") && num(e.preco) > 0)
    .sort((a, b) => ms(a.em) - ms(b.em))
    .pop();
  return ult ? num(ult.preco) : precoInicial(prod);
}

/**
 * Situação de um produto na live agora.
 * → { preco, vendas, vendasNoPreco, minNoPreco, minSemVenda, relampago, anuncio, sugestao }
 * sugestao: { tipo: subir|segurar|voltar|soltar|alvo|info, texto, preco?, relampago? }
 */
export function estadoProduto(prod, eventos, agora = Date.now(), inicioLive = null) {
  const evs = (eventos || []).filter((e) => e.produto_key === prod.key).sort((a, b) => ms(a.em) - ms(b.em));
  const precos = evs.filter((e) => e.tipo === "preco" || e.tipo === "estrategia");
  const ult = precos[precos.length - 1] || null;
  const preco = ult && num(ult.preco) > 0 ? num(ult.preco) : precoInicial(prod);
  const desde = ult ? ms(ult.em) : inicioLive ? ms(inicioLive) : agora;
  const vendasEv = evs.filter((e) => e.tipo === "venda");
  const vendas = vendasEv.reduce((t, e) => t + num(e.quantidade), 0);
  const vendasNoPreco = vendasEv.filter((e) => ms(e.em) >= desde).reduce((t, e) => t + num(e.quantidade), 0);
  const ultVenda = vendasEv.filter((e) => num(e.quantidade) > 0).pop();
  const minNoPreco = Math.max(0, (agora - desde) / 60000);
  const minSemVenda = Math.max(0, (agora - Math.max(desde, ultVenda ? ms(ultVenda.em) : 0)) / 60000);
  const relampago = !!ult?.info?.relampago;
  const e = prod.estrategia || {};
  const r2 = (x) => Math.round(x);
  let sugestao = null;
  if (e.tipo === "escada") {
    const alvo = num(e.alvo) || refDe(prod);
    const passo = num(e.passo) || 0.5;
    if (alvo > 0 && preco >= alvo - 0.004) sugestao = { tipo: "alvo", texto: "No alvo — foque no próximo produto" };
    else {
      const prox = cent(Math.min(alvo || preco + passo, preco + passo));
      const porVendas = e.subirPor !== "tempo" && vendasNoPreco >= (num(e.aCada) || 3);
      const porTempo = e.subirPor !== "vendas" && minNoPreco >= (num(e.minutos) || 5);
      if (porVendas || porTempo) sugestao = { tipo: "subir", texto: `Subir agora → R$ ${prox.toFixed(2).replace(".", ",")}`, preco: prox };
      else if (vendasNoPreco === 0 && minSemVenda >= MIN_SEM_VENDA)
        sugestao = { tipo: "segurar", texto: `Sem venda há ${r2(minSemVenda)} min — segure ou volte um degrau`, preco: cent(Math.max(num(e.piso) || 0, preco - passo)) };
      else {
        const partes = [];
        if (e.subirPor !== "tempo") partes.push(`faltam ${Math.max(0, (num(e.aCada) || 3) - vendasNoPreco)} vendas`);
        if (e.subirPor !== "vendas") partes.push(`sobe em ${Math.max(0, Math.ceil((num(e.minutos) || 5) - minNoPreco))} min`);
        sugestao = { tipo: "info", texto: `Próximo degrau R$ ${prox.toFixed(2).replace(".", ",")}: ${partes.join(" ou ")}` };
      }
    }
  } else if (e.tipo === "primeiros") {
    const n = num(e.n) || 10;
    const noEspecial = vendasEv.filter((v) => Math.abs(num(v.preco) - num(e.preco)) < 0.005).reduce((t, v) => t + num(v.quantidade), 0);
    const normal = num(e.normal) || refDe(prod);
    if (Math.abs(preco - num(e.preco)) < 0.005) {
      if (noEspecial >= n) sugestao = { tipo: "voltar", texto: `Os ${n} primeiros já foram — volte pra R$ ${normal.toFixed(2).replace(".", ",")}`, preco: normal };
      else sugestao = { tipo: "info", texto: `Faltam ${n - noEspecial} no preço especial` };
    } else sugestao = { tipo: "info", texto: "Preço especial encerrado" };
  } else if (e.tipo === "relampago") {
    const normal = num(e.normal) || refDe(prod);
    if (relampago) {
      const resta = (num(e.minutos) || 5) - minNoPreco;
      sugestao =
        resta <= 0
          ? { tipo: "voltar", texto: `Relâmpago acabou — volte pra R$ ${normal.toFixed(2).replace(".", ",")}`, preco: normal }
          : { tipo: "info", texto: `Relâmpago: faltam ${Math.ceil(resta)} min` };
    } else sugestao = { tipo: "soltar", texto: `Soltar relâmpago → R$ ${num(e.preco).toFixed(2).replace(".", ",")} por ${num(e.minutos) || 5} min`, preco: num(e.preco), relampago: true };
  } else if (minSemVenda >= MIN_SEM_VENDA && vendasNoPreco === 0) sugestao = { tipo: "info", texto: `Sem venda há ${r2(minSemVenda)} min` };
  const anuncio = prod.riscado ? anuncioNoRiscado(preco, prod.riscado) : null;
  return { preco, vendas, vendasNoPreco, minNoPreco, minSemVenda, relampago, anuncio, sugestao };
}

/** Vendas, faturamento e lucro de cada produto e da live. */
export function resumoLive(live, eventos, ctx) {
  const evs = (eventos || []).filter((e) => e.live_id === live.id);
  const produtos = (live.produtos || []).map((p) => {
    const vendas = evs.filter((e) => e.tipo === "venda" && e.produto_key === p.key);
    const qtd = vendas.reduce((t, e) => t + num(e.quantidade), 0);
    let fat = 0;
    let lucro = 0;
    let vendeuAte = null;
    for (const v of vendas) {
      const pr = num(v.preco) || precoInicial(p) || 0;
      fat += num(v.quantidade) * pr;
      lucro += num(v.quantidade) * (lucroNaLive(p, pr, { ...ctx, taxaExtra: live.taxa_extra }) ?? 0);
      if (num(v.quantidade) > 0 && (vendeuAte == null || pr > vendeuAte)) vendeuAte = pr;
    }
    const tentou = evs.filter((e) => e.produto_key === p.key && (e.tipo === "preco" || e.tipo === "estrategia")).map((e) => num(e.preco));
    const maiorTentado = Math.max(precoInicial(p) || 0, ...tentou);
    const semVendaAcima = vendeuAte != null && maiorTentado > vendeuAte + 0.004 ? maiorTentado : null;
    const trocas = evs.filter((e) => e.produto_key === p.key && e.tipo === "estrategia").map((e) => e.info?.tipo);
    return { prod: p, qtd, faturamento: cent(fat), lucro: cent(lucro), vendeuAte, semVendaAcima, estrategias: [p.estrategia?.tipo, ...trocas].filter(Boolean) };
  });
  const duracaoMin = live.inicio ? Math.max(0, ((live.fim ? ms(live.fim) : Date.now()) - ms(live.inicio)) / 60000) : 0;
  const qtd = produtos.reduce((t, x) => t + x.qtd, 0);
  const faturamento = produtos.reduce((t, x) => t + x.faturamento, 0);
  // Cupom da live: cada uso marcado no Ao vivo sai do lucro (e do faturamento)
  // — R$ fixo, ou % do total médio dos pedidos da faixa (estimado).
  const cupom = cupomDaLive(live);
  const usados = usadosDoCupom(cupom);
  const estimado = cupom ? descontoEstimadoPorFaixa(live, ctx) : [];
  const descontoCupom = cupom ? cent(estimado.reduce((t, d, i) => t + d * (usados[i] || 0), 0)) : 0;
  const lucro = cent(produtos.reduce((t, x) => t + x.lucro, 0) - descontoCupom);
  return { produtos, qtd, faturamento: cent(faturamento - descontoCupom), lucro, descontoCupom, cupom, cupomUsados: usados.reduce((t, x) => t + x, 0), duracaoMin, lucroHora: duracaoMin >= 15 ? cent((lucro / duracaoMin) * 60) : null };
}

// ---------- Cupom da live (18/10/2026) ----------
// O preço dos produtos NÃO muda (é o da loja); o cupom da plataforma dá um
// desconto no TOTAL do pedido por faixa: "7% acima de R$ 40 · 10% acima de
// R$ 60" (ou R$ fixo). Vale a maior faixa que o pedido alcança. Guardado em
// live.pedidos._cupom = { faixas: [{ minimo, tipo 'pct'|'valor', valor, teto? }],
// usos, usados: [n por faixa], fora } (sem SQL). Formato antigo
// { valor, minimo, usados } = uma faixa em R$.
const ceil5 = (v) => Math.ceil(v / 5) * 5;
export const PCT_MAX_CUPOM = 15; // nunca sugere mais que 15%
export const ITENS_MAX_PEDIDO = 4;
export const FOLGA_USADA = 0.8; // a sugestão usa até 80% da folga do pior pedido

export function faixasDoCupom(c) {
  if (!c) return [];
  const lista = Array.isArray(c.faixas) ? c.faixas : num(c.valor) > 0 ? [{ minimo: c.minimo, tipo: "valor", valor: c.valor }] : [];
  return lista
    .map((f) => ({ minimo: num(f.minimo), tipo: f.tipo === "pct" ? "pct" : "valor", valor: num(f.valor), teto: num(f.teto) || null }))
    .filter((f) => f.minimo > 0 && f.valor > 0)
    .sort((a, b) => a.minimo - b.minimo);
}
export const usadosDoCupom = (c) => (Array.isArray(c?.usados) ? c.usados.map(num) : [num(c?.usados)]);
export const cupomDaLive = (live) => {
  const c = live?.pedidos?._cupom;
  return c && faixasDoCupom(c).length ? c : null;
};

/** Desconto do cupom num pedido de valor `total` → { idx, desconto } (idx −1 = não alcança). */
export function descontoNoPedido(faixas, total) {
  let idx = -1;
  faixas.forEach((f, i) => {
    if (total >= f.minimo - 0.004) idx = i;
  });
  if (idx < 0) return { idx, desconto: 0 };
  const f = faixas[idx];
  let d = f.tipo === "pct" ? (total * f.valor) / 100 : f.valor;
  if (f.teto) d = Math.min(d, f.teto);
  return { idx, desconto: cent(d) };
}
export const textoFaixa = (f) => {
  const brl = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",").replace(",00", "")}`;
  return `${f.tipo === "pct" ? `${String(f.valor).replace(".", ",")}%` : brl(f.valor)} acima de ${brl(f.minimo)}${f.tipo === "pct" && f.teto ? ` (máx. ${brl(f.teto)})` : ""}`;
};

// `fora` = keys dos produtos que NÃO entram no cupom (padrão: os sem folga —
// cupom de produto, só pros marcados). O total do pedido conta só os do cupom.
export const foraDoCupom = (cupom, analise) => (Array.isArray(cupom?.fora) ? cupom.fora : analise.itens.filter((x) => x.etiqueta === "sem").map((x) => x.prod.key));

/**
 * Análise do cupom pros produtos da live, no preço de abertura de cada um.
 * Pedido = 1 a 4 itens do cupom (pode repetir). Conservador: o desconto sai
 * inteiro do lucro. Um pedido "cabe" se o lucro com o desconto fica ≥ a soma
 * dos mínimos dos itens.
 * → { itens, semFolga, avaliar(faixas), sugerir(tipo), combos(faixas) }
 */
export function analiseCupom(produtos, ctx, fora = null) {
  const cfgDe = (p) => (ctx?.cfgDe ? ctx.cfgDe(p) : ctx?.cfg) || {};
  const itens = (produtos || [])
    .map((p) => {
      const preco = precoInicial(p);
      const lucro = preco ? lucroNaLive(p, preco, ctx) : null;
      if (!(preco > 0) || lucro == null) return null;
      const minimo = cent(lucroMinimoAceitavel(preco, cfgDe(p)));
      return { prod: p, preco: cent(preco), lucro, minimo, folga: cent(lucro - minimo), pecas: (p.pecas || []).reduce((t, x) => t + num(x.q), 0) || 1 };
    })
    .filter(Boolean);
  const avulsos = itens.filter((x) => x.pecas <= 1 && String(x.prod.item_id).startsWith("p:"));
  const lucroAvulsoMax = Math.max(0, ...avulsos.map((x) => x.lucro));
  for (const x of itens) x.etiqueta = x.pecas > 1 && x.lucro >= lucroAvulsoMax && x.folga > 0 ? "puxa" : x.folga > 0.004 ? "pode" : "sem";
  const semFolga = itens.filter((x) => x.etiqueta === "sem").map((x) => x.prod.key);
  const foraSet = new Set(Array.isArray(fora) ? fora : semFolga);
  for (const x of itens) x.noCupom = !foraSet.has(x.prod.key);
  const noCupom = itens.filter((x) => x.noCupom);

  // Todos os pedidos de 1 a 4 itens do cupom (com repetição).
  const pedidos = [];
  const n = noCupom.length;
  const rec = (inicio, lista) => {
    if (lista.length) {
      pedidos.push({
        itens: lista,
        total: cent(lista.reduce((t, x) => t + x.preco, 0)),
        lucro: cent(lista.reduce((t, x) => t + x.lucro, 0)),
        minimo: cent(lista.reduce((t, x) => t + x.minimo, 0)),
      });
    }
    if (lista.length >= ITENS_MAX_PEDIDO) return;
    for (let i = inicio; i < n; i++) rec(i, [...lista, noCupom[i]]);
  };
  if (n <= 14) rec(0, []);

  function avaliar(faixasIn) {
    const faixas = faixasDoCupom({ faixas: faixasIn });
    const porFaixa = faixas.map((f) => ({ faixa: f, pior: null, n: 0, somaLucro: 0, somaTotal: 0, somaDesc: 0 }));
    let pior = null;
    for (const p of pedidos) {
      const { idx, desconto } = descontoNoPedido(faixas, p.total);
      if (idx < 0) continue;
      const lucroCom = cent(p.lucro - desconto);
      const x = { ...p, desconto, lucroCom, folga: cent(lucroCom - p.minimo) };
      const pf = porFaixa[idx];
      pf.n++;
      pf.somaLucro += lucroCom;
      pf.somaTotal += p.total;
      pf.somaDesc += desconto;
      if (!pf.pior || x.folga < pf.pior.folga) pf.pior = x;
      if (!pior || x.folga < pior.folga) pior = x;
    }
    const linhas = porFaixa.map((pf) => ({
      faixa: pf.faixa,
      pior: pf.pior,
      n: pf.n,
      medio: pf.n ? cent(pf.somaLucro / pf.n) : null,
      totalMedio: pf.n ? cent(pf.somaTotal / pf.n) : null,
      descontoMedio: pf.n ? cent(pf.somaDesc / pf.n) : null,
      abaixo: !!pf.pior && pf.pior.folga < -0.004,
      prejuizo: !!pf.pior && pf.pior.lucroCom < 0,
    }));
    return { porFaixa: linhas, pior, abaixo: linhas.some((l) => l.abaixo), prejuizo: linhas.some((l) => l.prejuizo) };
  }

  // Maior desconto que ainda deixa TODO pedido da faixa ≥ o mínimo.
  function cabeNaFaixa(minimo, ate, tipo) {
    const ps = pedidos.filter((p) => p.total >= minimo - 0.004 && (ate == null || p.total < ate - 0.004));
    if (!ps.length) return null;
    if (tipo === "pct") return Math.min(PCT_MAX_CUPOM, Math.floor(Math.min(...ps.map((p) => ((p.lucro - p.minimo) / p.total) * 100))));
    return Math.floor(Math.min(minimo * (PCT_MAX_CUPOM / 100), ...ps.map((p) => p.lucro - p.minimo)));
  }
  /** Faixas sugeridas (até 2): a 1ª passa do avulso mais caro; a 2ª ~1,5× ela. */
  function sugerir(tipo = "pct") {
    if (!noCupom.length || !pedidos.length) return [];
    const avNo = avulsos.filter((x) => x.noCupom);
    const maiorAvulso = Math.max(0, ...avNo.map((x) => x.preco));
    const m1 = maiorAvulso > 0 ? ceil5(maiorAvulso + 0.01) : ceil5(Math.min(...noCupom.map((x) => x.preco)) * 1.5);
    const m2 = ceil5(m1 * 1.5);
    // "Vale a pena" = usa até FOLGA_USADA da folga (sobra margem) e a 2ª
    // faixa sempre dá mais que a 1ª (senão não puxa o pedido maior).
    const c1 = cabeNaFaixa(m1, m2, tipo);
    const c2 = cabeNaFaixa(m2, null, tipo);
    const v2 = c2 != null ? Math.floor(c2 * FOLGA_USADA) : 0;
    let v1 = c1 != null ? Math.floor(c1 * FOLGA_USADA) : 0;
    if (v2 >= 2) v1 = Math.min(v1, v2 - (tipo === "pct" ? 3 : Math.max(1, Math.round(v2 * 0.3))));
    const out = [];
    if (v1 >= 1) out.push({ minimo: m1, tipo, valor: v1 });
    if (v2 >= 1 && v2 > (v1 >= 1 ? v1 : 0)) out.push({ minimo: m2, tipo, valor: v2 });
    return out;
  }
  /** Combos de 2–3 avulsos diferentes que alcançam uma faixa e lucram acima do mínimo. */
  function combos(faixasIn, limite = 4) {
    const faixas = faixasDoCupom({ faixas: faixasIn });
    if (!faixas.length) return [];
    const vistos = new Set();
    return pedidos
      // só avulsos diferentes (o kit já é um combo)
      .filter((p) => p.itens.length >= 2 && p.itens.length <= 3 && p.itens.every((x) => x.pecas <= 1) && new Set(p.itens.map((x) => x.prod.key)).size === p.itens.length)
      .map((p) => {
        const { idx, desconto } = descontoNoPedido(faixas, p.total);
        const prox = faixas[idx + 1] || null;
        return { ...p, idx, desconto, lucroCom: cent(p.lucro - desconto), faltaProx: prox ? cent(prox.minimo - p.total) : null };
      })
      .filter((p) => p.idx >= 0 && p.lucroCom >= p.minimo - 0.004)
      .sort((a, b) => b.lucroCom / b.total - a.lucroCom / a.total || b.lucroCom - a.lucroCom)
      .filter((p) => {
        const k = p.itens.map((x) => x.prod.key).sort().join("|");
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .slice(0, limite);
  }
  // Cupom POR PRODUTO (referência pra digitar na plataforma): até 80% da
  // folga de cada produto, em R$ (múltiplo de R$ 0,50) e em % (inteiro).
  for (const x of itens) {
    const cabe = Math.max(0, x.folga * FOLGA_USADA);
    x.cupomPct = x.noCupom && x.preco > 0 ? Math.floor((cabe / x.preco) * 100) : 0;
    x.cupomR = x.noCupom ? Math.floor(cabe * 2) / 2 : 0;
    x.lucroComCupom = cent(x.lucro - x.cupomR);
  }
  return { itens, semFolga, avaliar, sugerir, combos, pedidos: pedidos.length };
}

/** Desconto estimado por uso de cada faixa (R$ fixo, ou % do total médio dos pedidos da faixa). */
export function descontoEstimadoPorFaixa(live, ctx) {
  const c = cupomDaLive(live);
  const faixas = faixasDoCupom(c);
  if (!faixas.length) return [];
  if (faixas.every((f) => f.tipo === "valor")) return faixas.map((f) => f.valor);
  const prods = (live.produtos || []).map((p) => completarCopia(p, ctx));
  const r = analiseCupom(prods, ctx, Array.isArray(c.fora) ? c.fora : null).avaliar(faixas);
  return faixas.map((f, i) => {
    if (f.tipo === "valor") return f.valor;
    const base = r.porFaixa[i]?.totalMedio || f.minimo;
    let d = (base * f.valor) / 100;
    if (f.teto) d = Math.min(d, f.teto);
    return cent(d);
  });
}

/** Lista da live: vendas como saíram + roteiro de impressão (peças somadas). */
export function listaDaLive(live, eventos) {
  const evs = (eventos || []).filter((e) => e.live_id === live.id && e.tipo === "venda");
  const vendas = (live.produtos || [])
    .map((p) => ({ prod: p, key: p.key, nome: p.nome, sku: p.sku, qtd: evs.filter((e) => e.produto_key === p.key).reduce((t, e) => t + num(e.quantidade), 0) }))
    .filter((v) => v.qtd > 0);
  const roteiro = new Map();
  for (const v of vendas) {
    const pecas = v.prod.pecas?.length ? v.prod.pecas : [{ produto_id: v.prod.item_id, nome: v.nome, sku: v.sku, q: 1 }];
    const solto = String(v.prod.item_id).startsWith("p:");
    for (const pc of pecas) {
      const x = roteiro.get(pc.produto_id) || { nome: pc.nome, sku: pc.sku, total: 0, soltas: 0, noKit: 0 };
      const n = num(pc.q) * v.qtd;
      x.total += n;
      if (solto) x.soltas += n;
      else x.noKit += n;
      roteiro.set(pc.produto_id, x);
    }
  }
  const ordenado = [...roteiro.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { vendas, roteiro: ordenado, totalVendas: vendas.reduce((t, v) => t + v.qtd, 0), totalPecas: ordenado.reduce((t, r) => t + r.total, 0) };
}

// ---------- Prazo de envio (dias úteis, sem sábado/domingo/feriado nacional) ----------
function feriados(ano) {
  const p = pascoa(ano);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map((d) => `${ano}-${d}`);
  return new Set([...fixos, somarDias(p, -48), somarDias(p, -47), somarDias(p, -2), somarDias(p, 60)]);
}
export function prazoEnvio(dataIso, diasUteis) {
  if (!dataIso) return null;
  let d = dataIso;
  let falta = Math.max(0, Math.round(num(diasUteis)));
  while (falta > 0) {
    d = somarDias(d, 1);
    const dow = new Date(`${d}T12:00:00`).getDay();
    if (dow !== 0 && dow !== 6 && !feriados(Number(d.slice(0, 4))).has(d)) falta--;
  }
  return d;
}

// ---------- Cruzamento com os pedidos importados (Fase 2) ----------
/**
 * Pelos 4 sinais: mesma plataforma (canal), dia da live (e o seguinte se ela
 * passou da meia-noite), mesmo produto e preço pago ≈ algum preço da live.
 * O pedido importado NÃO é alterado — a decisão fica em live.pedidos.
 * → { porProduto: Map(key → { marcado, live: [linhas], provavel: [linhas] }), totais }
 */
export function cruzarPedidos(live, eventos, linhasPedidos) {
  const evs = (eventos || []).filter((e) => e.live_id === live.id);
  const dias = new Set([live.data]);
  if (live.fim) dias.add(dataSP(live.fim));
  const dec = live.pedidos || {};
  const porProduto = new Map();
  let nLive = 0;
  let nProv = 0;
  let marcados = 0;
  for (const p of live.produtos || []) {
    const marcado = evs.filter((e) => e.tipo === "venda" && e.produto_key === p.key).reduce((t, e) => t + num(e.quantidade), 0);
    marcados += marcado;
    const precosLive = [precoInicial(p), ...evs.filter((e) => e.produto_key === p.key).map((e) => num(e.preco))].filter((x) => x > 0);
    const normal = num(p.salvo);
    const linhas = (linhasPedidos || []).filter((l) => l.valido && l.canal_id === live.canal_id && dias.has(l.data) && l.id_item === p.item_id);
    const live_ = [];
    const prov = [];
    for (const l of linhas) {
      const d = dec[l.chave];
      if (d === "nao") continue;
      const u = l.q > 0 ? l.pago / l.q : 0;
      const bateLive = precosLive.some((x) => Math.abs(u - x) <= TOLERANCIA_PRECO);
      const bateNormal = normal > 0 && Math.abs(u - normal) <= TOLERANCIA_PRECO;
      if (d === "live" || (bateLive && !bateNormal)) live_.push({ ...l, unit: u, decidido: d === "live" });
      else if (bateLive || !bateNormal) prov.push({ ...l, unit: u });
    }
    // Não passa do que você marcou (os decididos à mão sempre entram).
    const conf = live_.reduce((t, l) => t + l.q, 0);
    const sobra = Math.max(0, marcado - conf);
    let soma = 0;
    const provavel = prov.filter((l) => {
      if (soma >= sobra) return false;
      soma += l.q;
      return true;
    });
    nLive += conf;
    nProv += provavel.reduce((t, l) => t + l.q, 0);
    porProduto.set(p.key, { marcado, live: live_, provavel, confirmado: conf });
  }
  const temPedidos = (linhasPedidos || []).some((l) => l.canal_id === live.canal_id && dias.has(l.data));
  return { porProduto, confirmados: nLive, provaveis: nProv, marcados, temPedidos };
}

// ---------- Entre as lives ----------
/** Por item (somando as lives encerradas): vendas, lucro, frequência e média por live; ABC pelo lucro. */
export function abcDasLives(lives, eventos, ctxDaLive) {
  const enc = (lives || []).filter((l) => l.status === "encerrada");
  const porItem = new Map();
  for (const lv of enc) {
    const r = resumoLive(lv, eventos, ctxDaLive(lv));
    for (const x of r.produtos) {
      const k = x.prod.item_id;
      const g = porItem.get(k) || { item_id: k, nome: x.prod.nome, sku: x.prod.sku, qtd: 0, faturamento: 0, lucro: 0, lives: 0, vendeuEm: 0 };
      g.qtd += x.qtd;
      g.faturamento += x.faturamento;
      g.lucro += x.lucro;
      g.lives += 1;
      if (x.qtd > 0) g.vendeuEm += 1;
      porItem.set(k, g);
    }
  }
  const lista = [...porItem.values()].map((g) => ({ ...g, faturamento: cent(g.faturamento), lucro: cent(g.lucro), media: g.lives ? g.qtd / g.lives : 0 })).sort((a, b) => b.lucro - a.lucro);
  const total = lista.reduce((t, g) => t + Math.max(0, g.lucro), 0);
  let acum = 0;
  for (const g of lista) {
    const antes = total > 0 ? acum / total : 1;
    acum += Math.max(0, g.lucro);
    g.classe = total <= 0 || g.lucro <= 0 ? "C" : antes < 0.8 ? "A" : antes < 0.95 ? "B" : "C";
    g.parte = total > 0 ? Math.max(0, g.lucro) / total : 0;
  }
  return lista;
}

/** O que as lives anteriores dizem desse item (pro Planejar). */
export function historicoDoItem(itemId, lives, eventos, ctxDaLive, excetoId = null) {
  const enc = (lives || []).filter((l) => l.status === "encerrada" && l.id !== excetoId && (l.produtos || []).some((p) => p.item_id === itemId)).sort((a, b) => (a.data < b.data ? 1 : -1));
  if (!enc.length) return null;
  let qtd = 0;
  let ult = null;
  for (const lv of enc) {
    const r = resumoLive(lv, eventos, ctxDaLive(lv));
    const x = r.produtos.find((p) => p.prod.item_id === itemId);
    qtd += x?.qtd || 0;
    if (!ult) ult = { live: lv, ...x };
  }
  return { lives: enc.length, media: qtd / enc.length, pronto: Math.ceil(qtd / enc.length), ultima: ult };
}

export const novaKey = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Cópia de um item do catálogo pra dentro da live (o "valor salvo paralelo"). */
export function copiaDoItem(item, { canal, precos, produtos, riscadoDe, ctx }) {
  const tipo = item.id.startsWith("k:") ? "kit" : item.id.startsWith("v:") ? "variacao" : "produto";
  const s = canal ? (precos || []).find((x) => x.item_tipo === tipo && x.item_id === item.id.slice(2) && x.canal_id === canal.id) : null;
  const salvo = s && num(s.preco) > 0 ? num(s.preco) : null;
  const base = {
    key: novaKey(),
    item_id: item.id,
    nome: item.nome,
    sku: item.sku || "",
    custo: cent(num(item.custoTotal)),
    peso: num(item.peso),
    salvo,
    riscado: salvo && riscadoDe ? riscadoDe(item, salvo) : null,
    pecas: pecasDoItem(item, produtos),
  };
  const completo = completarCopia(base, ctx);
  return { ...completo, estrategia: estrategiaPadrao("escada", completo, ctx) };
}
