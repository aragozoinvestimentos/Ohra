// Gravações dos períodos de Ads (schema v44/v45) — lugar ÚNICO onde o Ads é
// ligado, ajustado e desligado. A aba Crescimento → Ads e o teste de
// lançamento da Rampa chamam estas funções; o teste é um período com
// tipo = 'teste' e, pra Rampa continuar com as regras dela (orçamento
// fechado, meta de vendas, prazo), as colunas teste_* da rampa são
// atualizadas JUNTO, daqui.
import { supabase } from "./supabaseClient.js";

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const msgErro = (error) =>
  /item_tipo_check/.test(error.message)
    ? "Falta rodar o supabase/schema_v54.sql no Supabase (Ads do anúncio com vários itens)"
    : /ads_periodos|schema cache|does not exist/.test(error.message) && !/tipo/.test(error.message)
    ? "Falta rodar o supabase/schema_v44.sql no Supabase"
    : `Não foi possível salvar: ${error.message}`;

// Insere tentando com `tipo` (v45); sem a coluna, grava sem ela e avisa.
async function inserirPeriodo(linha) {
  let r = await supabase.from("ads_periodos").insert(linha).select().single();
  let semTipo = false;
  if (r.error && /tipo/.test(r.error.message) && !/item_tipo/.test(r.error.message)) {
    const { tipo: _tipo, ...sem } = linha;
    semTipo = true;
    r = await supabase.from("ads_periodos").insert(sem).select().single();
  }
  return { ...r, semTipo };
}

// { lojaId, tipo: 'produto'|'kit'|'grupo' (anúncio com vários itens, v54), id, canalId, inicio, fim, orcamento, meta, nota, teste: bool, rampa?, regras? }
export async function iniciarPeriodoAds({ lojaId, tipo, id, canalId, inicio, fim = null, orcamento = null, meta = null, nota = null, teste = false, rampa = null, regras = null }) {
  const linha = {
    loja_id: lojaId || null,
    item_tipo: tipo,
    item_id: id,
    canal_id: canalId,
    inicio,
    fim: fim || null,
    orcamento_diario: orcamento,
    meta_roas: meta,
    nota: nota || (teste ? "teste de lançamento" : null),
    tipo: teste ? "teste" : "normal",
  };
  const r = await inserirPeriodo(linha);
  if (r.error) return { ok: false, msg: msgErro(r.error) };
  if (teste && rampa) {
    const dias = fim ? Math.max(1, diasEntre(inicio, fim) + 1) : regras?.testeDias || 7;
    const { error } = await supabase
      .from("rampas_preco")
      .update({
        teste_status: "iniciado",
        teste_inicio: inicio,
        teste_fim: null,
        teste_orcamento: orcamento ? Math.round(orcamento * dias * 100) / 100 : null,
        teste_dias: dias,
        teste_meta: regras?.testeMeta || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", rampa.id);
    if (error) return { ok: false, msg: /teste_/.test(error.message) ? "Falta rodar o supabase/schema_v34.sql no Supabase" : `Período criado, mas a Rampa não foi atualizada: ${error.message}` };
  }
  return { ok: true, semTipo: r.semTipo, periodo: r.data };
}

export async function ajustarPeriodoAds(periodo, ajuste) {
  const ajustes = [...(Array.isArray(periodo.ajustes) ? periodo.ajustes : []), ajuste];
  const { error } = await supabase.from("ads_periodos").update({ ajustes }).eq("id", periodo.id);
  return error ? { ok: false, msg: msgErro(error) } : { ok: true };
}

// Encerra o período; se for o teste de lançamento de uma rampa, conclui o teste nela.
export async function encerrarPeriodoAds(periodo, { fim, motivo = null, rampa = null } = {}) {
  if (periodo) {
    const { error } = await supabase.from("ads_periodos").update({ fim, motivo_fim: motivo || "encerrado" }).eq("id", periodo.id);
    if (error) return { ok: false, msg: msgErro(error) };
  }
  if (rampa && (periodo?.tipo === "teste" || !periodo) && rampa.teste_status === "iniciado") {
    const { error } = await supabase.from("rampas_preco").update({ teste_status: "concluido", teste_fim: fim, atualizado_em: new Date().toISOString() }).eq("id", rampa.id);
    if (error) return { ok: false, msg: `Período encerrado, mas a Rampa não foi atualizada: ${error.message}` };
  }
  return { ok: true };
}

// Exclui o período; se era o teste em andamento da rampa, o teste volta a "não iniciado".
export async function excluirPeriodoAds(periodo, { rampa = null, hoje } = {}) {
  const { error } = await supabase.from("ads_periodos").delete().eq("id", periodo.id);
  if (error) return { ok: false, msg: msgErro(error) };
  const ativo = !periodo.motivo_fim && (!periodo.fim || periodo.fim >= hoje);
  if (rampa && periodo.tipo === "teste" && ativo && rampa.teste_status === "iniciado")
    await supabase.from("rampas_preco").update({ teste_status: null, teste_inicio: null, teste_fim: null, atualizado_em: new Date().toISOString() }).eq("id", rampa.id);
  return { ok: true };
}

// Andamento do período (v48): substitui o anterior (nunca soma). Os envios
// anteriores ficam em `parcial.historico` (até 12, um por data) — a
// constância do Ads (média de 3 dias × os 3 anteriores) lê daqui.
export async function salvarAndamentoAds(periodo, { ate, gasto, cliques, vendas }) {
  const ant = periodo?.parcial;
  const hist = [...(Array.isArray(ant?.historico) ? ant.historico : []), ...(ant?.ate ? [{ ate: ant.ate, gasto: ant.gasto, cliques: ant.cliques, vendas: ant.vendas }] : [])]
    .filter((h) => h && h.ate && h.ate < ate)
    .reduce((m, h) => m.set(h.ate, h), new Map());
  const historico = [...hist.values()].sort((a, b) => a.ate.localeCompare(b.ate)).slice(-12);
  const parcial = { ate, gasto, cliques, vendas, em: new Date().toISOString(), historico };
  const { error } = await supabase.from("ads_periodos").update({ parcial }).eq("id", periodo.id);
  if (!error) return { ok: true };
  return { ok: false, msg: /parcial/.test(error.message) ? "Falta rodar o supabase/schema_v48.sql no Supabase" : msgErro(error) };
}

// CSV do Shopee Ads com gasto depois do fim de um período já encerrado no
// app: só com o "Sim" do Gustavo, estende o fim até a data do CSV.
export async function estenderPeriodoAds(periodo, fim) {
  const { error } = await supabase.from("ads_periodos").update({ fim }).eq("id", periodo.id);
  return error ? { ok: false, msg: msgErro(error) } : { ok: true };
}
