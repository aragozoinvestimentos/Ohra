// Gravações do histórico de ações comerciais (schema v64). Só daqui.
import { supabase } from "./supabaseClient.js";
import { recarregarAcoes } from "../hooks/useAcoesComerciais.js";

const SQL = "Rode o supabase/schema_v64.sql no Supabase pra usar o histórico de ações";

/** Ação manual (o que foi mudado direto no marketplace). */
export async function registrarAcao({ lojaId, itemTipo, itemId, canalId, tipo, data, antes, depois, observacao }) {
  if (!supabase) return { error: { message: "sem banco" } };
  const { error } = await supabase.from("acoes_comerciais").insert({
    loja_id: lojaId || null,
    origem: "manual",
    item_tipo: itemTipo,
    item_id: itemId,
    canal_id: canalId,
    tipo,
    data,
    valor_antes: antes || null,
    valor_depois: depois || null,
    observacao: observacao || null,
  });
  recarregarAcoes();
  return { error: error ? { message: /acoes_comerciais/.test(error.message) ? SQL : error.message } : null };
}

/** Conclusão de uma ação: manual (id) ou do app (chave — cria a linha se não houver). */
export async function concluirAcao({ lojaId, acao, conclusao }) {
  if (!supabase) return { error: { message: "sem banco" } };
  const campos = { conclusao: conclusao || null, conclusao_em: conclusao ? new Date().toISOString() : null };
  let r;
  if (acao.id) r = await supabase.from("acoes_comerciais").update(campos).eq("id", acao.id);
  else
    r = await supabase.from("acoes_comerciais").insert({
      loja_id: lojaId || null,
      origem: "app",
      chave: acao.chave,
      item_tipo: acao.itemTipo,
      item_id: acao.itemId,
      canal_id: acao.canalId,
      tipo: acao.tipo,
      data: acao.data,
      valor_antes: acao.antes || null,
      valor_depois: acao.depois || null,
      ...campos,
    });
  recarregarAcoes();
  return { error: r.error ? { message: /acoes_comerciais/.test(r.error.message) ? SQL : r.error.message } : null };
}

export async function excluirAcao(id) {
  if (!supabase) return { error: { message: "sem banco" } };
  const { error } = await supabase.from("acoes_comerciais").delete().eq("id", id);
  recarregarAcoes();
  return { error };
}
