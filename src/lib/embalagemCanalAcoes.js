import { supabase } from "./supabaseClient.js";
import { recarregarCatalogo } from "./catalogoStore.js";

// Gravações da embalagem do orgânico (schema v56). A conta fica em embalagemCanal.js.
export const SEM_COLUNA_V56 = "Falta rodar o supabase/schema_v56.sql no SQL Editor do Supabase (embalagem do orgânico).";
export const colunaFaltandoV56 = (error) => /embalagem_(canal|organico)/i.test(error?.message || "") || error?.code === "42703" || error?.code === "PGRST204";
export const limparItensEmbalagem = (itens) =>
  (itens || []).filter((r) => r.embalagem_id && Number(r.quantidade) > 0).map((r) => ({ embalagem_id: r.embalagem_id, quantidade: Number(r.quantidade) }));

/** Grava a embalagem do orgânico no produto/kit (dono = { tipo: "produto"|"kit", id }). */
export async function salvarEmbalagemOrganico(dono, config) {
  const valor = !config ? null : config.modo === "itens" ? { modo: "itens", itens: limparItensEmbalagem(config.itens) } : { modo: config.modo };
  const tabela = dono.tipo === "kit" ? "kits" : "produtos_cadastro";
  const { error } = await supabase.from(tabela).update({ embalagem_organico: valor }).eq("id", dono.id);
  if (error) return { erro: colunaFaltandoV56(error) ? SEM_COLUNA_V56 : `Não foi possível salvar: ${error.message}` };
  recarregarCatalogo();
  return { ok: true };
}
