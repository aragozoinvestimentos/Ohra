// Gravações da aba Análise (schema v55) — lugar ÚNICO onde pedidos, vendas
// físicas, importações e o lançamento automático no Fluxo de Caixa são gravados.
import { supabase } from "./supabaseClient.js";
import { caixaDosPedidos, enriquecer, inicioSemana } from "./pedidos.js";

const FALTA_SQL = "Falta rodar o supabase/schema_v55.sql no Supabase (aba Análise)";
const erroMsg = (e) => (/pedidos_itens|importacoes|skus_ignorados|origem_import|schema cache|does not exist/.test(e?.message || "") ? FALTA_SQL : `Não foi possível salvar: ${e?.message}`);

export async function registrarImportacao({ lojaId, relatorio, arquivo = null, periodo = null, ok = true, resumo = "", dados = null }) {
  const { error } = await supabase.from("importacoes").insert({ loja_id: lojaId || null, relatorio, arquivo, periodo_de: periodo?.de || null, periodo_ate: periodo?.ate || null, ok, resumo, dados });
  return error ? { ok: false, msg: erroMsg(error) } : { ok: true };
}

/** Grava (upsert pela chave) os itens de pedido já ligados ao catálogo. */
export async function gravarPedidos({ lojaId, linhas }) {
  if (!linhas.length) return { ok: true, n: 0 };
  const agora = new Date().toISOString();
  const rows = linhas.map((l) => ({ ...l, loja_id: lojaId || null, atualizado_em: agora }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("pedidos_itens").upsert(rows.slice(i, i + 500), { onConflict: "loja_id,chave" });
    if (error) return { ok: false, msg: erroMsg(error) };
  }
  return { ok: true, n: rows.length };
}

export async function ignorarSku({ lojaId, sku }) {
  const { error } = await supabase.from("skus_ignorados").upsert({ loja_id: lojaId || null, sku }, { onConflict: "loja_id,sku" });
  return error ? { ok: false, msg: erroMsg(error) } : { ok: true };
}

/** Venda física (balcão, feira, encomenda por Pix): vira um "pedido" entregue. */
export async function registrarVendaFisica({ lojaId, item, quantidade, preco, data, pagamento = null, observacao = null }) {
  const pedido = `F-${Date.now().toString(36)}`;
  const tipo = { p: "produto", v: "variacao", k: "kit" }[item.id[0]];
  const linha = {
    loja_id: lojaId || null,
    chave: `${pedido}|${item.sku || item.id}|1`,
    origem: "fisico",
    plataforma: "fisico",
    pedido,
    data,
    situacao: "Entregue",
    sku: item.sku || null,
    descricao: item.nome,
    item_tipo: tipo,
    item_id: item.id.slice(2),
    quantidade,
    valor_unitario: preco,
    pagamento,
    observacao,
  };
  const { data: salva, error } = await supabase.from("pedidos_itens").insert(linha).select().single();
  return error ? { ok: false, msg: erroMsg(error) } : { ok: true, linha: salva || linha };
}
export async function excluirVendaFisica(id) {
  const { error } = await supabase.from("pedidos_itens").delete().eq("id", id).eq("origem", "fisico");
  return error ? { ok: false, msg: erroMsg(error) } : { ok: true };
}

/**
 * Fluxo de Caixa: uma entrada por plataforma × semana com os pedidos
 * ENTREGUES (o que a plataforma repassa) e uma por semana das vendas físicas,
 * marcadas com `origem_import` — reenviar atualiza a mesma linha. Linhas
 * geradas que não existem mais (pedido cancelado/devolvido) saem. A receber não
 * vira lançamento. Proteção: entrada de venda lançada À MÃO na mesma semana e
 * canal → devolve um aviso (não bloqueia).
 * pedidos = todos os pedidos da loja (crus); ctx = { itens, canais, cfgDoProduto }.
 */
export async function sincronizarCaixa({ lojaId, pedidos, ctx }) {
  const { lancamentos } = caixaDosPedidos(enriquecer(pedidos, ctx));
  let q = supabase.from("lancamentos_caixa").select("id, origem_import, tipo, categoria, canal_id, data_prevista, data_realizada, descricao, valor");
  if (lojaId) q = q.eq("loja_id", lojaId);
  const { data: existentes, error } = await q;
  if (error) return { ok: false, msg: erroMsg(error) };
  const avisos = [];
  const manuais = (existentes || []).filter((l) => !l.origem_import && l.tipo === "entrada" && ["venda", "encomenda"].includes(l.categoria));
  for (const x of lancamentos) {
    const ja = (existentes || []).some((l) => l.origem_import === x.origem_import);
    if (!ja) {
      const dup = manuais.find((m) => inicioSemana(String(m.data_realizada || m.data_prevista).slice(0, 10)) === x.semana && (!x.canal_id || !m.canal_id || m.canal_id === x.canal_id));
      if (dup) avisos.push(`Já existe no caixa a entrada “${dup.descricao}” na mesma semana — confira se não está contando duas vezes com “${x.descricao}”.`);
    }
    const row = { loja_id: lojaId || null, origem_import: x.origem_import, tipo: "entrada", categoria: "venda", canal_id: x.canal_id, descricao: x.descricao, valor: Math.max(0, x.valor), data_prevista: x.data, data_realizada: x.data, observacao: "lançado pela aba Análise (pedidos importados)" };
    const r = await supabase.from("lancamentos_caixa").upsert(row, { onConflict: "loja_id,origem_import" });
    if (r.error) return { ok: false, msg: erroMsg(r.error) };
  }
  const vivas = new Set(lancamentos.map((x) => x.origem_import));
  const sobrando = (existentes || []).filter((l) => l.origem_import && l.origem_import.startsWith("pedidos|") && !vivas.has(l.origem_import));
  for (const l of sobrando) await supabase.from("lancamentos_caixa").delete().eq("id", l.id);
  return { ok: true, avisos, n: lancamentos.length, total: lancamentos.reduce((t, x) => t + x.valor, 0) };
}

