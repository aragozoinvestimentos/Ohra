import { supabase } from "./supabaseClient.js";
import { camposRevisado } from "./revisarPreco.js";
import { recarregarCatalogo } from "./catalogoStore.js";

// Grava o "✓ Revisado — manter o preço" (só a linha daquele item × canal; o
// preço salvo não muda). `r` = uma linha de revisoesPrecoDireto.
export async function marcarPrecoRevisado(r) {
  if (!supabase || !r?.linha?.id) return { error: { message: "preço salvo não encontrado" } };
  const { error } = await supabase.from("precos_canal").update(camposRevisado(r.linha, r.custoHoje, r.linha.lucro)).eq("id", r.linha.id);
  if (!error) recarregarCatalogo();
  return { error };
}
