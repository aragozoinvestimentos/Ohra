// Ações das tarefas manuais (schema v42): gravar, concluir/desfazer,
// excluir e o "abrir" (leva pra aba ligada com o item escolhido).
import { supabase } from "./supabaseClient.js";
import { abaTarefa, proximaData } from "./tarefas.js";
import { recarregarTarefas } from "../hooks/useTarefas.js";
import { irParaAba } from "./navegar.js";
import { pedirPasso } from "./passosPreco.js";

const PASSOS = ["avulso", "quantidade", "ficha", "lancamento"];

// Gravações das tarefas (schema v42). Cada uma recarrega a lista na hora.
export async function salvarTarefa(form, { id, lojaId }) {
  const linha = {
    descricao: form.descricao.trim(),
    vence: form.vence || null,
    repetir: form.repetir || null,
    link_aba: form.link_aba || null,
    link_item: form.link_item || null,
  };
  const r = id ? await supabase.from("tarefas").update(linha).eq("id", id) : await supabase.from("tarefas").insert({ ...linha, loja_id: lojaId || null });
  recarregarTarefas();
  return r.error;
}

// Conclui; se repete, cria a próxima (mesma tarefa, data seguinte). Devolve o
// necessário pro "desfazer".
export async function concluirTarefa(t, hoje) {
  const r = await supabase.from("tarefas").update({ concluida_em: new Date().toISOString() }).eq("id", t.id);
  if (r.error) return { error: r.error };
  let proximaId = null;
  const prox = proximaData(t, hoje);
  if (prox) {
    const ins = await supabase
      .from("tarefas")
      .insert({ loja_id: t.loja_id, descricao: t.descricao, vence: prox, repetir: t.repetir, link_aba: t.link_aba, link_item: t.link_item })
      .select("id");
    proximaId = ins.data?.[0]?.id || null;
  }
  recarregarTarefas();
  return { proximaId, prox };
}

export async function desfazerConclusao({ tarefa, proximaId }) {
  await supabase.from("tarefas").update({ concluida_em: null }).eq("id", tarefa.id);
  if (proximaId) await supabase.from("tarefas").delete().eq("id", proximaId);
  recarregarTarefas();
}

export async function excluirTarefa(t) {
  const r = await supabase.from("tarefas").delete().eq("id", t.id);
  recarregarTarefas();
  return r.error;
}

// "abrir": leva pra aba ligada, com o item escolhido quando a aba aceita.
export function abrirTarefa(t, itens, onIrPara) {
  const item = t.link_item ? itens.find((i) => i.id === t.link_item) : null;
  const aba = t.link_aba || (item ? "historico" : null);
  if (!aba) return;
  if (item && aba === "historico") return irParaAba("historico", { busca: item.nome });
  if (item && aba === "producao") {
    const pid = item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId;
    if (pid) return irParaAba("producao", { produtoId: pid });
  }
  if (item && PASSOS.includes(aba)) pedirPasso(aba, item.id, null);
  onIrPara?.(aba);
}

export function rotuloLink(t, itens) {
  const item = t.link_item ? itens.find((i) => i.id === t.link_item) : null;
  const aba = abaTarefa(t.link_aba || (item ? "historico" : ""));
  if (!aba && !item) return null;
  const nome = item ? item.nome : null;
  return [nome, aba?.rotulo].filter(Boolean).join(" · ");
}

