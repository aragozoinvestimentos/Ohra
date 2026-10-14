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
// Nada é gravado aqui: só devolve os números pro Registrar semana preencher.

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
// sku, impressoes, cliques, pedidos, unidades, variacoes: [{ sku, nome, qtd, unidades }] }] }
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
    };
    const porId = new Map();
    for (const l of pl.linhas.slice(iCab + 1)) {
      const id = String(l[c.id] || "").trim();
      if (!id) continue;
      const ehVar = c.idVar >= 0 && l[c.idVar] && l[c.idVar] !== "-";
      if (!porId.has(id)) porId.set(id, { itemId: id, nome: l[c.nome] || "", sku: normSku(l[c.sku]), impressoes: null, cliques: null, pedidos: null, unidades: null, variacoes: [] });
      const it = porId.get(id);
      if (ehVar) {
        it.variacoes.push({ sku: normSku(l[c.skuVar] !== "-" ? l[c.skuVar] : ""), nome: l[c.nomeVar] || "", qtd: quantidadeDaVariacao(l[c.nomeVar]), unidades: numBR(l[c.uni]) || 0 });
      } else {
        it.impressoes = numBR(l[c.imp]);
        it.cliques = numBR(l[c.cli]);
        it.pedidos = numBR(l[c.ped]);
        it.unidades = numBR(l[c.uni]);
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
  const c = {
    id: achar(cab, "ID do produto"),
    nome: achar(cab, "Nome do Anúncio"),
    gasto: achar(cab, "Despesas"),
    cli: achar(cab, "Cliques"),
    itens: achar(cab, "Itens Vendidos"),
    conv: achar(cab, "Conversões"),
  };
  const porItem = new Map();
  const total = { gasto: 0, cliques: 0, vendas: 0 };
  for (const l of linhas.slice(iCab + 1)) {
    const id = String(l[c.id] || "").trim();
    if (!id || id === "-") continue;
    const g = numPonto(l[c.gasto]) || 0;
    const cl = numPonto(l[c.cli]) || 0;
    const v = numPonto(l[c.itens >= 0 ? c.itens : c.conv]) || 0;
    const a = porItem.get(id) || { gasto: 0, cliques: 0, vendas: 0, nome: l[c.nome] || "" };
    a.gasto += g;
    a.cliques += cl;
    a.vendas += v;
    porItem.set(id, a);
    total.gasto += g;
    total.cliques += cl;
    total.vendas += v;
  }
  for (const a of porItem.values()) a.gasto = Math.round(a.gasto * 100) / 100;
  total.gasto = Math.round(total.gasto * 100) / 100;
  return { tipo: "ads", periodo, porItem, total };
}

// Lê um arquivo escolhido (File) e diz o que ele é.
export async function lerRelatorio(arquivo) {
  const nome = arquivo.name || "";
  if (/\.csv$/i.test(nome)) {
    const txt = await arquivo.text();
    const r = interpretarAds(lerCsv(txt), nome);
    if (!r) throw new Error(`${nome}: não parece o "Dados Gerais de Anúncios" do Shopee Ads`);
    return { ...r, arquivo: nome };
  }
  const r = interpretarDesempenho(await lerXlsx(await arquivo.arrayBuffer()), nome);
  if (!r) throw new Error(`${nome}: não parece o relatório de desempenho do produto (Informações Gerenciais → Produto)`);
  return { ...r, arquivo: nome };
}

// Junta os relatórios lidos e liga cada anúncio a um item do app pelo SKU.
// `itensApp` = [{ chave, sku, tipo: 'produto'|'kit'|'variacao', skuPai?, quantidade? }]
// Devolve { periodo, porChave: { chave: { vendas, impressoes, cliquesProduto,
// pedidos, gasto, cliques, adsVendas, mistura } }, semPar: [...], adsSemPar, avisos }.
export function cruzarRelatorios(relatorios, itensApp) {
  const desemp = relatorios.find((r) => r.tipo === "desempenho") || null;
  const ads = relatorios.find((r) => r.tipo === "ads") || null;
  const avisos = [];
  const periodo = desemp?.periodo || ads?.periodo || null;
  if (desemp?.periodo && ads?.periodo && (desemp.periodo.de !== ads.periodo.de || desemp.periodo.ate !== ads.periodo.ate))
    avisos.push("Os dois relatórios são de períodos diferentes — exporte os dois com as mesmas datas.");
  if (!desemp && ads) avisos.push("Só o Ads não basta: importe junto o relatório de desempenho do produto (é ele que liga o anúncio ao SKU).");
  const porChave = {};
  const usados = new Set();
  const porSku = new Map((desemp?.itens || []).filter((i) => i.sku).map((i) => [i.sku, i]));
  for (const it of itensApp) {
    const sku = normSku(it.sku);
    let num = null;
    if (it.tipo === "variacao") {
      // Variação de quantidade: soma as variações da Shopee com o SKU dela
      // (CH-OC-2 → CH-OC-2-PB, CH-OC-2-BP) ou, sem SKU, pela quantidade no nome.
      const pai = porSku.get(normSku(it.skuPai));
      if (!pai) continue;
      const vs = pai.variacoes.filter((v) => (sku ? v.sku === sku || v.sku.startsWith(`${sku}-`) : v.qtd === it.quantidade));
      if (!vs.length) continue;
      num = { vendas: vs.reduce((t, v) => t + v.unidades, 0) };
    } else {
      const d = sku ? porSku.get(sku) : null;
      if (!d) continue;
      usados.add(d.itemId);
      const a = ads?.porItem.get(d.itemId);
      const mistura = {};
      for (const v of d.variacoes) if (v.unidades > 0 && v.qtd) mistura[v.qtd] = (mistura[v.qtd] || 0) + v.unidades;
      num = {
        vendas: d.unidades,
        impressoes: d.impressoes,
        cliquesProduto: d.cliques,
        pedidos: d.pedidos,
        // Sem linha no Ads = não teve anúncio pago: campos de Ads ficam em branco.
        ...(a ? { gasto: a.gasto, cliques: a.cliques, adsVendas: a.vendas } : {}),
        mistura: Object.keys(mistura).length ? mistura : null,
      };
    }
    porChave[it.chave] = num;
  }
  const comNumero = (i) => (i.unidades || 0) > 0 || (i.impressoes || 0) > 0 || ads?.porItem.has(i.itemId);
  const semPar = (desemp?.itens || []).filter((i) => !usados.has(i.itemId) && comNumero(i));
  const adsSemPar = ads ? [...ads.porItem.entries()].filter(([id]) => !usados.has(id)).map(([id, a]) => ({ itemId: id, ...a })) : [];
  return { periodo, porChave, semPar, adsSemPar, avisos, temDesempenho: !!desemp, temAds: !!ads, totalAds: ads?.total || null };
}

// "6 × 1 un. · 2 × kit 2"
export function textoMistura(m) {
  if (!m) return "";
  return Object.entries(m)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([q, n]) => `${n} × ${Number(q) === 1 ? "1 un." : `kit ${q}`}`)
    .join(" · ");
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
  const desemp = (relatorios || []).find((r) => r?.tipo === "desempenho");
  if (!desemp) return;
  const m = idsShopeeLembrados();
  for (const i of desemp.itens) if (i.itemId && i.sku) m[i.itemId] = i.sku;
  try {
    localStorage.setItem(CHAVE_IDS, JSON.stringify(m));
  } catch {
    // sem problema: na próxima vez importa o desempenho junto
  }
}

// Ads por item do app: itensApp = [{ chave, sku }]. Números do período do CSV
// (o andamento é ACUMULADO: exporte do início do período de Ads até ontem).
export function adsPorItemApp(relatorios, itensApp) {
  const ads = (relatorios || []).find((r) => r?.tipo === "ads") || null;
  if (!ads) return { periodo: null, porChave: {}, adsSemPar: [], avisos: ["Escolha o CSV do Shopee Ads (Marketing → Shopee Ads → Exportar dados)."] };
  lembrarIdsShopee(relatorios);
  const idSku = idsShopeeLembrados();
  const porSku = new Map();
  for (const [id, a] of ads.porItem) {
    const sku = normSku(idSku[id]);
    if (!sku) continue;
    const t = porSku.get(sku) || { gasto: 0, cliques: 0, vendas: 0, ids: [] };
    t.gasto += a.gasto;
    t.cliques += a.cliques;
    t.vendas += a.vendas;
    t.ids.push(id);
    porSku.set(sku, t);
  }
  const porChave = {};
  const usados = new Set();
  for (const it of itensApp) {
    const t = porSku.get(normSku(it.sku));
    if (!t) continue;
    t.ids.forEach((id) => usados.add(id));
    porChave[it.chave] = { gasto: Math.round(t.gasto * 100) / 100, cliques: t.cliques, vendas: t.vendas };
  }
  const adsSemPar = [...ads.porItem.entries()].filter(([id, a]) => !usados.has(id) && a.gasto > 0).map(([id, a]) => ({ itemId: id, ...a, conhecido: !!idSku[id] }));
  const avisos = [];
  if (adsSemPar.some((a) => !a.conhecido)) avisos.push("Alguns anúncios do Ads ainda não estão ligados a um SKU: importe junto, uma vez, o relatório de desempenho do produto (Informações Gerenciais → Produto → Performance do produto).");
  // Produto com SKU já ligado a algum anúncio e sem linha no CSV = sem gasto (0);
  // SKU que o app ainda não conhece fica em branco.
  const skusConhecidos = new Set(Object.values(idSku).map(normSku));
  const zerados = itensApp.filter((it) => !porChave[it.chave] && skusConhecidos.has(normSku(it.sku))).map((it) => it.chave);
  return { periodo: ads.periodo, porChave, zerados, adsSemPar, avisos };
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
  const desemp = relatorios.find((r) => r.tipo === "desempenho") || null;
  const ads = relatorios.find((r) => r.tipo === "ads") || null;
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
