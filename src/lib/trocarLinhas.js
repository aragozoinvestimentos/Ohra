// Troca as linhas "filhas" de um registro (receita de embalagem do produto,
// peças e embalagens do kit) sem risco de perder a antiga: grava as novas
// primeiro e só depois apaga as que existiam. Se gravar falhar (internet
// caiu, coluna faltando), a receita antiga continua intacta.
export async function trocarLinhas(supabase, tabela, campoPai, paiId, novas) {
  const { data: antigas, error: erroLer } = await supabase.from(tabela).select("id").eq(campoPai, paiId);
  if (erroLer) return { error: erroLer };
  if (novas.length) {
    const { error } = await supabase.from(tabela).insert(novas);
    if (error) return { error };
  }
  const ids = (antigas || []).map((r) => r.id);
  if (ids.length) {
    const { error } = await supabase.from(tabela).delete().in("id", ids);
    if (error) return { error };
  }
  return { error: null };
}
