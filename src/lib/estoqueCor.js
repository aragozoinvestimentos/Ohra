// Estoque por COR (31/10/2026, schema v74). Vale só pra produto que tem a variação
// "Cor" na Ficha do anúncio (cores_anuncio). Cada movimento de estoque leva a cor
// (null = "sem cor": os de antes do v74 e o que não deu pra saber); cada venda pega
// a cor pelo sufixo do SKU (SKU do item + sufixo da cor, como a Ficha monta). PURO.
import { lerVariacoes } from "./vinculoSku.js";
import { estoqueDoProduto, situacaoEstoque } from "./revenda.js";

const norm = (x) => String(x || "").trim().toUpperCase();
const mesmo = (a, b) => norm(a).normalize("NFD").replace(/[̀-ͯ]/g, "") === norm(b).normalize("NFD").replace(/[̀-ͯ]/g, "");
export const SEM_COR = "sem cor";

/** [{ nome, sufixo }] da variação "Cor" do produto (ou kit); [] se não tiver. */
export function coresDoProduto(p) {
  const v = lerVariacoes(p?.cores_anuncio).find((x) => /^cor/i.test(String(x.nome).trim()));
  return v ? v.opcoes.filter((o) => o.nome) : [];
}

/** Cor (nome) pelo SKU vendido; null se não der pra saber. */
export function corPeloSku(sku, cores, base = "") {
  const s = norm(sku);
  if (!s || !cores?.length) return null;
  const b = norm(base);
  const resto = b && s.startsWith(b) ? s.slice(b.length) : s;
  let achou = null;
  for (const c of cores) {
    const suf = norm(c.sufixo);
    if (!suf) continue;
    let i = resto.indexOf(suf);
    while (i >= 0) {
      const depois = resto[i + suf.length];
      if (depois === undefined || depois === "-") {
        if (!achou || suf.length > norm(achou.sufixo).length) achou = c;
        break;
      }
      i = resto.indexOf(suf, i + 1);
    }
  }
  return achou ? achou.nome : null;
}

/**
 * Cor de uma linha de venda (enriquecer) pro produto `produto` (peça que sai do estoque).
 * Kit: a cor do kit (pelo SKU dele) vale pra peça se a peça tem uma cor com o mesmo nome.
 */
export function corDaVenda(l, produto, { kit = null } = {}) {
  const cores = coresDoProduto(produto);
  if (!cores.length) return undefined;
  if (kit) {
    const doKit = corPeloSku(l?.sku, coresDoProduto(kit), l?.item?.sku);
    const c = doKit && cores.find((x) => mesmo(x.nome, doKit));
    return c ? c.nome : corPeloSku(l?.sku, cores) || null;
  }
  return corPeloSku(l?.sku, cores, l?.item?.sku);
}

const PIOR = { negativo: 5, zerado: 4, repor: 3, parado: 1, ok: 0, "sem-controle": 0 };

/**
 * Estoque de cada cor (+ "sem cor" se tiver algo). Usa o MESMO início do produto, então
 * a soma das cores = o total do produto.
 * → [{ cor, semCor, est, sit }]
 */
export function estoquePorCor({ movimentos = [], vendas = [], hoje, cores = [], inicio, cfg }) {
  if (!cores.length || !inicio) return [];
  const nomes = cores.map((c) => c.nome);
  const daCor = (x) => {
    const c = x?.cor;
    if (!c) return null;
    const n = nomes.find((y) => mesmo(y, c));
    return n || null;
  };
  const out = [];
  for (const nome of nomes) {
    const est = estoqueDoProduto({ movimentos: movimentos.filter((m) => daCor(m) === nome), vendas: vendas.filter((v) => daCor(v) === nome), hoje, inicio });
    out.push({ cor: nome, semCor: false, est, sit: situacaoEstoque(est, cfg, hoje) });
  }
  const mSem = movimentos.filter((m) => !daCor(m));
  const vSem = vendas.filter((v) => !daCor(v) && v.data >= inicio);
  if (mSem.length || vSem.length) {
    const est = estoqueDoProduto({ movimentos: mSem, vendas: vSem, hoje, inicio });
    if (Math.abs(est.saldo) > 1e-9 || Math.abs(est.reservado) > 1e-9) out.push({ cor: SEM_COR, semCor: true, est, sit: situacaoEstoque(est, cfg, hoje) });
  }
  return out;
}

/** A pior situação entre as cores (sem o "sem cor"), com o nome da cor na frente. */
export function piorCor(porCor) {
  let pior = null;
  for (const x of porCor || []) {
    if (x.semCor) continue;
    if (!pior || (PIOR[x.sit.tipo] || 0) > (PIOR[pior.sit.tipo] || 0)) pior = x;
  }
  return pior && (PIOR[pior.sit.tipo] || 0) > 0 ? pior : null;
}

export const PESO_SITUACAO = PIOR;

export const textoPorCor = (porCor) => (porCor || []).map((x) => `${x.cor} ${Number.isInteger(x.est.saldo) ? x.est.saldo : x.est.saldo.toFixed(1).replace(".", ",")}`).join(" · ");
