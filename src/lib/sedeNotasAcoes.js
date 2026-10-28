// Gravação da nota por setor da Sede (schema v68). Única gravação: a nota da semana
// que está correndo (upsert por loja × semana × setor) — a da semana passada fica como histórico.
import { supabase } from "./supabaseClient.js";

export async function gravarNotasDaSemana(lojaId, semana, setores) {
  if (!supabase || !lojaId) return { error: null };
  const linhas = Object.entries(setores)
    .filter(([, s]) => s.nota != null)
    .map(([setor, s]) => ({ loja_id: lojaId, semana, setor, nota: s.nota, partes: s.partes, atualizado_em: new Date().toISOString() }));
  if (!linhas.length) return { error: null };
  return supabase.from("sede_notas").upsert(linhas, { onConflict: "loja_id,semana,setor" });
}
