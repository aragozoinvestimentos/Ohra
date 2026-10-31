// Importar a semana a partir dos relatórios exportados da Shopee — lido no
// próprio navegador, nada é enviado. Dois arquivos:
//  - Desempenho do produto (.xlsx): Dados → Informações Gerenciais → Produto →
//    Performance do produto → Exportar ("parentskudetail.AAAAMMDD_AAAAMMDD").
//    Uma linha por anúncio (ID do Item + SKU Principle) + uma por variação
//    (SKU da Variação, "Cor,2 Unidades").
//  - Shopee Ads (.csv): Marketing → Shopee Ads → Exportar dados → "Dados Gerais
//    de Anúncios". Uma linha por anúncio com o "ID do produto" (= ID do Item).
// O anúncio é ligado ao produto/kit do app pelo SKU (SKU Principle = SKU do
// Cadastros); o Ads chega no SKU pelo ID do Item do relatório de desempenho.
// Nada é gravado aqui: só lê e devolve os números (a central guarda o relatório).

// ---------- leitura de .xlsx (zip + XML) sem biblioteca ----------
async function inflarRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

async function lerZip(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let fim = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("arquivo não é um .xlsx válido");
  const total = dv.getUint16(fim + 10, true);
  let p = dv.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const arquivos = {};
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const lenNome = dv.getUint16(p + 28, true);
    const lenExtra = dv.getUint16(p + 30, true);
    const lenCom = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nome = dec.decode(u8.subarray(p + 46, p + 46 + lenNome));
    const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const dados = u8.subarray(ini, ini + tamComp);
    arquivos[nome] = { metodo, dados };
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return async (nome) => {
    const a = arquivos[nome];
    if (!a) return null;
    const bytes = a.metodo === 0 ? a.dados : await inflarRaw(a.dados);
    return dec.decode(bytes);
  };
}

const colunaDe = (ref) => {
  const letras = (ref || "").replace(/\d+/g, "");
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Devolve [{ nome, linhas: string[][] }] — todas as células como texto.
export async function lerXlsx(buffer) {
  const abrir = await lerZip(buffer);
  const xml = (txt) => new DOMParser().parseFromString(txt, "application/xml");
  const textoDe = (el) => Array.from(el.getElementsByTagName("t")).map((t) => t.textContent).join("");
  const ssTxt = await abrir("xl/sharedStrings.xml");
  const compart = ssTxt ? Array.from(xml(ssTxt).getElementsByTagName("si")).map(textoDe) : [];
  const wb = xml((await abrir("xl/workbook.xml")) || "<x/>");
  const rels = xml((await abrir("xl/_rels/workbook.xml.rels")) || "<x/>");
  const alvo = {};
  for (const r of Array.from(rels.getElementsByTagName("Relationship"))) alvo[r.getAttribute("Id")] = r.getAttribute("Target");
  const out = [];
  for (const s of Array.from(wb.getElementsByTagName("sheet"))) {
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const t = (alvo[rid] || "").replace(/^\/?(xl\/)?/, "");
    const txt = await abrir(`xl/${t}`);
    if (!txt) continue;
    const linhas = [];
    for (const row of Array.from(xml(txt).getElementsByTagName("row"))) {
      const cel = [];
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const v = c.getElementsByTagName("v")[0];
        const tipo = c.getAttribute("t");
        let val = "";
        if (tipo === "s" && v) val = compart[Number(v.textContent)] ?? "";
        else if (tipo === "inlineStr") val = textoDe(c);
        else if (v) val = v.textContent;
        cel[colunaDe(c.getAttribute("r"))] = val;
      }
      linhas.push(Array.from(cel, (x) => x ?? ""));
    }
    out.push({ nome: s.getAttribute("name"), linhas });
  }
  return out;
}

// CSV simples com aspas ("a,b" fica junto).
export function lerCsv(texto) {
  const linhas = [];
  let linha = [];
  let campo = "";
  let aspas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

// ---------- números e datas ----------
// Desempenho (.xlsx) vem em formato brasileiro ("100,76", "3.737");
// Ads (.csv) vem com ponto decimal ("20.05", "2.22%").
export function numBR(x) {
  const s = String(x ?? "").trim().replace("%", "");
  if (!s || s === "-") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return Number.isFinite(n) ? n : null;
}
export function numPonto(x) {
  const s = String(x ?? "").trim().replace("%", "").replace(/,/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const isoDeBR = (d) => {
  const m = /(\d{2})[/_-](\d{2})[/_-](\d{4})/.exec(d || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const isoDeCompacto = (d) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

// Período pelo nome do arquivo: "…20261004_20261010.xlsx" ou "…04_10_2026-10_10_2026.csv".
export function periodoDoNome(nome) {
  const a = /(\d{8})[_-](\d{8})/.exec(nome || "");
  if (a) return { de: isoDeCompacto(a[1]), ate: isoDeCompacto(a[2]) };
  const b = /(\d{2}_\d{2}_\d{4})-(\d{2}_\d{2}_\d{4})/.exec(nome || "");
  if (b) return { de: isoDeBR(b[1]), ate: isoDeBR(b[2]) };
  return null;
}

export const normSku = (s) => String(s || "").trim().toUpperCase();
const achar = (cab, ...nomes) => {
  for (const n of nomes) {
    const i = cab.findIndex((c) => String(c).trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};
// Quantidade pela variação da Shopee: "Preto e Branco,2 Unidades" → 2.
export function quantidadeDaVariacao(nome) {
  const m = /(\d+)\s*unidade/i.exec(nome || "");
  return m ? Number(m[1]) : null;
}

// ---------- relatórios ----------
// Desempenho do produto → { tipo: 'desempenho', periodo, itens: [{ itemId, nome,
// sku, impressoes, cliques, pedidos, unidades, + (24/10/2026) visitantes, carrinho, carrinhoUnidades,
// pedidosFeitos, unidadesFeitas, compradores, recompra (fração), diasRecompra, sairam, cliquesBusca,
// curtidas, visualizacoes, vendasPagas; variacoes: [{ sku, nome, qtd, unidades, carrinho, carrinhoUnidades }] }] }
export function interpretarDesempenho(planilhas, nomeArquivo) {
  for (const pl of planilhas) {
    const iCab = pl.linhas.findIndex((l) => achar(l, "ID do Item") >= 0 && achar(l, "SKU Principle", "SKU Principal") >= 0);
    if (iCab < 0) continue;
    const cab = pl.linhas[iCab];
    const c = {
      id: achar(cab, "ID do Item"),
      nome: achar(cab, "Produto"),
      idVar: achar(cab, "ID da Variação"),
      nomeVar: achar(cab, "Nome da Variação"),
      skuVar: achar(cab, "SKU da Variação"),
      sku: achar(cab, "SKU Principle", "SKU Principal"),
      imp: achar(cab, "Impressão do Produto", "Impressões de Produto"),
      cli: achar(cab, "Cliques Por Produto"),
      ped: achar(cab, "Produto Pago", "Pedido Pago"),
      uni: achar(cab, "Unidades (Pedido pago)"),
      // Colunas a mais do arquivo real (24/10/2026 — funil com carrinho, pedido
      // feito × pago, compradores, recompra, rejeição, busca). Ausente = null.
      vendasPagas: achar(cab, "Vendas (Pedido pago) (BRL)"),
      pedFeito: achar(cab, "Pedido Feito"),
      uniFeito: achar(cab, "Unidades (Pedido realizado)"),
      compr: achar(cab, "Compradores (Pedidos pago)", "Compradores (Pedido pago)"),
      visit: achar(cab, "Visitantes do Produto (Visita)"),
      pagVis: achar(cab, "Visualizações da Página do Produto"),
      sairam: achar(cab, "Visitantes que saíram da página"),
      busca: achar(cab, "Cliques em buscas"),
      curt: achar(cab, "Curtidas"),
      carVis: achar(cab, "Visitantes do Produto (Adicionar ao Carrinho)"),
      carUni: achar(cab, "Unidades (adicionar ao carrinho)"),
      recompra: achar(cab, "Taxa de repetição de pedido (pedidos pagos)", "Taxa de Recompra (Pedido Realizado)"),
      diasRec: achar(cab, "Média de dias para repetir pedido (pedidos pagos)"),
    };
    const col = (l, k, frac = false) => {
      if (c[k] < 0) return null;
      const v = numBR(l[c[k]]);
      return v == null ? null : frac ? v / 100 : v;
    };
    const porId = new Map();
    for (const l of pl.linhas.slice(iCab + 1)) {
      const id = String(l[c.id] || "").trim();
      if (!id) continue;
      const ehVar = c.idVar >= 0 && l[c.idVar] && l[c.idVar] !== "-";
      if (!porId.has(id)) porId.set(id, { itemId: id, nome: l[c.nome] || "", sku: normSku(l[c.sku]), impressoes: null, cliques: null, pedidos: null, unidades: null, variacoes: [] });
      const it = porId.get(id);
      if (ehVar) {
        it.variacoes.push({ sku: normSku(l[c.skuVar] !== "-" ? l[c.skuVar] : ""), nome: l[c.nomeVar] || "", qtd: quantidadeDaVariacao(l[c.nomeVar]), unidades: numBR(l[c.uni]) || 0, carrinho: col(l, "carVis"), carrinhoUnidades: col(l, "carUni") });
      } else {
        it.impressoes = numBR(l[c.imp]);
        it.cliques = numBR(l[c.cli]);
        it.pedidos = numBR(l[c.ped]);
        it.unidades = numBR(l[c.uni]);
        it.vendasPagas = col(l, "vendasPagas");
        it.pedidosFeitos = col(l, "pedFeito");
        it.unidadesFeitas = col(l, "uniFeito");
        it.compradores = col(l, "compr");
        it.visitantes = col(l, "visit");
        it.visualizacoes = col(l, "pagVis");
        it.sairam = col(l, "sairam");
        it.cliquesBusca = col(l, "busca");
        it.curtidas = col(l, "curt");
        it.carrinho = col(l, "carVis");
        it.carrinhoUnidades = col(l, "carUni");
        it.recompra = col(l, "recompra", true);
        it.diasRecompra = col(l, "diasRec");
        if (!it.sku) it.sku = normSku(l[c.sku]);
      }
    }
    return { tipo: "desempenho", periodo: periodoDoNome(nomeArquivo), itens: [...porId.values()] };
  }
  return null;
}

// Shopee Ads "Dados Gerais de Anúncios" (.csv) → { tipo: 'ads', periodo,
// porItem: Map(itemId → { gasto, cliques, vendas, nome }), total }.
export function interpretarAds(linhas, nomeArquivo) {
  const iCab = linhas.findIndex((l) => achar(l, "ID do produto") >= 0 && achar(l, "Despesas") >= 0);
  if (iCab < 0) return null;
  const linhaPer = linhas.slice(0, iCab).find((l) => String(l[0]).trim().toLowerCase() === "período");
  const perTxt = linhaPer ? String(linhaPer[1] || "").split("-") : [];
  const periodo = perTxt.length === 2 && isoDeBR(perTxt[0]) && isoDeBR(perTxt[1]) ? { de: isoDeBR(perTxt[0]), ate: isoDeBR(perTxt[1]) } : periodoDoNome(nomeArquivo);
  const cab = linhas[iCab];
  // Arquivo próprio da GMV Max da Loja (1ª linha "GMV Max da Loja", coluna
  // "Nome do Produto" no lugar de "Nome do Anúncio") — tratado à parte.
  if (/gmv max da loja/i.test(String(linhas[0]?.[0] || "")) || (achar(cab, "Nome do Anúncio") < 0 && achar(cab, "Nome do Produto") >= 0)) return interpretarGmvLoja(linhas, iCab, periodo);
  const c = {
    id: achar(cab, "ID do produto"),
    nome: achar(cab, "Nome do Anúncio"),
    gasto: achar(cab, "Despesas"),
    cli: achar(cab, "Cliques"),
    itens: achar(cab, "Itens Vendidos"),
    diretas: achar(cab, "Itens Vendidos Diretos"),
    conv: achar(cab, "Conversões"),
    gmv: achar(cab, "GMV"),
    status: achar(cab, "Status"),
    inicio: achar(cab, "Data de Início"),
    lance: achar(cab, "Método de Lance"),
  };
  const porItem = new Map();
  const total = { gasto: 0, cliques: 0, vendas: 0, diretas: c.diretas >= 0 ? 0 : null };
  // GMV Max da Loja: linha própria, sem ID do produto ("-") e sem separar
  // por produto (conferido no CSV real de 17/10/2026).
  let loja = null;
  for (const l of linhas.slice(iCab + 1)) {
    const id = String(l[c.id] || "").trim();
    if ((!id || id === "-") && /gmv max da loja/i.test(String(l[c.nome] || ""))) {
      const ini = isoDeBR(String(l[c.inicio] || "").split(" ")[0]);
      loja = {
        gasto: Math.round(((loja?.gasto || 0) + (numPonto(l[c.gasto]) || 0)) * 100) / 100,
        cliques: (loja?.cliques || 0) + (numPonto(l[c.cli]) || 0),
        vendas: (loja?.vendas || 0) + (numPonto(l[c.itens >= 0 ? c.itens : c.conv]) || 0),
        receita: Math.round(((loja?.receita || 0) + (c.gmv >= 0 ? numPonto(l[c.gmv]) || 0 : 0)) * 100) / 100,
        inicio: ini || loja?.inicio || null,
        status: c.status >= 0 ? String(l[c.status] || "") : "",
      };
      continue;
    }
    if (!id || id === "-") continue;
    const g = numPonto(l[c.gasto]) || 0;
    const cl = numPonto(l[c.cli]) || 0;
    const v = numPonto(l[c.itens >= 0 ? c.itens : c.conv]) || 0;
    // "Itens Vendidos" conta compras de OUTROS produtos depois do clique; os
    // "Diretos" são só o produto do anúncio (é o que as decisões usam).
    const vd = c.diretas >= 0 ? numPonto(l[c.diretas]) || 0 : null;
    const a = porItem.get(id) || { gasto: 0, cliques: 0, vendas: 0, diretas: c.diretas >= 0 ? 0 : null, nome: l[c.nome] || "", linhas: [] };
    // Assinatura da linha (o mesmo anúncio aparece em mais de uma lista da
    // Shopee — "melhor desempenho", "recém-cadastrados"… — e não pode somar 2×).
    a.linhas.push({ k: `${l[c.nome] || ""}|${c.inicio >= 0 ? l[c.inicio] || "" : ""}`, g, cl, v, vd });
    // Status do anúncio na Shopee (Em Andamento / Pausado / Excluído): o que
    // estiver rodando prevalece quando o mesmo produto tem mais de uma linha.
    const st = c.status >= 0 ? String(l[c.status] || "").trim() : "";
    if (st && (!a.status || /andamento/i.test(st))) a.status = st;
    // Método de Lance ("Fase 1: GMV Max - Lances Automáticos, Fase 2: GMV Max -
    // Meta de ROAS"): o CSV diz o tipo, não o número da meta.
    const lance = c.lance >= 0 ? String(l[c.lance] || "").trim() : "";
    if (lance && (!a.lance || /andamento/i.test(st))) a.lance = lance;
    a.gasto += g;
    a.cliques += cl;
    a.vendas += v;
    a.diretas = somaD(a.diretas, vd);
    porItem.set(id, a);
    total.gasto += g;
    total.cliques += cl;
    total.vendas += v;
    total.diretas = somaD(total.diretas, vd);
  }
  for (const a of porItem.values()) a.gasto = Math.round(a.gasto * 100) / 100;
  total.gasto = Math.round(total.gasto * 100) / 100;
  return { tipo: "ads", periodo, porItem, total, loja };
}

// "Dados do GMV MAX da Loja" (18/10/2026, arquivo real): linha total "GMV Max
// da Loja" (ID "-") + uma linha por produto que a campanha divulgou. Nenhum
// produto vira Ads próprio: `porItem` vazio; a quebra fica em `lojaPorItem`.
function interpretarGmvLoja(linhas, iCab, periodo) {
  const cab = linhas[iCab];
  const c = {
    id: achar(cab, "ID do produto"),
    nome: achar(cab, "Nome do Produto", "Nome do Anúncio"),
    imp: achar(cab, "Impressões"),
    gasto: achar(cab, "Despesas"),
    cli: achar(cab, "Cliques"),
    itens: achar(cab, "Itens Vendidos"),
    conv: achar(cab, "Conversões"),
    gmv: achar(cab, "GMV"),
  };
  const ler = (l) => ({
    gasto: Math.round((numPonto(l[c.gasto]) || 0) * 100) / 100,
    cliques: numPonto(l[c.cli]) || 0,
    impressoes: c.imp >= 0 ? numPonto(l[c.imp]) || 0 : 0,
    vendas: numPonto(l[c.itens >= 0 ? c.itens : c.conv]) || 0,
    receita: c.gmv >= 0 ? Math.round((numPonto(l[c.gmv]) || 0) * 100) / 100 : 0,
  });
  let loja = null;
  const lojaPorItem = [];
  for (const l of linhas.slice(iCab + 1)) {
    const id = String(l[c.id] || "").trim();
    if (!id && !String(l[c.nome] || "").trim()) continue;
    if (!id || id === "-") {
      if (/gmv max da loja/i.test(String(l[c.nome] || ""))) loja = ler(l);
      continue;
    }
    lojaPorItem.push({ id, nome: String(l[c.nome] || ""), ...ler(l) });
  }
  if (!loja) {
    // sem a linha total: soma os produtos
    loja = lojaPorItem.reduce((a, p) => ({ gasto: Math.round((a.gasto + p.gasto) * 100) / 100, cliques: a.cliques + p.cliques, impressoes: a.impressoes + p.impressoes, vendas: a.vendas + p.vendas, receita: Math.round((a.receita + p.receita) * 100) / 100 }), { gasto: 0, cliques: 0, impressoes: 0, vendas: 0, receita: 0 });
  }
  return { tipo: "gmv", periodo, porItem: new Map(), total: { gasto: 0, cliques: 0, vendas: 0 }, loja, lojaPorItem };
}

// Shopee Ads exporta UMA lista por tipo de campanha ("produto com melhor
// desempenho", "produtos recém-cadastrados"…): vários CSVs do MESMO período
// viram um relatório só (soma as campanhas de cada ID do item; a mesma
// campanha em duas listas conta uma vez).
export function juntarAds(relatorios) {
  const vistos = new Set();
  const lista = (relatorios || []).filter((r) => r?.tipo === "ads" && !(r.arquivo && vistos.has(r.arquivo)) && (vistos.add(r.arquivo), true));
  if (lista.length <= 1) return lista[0] || null;
  const porItem = new Map();
  const total = { gasto: 0, cliques: 0, vendas: 0 };
  // GMV Max da Loja: uma campanha só — fica o maior acumulado entre as listas.
  let loja = null;
  for (const r of lista) if (r.loja && (!loja || r.loja.gasto > loja.gasto)) loja = { ...r.loja };
  // O mesmo anúncio em duas listas (ou o mesmo CSV baixado de novo) conta UMA
  // vez (17/10/2026: o Suporte Gato aparecia 2× e o gasto dobrava — R$ 10,03 →
  // R$ 20,06). Por campanha (nome + data de início) fica o maior acumulado;
  // relatório guardado antes (sem `linhas`) = o maior número do mesmo ID.
  const camp = new Map(); // id → Map(k → {g, cl, v})
  for (const r of lista)
    for (const [id, a] of r.porItem) {
      const t = porItem.get(id) || { gasto: 0, cliques: 0, vendas: 0, diretas: null, nome: a.nome };
      if (a.status && (!t.status || /andamento/i.test(a.status))) t.status = a.status;
      if (a.lance) t.lance = a.lance;
      porItem.set(id, t);
      const m = camp.get(id) || new Map();
      const linhasA = Array.isArray(a.linhas) && a.linhas.length && typeof a.linhas[0] === "object" ? a.linhas : [{ k: "*", g: a.gasto, cl: a.cliques, v: a.vendas, vd: a.diretas ?? null }];
      for (const x of linhasA) {
        const ant = m.get(x.k);
        if (!ant || x.g > ant.g || (x.g === ant.g && x.cl > ant.cl)) m.set(x.k, x);
      }
      camp.set(id, m);
    }
  for (const [id, m] of camp) {
    const t = porItem.get(id);
    // Com linhas detalhadas, a entrada genérica "*" (relatório antigo) só vale se for maior que a soma das campanhas.
    const det = [...m.entries()].filter(([k]) => k !== "*").map(([, x]) => x);
    const somaDet = det.reduce((q, x) => ({ g: q.g + x.g, cl: q.cl + x.cl, v: q.v + x.v, vd: somaD(q.vd, x.vd ?? null) }), { g: 0, cl: 0, v: 0, vd: 0 });
    const gen = m.get("*");
    const fim = gen && gen.g > somaDet.g ? gen : somaDet;
    t.gasto = Math.round(fim.g * 100) / 100;
    t.cliques = fim.cl;
    t.vendas = fim.v;
    t.diretas = det.length || fim !== somaDet ? fim.vd ?? null : null;
    if (fim === somaDet) t.linhas = det;
    total.gasto += t.gasto;
    total.cliques += t.cliques;
    total.vendas += t.vendas;
  }
  total.gasto = Math.round(total.gasto * 100) / 100;
  const pers = lista.map((r) => r.periodo).filter(Boolean);
  const iguais = pers.every((p) => p.de === pers[0]?.de && p.ate === pers[0]?.ate);
  const periodo = pers.length ? { de: pers.map((p) => p.de).sort()[0], ate: pers.map((p) => p.ate).sort().pop() } : null;
  return { tipo: "ads", periodo, porItem, total, loja, arquivo: lista.map((r) => r.arquivo).join(" + "), arquivos: lista.length, periodosDiferentes: !iguais };
}

// ---------- CSV de Ads em JANELAS de datas (21/10/2026) ----------
// Pedido do Gustavo: não precisar exportar desde o início do período (campanha
// que roda meses, GMV). Cada envio = uma janela (o período exportado); as
// janelas guardadas se SOMAM, campanha por campanha, sem repetir dia (a mesma
// janela substitui; janela maior engole as menores — juntarJanela de
// gmvLoja.js). A Shopee manda o TOTAL do período (não o dia a dia): janela que
// repete só PARTE de uma anterior é recusada (conferirJanelaNova, 23/10/2026 —
// a estimativa pela média dos dias repetidos inflava o gasto).
export function somarJanelasAds(relatorios) {
  const lista = (relatorios || []).filter((r) => r?.tipo === "ads" && r.periodo?.de);
  if (!lista.length) return null;
  if (lista.length === 1) return lista[0];
  lista.sort((a, b) => a.periodo.de.localeCompare(b.periodo.de));
  const porItem = new Map();
  for (const r of lista)
    for (const [id, a] of r.porItem) {
      const t = porItem.get(id) || { gasto: 0, cliques: 0, vendas: 0, diretas: 0, nome: a.nome, camp: new Map() };
      if (a.status) t.status = a.status; // o da janela mais recente
      if (a.lance) t.lance = a.lance;
      t.gasto += num0(a.gasto);
      t.cliques += num0(a.cliques);
      t.vendas += num0(a.vendas);
      t.diretas = somaD(t.diretas, a.diretas ?? null);
      const ls = Array.isArray(a.linhas) && a.linhas.length && typeof a.linhas[0] === "object" ? a.linhas : null;
      if (ls)
        for (const x of ls) {
          const c = t.camp.get(x.k) || { k: x.k, g: 0, cl: 0, v: 0, vd: 0 };
          c.g += num0(x.g);
          c.cl += num0(x.cl);
          c.v += num0(x.v);
          c.vd = somaD(c.vd, x.vd ?? null);
          t.camp.set(x.k, c);
        }
      else t.semLinhas = true;
      porItem.set(id, t);
    }
  const total = { gasto: 0, cliques: 0, vendas: 0 };
  for (const t of porItem.values()) {
    t.gasto = Math.round(t.gasto * 100) / 100;
    if (!t.semLinhas && t.camp.size) t.linhas = [...t.camp.values()].map((c) => ({ ...c, g: Math.round(c.g * 100) / 100 }));
    delete t.camp;
    delete t.semLinhas;
    total.gasto += t.gasto;
    total.cliques += t.cliques;
    total.vendas += t.vendas;
  }
  total.gasto = Math.round(total.gasto * 100) / 100;
  let loja = null;
  for (const r of lista)
    if (r.loja) {
      loja = loja || { gasto: 0, cliques: 0, vendas: 0, receita: 0, inicio: r.loja.inicio };
      loja.gasto = Math.round((loja.gasto + num0(r.loja.gasto)) * 100) / 100;
      loja.cliques += num0(r.loja.cliques);
      loja.vendas += num0(r.loja.vendas);
      loja.receita = Math.round((loja.receita + num0(r.loja.receita)) * 100) / 100;
      if (r.loja.status) loja.status = r.loja.status;
    }
  return { tipo: "ads", periodo: { de: lista[0].periodo.de, ate: lista.map((r) => r.periodo.ate).sort().pop() }, porItem, total, loja, arquivo: lista.map((r) => r.arquivo).filter(Boolean).join(" + "), janelas: lista.length, estimado: lista.some((r) => r.estimado) };
}

// Desempenho do produto: a Shopee separa os anúncios em listas ("produto com
// melhor desempenho", "produtos recém-cadastrados"…), cada uma com o seu
// Exportar. Vários arquivos do MESMO período viram um relatório só (anúncio
// que aparece em mais de uma lista conta uma vez).
export function juntarDesempenho(relatorios) {
  const vistos = new Set();
  const lista = (relatorios || []).filter((r) => r?.tipo === "desempenho" && !(r.arquivo && vistos.has(r.arquivo)) && (vistos.add(r.arquivo), true));
  if (lista.length <= 1) return lista[0] || null;
  const porId = new Map();
  for (const r of lista) for (const i of r.itens || []) if (!porId.has(i.itemId)) porId.set(i.itemId, i);
  const pers = lista.map((r) => r.periodo).filter(Boolean);
  const iguais = pers.every((p) => p.de === pers[0]?.de && p.ate === pers[0]?.ate);
  return { tipo: "desempenho", periodo: pers[0] || null, itens: [...porId.values()], arquivo: lista.map((r) => r.arquivo).join(" + "), arquivos: lista.length, periodosDiferentes: !iguais };
}

// Lê um arquivo escolhido (File) e diz o que ele é.
export async function lerRelatorio(arquivo) {
  const nome = arquivo.name || "";
  if (/\.csv$/i.test(nome)) {
    const txt = await arquivo.text();
    const r = interpretarAds(lerCsv(txt), nome);
    if (!r) throw new Error(`${nome}: não parece o "Dados Gerais de Anúncios" do Shopee Ads nem o da GMV Max da Loja`);
    return { ...r, arquivo: nome };
  }
  const r = interpretarDesempenho(await lerXlsx(await arquivo.arrayBuffer()), nome);
  if (!r) throw new Error(`${nome}: não parece o relatório de desempenho do produto (Informações Gerenciais → Produto)`);
  return { ...r, arquivo: nome };
}

// ---- Andamento do Ads (v48) ----
// O CSV do Ads só traz o ID do Item da Shopee; quem liga ID → SKU é o
// relatório de desempenho. O app LEMBRA essa ligação (localStorage) toda vez
// que um desempenho é importado — depois, o CSV do Ads sozinho já basta.
const CHAVE_IDS = "ohra:shopee:id-sku";
export function idsShopeeLembrados() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_IDS) || "{}") || {};
  } catch {
    return {};
  }
}
export function lembrarIdsShopee(relatorios) {
  const desemp = juntarDesempenho(relatorios);
  if (!desemp) return;
  const m = idsShopeeLembrados();
  for (const i of desemp.itens) if (i.itemId && i.sku) m[i.itemId] = i.sku;
  try {
    localStorage.setItem(CHAVE_IDS, JSON.stringify(m));
  } catch {
    // sem problema: na próxima vez importa o desempenho junto
  }
}

// Anúncio com vários itens: o ID do item da Shopee → id do grupo, lembrado
// toda vez que cruzarGrupos acha o anúncio no relatório de desempenho (o CSV
// do Ads sozinho só traz o ID).
const CHAVE_GRUPOS = "ohra:shopee:id-grupo";
export function gruposShopeeLembrados() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || "{}") || {};
  } catch {
    return {};
  }
}
function lembrarGrupoShopee(itemId, grupoId) {
  const m = gruposShopeeLembrados();
  m[itemId] = grupoId;
  try {
    localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(m));
  } catch {
    // sem problema: na próxima vez importa o desempenho junto
  }
}

// Ads por item do app: itensApp = [{ chave, sku, grupoId? }] (grupoId = anúncio com vários itens). Números do período do CSV
// (o andamento é ACUMULADO: exporte do início do período de Ads até ontem).
// Campanhas de um anúncio no CSV (nome + data de início), pra separar uma
// campanha antiga (período já encerrado no app) da atual. Sem a data = null.
function campanhasDe(a) {
  const ls = Array.isArray(a?.linhas) && a.linhas.length && typeof a.linhas[0] === "object" ? a.linhas : null;
  if (!ls) return [{ inicio: null, g: num0(a?.gasto), cl: num0(a?.cliques), v: num0(a?.vendas), vd: a?.diretas ?? null }];
  return ls.map((x) => {
    const raw = String(x.k || "").split("|").pop().trim().split(" ")[0];
    return { inicio: isoDeBR(raw) || null, g: num0(x.g), cl: num0(x.cl), v: num0(x.v), vd: x.vd ?? null };
  });
}
const num0 = (x) => (isFinite(Number(x)) ? Number(x) : 0);
// Vendas DIRETAS (só o produto do anúncio) — 01/11/2026. null = o arquivo não
// trazia a coluna (relatório antigo): a soma com um null fica null.
const somaD = (a, b) => (a == null || b == null ? null : a + b);

/**
 * O CSV soma TODAS as campanhas do anúncio (a antiga, que você pausou, e a
 * nova). Pro período `periodo`, só valem as campanhas que começaram nele
 * (pela data de início) — senão o gasto da campanha antiga entra 2× (no
 * período antigo e no atual).
 * Campanha sem data de início = vale pro período (como antes).
 */
export function valoresDoPeriodo(x, periodo, periodosDoItem = []) {
  const cs = x?.campanhas;
  if (!periodo || !Array.isArray(cs) || !cs.length || cs.some((c) => !c.inicio)) return x;
  // Cada campanha é do período que começou por último até ela (com 2 dias de
  // folga — o período no app pode ser criado um pouco depois); campanha mais
  // antiga que todos os períodos fica no primeiro.
  const lista = [...(periodosDoItem || []).filter((p) => p && p.id !== periodo.id), periodo].sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  const mais2 = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  };
  const dono = (c) => {
    let o = lista[0];
    for (const p of lista) if (String(p.inicio).slice(0, 10) <= mais2(c.inicio)) o = p;
    return o;
  };
  const dentro = cs.filter((c) => dono(c) === periodo);
  if (dentro.length === cs.length) return x;
  const soma = dentro.reduce((t, c) => ({ g: t.g + c.g, cl: t.cl + c.cl, v: t.v + c.v, vd: somaD(t.vd, c.vd ?? null) }), { g: 0, cl: 0, v: 0, vd: 0 });
  return { ...x, gasto: Math.round(soma.g * 100) / 100, cliques: soma.cl, vendas: soma.v, diretas: soma.vd, separado: true };
}

export function adsPorItemApp(relatorios, itensApp) {
  const ads = juntarAds(relatorios);
  if (!ads) return { periodo: null, porChave: {}, adsSemPar: [], avisos: ["Escolha o CSV do Shopee Ads (Marketing → Shopee Ads → Exportar dados)."] };
  lembrarIdsShopee(relatorios);
  const idSku = idsShopeeLembrados();
  const porSku = new Map();
  for (const [id, a] of ads.porItem) {
    const sku = normSku(idSku[id]);
    if (!sku) continue;
    const t = porSku.get(sku) || { gasto: 0, cliques: 0, vendas: 0, diretas: 0, ids: [], campanhas: [] };
    if (a.status && (!t.status || /andamento/i.test(a.status))) t.status = a.status;
    if (a.lance) t.lance = a.lance;
    t.campanhas.push(...campanhasDe(a));
    t.gasto += a.gasto;
    t.cliques += a.cliques;
    t.vendas += a.vendas;
    t.diretas = somaD(t.diretas, a.diretas ?? null);
    t.ids.push(id);
    porSku.set(sku, t);
  }
  const porChave = {};
  const usados = new Set();
  const idGrupo = gruposShopeeLembrados();
  for (const it of itensApp.filter((x) => x.grupoId)) {
    const ids = [...ads.porItem.keys()].filter((id) => idGrupo[id] === it.grupoId);
    if (!ids.length) continue;
    const t = { gasto: 0, cliques: 0, vendas: 0, diretas: 0, campanhas: [] };
    for (const id of ids) {
      const a = ads.porItem.get(id);
      if (a.status && (!t.status || /andamento/i.test(a.status))) t.status = a.status;
      if (a.lance) t.lance = a.lance;
      t.campanhas.push(...campanhasDe(a));
      t.gasto += a.gasto;
      t.cliques += a.cliques;
      t.vendas += a.vendas;
      t.diretas = somaD(t.diretas, a.diretas ?? null);
      usados.add(id);
    }
    porChave[it.chave] = { gasto: Math.round(t.gasto * 100) / 100, cliques: t.cliques, vendas: t.vendas, diretas: t.diretas, status: t.status || "", lance: t.lance || "", campanhas: t.campanhas };
  }
  for (const it of itensApp.filter((x) => !x.grupoId)) {
    const t = porSku.get(normSku(it.sku));
    if (!t) continue;
    t.ids.forEach((id) => usados.add(id));
    porChave[it.chave] = { gasto: Math.round(t.gasto * 100) / 100, cliques: t.cliques, vendas: t.vendas, diretas: t.diretas, status: t.status || "", lance: t.lance || "", campanhas: t.campanhas };
  }
  const adsSemPar = [...ads.porItem.entries()].filter(([id, a]) => !usados.has(id) && a.gasto > 0).map(([id, a]) => ({ itemId: id, ...a, conhecido: !!idSku[id] || !!idGrupo[id] }));
  const avisos = [];
  if (adsSemPar.some((a) => !a.conhecido)) avisos.push("Alguns anúncios do Ads ainda não estão ligados a um SKU: importe junto, uma vez, o relatório de desempenho do produto (Informações Gerenciais → Produto → Performance do produto).");
  // Produto com SKU já ligado a algum anúncio e sem linha no CSV = sem gasto (0);
  // SKU que o app ainda não conhece fica em branco.
  const skusConhecidos = new Set(Object.values(idSku).map(normSku));
  const gruposConhecidos = new Set(Object.values(idGrupo));
  const zerados = itensApp.filter((it) => !porChave[it.chave] && (it.grupoId ? gruposConhecidos.has(it.grupoId) : skusConhecidos.has(normSku(it.sku)))).map((it) => it.chave);
  return { periodo: ads.periodo, porChave, zerados, adsSemPar, avisos, loja: ads.loja || null };
}

// ---- Anúncio com vários itens (3º Ficha → anuncios_grupo) ----
// O anúncio do kit tem SKU principal próprio; cada opção da Shopee tem o SKU
// que a Ficha gerou (SKU do item + sufixo da opção + sufixo da cor). Aqui o
// anúncio é achado pelas VARIAÇÕES: o anúncio do relatório cujas variações
// batem com mais opções do grupo (≥ 2, ou a única se o grupo tiver 1).
// grupos = [{ id, nome, opcoes: [{ idx, skus: [SKU…] }] }]
// → { porGrupo: { id: { itemId, nomeAnuncio, impressoes, cliques, pedidos,
//      unidades, porOpcao: { idx: unidades }, semOpcao: [{sku, unidades}], ads } },
//    idsUsados: Set }
export function cruzarGrupos(relatorios, grupos) {
  const desemp = juntarDesempenho(relatorios);
  const ads = juntarAds(relatorios);
  const porGrupo = {};
  const idsUsados = new Set();
  if (!desemp) return { porGrupo, idsUsados };
  for (const g of grupos || []) {
    const skuOpcao = new Map();
    for (const o of g.opcoes) for (const s of o.skus) if (s) skuOpcao.set(normSku(s), o.idx);
    if (!skuOpcao.size) continue;
    const minimo = Math.min(2, g.opcoes.length);
    let melhor = null;
    for (const it of desemp.itens) {
      if (idsUsados.has(it.itemId)) continue;
      const opcoes = new Set(it.variacoes.map((v) => skuOpcao.get(v.sku)).filter((x) => x != null));
      if (opcoes.size >= minimo && (!melhor || opcoes.size > melhor.n)) melhor = { it, n: opcoes.size };
    }
    if (!melhor) continue;
    const it = melhor.it;
    idsUsados.add(it.itemId);
    lembrarGrupoShopee(it.itemId, g.id); // o andamento do Ads (CSV sozinho) usa essa ligação
    const porOpcao = {};
    const semOpcao = [];
    for (const v of it.variacoes) {
      const idx = skuOpcao.get(v.sku);
      if (idx != null) porOpcao[idx] = (porOpcao[idx] || 0) + (v.unidades || 0);
      else if (v.unidades > 0) semOpcao.push({ sku: v.sku || v.nome, unidades: v.unidades });
    }
    const a = ads?.porItem.get(it.itemId) || null;
    porGrupo[g.id] = {
      itemId: it.itemId,
      nomeAnuncio: it.nome,
      impressoes: it.impressoes,
      cliques: it.cliques,
      pedidos: it.pedidos,
      unidades: it.unidades,
      porOpcao,
      semOpcao,
      ads: a ? { gasto: a.gasto, cliques: a.cliques, vendas: a.vendas } : null,
    };
  }
  return { porGrupo, idsUsados };
}

// ---------- Central de importação (aba Análise, v55) ----------
// O relatório lido vai pra `importacoes.dados` (JSON) e volta igual ao que o
// lerRelatorio devolve — as semanas automáticas (lib/semanasAuto.js) leem daqui.
export function relatorioParaGuardar(r) {
  if (!r) return null;
  if (r.tipo === "ads") return { ...r, porItem: [...r.porItem.entries()] };
  return { ...r };
}
export function relatorioDoGuardado(d) {
  if (!d || !d.tipo) return null;
  if (d.tipo === "ads") return { ...d, porItem: new Map(d.porItem || []) };
  return d;
}

/**
 * CSV do Shopee Ads → andamento de cada período ligado + perguntas (só agem no
 * "Sim"): período encerrado no app com gasto depois do fim → estender; gasto
 * sem período → criar. Mesma conta da central e da janela "Atualizar andamento".
 * todas = linhasAds.linhas (useCrescimento). → { porChave, zerados, periodo, avisos, perguntas }
 */
// Lance automático no app, mas a Shopee já está na Fase 2 com Meta de ROAS
// (22/10/2026 — Etapa 1 da GMV Max define a meta sozinha). O CSV diz o TIPO
// ("Fase 2: GMV Max - Meta de ROAS"), não o número: a central pergunta a meta
// que aparece na Shopee e registra como ajuste. Só depois de 7 dias do início.
function metaNaShopee(lance, periodo, ate) {
  if (!lance || !periodo || periodo.tipo !== "auto") return false;
  const fase2 = String(lance).split(/fase\s*2\s*:/i)[1] || (/fase\s*1/i.test(lance) ? "" : lance);
  if (!/meta de roas/i.test(fase2)) return false;
  const temMeta = (Array.isArray(periodo.ajustes) ? periodo.ajustes : []).some((a) => a && a.meta != null && a.meta !== "" && !a.tipo);
  if (temMeta || periodo.meta_roas != null) return false;
  if (!ate || !periodo.inicio) return false;
  const dias = Math.round((new Date(`${ate}T12:00:00`) - new Date(`${periodo.inicio}T12:00:00`)) / 864e5) + 1;
  return dias >= 7;
}
function orcamentoAtual(periodo) {
  const aj = (Array.isArray(periodo.ajustes) ? periodo.ajustes : []).filter((a) => a && !a.tipo && a.orcamento != null);
  return Number(aj.length ? aj[aj.length - 1].orcamento : periodo.orcamento_diario) || null;
}

export function andamentoDoCsv(lidos, todas, lojaLinha = null) {
  const shopee = (todas || []).filter((l) => l.canal?.tipo === "shopee");
  const res = adsPorItemApp(lidos, shopee.map((l) => ({ chave: l.chave, sku: l.item.sku, grupoId: l.tipo === "grupo" ? l.id : null })));
  const avisos = [...(res.avisos || [])];
  const perguntas = [];
  const somar = (iso, n) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  const infos = []; // ✓ linhas só informativas (nada a fazer)
  const parado = (st) => /pausad|exclu/i.test(st || "");
  const nomeSt = (st) => (/exclu/i.test(st || "") ? "Excluído" : "Pausado");
  const pausadoNoApp = (av) => ["pausado", "despausar", "pausa-longa"].includes(av?.chave);
  // Dia em que o gasto parou: o 1º envio do andamento que já tinha o gasto de
  // hoje (depois dele não gastou mais); sem envio antes, o fim do CSV.
  const quandoParou = (periodo, gasto) => {
    const par = periodo?.parcial;
    const pts = [...(Array.isArray(par?.historico) ? par.historico : []), ...(par?.ate ? [par] : [])].filter((h) => h?.ate).sort((a, b) => String(a.ate).localeCompare(String(b.ate)));
    const p = pts.find((h) => Number(h.gasto) >= gasto - 0.01);
    return p ? String(p.ate).slice(0, 10) : res.periodo.ate;
  };
  // Anúncio pausado/excluído na Shopee (17/10/2026, Gustavo: "se está pausado,
  // só me informe e eu confirmo"): nunca pergunta "estender"; com período
  // ligado no app, sugere encerrar na data em que o gasto parou.
  const tratar = (l, x0, chave) => {
    const ativo = l.av?.ativo || null;
    const st = x0?.status || "";
    // Só as campanhas deste período (a antiga, pausada, fica no período dela).
    const ult0 = ativo || (l.periodos || [])[0] || null;
    const x = l.tipo === "loja" ? x0 : valoresDoPeriodo(x0, ult0, l.periodos);
    if (ativo && x !== x0) res.porChave[chave] = x;
    const valores = { gasto: x.gasto, cliques: Math.round(x.cliques || 0), vendas: Math.round(x.vendas || 0), ...(x.diretas != null ? { diretas: Math.round(x.diretas) } : {}), ...(x.receita != null ? { receita: x.receita } : {}) };
    if (ativo) {
      if (parado(st) && !(/pausad/i.test(st) && pausadoNoApp(l.av))) perguntas.push({ chave, l, tipo: "parado", status: nomeSt(st), periodo: ativo, data: quandoParou(ativo, x.gasto), valores });
      else if (metaNaShopee(x0?.lance, ativo, res.periodo?.ate)) perguntas.push({ chave: `${chave}|meta`, l, tipo: "meta-shopee", periodo: ativo, valores, orcamento: orcamentoAtual(ativo) });
      return;
    }
    if (!res.periodo?.de || !res.periodo?.ate || !(x.gasto > 0)) return;
    const ult = (l.periodos || [])[0] || null;
    if (parado(st)) {
      if (!ult) perguntas.push({ chave, l, tipo: "criar-encerrado", status: nomeSt(st), data: res.periodo.de, ate: res.periodo.ate, valores });
      else if (res.periodo.de <= ult.inicio && Math.abs(Number(ult.parcial?.gasto || 0) - x.gasto) >= 0.01)
        perguntas.push({ chave, l, tipo: "corrigir", status: nomeSt(st), periodo: ult, data: ult.fim && ult.fim < res.periodo.ate ? ult.fim : res.periodo.ate, valores, antes: Number(ult.parcial?.gasto || 0) });
      else infos.push(`${l.item.nome}: ${nomeSt(st)} na Shopee, sem gasto novo — período no app encerrado${ult.fim ? ` em ${dm(ult.fim)}` : ""} (R$ ${x.gasto.toFixed(2).replace(".", ",")} no total) ✓`);
      return;
    }
    const ini = [x.inicio, res.periodo.de].filter(Boolean).sort().pop();
    if (ult && ult.fim && ult.fim < res.periodo.ate && ult.fim >= somar(res.periodo.de, -1)) perguntas.push({ chave, l, tipo: "estender", periodo: ult, data: res.periodo.ate, valores });
    else if (!ult || !ult.fim || ult.fim < ini) {
      // Período novo: só as campanhas que começaram depois do último encerrado.
      const xn = valoresDoPeriodo(x0, { id: "novo", inicio: ini }, l.periodos);
      if (xn.gasto > 0) perguntas.push({ chave, l, tipo: "criar", data: ini, ate: res.periodo.ate, valores: { gasto: xn.gasto, cliques: Math.round(xn.cliques || 0), vendas: Math.round(xn.vendas || 0), ...(xn.diretas != null ? { diretas: Math.round(xn.diretas) } : {}) } });
    }
  };
  for (const l of shopee) {
    if (l.av?.ativo && res.periodo?.de && res.periodo.de > l.av.ativo.inicio)
      avisos.push(`${l.item.nome}: sem dados de Ads antes de ${dm(res.periodo.de)} (o período começou em ${dm(l.av.ativo.inicio)}) — o app conta a partir do 1º envio; se quiser o total desde o início, mande também de ${dm(l.av.ativo.inicio)} a ${dm(somar(res.periodo.de, -1))}.`);
    const x = res.porChave[l.chave];
    if (x) tratar(l, x, l.chave);
  }
  // GMV Max da Loja (linha própria do CSV, sem separar por produto).
  let loja = null;
  if (res.loja && lojaLinha && res.periodo?.ate) {
    const ativo = lojaLinha.av?.ativo || null;
    if (ativo) loja = { periodo: ativo, ate: res.periodo.ate, valores: { gasto: res.loja.gasto, cliques: Math.round(res.loja.cliques), vendas: Math.round(res.loja.vendas), receita: res.loja.receita } };
    tratar(lojaLinha, res.loja, lojaLinha.chave);
  }
  for (const a of (res.adsSemPar || []).filter((x) => x.conhecido)) avisos.push(`Anúncio ${a.nome || a.itemId}: R$ ${a.gasto.toFixed(2).replace(".", ",")} de Ads, mas não está ligado a nenhum produto/anúncio do app com preço salvo.`);
  return { ...res, avisos, infos, perguntas, lojaAndamento: loja };
}
