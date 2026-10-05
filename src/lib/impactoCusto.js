// "Impacto da mudança": mexeu na fabricação/embalagem/frete/peso de um
// produto (ou de uma variação) — quanto muda o lucro de tudo que depende dele
// (o próprio produto, as variações dele e os kits que o contêm), em cada canal
// com preço salvo. As duas contas usam o custo ao vivo e as taxas de hoje, então
// a diferença é só o efeito da mudança.
import { produtoAoVivo } from "./aoVivo.js";
import { calcVariacao, resumoProduto } from "./variacoes.js";
import { lucroNoPreco, precoMinimoAceitavel } from "./escada.js";
import { alertaPreco, estrategiaEfetiva, produtosEmRampa } from "./estrategia.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;

const PREFIXO = { produto: "p", variacao: "v", kit: "k" };

// Linhas por item afetado × canal com preço salvo.
// O alerta (prejuízo / abaixo do mínimo) é o da função única alertaPreco, com
// a estratégia do item (crescimento/atração/rampa silenciam o mínimo) e o
// lucro NOVO — se a mudança derrubar o lucro abaixo do lucro de referência
// da decisão, a estratégia vence e o aviso volta.
function montarLinhas(afetados, { canais, precos, cfgDoProduto, itens = [], rampas = [] }) {
  const linhas = [];
  const emRampa = produtosEmRampa(rampas, precos);
  for (const a of afetados) {
    const tipo = Object.keys(PREFIXO).find((k) => PREFIXO[k] === a.id[0]);
    const idCru = a.id.slice(2);
    const cfg = cfgDoProduto(a.produtoId || null);
    for (const c of canais) {
      const salvo = precos.find((p) => p.item_tipo === tipo && p.item_id === idCru && p.canal_id === c.id);
      if (!salvo || !(num(salvo.preco) > 0)) continue;
      const preco = num(salvo.preco);
      const lucroHoje = lucroNoPreco(c, preco, a.custoAtual, a.pesoAtual, cfg);
      const lucroNovo = lucroNoPreco(c, preco, a.custoNovo, a.pesoNovo, cfg);
      const minimo = precoMinimoAceitavel(c, a.custoNovo, a.pesoNovo, cfg);
      const item = itens.find((i) => i.id === a.id) || { id: a.id, produtoId: a.produtoId };
      const estrategia = estrategiaEfetiva(item, c, { precos, emRampa, lucroAoVivo: lucroNovo });
      const al = alertaPreco({ lucro: lucroNovo, preco, minimo, estrategia });
      linhas.push({
        id: `${a.id}|${c.id}`,
        nome: a.nome,
        canal: c,
        preco,
        lucroHoje,
        lucroNovo,
        diferenca: lucroNovo - lucroHoje,
        margemNova: preco > 0 ? lucroNovo / preco : null,
        prejuizo: al.tipo === "prejuizo",
        prejuizoDiscreto: al.tipo === "prejuizo" && al.discreto,
        abaixoMinimo: al.tipo === "abaixo-minimo",
        estrategia,
      });
    }
  }
  return linhas;
}

// Produto com campos novos (rascunho do formulário). `produtoNovoRaw` = linha
// de produtos_cadastro com os campos editados; `receitaNova` = itens de
// embalagem [{ embalagem_id, quantidade }] (null = mantém a atual).
export function impactoProduto({ produtoId, produtoNovoRaw, receitaNova = null, dados, cfgDoProduto }) {
  const { produtos, variacoes, materiais, embalagens, produtoEmbalagens, itens, canais, precos } = dados;
  const atual = produtos.find((p) => p.id === produtoId);
  if (!atual || !produtoNovoRaw) return null;
  const pe = receitaNova ? [...produtoEmbalagens.filter((r) => r.produto_id !== produtoId), ...receitaNova.map((r) => ({ ...r, produto_id: produtoId }))] : produtoEmbalagens;
  const novo = produtoAoVivo({ ...produtoNovoRaw, id: produtoId }, { materiais, produtoEmbalagens: pe, embalagens });
  const custoTotal = (p) => num(p.custo_producao) + num(p.frete_padrao) + num(p.embalagem_padrao);

  const afetados = [];
  const itemP = itens.find((i) => i.id === `p:${produtoId}`);
  if (itemP) {
    afetados.push({
      id: itemP.id,
      nome: `${atual.nome} (avulso)`,
      produtoId,
      custoAtual: itemP.custoTotal,
      pesoAtual: itemP.peso,
      custoNovo: cent(custoTotal(novo)),
      pesoNovo: resumoProduto(novo, { embalagens, produtoEmbalagens: pe }).peso,
    });
  }
  for (const v of variacoes.filter((x) => x.produto_id === produtoId)) {
    const it = itens.find((i) => i.id === `v:${v.id}`);
    if (!it) continue;
    const c = calcVariacao(v, novo, { materiais, embalagens, produtoEmbalagens: pe });
    afetados.push({ id: it.id, nome: `${atual.nome} — ${v.nome}`, produtoId, custoAtual: it.custoTotal, pesoAtual: it.peso, custoNovo: cent(c.custoTotal), pesoNovo: c.peso });
  }
  const dProd = num(novo.custo_producao) - num(atual.custo_producao);
  const dPeso = num(novo.peso_g) - num(atual.peso_g);
  for (const k of itens.filter((i) => i.tipo === "Kit" && (i.componentes || []).some((c) => c.produtoId === produtoId))) {
    const q = k.componentes.filter((c) => c.produtoId === produtoId).reduce((s, c) => s + num(c.quantidade), 0);
    afetados.push({ id: k.id, nome: k.nome, produtoId: null, custoAtual: k.custoTotal, pesoAtual: k.peso, custoNovo: cent(k.custoTotal + q * dProd), pesoNovo: k.peso + q * dPeso });
  }

  const linhas = montarLinhas(afetados, { canais, precos, cfgDoProduto, itens: dados.itens, rampas: dados.rampas });
  return resumo({
    custoPecaAtual: num(atual.custo_producao),
    custoPecaNovo: num(novo.custo_producao),
    custoTotalAtual: itemP?.custoTotal ?? null,
    custoTotalNovo: cent(custoTotal(novo)),
    afetados,
    linhas,
  });
}

// Variação com campos novos (editor de variação).
export function impactoVariacao({ variacaoId, variacaoNova, dados, cfgDoProduto }) {
  const { produtos, materiais, embalagens, produtoEmbalagens, itens, canais, precos } = dados;
  const it = itens.find((i) => i.id === `v:${variacaoId}`);
  const produto = it && produtos.find((p) => p.id === it.produtoId);
  if (!it || !produto || !variacaoNova) return null;
  const c = calcVariacao({ ...variacaoNova, id: variacaoId }, produto, { materiais, embalagens, produtoEmbalagens });
  const afetados = [{ id: it.id, nome: it.nome, produtoId: produto.id, custoAtual: it.custoTotal, pesoAtual: it.peso, custoNovo: cent(c.custoTotal), pesoNovo: c.peso }];
  return resumo({ custoTotalAtual: it.custoTotal, custoTotalNovo: cent(c.custoTotal), afetados, linhas: montarLinhas(afetados, { canais, precos, cfgDoProduto, itens: dados.itens, rampas: dados.rampas }) });
}

function resumo(r) {
  const diffs = r.linhas.map((l) => l.diferenca);
  const dCusto = r.custoTotalNovo != null && r.custoTotalAtual != null ? r.custoTotalNovo - r.custoTotalAtual : 0;
  const relevante = Math.abs(dCusto) >= 0.05 || diffs.some((d) => Math.abs(d) >= 0.05);
  return {
    ...r,
    dCusto,
    relevante,
    itensAfetados: r.afetados.length,
    canaisAfetados: new Set(r.linhas.map((l) => l.canal.id)).size,
    algumProblema: r.linhas.some((l) => (l.prejuizo && !l.prejuizoDiscreto) || l.abaixoMinimo),
    // Estratégia (crescimento/atração) que VENCE com essa mudança: o lucro cai
    // mais de R$0,05 abaixo do lucro do dia da decisão.
    decisaoVence: r.linhas.some((l) => l.estrategia?.vencida && l.estrategia.motivoVencida === "lucro"),
  };
}
