import { supabase } from "./supabaseClient.js";

// "Não acompanhar por enquanto" (out/2026, sem SQL — tabela lembretes do v40):
// a rampa sai de "Pra fazer"/"Pronto pra subir" (vai pra "Sem acompanhar") e
// dos avisos do Início. Volta sozinha quando VENDER (vendas no total passam do
// número do dia em que foi pausada) ou quando o prazo acaba. Urgente (resolver,
// ex.: prejuízo) aparece mesmo pausada. Nada da rampa muda.
// Chave `rampa-pausa|<rampaId>`; tipo `pausa-rampa|<vendas no total>`.
export const PRAZOS_PAUSA = [15, 30, 60, null]; // null = só quando vender
const SEM_PRAZO = "2099-12-31";
const chave = (rampaId) => `rampa-pausa|${rampaId}`;

export function pausasDeRampa(lembretes) {
  const m = new Map();
  for (const l of lembretes || []) {
    if (!String(l.chave).startsWith("rampa-pausa|")) continue;
    const base = Number(String(l.tipo || "").split("|")[1]) || 0;
    m.set(l.chave.slice(12), { ate: l.adiado_ate, soVenda: l.adiado_ate >= SEM_PRAZO, base, desde: String(l.criado_em || "").slice(0, 10) });
  }
  return m;
}

// Pausa que ainda vale (prazo não acabou e não vendeu desde que pausou).
export function pausaAtiva(pausa, est, hoje) {
  if (!pausa || !(pausa.ate > hoje)) return null;
  if (Number(est?.vendasTotal || 0) > pausa.base) return null;
  return pausa;
}

export async function pausarRampa({ lojaId, rampaId, dias, vendasTotal, hoje }) {
  let ate = SEM_PRAZO;
  if (dias) {
    const d = new Date(`${hoje}T12:00:00`);
    d.setDate(d.getDate() + dias);
    ate = d.toISOString().slice(0, 10);
  }
  const { error } = await supabase
    .from("lembretes")
    .upsert({ loja_id: lojaId || null, chave: chave(rampaId), adiado_ate: ate, tipo: `pausa-rampa|${Number(vendasTotal || 0)}`, criado_em: new Date().toISOString() }, { onConflict: "loja_id,chave" });
  if (!error) window.dispatchEvent(new Event("ohra:lembretes"));
  return error ? { ok: false, msg: /lembretes/.test(error.message) ? "Falta rodar o supabase/schema_v40.sql no Supabase" : `Não foi possível pausar: ${error.message}` } : { ok: true, ate };
}

export async function retomarRampa({ lojaId, rampaId }) {
  let q = supabase.from("lembretes").delete().eq("chave", chave(rampaId));
  q = lojaId ? q.eq("loja_id", lojaId) : q.is("loja_id", null);
  const { error } = await q;
  if (!error) window.dispatchEvent(new Event("ohra:lembretes"));
  return error ? { ok: false, msg: `Não foi possível voltar a acompanhar: ${error.message}` } : { ok: true };
}
