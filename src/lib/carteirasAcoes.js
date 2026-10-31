// Gravações das carteiras do Caixa (schema v67) — lugar ÚNICO onde o extrato
// das plataformas e os saques (transferência carteira → Conta da loja) são
// gravados. Contas em lib/carteiras.js.
import { supabase } from "./supabaseClient.js";
import { CARTEIRA_LOJA, nomeCarteira } from "./carteiras.js";

const FALTA_SQL = "Falta rodar o supabase/schema_v67.sql no Supabase (carteiras do Caixa)";
const erroMsg = (e) => (/extrato_carteira|carteira|transferencia_id|schema cache|does not exist/.test(e?.message || "") ? FALTA_SQL : `Não foi possível salvar: ${e?.message}`);
const avisarCaixa = () => typeof window !== "undefined" && window.dispatchEvent(new Event("ohra:caixa"));
const novoId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

/**
 * Saque: duas linhas ligadas pelo transferencia_id — saída da carteira da
 * plataforma e entrada na Conta da loja, na mesma data e valor. O saldo total
 * não muda; fora de Metas/Payoff/médias (categoria "transferencia").
 * origem = chave do extrato quando veio da importação (não duplica ao reenviar).
 */
export async function registrarTransferencia({ lojaId, de, para = CARTEIRA_LOJA, valor, data, observacao = null, origem = null }) {
  const v = Math.round(Number(valor) * 100) / 100;
  if (!(v > 0)) return { ok: false, msg: "Informe o valor do saque." };
  if (!de || de === para) return { ok: false, msg: "Escolha de qual carteira saiu." };
  const id = novoId();
  const base = { loja_id: lojaId || null, categoria: "transferencia", valor: v, data_prevista: data, data_realizada: data, transferencia_id: id, observacao, pago_com: "loja" };
  const desc = `Saque ${nomeCarteira(de)} → ${nomeCarteira(para)}`;
  const linhas = [
    { ...base, tipo: "saida", carteira: de, descricao: desc, ...(origem ? { origem_import: `${origem}|saida` } : {}) },
    { ...base, tipo: "entrada", carteira: para, descricao: desc, ...(origem ? { origem_import: `${origem}|entrada` } : {}) },
  ];
  const r = origem ? await supabase.from("lancamentos_caixa").upsert(linhas, { onConflict: "loja_id,origem_import", ignoreDuplicates: true }) : await supabase.from("lancamentos_caixa").insert(linhas);
  if (r.error) return { ok: false, msg: erroMsg(r.error) };
  avisarCaixa();
  return { ok: true };
}

/** Exclui as duas pontas de um saque. */
export async function excluirTransferencia(transferenciaId) {
  if (!transferenciaId) return { ok: false, msg: "Saque sem identificação." };
  const { error } = await supabase.from("lancamentos_caixa").delete().eq("transferencia_id", transferenciaId);
  return error ? { ok: false, msg: erroMsg(error) } : { ok: true };
}

/**
 * Grava as transações do extrato (upsert pela chave — reenviar não duplica) e
 * cria o saque no Caixa pra cada saída de saque do extrato (uma vez só, pela
 * origem "extrato|<plataforma>|<chave>").
 */
export async function gravarExtrato({ lojaId, plataforma, transacoes, importacaoId = null }) {
  const rows = transacoes.map((t) => ({ loja_id: lojaId || null, plataforma, chave: t.chave, data: t.data.replace(" ", "T"), tipo: t.tipo, descricao: t.descricao, pedido: t.pedido, valor: t.valor, status: t.status, saldo_apos: t.saldo_apos }));
  // v71: as transações NOVAS guardam de qual envio entraram (pro × do envio).
  let ja = new Set();
  if (importacaoId) {
    let q = supabase.from("extrato_carteira").select("chave").eq("plataforma", plataforma);
    if (lojaId) q = q.eq("loja_id", lojaId);
    const r = await q;
    ja = new Set((r.data || []).map((x) => x.chave));
  }
  let semControle = !importacaoId;
  const grupos = importacaoId ? [rows.filter((r) => !ja.has(r.chave)).map((r) => ({ ...r, importacao_id: importacaoId })), rows.filter((r) => ja.has(r.chave))] : [rows];
  for (let g of grupos) {
    for (let i = 0; i < g.length; i += 500) {
      let { error } = await supabase.from("extrato_carteira").upsert(g.slice(i, i + 500), { onConflict: "loja_id,plataforma,chave" });
      if (error && /importacao_id/.test(error.message || "")) {
        semControle = true;
        g = g.map(({ importacao_id: _x, ...r }) => r); // eslint-disable-line no-unused-vars
        ({ error } = await supabase.from("extrato_carteira").upsert(g.slice(i, i + 500), { onConflict: "loja_id,plataforma,chave" }));
      }
      if (error) return { ok: false, msg: erroMsg(error) };
    }
  }
  let saques = 0;
  for (const t of transacoes.filter((x) => x.saque)) {
    const r = await registrarTransferencia({ lojaId, de: plataforma, valor: Math.abs(t.valor), data: t.data.slice(0, 10), observacao: `do extrato: ${t.descricao || t.tipo}`, origem: `extrato|${plataforma}|${t.chave}` });
    if (!r.ok) return r;
    saques++;
  }
  return { ok: true, n: rows.length, saques, semControle };
}
