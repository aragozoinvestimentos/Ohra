import { supabase } from "./supabaseClient.js";
import { recarregarAvaliacoes } from "../hooks/useAvaliacoes.js";

// Gravações do bloco Avaliações (schema v58, tabela avaliacoes_produto).
// Cada envio guarda o TOTAL que a plataforma mostra hoje (por estrela, ou só
// o total no modo simples) — lib/semanasAuto.js tira a diferença.
const msgErro = (e) =>
  /avaliacoes_produto|does not exist|schema cache/.test(e?.message || "") ? "Falta rodar o supabase/schema_v58.sql no Supabase (avaliações)" : `Não foi possível salvar: ${e?.message || "erro"}`;

export async function salvarAvaliacao({ lojaId, tipo, id, canalId, data, estrelas = null, total = null, nota = null, ruinsNovas = null, tresNovas = null }) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const linha = {
    loja_id: lojaId || null,
    item_tipo: tipo,
    item_id: id,
    canal_id: canalId,
    data,
    ...(estrelas ? { e5: estrelas[0], e4: estrelas[1], e3: estrelas[2], e2: estrelas[3], e1: estrelas[4] } : {}),
    total,
    nota,
    ruins_novas: ruinsNovas,
    tres_novas: tresNovas,
  };
  const { error } = await supabase.from("avaliacoes_produto").insert(linha);
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarAvaliacoes();
  return { ok: true };
}

export async function excluirAvaliacao(id) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const { error } = await supabase.from("avaliacoes_produto").delete().eq("id", id);
  if (error) return { ok: false, msg: msgErro(error) };
  recarregarAvaliacoes();
  return { ok: true };
}
