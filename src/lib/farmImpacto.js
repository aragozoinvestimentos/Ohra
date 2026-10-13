// Mudança na farm (impressora ou config) × lucro de tudo que depende dela:
// recalcula o custo de produção de cada produto com a farm NOVA e compara com
// o de hoje, no preço salvo de cada canal (mesma conta do "Impacto da mudança"
// — lib/impactoCusto.js). Só sobe pro aviso o que PIOROU de verdade
// (motivoDaPiora em lib/farm.js); custo que caiu não gera nada.
import { produtoAoVivo } from "./aoVivo.js";
import { calcVariacao } from "./variacoes.js";
import { montarLinhas } from "./impactoCusto.js";
import { maquinaDoProduto, motivoDaPiora } from "./farm.js";

const cent = (v) => Math.round(v * 100) / 100;

export function pioraDaFarm({ dados, impressoras, cfg }) {
  const { produtos, variacoes = [], materiais, embalagens, produtoEmbalagens, itens, canais, precos, cfgDoProduto, rampas } = dados;
  const ctx = { materiais, embalagens, produtoEmbalagens };
  const afetados = [];
  const dKit = new Map();
  for (const p of produtos) {
    const novo = produtoAoVivo({ ...p, _maquina: maquinaDoProduto(p, impressoras, cfg) }, ctx);
    const dProd = (Number(novo.custo_producao) || 0) - (Number(p.custo_producao) || 0);
    if (Math.abs(dProd) < 0.005) continue;
    const itP = itens.find((i) => i.id === `p:${p.id}`);
    if (itP) afetados.push({ id: itP.id, nome: p.nome, produtoId: p.id, custoAtual: itP.custoTotal, pesoAtual: itP.peso, custoNovo: cent(itP.custoTotal + dProd), pesoNovo: itP.peso });
    for (const v of variacoes.filter((x) => x.produto_id === p.id)) {
      const it = itens.find((i) => i.id === `v:${v.id}`);
      if (!it) continue;
      const c = calcVariacao(v, novo, ctx);
      afetados.push({ id: it.id, nome: it.nome, produtoId: p.id, custoAtual: it.custoTotal, pesoAtual: it.peso, custoNovo: cent(c.custoTotal), pesoNovo: it.peso });
    }
    for (const k of itens.filter((i) => i.tipo === "Kit" && (i.componentes || []).some((c) => c.produtoId === p.id))) {
      const q = k.componentes.filter((c) => c.produtoId === p.id).reduce((s, c) => s + (Number(c.quantidade) || 0), 0);
      dKit.set(k.id, (dKit.get(k.id) || 0) + q * dProd);
    }
  }
  for (const [id, d] of dKit) {
    const k = itens.find((i) => i.id === id);
    afetados.push({ id, nome: k.nome, produtoId: null, custoAtual: k.custoTotal, pesoAtual: k.peso, custoNovo: cent(k.custoTotal + d), pesoNovo: k.peso });
  }
  const linhas = montarLinhas(afetados, { canais, precos, cfgDoProduto, itens, rampas });
  const piores = [];
  let subiu = 0;
  let caiu = 0;
  for (const l of linhas) {
    if (l.diferenca < -0.005) subiu++;
    else if (l.diferenca > 0.005) caiu++;
    const motivo = motivoDaPiora(l);
    if (!motivo) continue;
    const a = afetados.find((x) => l.id.startsWith(`${x.id}|`));
    piores.push({
      id: a.id,
      nome: l.nome,
      canal_id: l.canal.id,
      canal_nome: l.canal.nome,
      preco: l.preco,
      custo_antes: a.custoAtual,
      custo_depois: a.custoNovo,
      lucro_antes: cent(l.lucroHoje),
      lucro_depois: cent(l.lucroNovo),
      motivo,
    });
  }
  return { piores, subiu, caiu, afetados: afetados.length };
}
