// Gravações das Últimas importações (31/10/2026) — lugar ÚNICO onde um envio
// da Atualizar dados é excluído. O que cada tipo tira está em lib/importacoes.js
// (efeitoDaExclusao); o caixa e o andamento do Ads são refeitos por quem chama.
import { supabase } from "./supabaseClient.js";

const msg = (e) => `Não foi possível excluir: ${e?.message || "erro"}`;
const semColuna = (e) => /importacao_id|schema cache|does not exist/.test(e?.message || "");

/** entrada = item de listaImportacoes. → { ok, pedidos (itens apagados), transacoes } */
export async function excluirImportacao({ entrada, lojaId }) {
  const id = entrada.imp.id;
  let nPed = 0;
  let nTr = 0;
  if (entrada.tipo === "pedidos" && entrada.imp.ok !== false) {
    let q = supabase.from("pedidos_itens").delete({ count: "exact" }).eq("importacao_id", id).neq("origem", "fisico");
    if (lojaId) q = q.eq("loja_id", lojaId);
    const r = await q;
    if (r.error && !semColuna(r.error)) return { ok: false, msg: msg(r.error) };
    nPed = r.count || 0;
  }
  if (entrada.tipo === "extrato" && entrada.imp.ok !== false) {
    let q = supabase.from("extrato_carteira").select("chave, plataforma").eq("importacao_id", id);
    if (lojaId) q = q.eq("loja_id", lojaId);
    const r = await q;
    if (r.error && !semColuna(r.error)) return { ok: false, msg: msg(r.error) };
    const linhas = r.data || [];
    // Saques que vieram deste extrato (as duas pontas da transferência no Caixa).
    const origens = linhas.flatMap((t) => [`extrato|${t.plataforma}|${t.chave}|saida`, `extrato|${t.plataforma}|${t.chave}|entrada`]);
    for (let i = 0; i < origens.length; i += 200) {
      let d = supabase.from("lancamentos_caixa").delete().in("origem_import", origens.slice(i, i + 200));
      if (lojaId) d = d.eq("loja_id", lojaId);
      const x = await d;
      if (x.error) return { ok: false, msg: msg(x.error) };
    }
    if (linhas.length) {
      let d = supabase.from("extrato_carteira").delete().eq("importacao_id", id);
      if (lojaId) d = d.eq("loja_id", lojaId);
      const x = await d;
      if (x.error) return { ok: false, msg: msg(x.error) };
    }
    nTr = linhas.length;
  }
  const ids = [id, ...(entrada.filhos || []).map((f) => f.id)];
  const { error } = await supabase.from("importacoes").delete().in("id", ids);
  if (error) return { ok: false, msg: msg(error) };
  return { ok: true, pedidos: nPed, transacoes: nTr };
}
