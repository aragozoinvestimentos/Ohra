// Gravações do Preço dinâmico → Otimizar preço (18/11/2026). SÓ aqui.
// O preço muda pela RAMPA (degrau acima do alvo; na plataforma só a promo muda,
// o riscado fica fixo); o estado fica em rampas_preco.checklist.otimizar.
// Anúncio sem rampa: ligar cria uma rampa no alvo (degraus [alvo] / [100%]).
import { supabase } from "./supabaseClient.js";
import { normalizarDegraus } from "./rampa.js";
import { otimizarDepois, REGRAS_OTIMIZAR } from "./otimizarPreco.js";
import { gravarPrecoNovo } from "./estrategia.js";
import { recarregarCatalogo } from "./catalogoStore.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const agoraIso = () => new Date().toISOString();
const avisar = () => window.dispatchEvent(new Event("focus"));

function listaDegraus(degraus, novo, grupo) {
  if (grupo) return [...new Set([...(degraus || []).map(num), num(novo)].map((v) => Math.round(v * 10) / 10).filter((v) => v > 0))].sort((a, b) => a - b);
  return normalizarDegraus([...(degraus || []), novo]);
}

/** Liga o Otimizar num anúncio (linha do Ads `b`, com b.otimizar). Cria a rampa no alvo se não houver. */
export async function ligarOtimizar({ lojaId, b, hoje, vendasIniciais = 0, subir = null }) {
  if (!supabase) return { ok: false, msg: "Sem conexão com o banco" };
  const op = b.otimizar;
  const grupo = b.tipo === "grupo";
  const base = Math.max(num(op.atual), num(op.alvo));
  let r = op.rampaLinha?.r || null;
  const anterior = r?.checklist?.otimizar || {};
  const ot = { ...anterior, ligado: true, desde: hoje, base, passos: Array.isArray(anterior.passos) ? anterior.passos : [], precoBom: null, bloqueadoAte: null, confirmadoAte: null, desligadoEm: null, criouRampa: anterior.criouRampa || !r };
  if (r) {
    const { error } = await supabase.from("rampas_preco").update({ checklist: { ...(r.checklist || {}), otimizar: ot }, atualizado_em: agoraIso() }).eq("id", r.id);
    if (error) return { ok: false, msg: `Não foi possível ligar: ${error.message}` };
    r = { ...r, checklist: { ...(r.checklist || {}), otimizar: ot } };
  } else {
    const alvo = grupo ? 100 : num(op.alvo);
    if (!(alvo > 0)) return { ok: false, msg: "Esse anúncio não tem preço salvo neste canal" };
    const linha = {
      loja_id: lojaId || null,
      ...(b.tipo === "kit" ? { kit_id: b.id, produto_id: null } : grupo ? { grupo_id: b.id } : { produto_id: b.id }),
      canal_id: b.canal.id,
      degraus: [alvo],
      degrau_atual: 0,
      desde: hoje,
      base_avaliacoes: 0,
      vendas_iniciais: Math.round(num(vendasIniciais)),
      teste_status: "pulado",
      checklist: { otimizar: ot },
    };
    let { data, error } = await supabase.from("rampas_preco").insert(linha).select().single();
    if (error && /teste_status/.test(error.message)) {
      delete linha.teste_status;
      ({ data, error } = await supabase.from("rampas_preco").insert(linha).select().single());
    }
    if (error) return { ok: false, msg: /kit_id/.test(error.message) ? "Falta rodar o supabase/schema_v62.sql (rampa de kit)" : /grupo_id/.test(error.message) ? "Falta rodar o supabase/schema_v54.sql (rampa do anúncio inteiro)" : `Não foi possível ligar: ${error.message}` };
    r = data;
    await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: r.id, tipo: "inicio", data: hoje, degrau: 0, preco: alvo, observacao: "otimizar preço" });
  }
  if (subir?.novo > 0) {
    const p = await passoOtimizar({ lojaId, r, tipo: "subir", novo: subir.novo, passo: subir.passo, hoje, grupo });
    if (!p.ok) return p;
  }
  avisar();
  return { ok: true, r };
}

/** Sobe ou volta um degrau do Otimizar (muda o preço de agora pela rampa). */
export async function passoOtimizar({ lojaId, r, tipo, novo, passo = null, hoje, grupo = false, confirmar = false, avaliacoes = null }) {
  if (!supabase || !r) return { ok: false, msg: "Rampa não encontrada" };
  const degraus = listaDegraus(r.degraus, novo, grupo);
  const idx = degraus.findIndex((d) => Math.abs(d - num(novo)) < 0.005);
  const de = num((r.degraus || [])[r.degrau_atual ?? 0]);
  let ot = otimizarDepois(r.checklist?.otimizar, { tipo, de, para: num(novo), hoje, passo });
  if (confirmar) ot = { ...ot, confirmadoAte: num(novo) * (1 + REGRAS_OTIMIZAR.confirmarCada) };
  const campos = { degraus, degrau_atual: idx, desde: hoje, checklist: { ...(r.checklist || {}), otimizar: ot }, atualizado_em: agoraIso() };
  if (avaliacoes != null) campos.base_avaliacoes = Math.round(num(avaliacoes));
  const { error } = await supabase.from("rampas_preco").update(campos).eq("id", r.id);
  if (error) return { ok: false, msg: `Não foi possível mudar o preço: ${error.message}` };
  await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: r.id, tipo: tipo === "subir" ? "subida" : "descida", data: hoje, degrau: idx, preco: num(novo), observacao: "otimizar preço" });
  avisar();
  return { ok: true };
}

/** "Manter aqui": o preço de agora vira o preço bom; não sugere subir por 30 dias. */
export async function manterOtimizar({ r, hoje }) {
  if (!supabase || !r) return { ok: false, msg: "Rampa não encontrada" };
  const de = num((r.degraus || [])[r.degrau_atual ?? 0]);
  const ot = otimizarDepois(r.checklist?.otimizar, { tipo: "manter", de, hoje });
  const { error } = await supabase.from("rampas_preco").update({ checklist: { ...(r.checklist || {}), otimizar: ot }, atualizado_em: agoraIso() }).eq("id", r.id);
  if (error) return { ok: false, msg: `Não foi possível salvar: ${error.message}` };
  avisar();
  return { ok: true };
}

/**
 * Desliga. modo: 'ficar' (fica no preço de agora) | 'melhor' | 'salvo' (volta ao
 * alvo). O histórico fica guardado (religar continua de onde parou).
 */
export async function desligarOtimizar({ lojaId, r, modo = "ficar", preco = null, hoje, grupo = false }) {
  if (!supabase || !r) return { ok: false, msg: "Rampa não encontrada" };
  const ot = { ...(r.checklist?.otimizar || {}), ligado: false, desligadoEm: hoje };
  const campos = { checklist: { ...(r.checklist || {}), otimizar: ot }, atualizado_em: agoraIso() };
  const atual = num((r.degraus || [])[r.degrau_atual ?? 0]);
  const muda = modo !== "ficar" && preco > 0 && Math.abs(num(preco) - atual) > 0.004;
  if (muda) {
    const degraus = listaDegraus(r.degraus, preco, grupo);
    campos.degraus = degraus;
    campos.degrau_atual = degraus.findIndex((d) => Math.abs(d - num(preco)) < 0.005);
    campos.desde = hoje;
  }
  const { error } = await supabase.from("rampas_preco").update(campos).eq("id", r.id);
  if (error) return { ok: false, msg: `Não foi possível desligar: ${error.message}` };
  if (muda) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: r.id, tipo: num(preco) < atual ? "descida" : "subida", data: hoje, degrau: campos.degrau_atual, preco: num(preco), observacao: "otimizar preço desligado" });
  avisar();
  return { ok: true };
}

/** Produto/kit: o preço bom vira o preço salvo (o alvo). Só com confirmação na tela. */
export async function atualizarSalvoOtimizar({ salvo, preco, custo, lucro }) {
  if (!supabase || !salvo?.id) return { ok: false, msg: "Preço salvo não encontrado" };
  const { error } = await gravarPrecoNovo((extra) =>
    supabase
      .from("precos_canal")
      .update({ preco, custo_total: custo, lucro, margem: preco > 0 && lucro != null ? lucro / preco : null, atualizado_em: agoraIso(), ...extra })
      .eq("id", salvo.id)
  );
  if (error) return { ok: false, msg: `Não foi possível atualizar o preço salvo: ${error.message}` };
  recarregarCatalogo();
  avisar();
  return { ok: true };
}
