// Nota de compra pelo PDF (DANFE) — 28/10/2026, pedido do Gustavo.
// O XML continua sendo o caminho certo (vem tudo exato); o PDF é lido pela POSIÇÃO
// do texto na página, então é "melhor esforço": o que a chave de acesso dá é exato
// (CNPJ e UF do emitente, número, série), o resto (itens, totais, duplicatas) sai
// das colunas da tabela e SEMPRE passa pela conferência da tela de importar.
// PURO: recebe as páginas já extraídas (lerDanfePdf.js faz a extração com o pdf.js)
// e devolve o MESMO formato do lerNfe (revenda.js) + { origem: "pdf", avisos }.
import { eanValido } from "./revenda.js";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const RE_NUM = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;
/** "1.234,5600" → 1234.56 */
export const numBr = (s) => {
  const t = String(s || "").replace(/[R$\s]/g, "");
  if (!RE_NUM.test(t)) return null;
  const x = Number(t.replace(/\./g, "").replace(",", "."));
  return isFinite(x) ? x : null;
};
const UF_DO_CODIGO = { 11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF" };
const UFS = new Set(Object.values(UF_DO_CODIGO));
const dataIso = (dmy) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(dmy || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/** Chave de acesso (44 dígitos) → partes exatas (layout oficial da NF-e). */
export function partesDaChave(chave) {
  const d = soDigitos(chave);
  if (d.length !== 44) return null;
  return { chave: d, uf: UF_DO_CODIGO[Number(d.slice(0, 2))] || "", anoMes: `20${d.slice(2, 4)}-${d.slice(4, 6)}`, cnpj: d.slice(6, 20), modelo: d.slice(20, 22), serie: String(Number(d.slice(22, 25))), numero: String(Number(d.slice(25, 34))) };
}

// ---------- ajudas de posição (y de cima pra baixo) ----------
const centro = (it) => it.x + it.w / 2;
function linhasDe(itens, tol = 2.5) {
  const ord = [...itens].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of ord) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.y - it.y) <= tol) l.itens.push(it);
    else out.push({ y: it.y, itens: [it] });
  }
  for (const l of out) l.itens.sort((a, b) => a.x - b.x);
  return out;
}
const textoDe = (itens) => linhasDe(itens).map((l) => l.itens.map((i) => i.t).join(" ")).join("\n");
const acha = (itens, re, depoisDe = -1) => itens.filter((i) => i.y > depoisDe && re.test(norm(i.t))).sort((a, b) => a.y - b.y)[0] || null;
/** Valor logo ABAIXO de um rótulo (mesma coluna), ou no próprio rótulo ("VALOR DO FRETE 0,00"). */
function valorAbaixo(itens, rot, aceita = (s) => numBr(s) != null) {
  const fim = /(\S+)$/.exec(rot.t)?.[1];
  if (fim && aceita(fim) && norm(rot.t).length > fim.length + 3) return fim;
  const cand = itens.filter((i) => i !== rot && i.y > rot.y + rot.h * 0.4 && i.y < rot.y + rot.h + 22 && i.x < rot.x + rot.w + 12 && i.x + i.w > rot.x - 12 && aceita(i.t.trim()));
  cand.sort((a, b) => a.y - b.y || Math.abs(centro(a) - centro(rot)) - Math.abs(centro(b) - centro(rot)));
  return cand[0]?.t.trim() ?? null;
}

// ---------- colunas da tabela de produtos ----------
const COLUNAS = [
  ["descricao", /DESCRI/],
  ["ncm", /NCM/],
  ["cfop", /CFOP/],
  ["cst", /CST|CSOSN/],
  ["unidade", /^UN|UNID/],
  ["qtd", /QUANT|QTD|QTDE/],
  ["vUn", /UNIT/],
  ["vDesc", /DESC/],
  ["vProd", /TOTAL|V\.? ?LIQ|VALOR LIQ/],
  ["bcIcms", /B\.? ?C(ALC)?|BASE/],
  ["vIPI", /IPI/],
  ["vICMS", /ICMS/],
  ["aliq", /ALIQ/],
  ["codigo", /COD/],
];
function tipoDaColuna(txt) {
  const t = norm(txt);
  if (/ALIQ/.test(t)) return "aliq";
  if (/DESCRI/.test(t)) return "descricao";
  for (const [k, re] of COLUNAS) if (re.test(t)) return k;
  return null;
}

function itensDaPagina(itens, avisos) {
  const titulo = acha(itens, /DADOS DOS? PRODUTOS?/);
  const cab = acha(itens, /DESCRI/, titulo ? titulo.y : -1);
  if (!cab) return [];
  // faixa do cabeçalho: rótulos em até 2 linhas em volta do "DESCRIÇÃO"
  const faixa = itens.filter((i) => i.y >= cab.y - cab.h * 1.6 && i.y <= cab.y + cab.h * 1.8 && (!titulo || i.y > titulo.y + 1));
  const ord = [...faixa].sort((a, b) => a.x - b.x);
  const cols = [];
  for (const it of ord) {
    const c = cols[cols.length - 1];
    if (c && it.x < c.x1 - 0.5) {
      c.x1 = Math.max(c.x1, it.x + it.w);
      c.partes.push(it);
    } else cols.push({ x0: it.x, x1: it.x + it.w, partes: [it] });
  }
  for (const c of cols) {
    c.texto = [...c.partes].sort((a, b) => a.y - b.y).map((p) => p.t).join(" ");
    c.k = tipoDaColuna(c.texto);
    c.c = (c.x0 + c.x1) / 2;
  }
  const uteis = cols.filter((c) => c.k);
  const tem = (k) => uteis.some((c) => c.k === k);
  if (!tem("descricao") || !tem("qtd") || !tem("vProd")) {
    avisos.push("Não achei as colunas da tabela de produtos (Descrição, Quantidade, Valor total) — confira os itens.");
    return [];
  }
  const baixoCab = Math.max(...faixa.map((i) => i.y + i.h));
  const fimSec = acha(itens, /DADOS ADICIONAIS|INFORMACOES COMPLEMENTARES|CALCULO DO ISSQN/, baixoCab);
  const corpo = itens.filter((i) => i.y > baixoCab && (!fimSec || i.y < fimSec.y - 0.5));
  // a coluna de um texto = a do centro mais próximo (descrição é larga: vale a faixa dela)
  const desc = uteis.find((c) => c.k === "descricao");
  const colDe = (it) => {
    const cx = centro(it);
    if (it.x >= desc.x0 - 2 && cx <= desc.x1 + 2 && !RE_NUM.test(it.t.trim())) return "descricao";
    let m = null;
    for (const c of uteis) if (!m || Math.abs(c.c - cx) < Math.abs(m.c - cx)) m = c;
    return m.k;
  };
  const out = [];
  for (const l of linhasDe(corpo)) {
    const v = {};
    for (const it of l.itens) {
      // "10,0000 5,9000" num pedaço só: separa pelos espaços
      const pedacos = it.t.trim().split(/\s{2,}/);
      if (pedacos.length > 1 && pedacos.every((p) => RE_NUM.test(p))) {
        const w = it.w / pedacos.length;
        pedacos.forEach((p, i) => { const k = colDe({ ...it, t: p, x: it.x + i * w, w }); v[k] = v[k] ? `${v[k]} ${p}` : p; });
        continue;
      }
      const k = colDe(it);
      v[k] = v[k] ? `${v[k]} ${it.t.trim()}` : it.t.trim();
    }
    const qtd = numBr(v.qtd), vProd = numBr(v.vProd);
    if (qtd != null && vProd != null && (v.descricao || v.codigo)) {
      const vUn = numBr(v.vUn);
      const aliqs = String(v.aliq || "").split(/\s+/).map(numBr).filter((x) => x != null);
      const cod = String(v.codigo || "").trim();
      out.push({
        codigo: cod,
        ean: /^\d{8}$|^\d{12,14}$/.test(cod) ? eanValido(cod) : null,
        descricao: String(v.descricao || "").trim(),
        ncm: soDigitos(v.ncm) || null,
        unidade: String(v.unidade || "UN").trim().toUpperCase() || "UN",
        qtd,
        unidadeTrib: null,
        qtdTrib: 0,
        vUn: vUn ?? (qtd ? vProd / qtd : 0),
        vProd,
        vDesc: numBr(v.vDesc) || 0,
        vFrete: 0,
        vSeg: 0,
        vOutro: 0,
        vIPI: numBr(v.vIPI) || 0,
        vST: 0,
        vICMS: numBr(v.vICMS) || 0,
        pICMS: (aliqs[0] || 0) / 100,
        cfop: soDigitos(v.cfop) || null,
        cst: String(v.cst || "").trim() || null,
      });
    } else if (out.length) {
      // linha embaixo do item: código de barras, nº da FCI ou a descrição que quebrou
      const ult = out[out.length - 1];
      const linha = l.itens.map((i) => i.t.trim()).join(" ");
      const barras = /C[OÓ]D\.?\s*(DE\s*)?BARRAS\s*:?\s*(\d{8,14})|\b(?:GTIN|EAN)\s*:?\s*(\d{8,14})/i.exec(linha);
      if (barras) ult.ean = ult.ean || eanValido(barras[2] || barras[3]); // "Cód. Barras: 7900083000665"
      else if (/CONTROLE\s*FCI|^\*?\s*FCI\b/.test(norm(linha))) ult.fci = linha.replace(/^\*/, "").trim(); // FCI não é descrição
      else if (v.descricao && Object.keys(v).length === 1) ult.descricao += ` ${v.descricao}`; // descrição que quebrou de linha
    }
  }
  return out;
}

const TOTAIS = [
  ["vProd", /^((VALOR|V\.) ?)?TOTAL (DOS )?PRODUTOS/],
  ["vFrete", /^(VALOR|V\.) ?DO FRETE|^(VALOR|V\.) ?FRETE/],
  ["vSeg", /^(VALOR|V\.) ?DO SEGURO|^(VALOR|V\.) ?SEGURO/],
  ["vDesc", /^DESCONTO|^(VALOR|V\.) ?(DO )?DESCONTO/],
  ["vOutro", /OUTRAS DESP/],
  ["vIPI", /^(VALOR|V\.) ?(TOTAL )?(DO )?IPI/],
  ["vST", /^(VALOR|V\.) ?(DO )?ICMS (SUBST|ST)/],
  ["vNF", /^((VALOR|V\.) ?)?TOTAL (DA )?NOTA/],
];

/**
 * paginas = [{ itens: [{ t, x, y (topo, de cima pra baixo), w, h }] }] → nota no formato do lerNfe
 * + { origem: "pdf", avisos: [] } — ou { erro }.
 */
export function interpretarDanfe(paginas) {
  const todos = (paginas || []).flatMap((p) => p.itens || []);
  const texto = (paginas || []).map((p) => textoDe(p.itens || [])).join("\n");
  if (!/DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL/i.test(norm(texto))) {
    if (!todos.length) return { erro: "Não consegui ler texto neste PDF — parece imagem (nota escaneada/foto). Use o XML da nota." };
    return { erro: "Este PDF não parece uma DANFE (nota fiscal eletrônica). Use o PDF da nota que veio do fornecedor, ou o XML." };
  }
  const avisos = [];
  const m44 = /(?:\d[\s.]?){44}/.exec(texto.replace(/\n/g, " "));
  const ch = partesDaChave(m44 ? m44[0] : "");
  if (!ch) avisos.push("Não achei a chave de acesso (44 dígitos) — confira o fornecedor e o número.");
  const p1 = paginas[0]?.itens || [];

  // emitente: o canhoto "RECEBEMOS DE <NOME> OS PRODUTOS…" ou o maior texto do topo
  let nome = (/RECEBEMOS DE\s+(.+?)\s+OS (PRODUTOS|SERVICOS|MERCADORIAS)/.exec(norm(texto.replace(/\n/g, " "))) || [])[1] || "";
  if (!nome) {
    const alturaMax = Math.max(...p1.map((i) => i.y + i.h), 1);
    const topo = p1.filter((i) => i.y < alturaMax * 0.3 && /[A-Za-z]{3}/.test(i.t) && !/DANFE|RECEBEMOS|DOCUMENTO|NOTA FISCAL|ENTRADA|SAIDA|CHAVE|CONSULTA|PROTOCOLO|IDENTIFICA/i.test(norm(i.t)));
    nome = topo.sort((a, b) => b.h - a.h)[0]?.t?.trim() || "";
  }

  // data de emissão
  let emissao = "";
  const rotEm = acha(p1, /DATA (DA |DE )?EMISS/);
  if (rotEm) emissao = dataIso(valorAbaixo(p1, rotEm, (s) => /\d{2}\/\d{2}\/\d{4}/.test(s)));
  if (!emissao) {
    const datas = [...texto.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
    emissao = (ch && datas.find((d) => d.slice(0, 7) === ch.anoMes)) || datas[0] || "";
  }

  // UF do destinatário (a sua loja): o "UF" dentro do bloco do destinatário
  let ufDestino = "";
  const rotDest = acha(p1, /DESTINATARIO/);
  if (rotDest) {
    const prox = acha(p1, /FATURA|DUPLICATA|CALCULO DO IMPOSTO/, rotDest.y + 1);
    const naSecao = p1.filter((i) => i.y > rotDest.y && (!prox || i.y < prox.y));
    const rotUf = naSecao.find((i) => norm(i.t) === "UF");
    if (rotUf) ufDestino = valorAbaixo(naSecao, rotUf, (s) => UFS.has(norm(s))) || "";
    if (!ufDestino) ufDestino = naSecao.map((i) => norm(i.t)).find((s) => UFS.has(s)) || "";
  }

  // totais (bloco "CÁLCULO DO IMPOSTO")
  const totais = { vProd: 0, vIPI: 0, vST: 0, vFrete: 0, vSeg: 0, vOutro: 0, vDesc: 0, vNF: 0 };
  const rotCalc = acha(p1, /CALCULO DO IMPOSTO/);
  if (rotCalc) {
    const prox = acha(p1, /TRANSPORTADOR|DADOS DOS? PRODUTOS?/, rotCalc.y + 1);
    const sec = p1.filter((i) => i.y > rotCalc.y && (!prox || i.y < prox.y));
    for (const [k, re] of TOTAIS) {
      const rot = sec.find((i) => re.test(norm(i.t)));
      if (rot) totais[k] = numBr(valorAbaixo(sec, rot)) || 0;
    }
  } else avisos.push("Não achei o bloco “Cálculo do imposto” — confira frete, IPI, ST e o total.");

  // duplicatas (bloco "FATURA / DUPLICATAS"): data de vencimento seguida do valor
  const duplicatas = [];
  const rotFat = acha(p1, /FATURA|DUPLICATA/);
  if (rotFat) {
    const prox = acha(p1, /CALCULO DO IMPOSTO/, rotFat.y + 1);
    const sec = textoDe(p1.filter((i) => i.y > rotFat.y - 1 && (!prox || i.y < prox.y))).replace(/\n/g, " ");
    let n = 0;
    for (const m of sec.matchAll(/(\d{2}\/\d{2}\/\d{4})\D{0,30}?(\d{1,3}(?:\.\d{3})*,\d{2})/g)) {
      const valor = numBr(m[2]);
      if (valor > 0) duplicatas.push({ n: String(++n).padStart(3, "0"), venc: dataIso(m[1]), valor });
    }
  }

  // itens (a tabela pode continuar nas outras páginas)
  const itens = (paginas || []).flatMap((p) => itensDaPagina(p.itens || [], avisos)).map((it, i) => ({ ...it, n: i + 1 }));
  if (!itens.length) return { erro: "Não consegui ler os produtos deste PDF. Use o XML da nota (vem no e-mail do fornecedor ou no site da Receita pela chave de acesso)." };
  const somaProd = itens.reduce((s, i) => s + i.vProd, 0);
  if (!totais.vProd) totais.vProd = Math.round(somaProd * 100) / 100;
  else if (Math.abs(somaProd - totais.vProd) > 0.05) avisos.push(`A soma dos itens lidos (${somaProd.toFixed(2).replace(".", ",")}) não bate com o total dos produtos da nota (${totais.vProd.toFixed(2).replace(".", ",")}) — algum item pode ter ficado de fora ou com valor errado.`);
  // IPI e ST: a DANFE mostra o total; sem a coluna por item, reparte pelo valor
  const ratear = (campo, total) => {
    if (!total || itens.some((i) => i[campo] > 0)) return;
    for (const i of itens) i[campo] = Math.round(((total * i.vProd) / (somaProd || 1)) * 100) / 100;
  };
  ratear("vIPI", totais.vIPI);
  ratear("vST", totais.vST);
  if (totais.vST > 0) avisos.push("Nota com ICMS-ST: a DANFE só mostra o total — repartido pelo valor de cada item.");
  return {
    chave: ch?.chave || null,
    numero: ch?.numero || (/N[º°O.]\s*:?\s*([\d.]+)/.exec(norm(texto)) || [])[1]?.replace(/\./g, "") || "",
    serie: ch?.serie || "",
    emissao,
    emitente: { cnpj: ch?.cnpj || soDigitos((/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.exec(texto) || [])[0]), nome: nome.slice(0, 80), uf: ch?.uf || "" },
    ufDestino,
    totais,
    itens,
    duplicatas,
    origem: "pdf",
    avisos,
  };
}
