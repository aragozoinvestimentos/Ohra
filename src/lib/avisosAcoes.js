// "Lembrar em 30 dias" de um aviso do Início, usado também fora do Início (faixa
// "Avisos desta tela"): a MESMA gravação — tabela lembretes (v40), chave inicio|<id>.
import { supabase } from "./supabaseClient.js";

export async function adiarAviso(lojaId, id, hoje, dias = 30) {
  const d = new Date(`${hoje}T12:00:00`);
  d.setDate(d.getDate() + dias);
  const r = await supabase.from("lembretes").upsert({ loja_id: lojaId || null, chave: `inicio|${id}`, adiado_ate: d.toISOString().slice(0, 10), tipo: "adiar30" }, { onConflict: "loja_id,chave" });
  if (!r.error) window.dispatchEvent(new Event("ohra:lembretes"));
  return r;
}
