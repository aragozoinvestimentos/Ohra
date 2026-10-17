import { supabase } from "./supabaseClient.js";
import { recarregarLives } from "../hooks/useLives.js";

// Gravações da aba Live (schema v61) — SÓ nas tabelas lives e live_eventos.
// Nada daqui toca preço salvo, Rampa, Ads, anúncios ou pedidos.
const msgErro = (e) =>
  /lives|live_eventos|does not exist|schema cache/.test(e?.message || "") ? "Falta rodar o supabase/schema_v61.sql no Supabase (aba Live)" : `Não foi possível salvar: ${e?.message || "erro"}`;

export async function criarLive(dados) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const { data, error } = await supabase.from("lives").insert(dados).select("*").single();
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarLives();
  return { ok: true, live: data };
}

export async function salvarLive(id, patch) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const { error } = await supabase
    .from("lives")
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarLives();
  return { ok: true };
}

export async function excluirLive(id) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const { error } = await supabase.from("lives").delete().eq("id", id);
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarLives();
  return { ok: true };
}

// ev: { tipo, produto_key, quantidade?, preco?, info?, manual? }
export async function registrarEvento(live, ev) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const { error } = await supabase.from("live_eventos").insert({ loja_id: live.loja_id || null, live_id: live.id, em: new Date().toISOString(), ...ev });
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarLives();
  return { ok: true };
}

export async function registrarEventos(live, evs) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  if (!evs.length) return { ok: true };
  const { error } = await supabase.from("live_eventos").insert(evs.map((ev) => ({ loja_id: live.loja_id || null, live_id: live.id, em: new Date().toISOString(), ...ev })));
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarLives();
  return { ok: true };
}
