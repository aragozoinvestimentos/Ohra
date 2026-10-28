// REVENDA (schema v66, 24/10/2026) — produto comprado pronto, na MESMA loja.
// Conta ÚNICA (funções puras): ler o XML da NF-e de compra, custo final por
// unidade (preço + IPI + ST + frete/seguro/outros rateados − desconto + DIFAL
// — a planilha "Formação de Custo" do Gustavo), custo médio (3 últimas notas,
// como o filamento), estoque (entra pela nota, sai AO VIVO pelos pedidos
// importados, ajustes/inventário à mão), situação (repor/parado/negativo) e
// o regime de impostos da loja (MEI × Simples) com o limite anual do MEI.
// O estoque COMEÇA na 1ª nota importada de cada produto: venda antes disso
// não baixa nada (decisão do Gustavo — ainda não tinha estoque).
import { precoMedio } from "./comprasMaterial.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const centavos = (v) => Math.round(num(v) * 100) / 100;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const soDigitos = (s) => String(s || "").replace(/\D/g, "");

export const COMPRAS_NA_MEDIA_REVENDA = 3;
export const ESTOQUE_PADRAO = { prazo: 7, folga: 3 };
export const DIAS_RITMO = 30; // ritmo de vendas pelos últimos 30 dias (desde o início do estoque, se for mais novo)
export const DIAS_PARADO = 30;
export const COBRIR_DIAS = 30; // sugestão de compra cobre o prazo + 30 dias
export const ALIQUOTA_INTERNA_PADRAO = 0.18;

// ---------- Leitura da NF-e (XML) ----------
// Sem biblioteca e sem DOMParser (roda igual no navegador e nos testes):
// a NF-e tem tags simples e sem repetição ambígua dentro de cada bloco.
const tag = (xml, nome) => {
  const m = String(xml || "").match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : null;
};
const blocos = (xml, nome) => {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${nome}(\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, "g");
  let m;
  while ((m = re.exec(String(xml || "")))) out.push({ attrs: m[1] || "", corpo: m[2] });
  return out;
};
const txt = (s) =>
  s == null
    ? null
    : String(s)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
export const eanValido = (s) => {
  const d = soDigitos(s);
  return d.length >= 8 && d !== "0".repeat(d.length) ? d : null;
};

/** XML da NF-e → { chave, numero, serie, emissao, emitente:{cnpj,nome,uf}, ufDestino, totais, itens, duplicatas } ou { erro } */
export function lerNfe(xml) {
  const s = String(xml || "");
  if (!/<(?:\w+:)?infNFe[\s>]/.test(s)) return { erro: "Este arquivo não é o XML de uma NF-e (nota fiscal eletrônica). Baixe o XML da nota no site do fornecedor ou no e-mail que ele mandou." };
  const inf = blocos(s, "infNFe")[0];
  const idAttr = (inf.attrs.match(/Id="(?:NFe)?(\d{44})"/) || [])[1] || null;
  const chave = idAttr || soDigitos(tag(s, "chNFe")).slice(0, 44) || null;
  const ide = tag(inf.corpo, "ide") || "";
  const emit = tag(inf.corpo, "emit") || "";
  const dest = tag(inf.corpo, "dest") || "";
  const dh = txt(tag(ide, "dhEmi")) || txt(tag(ide, "dEmi")) || "";
  const tot = tag(tag(inf.corpo, "total") || "", "ICMSTot") || "";
  const t = (n) => num(txt(tag(tot, n)));
  const itens = blocos(inf.corpo, "det").map((d, i) => {
    const prod = tag(d.corpo, "prod") || "";
    const imp = tag(d.corpo, "imposto") || "";
    const icms = tag(imp, "ICMS") || "";
    const ipi = tag(imp, "IPI") || "";
    const p = (n) => num(txt(tag(prod, n)));
    return {
      n: num((d.attrs.match(/nItem="(\d+)"/) || [])[1]) || i + 1,
      codigo: txt(tag(prod, "cProd")) || "",
      ean: eanValido(txt(tag(prod, "cEANTrib"))) || eanValido(txt(tag(prod, "cEAN"))),
      descricao: txt(tag(prod, "xProd")) || "",
      ncm: txt(tag(prod, "NCM")) || null,
      unidade: txt(tag(prod, "uCom")) || "UN",
      qtd: p("qCom"),
      unidadeTrib: txt(tag(prod, "uTrib")) || null,
      qtdTrib: p("qTrib"),
      vUn: p("vUnCom"),
      vProd: p("vProd"),
      vDesc: p("vDesc"),
      vFrete: p("vFrete"),
      vSeg: p("vSeg"),
      vOutro: p("vOutro"),
      vIPI: num(txt(tag(ipi, "vIPI"))),
      vST: num(txt(tag(icms, "vICMSST"))) + num(txt(tag(icms, "vFCPST"))),
      vICMS: num(txt(tag(icms, "vICMS"))),
      pICMS: num(txt(tag(icms, "pICMS"))) / 100,
    };
  });
  if (!itens.length) return { erro: "A nota não tem itens." };
  const duplicatas = blocos(tag(inf.corpo, "cobr") || "", "dup")
    .map((d) => ({ n: txt(tag(d.corpo, "nDup")), venc: txt(tag(d.corpo, "dVenc")), valor: num(txt(tag(d.corpo, "vDup"))) }))
    .filter((d) => d.valor > 0 && d.venc);
  return {
    chave,
    numero: txt(tag(ide, "nNF")),
    serie: txt(tag(ide, "serie")),
    emissao: dh.slice(0, 10),
    emitente: { cnpj: soDigitos(txt(tag(emit, "CNPJ")) || txt(tag(emit, "CPF"))), nome: txt(tag(emit, "xFant")) || txt(tag(emit, "xNome")) || "", uf: txt(tag(tag(emit, "enderEmit") || "", "UF")) },
    ufDestino: txt(tag(tag(dest, "enderDest") || "", "UF")),
    totais: { vProd: t("vProd"), vIPI: t("vIPI"), vST: t("vST") + t("vFCPST"), vFrete: t("vFrete"), vSeg: t("vSeg"), vOutro: t("vOutro"), vDesc: t("vDesc"), vNF: t("vNF") },
    itens,
    duplicatas,
  };
}

// ---------- Custo final por unidade ----------
// Frete/seguro/outros/desconto: o valor do ITEM quando a nota traz por item;
// senão o total da nota rateado pelo valor de cada item (vProd).
// DIFAL (base única, como a planilha): só compra de fora do estado, item SEM
// ST, ligado na nota: preço × alíquota interna − ICMS destacado (nunca < 0).
/**
 * @param nota   lerNfe()
 * @param fatores { [n do item]: unidades por unidade da nota } (padrão 1)
 * @param difal  { ligado, aliquotaInterna }
 * → itens com { quantidade, freteRat, outrosRat, descRat, difal, total, custoUn, ipiUn, stUn, freteUn, difalUn }
 */
export function custoDosItens(nota, { fatores = {}, difal = null } = {}) {
  const itens = nota?.itens || [];
  const somaProd = itens.reduce((s, i) => s + i.vProd, 0) || 1;
  const porItem = (campo) => itens.some((i) => i[campo] > 0);
  const tot = nota?.totais || {};
  const rat = (i, campo, total) => (porItem(campo) ? i[campo] : (num(total) * i.vProd) / somaProd);
  const fora = !!(nota?.emitente?.uf && nota?.ufDestino && nota.emitente.uf !== nota.ufDestino);
  const aliq = num(difal?.aliquotaInterna ?? ALIQUOTA_INTERNA_PADRAO);
  return itens.map((i) => {
    const fator = num(fatores[i.n]) > 0 ? num(fatores[i.n]) : 1;
    const quantidade = i.qtd * fator;
    const freteRat = rat(i, "vFrete", tot.vFrete);
    const outrosRat = rat(i, "vSeg", tot.vSeg) + rat(i, "vOutro", tot.vOutro);
    const descRat = rat(i, "vDesc", tot.vDesc);
    const dif = difal?.ligado && fora && !(i.vST > 0) ? Math.max(0, i.vProd * aliq - i.vICMS) : 0;
    const total = i.vProd - descRat + freteRat + outrosRat + i.vIPI + i.vST + dif;
    const q = quantidade || 1;
    return {
      ...i,
      fator,
      quantidade,
      freteRat,
      outrosRat,
      descRat,
      difal: dif,
      total: centavos(total),
      custoUn: Math.round((total / q) * 10000) / 10000,
      precoUn: (i.vProd - descRat) / q,
      ipiUn: i.vIPI / q,
      stUn: i.vST / q,
      freteUn: (freteRat + outrosRat) / q,
      difalUn: dif / q,
    };
  });
}
export const compraDeForaDoEstado = (nota) => !!(nota?.emitente?.uf && nota?.ufDestino && nota.emitente.uf !== nota.ufDestino);

// ---------- Unidades por embalagem da nota (palpite) ----------
// 1º pela unidade tributável da própria NF-e (ex.: 2 CX = 24 UN → 12); senão
// pelo nome ("CX12", "C/12", "CAIXA 12 UN", "PCT 6") quando a unidade não é UN.
// Só um palpite: a tela mostra "confira" e a pessoa corrige (fica lembrado).
export function palpiteFator(item) {
  const q = num(item?.qtd);
  const qt = num(item?.qtdTrib);
  if (q > 0 && qt > q && item?.unidadeTrib && item.unidadeTrib !== item.unidade) {
    const f = qt / q;
    if (Math.abs(f - Math.round(f)) < 1e-6 && f > 1 && f <= 1000) return Math.round(f);
  }
  const un = String(item?.unidade || "").toUpperCase();
  if (["UN", "UND", "UNID", "PC", "PÇ", "PECA"].includes(un)) return null;
  const m = String(item?.descricao || "").toUpperCase().match(/(?:\bCX|\bC\/|CAIXA|\bPCT|PACOTE|\bKIT|\bDP|DISPLAY)\s*(?:COM\s*)?(\d{1,3})\b/);
  const f = m ? Number(m[1]) : null;
  return f && f > 1 ? f : null;
}

// ---------- Ligar item da nota → produto ----------
/** Item da nota → { produtoId, fator, por: 'codigo'|'ean'|null } (pelo de-para do fornecedor, senão pelo EAN do produto). */
export function ligarItem(item, { fornecedorId, fornecedorItens = [], produtos = [] }) {
  const dp = fornecedorId ? fornecedorItens.find((x) => x.fornecedor_id === fornecedorId && x.codigo === item.codigo) : null;
  if (dp?.produto_id && produtos.some((p) => p.id === dp.produto_id)) return { produtoId: dp.produto_id, fator: num(dp.fator) || 1, por: "codigo" };
  if (item.ean) {
    const p = produtos.find((x) => soDigitos(x.ean) === item.ean);
    if (p) return { produtoId: p.id, fator: 1, por: "ean" };
  }
  return { produtoId: null, fator: 1, por: null };
}

// ---------- Custo médio ----------
/** Itens de compra de UM produto (com emissao/contar_media da nota) → { custo, compras } ou null. */
export function custoMedioRevenda(itensDoProduto, n = COMPRAS_NA_MEDIA_REVENDA) {
  return precoMedio(
    (itensDoProduto || []).map((i) => ({ data: i.emissao, criado_em: i.criado_em, quantidade: i.quantidade, valor_total: num(i.custo_un) * num(i.quantidade), contar_media: i.contar_media })),
    n
  );
}
export const ehRevenda = (p) => p?.origem === "revenda";

// ---------- Vendas por produto (dos pedidos importados) ----------
/**
 * Pedidos válidos (enriquecer) → Map produto_id → [{ data, unidades, pedido }]
 * explodindo variação (× quantidade) e kit (× peças daquele produto).
 */
export function vendasPorProduto(pedidos, itens, soProdutos = null) {
  const porId = new Map((itens || []).map((i) => [i.id, i]));
  const out = new Map();
  const add = (pid, data, u, pedido) => {
    if (!pid || !(u > 0) || (soProdutos && !soProdutos.has(pid))) return;
    if (!out.has(pid)) out.set(pid, []);
    out.get(pid).push({ data, unidades: u, pedido });
  };
  for (const l of pedidos || []) {
    if (!l.valido || !l.id_item) continue;
    const q = num(l.q ?? l.quantidade) || 1;
    const data = String(l.data || "").slice(0, 10);
    const id = l.id_item;
    if (id.startsWith("p:")) add(id.slice(2), data, q, l.pedido);
    else if (id.startsWith("v:")) {
      const v = porId.get(id);
      add(v?.produtoId, data, q * (num(v?.quantidade) || 1), l.pedido);
    } else if (id.startsWith("k:")) {
      const k = porId.get(id);
      for (const c of k?.componentes || []) add(c.produtoId, data, q * (num(c.quantidade) || 1), l.pedido);
    }
  }
  return out;
}

// ---------- Estoque ----------
/**
 * @param movimentos estoque_movimentos do produto (entrada/ajuste/inventario, quantidade ±)
 * @param vendas     [{ data, unidades }] do produto (vendasPorProduto)
 * → { inicio, saldo, entradas, ajustes, vendido, porDia, duraDias, ultimaVenda, negativoEm, semEstoque }
 */
export function estoqueDoProduto({ movimentos = [], vendas = [], hoje }) {
  const movs = [...movimentos].sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  if (!movs.length) return { inicio: null, saldo: 0, entradas: 0, ajustes: 0, vendido: 0, porDia: 0, duraDias: null, ultimaVenda: null, negativoEm: null, semControle: true };
  const inicio = String(movs[0].data).slice(0, 10);
  const vds = (vendas || []).filter((v) => v.data >= inicio);
  const entradas = movs.filter((m) => m.tipo === "entrada").reduce((s, m) => s + num(m.quantidade), 0);
  const ajustes = movs.filter((m) => m.tipo !== "entrada").reduce((s, m) => s + num(m.quantidade), 0);
  const vendido = vds.reduce((s, v) => s + num(v.unidades), 0);
  const saldo = entradas + ajustes - vendido;
  // linha do tempo: dia em que ficou negativo (pela ordem dos dias; no mesmo dia, entra antes de sair)
  const eventos = [...movs.map((m) => ({ data: String(m.data).slice(0, 10), q: num(m.quantidade), ordem: 0 })), ...vds.map((v) => ({ data: v.data, q: -num(v.unidades), ordem: 1 }))].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem);
  let s = 0;
  let negativoEm = null;
  for (const e of eventos) {
    s += e.q;
    if (s < 0 && !negativoEm) negativoEm = e.data;
    if (s >= 0) negativoEm = null;
  }
  // ritmo: vendas dos últimos 30 dias (ou desde o início, no mínimo 7 dias de base)
  const desde = [somarDias(hoje, -(DIAS_RITMO - 1)), inicio].sort()[1];
  const dias = Math.max(7, diasEntre(desde, hoje) + 1);
  const recentes = vds.filter((v) => v.data >= desde && v.data <= hoje).reduce((t, v) => t + num(v.unidades), 0);
  const porDia = recentes / dias;
  const ultimaVenda = vds.map((v) => v.data).sort().pop() || null;
  return { inicio, saldo, entradas, ajustes, vendido, porDia, duraDias: porDia > 0 ? Math.max(0, saldo) / porDia : null, ultimaVenda, negativoEm: saldo < 0 ? negativoEm : null };
}

/** → { tipo: 'negativo'|'zerado'|'repor'|'parado'|'ok'|'sem-controle', texto, comprar } */
export function situacaoEstoque(est, cfg, hoje) {
  const prazo = num(cfg?.prazo) > 0 ? num(cfg.prazo) : ESTOQUE_PADRAO.prazo;
  const folga = num(cfg?.folga) >= 0 && cfg?.folga !== "" && cfg?.folga != null ? num(cfg.folga) : ESTOQUE_PADRAO.folga;
  if (!est || est.semControle) return { tipo: "sem-controle", texto: "sem nota importada", comprar: 0, prazo, folga };
  const comprar = est.porDia > 0 ? Math.max(0, Math.ceil(est.porDia * (prazo + COBRIR_DIAS) - Math.max(0, est.saldo))) : 0;
  if (est.saldo < 0) return { tipo: "negativo", texto: `negativo (${fmtQ(est.saldo)}) — falta importar nota ou contar`, comprar, prazo, folga };
  if (est.saldo === 0) return { tipo: "zerado", texto: est.porDia > 0 ? `acabou — compre ~${comprar} un` : "acabou", comprar, prazo, folga };
  if (est.duraDias != null && est.duraDias < prazo + folga) {
    const d = Math.floor(est.duraDias);
    return { tipo: "repor", texto: `repor — acaba em ~${d} dia${d === 1 ? "" : "s"}, o fornecedor leva ${prazo}; compre ~${comprar} un`, comprar, prazo, folga, dura: d };
  }
  const semVenda = est.ultimaVenda ? diasEntre(est.ultimaVenda, hoje) : est.inicio ? diasEntre(est.inicio, hoje) : 0;
  if (semVenda >= DIAS_PARADO) return { tipo: "parado", texto: `parado há ${semVenda} dias`, comprar: 0, prazo, folga, dias: semVenda };
  return { tipo: "ok", texto: "ok", comprar, prazo, folga };
}
const fmtQ = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(1).replace(".", ","));

/** Histórico de um produto (mais novo primeiro) com o saldo depois de cada linha; vendas agrupadas por dia. */
export function extratoEstoque({ movimentos = [], vendas = [], inicio }) {
  const linhas = [
    ...movimentos.map((m) => ({ data: String(m.data).slice(0, 10), tipo: m.tipo, q: num(m.quantidade), motivo: m.motivo, compraId: m.compra_id, id: m.id, ordem: 0 })),
  ];
  const porDia = new Map();
  for (const v of vendas || []) {
    if (inicio && v.data < inicio) continue;
    const x = porDia.get(v.data) || { data: v.data, tipo: "venda", q: 0, pedidos: new Set(), ordem: 1 };
    x.q -= num(v.unidades);
    if (v.pedido) x.pedidos.add(v.pedido);
    porDia.set(v.data, x);
  }
  linhas.push(...[...porDia.values()].map((x) => ({ ...x, pedidos: x.pedidos.size })));
  linhas.sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem);
  let s = 0;
  for (const l of linhas) {
    s += l.q;
    l.saldo = s;
  }
  return linhas.reverse();
}

/** Inventário: contado × o que o app diz → ajustes (só dos itens contados e diferentes). */
export function diferencasInventario(linhas) {
  return (linhas || [])
    .filter((l) => l.contado !== "" && l.contado != null && isFinite(Number(String(l.contado).replace(",", "."))))
    .map((l) => ({ ...l, contadoN: num(l.contado), diferenca: num(l.contado) - num(l.saldo) }))
    .filter((l) => Math.abs(l.diferenca) > 1e-9);
}

// ---------- Regime de impostos da loja ----------
// lojas.config_escada.impostos = { regime: 'mei'|'simples', limiteAnual, dasMensal }.
// MEI: nenhum imposto por venda (o DAS é fixo por mês → conta fixa no Caixa);
// o app acompanha o limite de faturamento do ANO (3D + revenda juntos).
// Os valores (limite, DAS) mudam por lei: ficam editáveis, sem número fixo no app.
export const LIMITE_MEI_PADRAO = 81000;
export const AVISO_LIMITE = 0.8;
export function regimeDaLoja(cfgLoja) {
  const i = cfgLoja?.impostos || {};
  return {
    regime: i.regime === "simples" ? "simples" : i.regime === "mei" ? "mei" : null,
    limiteAnual: num(i.limiteAnual) > 0 ? num(i.limiteAnual) : LIMITE_MEI_PADRAO,
    dasMensal: num(i.dasMensal) > 0 ? num(i.dasMensal) : null,
  };
}

/** Faturamento do ano (pedidos válidos: o que o cliente pagou) × limite do MEI, com o ritmo dos últimos 90 dias. */
export function limiteMei({ pedidos = [], limite = LIMITE_MEI_PADRAO, hoje }) {
  const ano = hoje.slice(0, 4);
  const ini = `${ano}-01-01`;
  const fim = `${ano}-12-31`;
  let faturado = 0;
  let recente = 0;
  const de90 = somarDias(hoje, -89);
  for (const l of pedidos) {
    if (!l.valido) continue;
    const d = String(l.data || "").slice(0, 10);
    const v = num(l.pago);
    if (d >= ini && d <= hoje) faturado += v;
    if (d >= de90 && d <= hoje) recente += v;
  }
  const porDia = recente / 90;
  const restam = diasEntre(hoje, fim);
  const projecao = faturado + porDia * restam;
  let passaEm = null;
  if (faturado >= limite) passaEm = hoje;
  else if (porDia > 0) {
    const d = Math.ceil((limite - faturado) / porDia);
    const dt = somarDias(hoje, d);
    if (dt <= fim) passaEm = dt;
  }
  return { faturado: centavos(faturado), limite, pct: limite > 0 ? faturado / limite : 0, porDia, projecao: centavos(projecao), passaEm, atencao: faturado >= limite * AVISO_LIMITE || !!passaEm };
}
