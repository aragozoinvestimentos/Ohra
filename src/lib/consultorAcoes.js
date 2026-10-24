// Gravações do consultor da Sede (schema v65, tabela consultor_registros).
// Tudo por loja. Sem a tabela, as funções devolvem o erro e a tela avisa.
import { supabase } from "./supabaseClient.js";
import { recarregarConsultor } from "../hooks/useConsultor.js";

export async function gravarRegistro(lojaId, tipo, chave, dados, status = null) {
  if (!supabase) return { error: { message: "sem banco" } };
  const r = await supabase
    .from("consultor_registros")
    .upsert({ loja_id: lojaId, tipo, chave, dados, status, atualizado_em: new Date().toISOString() }, { onConflict: "loja_id,tipo,chave" });
  recarregarConsultor();
  return r;
}

export async function atualizarRegistros(ids, patch) {
  if (!supabase || !ids.length) return { error: null };
  const r = await supabase
    .from("consultor_registros")
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .in("id", ids);
  recarregarConsultor();
  return r;
}

export async function excluirRegistro(id) {
  if (!supabase) return { error: null };
  const r = await supabase.from("consultor_registros").delete().eq("id", id);
  recarregarConsultor();
  return r;
}

// Nível app (com senha): erros e uso de TODAS as lojas — só esses dois tipos,
// nunca número de venda.
export async function lerNivelApp() {
  if (!supabase) return { erros: [], uso: [], lojas: [] };
  const [r, l] = await Promise.all([
    supabase.from("consultor_registros").select("loja_id,tipo,chave,dados,atualizado_em").in("tipo", ["erro", "uso"]),
    supabase.from("lojas").select("id,nome"),
  ]);
  const regs = r.data || [];
  return { erros: regs.filter((x) => x.tipo === "erro"), uso: regs.filter((x) => x.tipo === "uso"), lojas: l.data || [], erro: r.error };
}
