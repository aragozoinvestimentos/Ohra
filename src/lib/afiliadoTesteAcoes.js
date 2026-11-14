// Teste de 15 dias da comissão de afiliado — respostas e "subi o %" direto no cartão
// (Início, Vender mais → Hoje) e no Acompanhamento da aba Afiliados (14/11/2026).
// Gravações SÓ aqui: preferencias_loja `afiliados:testes`, afiliado_config e a ação
// em acoes_comerciais. afTeste = o objeto que avisosComissaoLoja põe no aviso.
import { supabase } from "./supabaseClient.js";
import { gravarPreferencia, lerPreferencia } from "../hooks/usePreferencia.js";
import { registrarAcao } from "./acoesComerciaisAcoes.js";
import { hojeSP } from "./datas.js";

const CHAVE = "afiliados:testes";

/** resposta: "nao" (ninguém se afiliou/vendeu) · "sim" (teve) · "manter" (não perguntar mais nesse %). */
export async function responderTesteAfiliado(chave, resposta) {
  const t = { ...(lerPreferencia(CHAVE) || {}) };
  if (!t[chave]) return { ok: false, msg: "teste não encontrado" };
  t[chave] = { ...t[chave], resposta, em: hojeSP() };
  return gravarPreferencia(CHAVE, t);
}

/** Grava o % novo (loja ou do anúncio) e recomeça o teste de 15 dias. pct em pontos (7 = 7%). */
export async function subirComissaoAfiliado({ lojaId, afTeste, pct }) {
  if (!supabase || !afTeste) return { ok: false, msg: "sem banco" };
  const valor = Math.round(pct) / 100;
  const hoje = hojeSP();
  let q = supabase.from("afiliado_config").select("id").eq("canal_id", afTeste.canalId);
  q = lojaId ? q.eq("loja_id", lojaId) : q;
  q = afTeste.loja ? q.is("item_tipo", null).is("item_id", null) : q.eq("item_tipo", afTeste.itemTipo).eq("item_id", afTeste.itemId);
  const { data: rows, error: e1 } = await q;
  if (e1) return { ok: false, msg: e1.message };
  const campos = { ativo: true, comissao: valor, atualizado_em: new Date().toISOString() };
  const { error } = rows?.length
    ? await supabase.from("afiliado_config").update(campos).eq("id", rows[0].id)
    : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: afTeste.canalId, item_tipo: afTeste.loja ? null : afTeste.itemTipo, item_id: afTeste.loja ? null : afTeste.itemId });
  if (error) return { ok: false, msg: error.message };
  const t = { ...(lerPreferencia(CHAVE) || {}) };
  t[afTeste.chave] = { pct: valor, inicio: hoje };
  await gravarPreferencia(CHAVE, t);
  registrarAcao({
    lojaId,
    itemTipo: afTeste.loja ? null : afTeste.itemTipo,
    itemId: afTeste.loja ? null : afTeste.itemId,
    canalId: afTeste.canalId,
    tipo: "afiliado",
    data: hoje,
    antes: `${afTeste.pct}%`,
    depois: `${Math.round(pct)}%`,
    observacao: afTeste.loja ? "comissão da loja (subiu 1 ponto no teste)" : `comissão própria — ${afTeste.nome} (subiu 1 ponto no teste)`,
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("focus")); // recarrega afiliado_config
  return { ok: true };
}

/** Pede pra aba Afiliados rolar até o teste (vale também se a aba ainda não montou). */
export function mostrarTesteAfiliado(chave) {
  try {
    sessionStorage.setItem("ohra:af-teste", chave);
  } catch {
    /* sem sessão: só não rola */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ohra:af-teste", { detail: chave }));
}
