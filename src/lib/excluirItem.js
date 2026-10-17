import { supabase } from "./supabaseClient.js";
import { recarregarCatalogo } from "./catalogoStore.js";

// Excluir um produto ou kit POR COMPLETO (Produtos precificados e Catálogo
// usam esta mesma conta). As variações do produto somem junto (cascata no
// banco); preços, anúncios marcados, concorrente e afiliado não têm FK
// (referência genérica item_tipo/item_id) — limpos aqui.

/** Kits que usam o produto (pra avisar antes). → [nomes] */
export async function kitsQueUsam(item, itens) {
  const [letra, id] = String(item.id).split(":");
  if (letra === "k" || !supabase) return [];
  const { data, error } = await supabase.from("kit_produtos").select("kit_id").eq("produto_id", id);
  if (error || !data?.length) return [];
  return [...new Set(data.map((r) => r.kit_id))].map((kid) => itens.find((i) => i.id === `k:${kid}`)?.nome).filter(Boolean);
}

/** → { ok, msg? } */
export async function excluirItemCompleto(item, itens) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const [letra, id] = String(item.id).split(":");
  const tabela = letra === "k" ? "kits" : "produtos_cadastro";
  const itemTipo = letra === "k" ? "kit" : "produto";
  const idsVariacoes = itens.filter((i) => i.tipo === "Variação" && i.produtoId === id).map((i) => i.id.split(":")[1]);
  const { error } = await supabase.from(tabela).delete().eq("id", id);
  if (error) return { ok: false, msg: `Não foi possível excluir: ${error.message}` };
  for (const t of ["precos_canal", "precos_concorrente", "publicacoes_canal", "afiliado_config"]) {
    await supabase.from(t).delete().eq("item_tipo", itemTipo).eq("item_id", id);
    if (idsVariacoes.length) await supabase.from(t).delete().eq("item_tipo", "variacao").in("item_id", idsVariacoes);
  }
  recarregarCatalogo();
  return { ok: true };
}
