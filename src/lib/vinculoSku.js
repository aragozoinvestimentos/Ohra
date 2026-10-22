// Vínculo SKU do pedido → item (22/10/2026). O app liga a venda pelo SKU EXATO do item,
// pelo SKU de uma opção de anúncio com vários itens, ou pelo SKU do item + as variações
// próprias da Ficha (Cor, Modelo… em cores_anuncio). Fora disso, só pela regra do
// "começo do SKU" (ligarSku) — pode acertar, mas é frágil: vira aviso em Atualizar dados.

const norm = (x) => String(x || "").trim().toUpperCase();
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// `cores_anuncio` (schema v31): formato antigo = lista de opções de Cor [{nome, sufixo}];
// formato novo = { variacoes: [{ nome, opcoes: [{nome, sufixo}] }] }.
export function lerVariacoes(valor) {
  if (Array.isArray(valor)) return valor.length ? [{ nome: "Cor", opcoes: valor.filter((o) => o && o.nome) }] : [];
  if (valor && Array.isArray(valor.variacoes)) return valor.variacoes.filter((v) => v && v.nome).map((v) => ({ nome: v.nome, opcoes: (v.opcoes || []).filter((o) => o && o.nome) }));
  return [];
}

// Sufixos que a Ficha monta depois do SKU do item ("" + combinações das variações próprias).
export function sufixosDaFicha(coresAnuncio) {
  const vs = lerVariacoes(coresAnuncio).filter((v) => v.opcoes.length);
  let acc = [""];
  for (const v of vs) acc = acc.flatMap((a) => v.opcoes.map((o) => a + norm(o.sufixo)));
  return new Set(vs.length ? acc : [""]);
}

/**
 * Vendas dos últimos `dias` ligadas SÓ pelo começo do SKU (linhas de enriquecer com
 * skuExato === false), tirando as que batem com SKU do item + variações da Ficha.
 * → [{ sku, item, unidades, ultima, canais: Set }] (mais vendido primeiro).
 */
export function vendasPeloComeco(linhas, { produtos, kits, hoje, dias = 90 }) {
  const de = somarDias(hoje, -dias);
  const fichaDe = new Map();
  const sufixos = (item) => {
    const dono = item.id.startsWith("k:") ? (kits || []).find((k) => k.id === item.id.slice(2)) : (produtos || []).find((p) => p.id === (item.produtoId || item.id.slice(2)));
    const k = dono?.id || item.id;
    if (!fichaDe.has(k)) fichaDe.set(k, sufixosDaFicha(dono?.cores_anuncio));
    return fichaDe.get(k);
  };
  const m = new Map();
  for (const l of linhas || []) {
    if (!l.valido || l.origem === "fisico" || !l.item || l.skuExato !== false || String(l.data) < de) continue;
    const s = norm(l.sku);
    const base = norm(l.item.sku);
    if (s.startsWith(base) && sufixos(l.item).has(s.slice(base.length))) continue;
    const g = m.get(s) || { sku: s, item: l.item, unidades: 0, ultima: "", canais: new Set() };
    g.unidades += Number(l.q) || 0;
    if (String(l.data) > g.ultima) g.ultima = String(l.data);
    if (l.canal?.nome) g.canais.add(l.canal.nome);
    m.set(s, g);
  }
  return [...m.values()].sort((a, b) => b.unidades - a.unidades);
}
