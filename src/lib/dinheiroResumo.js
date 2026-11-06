// Dinheiro → Resumo (06/11/2026, aprovado pela prévia "Dinheiro — Resumo"):
// "desse total, de quem é cada parte" — calculado SOZINHO, sem "separar".
// PURO. Quem chama passa os lançamentos do caixa, os pedidos enriquecidos
// (pedidos.js → enriquecer) e o catálogo ao vivo.
//
// Repor material = custo de material (filamento + falhas + consumíveis + parte
// artesanal) e embalagem das peças vendidas DESDE O INÍCIO − as compras de
// material e embalagem lançadas no caixa (parcelas contam inteiras: o material
// já está em casa, a dívida aparece em "contas dos próximos 30 dias").
// Recompra de revenda = custo de compra dos produtos de revenda vendidos −
// as saídas "Mercadoria pra revenda".
// Energia, máquina, manutenção e acabamento NÃO entram: energia é a conta de
// luz (contas fixas) e a máquina é o fundo da próxima impressora (decisão do
// Gustavo: "material de reposição ou recompra de revenda").
import { ocorrenciasRecorrentes, lancamentosReais, mesDe, somarMeses } from "./fluxoCaixa.js";
import { custoProdutoPorPeca } from "./calc.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const ehTransf = (l) => l.categoria === "transferencia";

const CAT_MATERIAL = new Set(["filamento", "embalagem"]);
const CAT_REVENDA = new Set(["mercadoria"]);
const CAT_IMPOSTO = new Set(["taxas"]);

function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fração do custo de produção que é material comprado (filamento, falhas, consumíveis, artesanal). Sem detalhamento = 1. */
export function fracaoMaterial(produto, materiais) {
  if (!produto || produto.origem === "revenda") return 1;
  const r = produto.producao_detalhe ? custoProdutoPorPeca(produto, materiais) : null;
  if (!r || !(num(r.total) > 0)) return 1;
  const mat = num(r.material) + num(r.falhas) + num(r.consumiveis) + num(r.artesanal);
  return Math.min(1, Math.max(0, mat / num(r.total)));
}

/**
 * Quanto do custo de UMA unidade vendida de um item é "repor material" e "recompra de revenda".
 * item = item do catálogo (p:/v:/k:, já com a embalagem do canal); produtos = ao vivo (com origem/detalhe).
 */
export function reposicaoDoItem(item, { produtos = [], itens = [], fracao }) {
  const out = { material: 0, revenda: 0 };
  if (!item) return out;
  const prodDe = (id) => produtos.find((p) => p.id === id);
  const parte = (prodId, custoPeca, qtd) => {
    const p = prodDe(prodId);
    if (p?.origem === "revenda") out.revenda += custoPeca * qtd;
    else out.material += custoPeca * qtd * fracao(p);
  };
  const id = String(item.id || "");
  if (id.startsWith("k:")) {
    for (const c of item.componentes || []) {
      const pi = itens.find((x) => x.id === `p:${c.produtoId}`);
      parte(c.produtoId, num(pi?.custoProducao), num(c.quantidade));
    }
  } else {
    parte(item.produtoId || id.slice(2), num(item.custoProducao), 1);
  }
  out.material += num(item.embalagem);
  return out;
}

/** Compras já feitas (lançamentos): material/embalagem e mercadoria. Pago, ou parcela (o material já veio). */
export function comprasLancadas(lancamentos = [], hoje) {
  const out = { material: 0, revenda: 0, nMaterial: 0, nRevenda: 0 };
  for (const l of lancamentosReais(lancamentos)) {
    if (l.tipo !== "saida") continue;
    const veio = !!l.data_realizada || !!l.parcela_grupo || String(l.data_prevista) <= hoje;
    if (!veio) continue;
    if (CAT_MATERIAL.has(l.categoria)) {
      out.material += num(l.valor);
      out.nMaterial++;
    } else if (CAT_REVENDA.has(l.categoria)) {
      out.revenda += num(l.valor);
      out.nRevenda++;
    }
  }
  return out;
}

/** Repor material e recompra de revenda desde o início. pedidos = enriquecidos (só os válidos contam). */
export function reposicao({ pedidos = [], lancamentos = [], produtos = [], itens = [], materiais = [], hoje }) {
  const cache = new Map();
  const fracao = (p) => {
    if (!p) return 1;
    if (!cache.has(p.id)) cache.set(p.id, fracaoMaterial(p, materiais));
    return cache.get(p.id);
  };
  let vMat = 0;
  let vRev = 0;
  let desde = null;
  let semCusto = 0;
  for (const p of pedidos) {
    if (!p.valido || String(p.data).slice(0, 10) > hoje) continue;
    if (!p.item) {
      semCusto++;
      continue;
    }
    const r = reposicaoDoItem(p.item, { produtos, itens, fracao });
    vMat += r.material * num(p.q);
    vRev += r.revenda * num(p.q);
    const d = String(p.data).slice(0, 10);
    if (!desde || d < desde) desde = d;
  }
  const c = comprasLancadas(lancamentos, hoje);
  return {
    desde,
    semCusto,
    material: { vendido: r2(vMat), comprado: r2(c.material), falta: r2(vMat - c.material), n: c.nMaterial },
    revenda: { vendido: r2(vRev), comprado: r2(c.revenda), falta: r2(vRev - c.revenda), n: c.nRevenda },
  };
}

/** Saídas ainda não pagas até hoje + dias (atrasadas incluídas), com as recorrentes do período. */
export function contasAte(lancamentos = [], hoje, dias = 30) {
  const limite = somarDias(hoje, dias);
  const reais = lancamentosReais(lancamentos).filter((l) => l.tipo === "saida" && !l.data_realizada && !ehTransf(l) && String(l.data_prevista) <= limite);
  const primeiro = reais.reduce((m, l) => (!m || l.data_prevista < m ? l.data_prevista : m), null);
  const mesIni = primeiro && mesDe(primeiro) < mesDe(hoje) ? mesDe(primeiro) : somarMeses(mesDe(hoje), -1);
  const virt = ocorrenciasRecorrentes(lancamentos, mesIni, mesDe(limite)).filter((l) => l.tipo === "saida" && !ehTransf(l) && String(l.data_prevista) <= limite && String(l.data_prevista) >= `${mesDe(hoje)}-01`);
  const itens = [...reais, ...virt].sort((a, b) => String(a.data_prevista).localeCompare(String(b.data_prevista)));
  const contas = itens.filter((l) => !CAT_IMPOSTO.has(l.categoria));
  const impostos = itens.filter((l) => CAT_IMPOSTO.has(l.categoria));
  return { limite, itens, contas: r2(contas.reduce((t, l) => t + num(l.valor), 0)), impostos: r2(impostos.reduce((t, l) => t + num(l.valor), 0)), nContas: contas.length, nImpostos: impostos.length };
}

/** O que entra e sai nos próximos N dias (lançamentos previstos e recorrentes). */
export function proximosDias(lancamentos = [], hoje, dias = 7) {
  const limite = somarDias(hoje, dias);
  const reais = lancamentosReais(lancamentos).filter((l) => !l.data_realizada && !ehTransf(l) && String(l.data_prevista) >= hoje && String(l.data_prevista) <= limite);
  const virt = ocorrenciasRecorrentes(lancamentos, mesDe(hoje), mesDe(limite)).filter((l) => !ehTransf(l) && String(l.data_prevista) >= hoje && String(l.data_prevista) <= limite);
  return [...reais, ...virt].sort((a, b) => String(a.data_prevista).localeCompare(String(b.data_prevista)));
}

/**
 * Divide o total da loja: repor material, recompra de revenda, contas dos 30 dias,
 * impostos e o que sobra livre. Partes negativas (comprou mais do que vendeu) não tiram nada.
 */
export function partesDoTotal({ total, repor, contas }) {
  const material = Math.max(0, num(repor?.material?.falta));
  const revenda = Math.max(0, num(repor?.revenda?.falta));
  const partes = [
    { chave: "material", valor: r2(material) },
    { chave: "revenda", valor: r2(revenda) },
    { chave: "contas", valor: r2(num(contas?.contas)) },
    { chave: "impostos", valor: r2(num(contas?.impostos)) },
  ];
  const comprometido = partes.reduce((t, p) => t + p.valor, 0);
  const livre = r2(num(total) - comprometido);
  return { partes, comprometido: r2(comprometido), livre, falta: livre < 0 ? r2(-livre) : 0 };
}
