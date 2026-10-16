// Embalagem própria do canal orgânico (venda na loja) — schema v56, out/2026.
// Conta ÚNICA: nos marketplaces vale a embalagem do produto (como sempre);
// num canal PRÓPRIO com `canais.embalagem_canal` configurado, o custo do item
// troca a embalagem (e o frete, se "freteZero") pela do orgânico:
//   1) a do produto/kit (`embalagem_organico` = {modo:"itens"|"sem"});
//   2) senão a geral do canal (`embalagem_canal`).
// Variação (kit 2, kit 3…) segue a do produto pai. Sem configuração = igual a hoje.

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const centavos = (v) => Math.round(num(v) * 100) / 100;

/** O canal tem embalagem própria configurada? (só canais próprios) */
export function canalComEmbalagem(canal) {
  return !!canal && canal.tipo === "custom" && !!canal.embalagem_canal && typeof canal.embalagem_canal === "object";
}

/** Total em R$ de uma lista [{embalagem_id, quantidade}] com o preço ATUAL das embalagens. */
export function totalReceita(itens, embalagens) {
  return centavos(
    (itens || []).reduce((s, r) => {
      const e = (embalagens || []).find((x) => x.id === r.embalagem_id);
      return s + num(e?.preco) * num(r.quantidade);
    }, 0)
  );
}

/** Texto curto da receita: "Sacola kraft P + Fita / laço". */
export function nomesReceita(itens, embalagens) {
  const n = (itens || [])
    .map((r) => {
      const e = (embalagens || []).find((x) => x.id === r.embalagem_id);
      if (!e) return null;
      return num(r.quantidade) > 1 ? `${num(r.quantidade)}× ${e.nome}` : e.nome;
    })
    .filter(Boolean);
  return n.length ? n.join(" + ") : "sem embalagem";
}

/** Receita geral do canal: { itens, freteZero, sem } (null se o canal usa a do produto). */
export function receitaDoCanal(canal) {
  if (!canalComEmbalagem(canal)) return null;
  const c = canal.embalagem_canal;
  return { itens: c.modo === "itens" ? c.itens || [] : [], freteZero: c.freteZero !== false, sem: c.modo === "sem" };
}

/** A configuração própria do produto/kit dono do item (variação = do produto pai). */
export function configOrganicoDoItem(item, { produtos, kits }) {
  if (!item) return { dono: null, config: null };
  const id = String(item.id || "");
  if (id.startsWith("k:")) {
    const k = (kits || []).find((x) => x.id === id.slice(2));
    return { dono: k ? { tipo: "kit", id: k.id, nome: k.nome } : null, config: k?.embalagem_organico || null };
  }
  const pid = id.startsWith("v:") ? item.produtoId : id.slice(2);
  const p = (produtos || []).find((x) => x.id === pid);
  return { dono: p ? { tipo: "produto", id: p.id, nome: p.nome } : null, config: p?.embalagem_organico || null };
}

/**
 * Embalagem que vale pro item no canal: { itens, valor, origem: 'produto'|'canal',
 * definido (o produto já escolheu — "do canal" confirmado ou própria), freteZero }.
 * null quando o canal não tem embalagem própria (vale a do produto).
 */
export function embalagemNoCanal(item, canal, { produtos, kits, embalagens }) {
  const rc = receitaDoCanal(canal);
  if (!rc) return null;
  const { dono, config } = configOrganicoDoItem(item, { produtos, kits });
  let itens = rc.itens;
  let origem = "canal";
  if (config?.modo === "itens") {
    itens = config.itens || [];
    origem = "produto";
  } else if (config?.modo === "sem") {
    itens = [];
    origem = "produto";
  }
  return { itens, valor: totalReceita(itens, embalagens), origem, definido: !!config, dono, freteZero: rc.freteZero, nomes: nomesReceita(itens, embalagens) };
}

/**
 * O item com o custo do canal: troca a embalagem (e o frete, se freteZero)
 * pela do orgânico. Fora de canal próprio configurado devolve o próprio item.
 */
export function itemNoCanal(item, canal, ctx) {
  if (!item || !canalComEmbalagem(canal)) return item;
  const e = embalagemNoCanal(item, canal, ctx);
  if (!e) return item;
  const embAntes = num(item.embalagem);
  // variação: item.frete = frete + ajuste avulso (o ajuste continua)
  const freteAntes = item.calc ? num(item.calc.frete) : num(item.freteProduto ?? item.frete);
  const freteDepois = e.freteZero ? 0 : freteAntes;
  const custoTotal = centavos(num(item.custoTotal) - embAntes - freteAntes + e.valor + freteDepois);
  return {
    ...item,
    custoTotal,
    embalagem: e.valor,
    ...(item.freteProduto != null ? { freteProduto: freteDepois } : {}),
    ...(item.frete != null ? { frete: centavos(num(item.frete) - freteAntes + freteDepois) } : {}),
    embalagemCanal: e,
    embalagemMarketplace: embAntes,
  };
}
