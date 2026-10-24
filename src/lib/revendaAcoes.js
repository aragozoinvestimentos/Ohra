// Gravações da REVENDA (schema v66). Só daqui: nota de compra (XML), fornecedores,
// ajustes e inventário de estoque, regime de impostos. O custo do produto de
// revenda é a média das 3 últimas notas e é GRAVADO em produtos_cadastro.custo_producao
// a cada nota gravada/excluída (como o filamento em materiais.preco) — assim todo o
// "ao vivo" do app (preço, lucro, escada, Anunciar) continua igual.
import { supabase } from "./supabaseClient.js";
import { recarregarRevenda } from "../hooks/useRevenda.js";
import { recarregarCatalogo } from "./catalogoStore.js";
import { custoMedioRevenda } from "./revenda.js";

export const SQL_REVENDA = "Rode o supabase/schema_v66.sql no Supabase pra usar a revenda (notas, fornecedores e estoque)";
const ehFaltaTabela = (e) => !!e && /fornecedor|compras_revenda|estoque_movimentos|origem|compra_revenda_id|schema cache|does not exist/i.test(e.message || "");
const erro = (e) => ({ message: ehFaltaTabela(e) ? SQL_REVENDA : e?.message || "erro" });
const cent = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Recalcula e grava o custo médio dos produtos (3 últimas notas que contam). */
export async function recalcularCustoRevenda(produtoIds) {
  for (const pid of [...new Set(produtoIds)].filter(Boolean)) {
    const { data, error } = await supabase.from("compras_revenda_itens").select("custo_un, quantidade, criado_em, compras_revenda(emissao, contar_media)").eq("produto_id", pid);
    if (error) continue;
    const m = custoMedioRevenda((data || []).map((i) => ({ ...i, emissao: i.compras_revenda?.emissao, contar_media: i.compras_revenda?.contar_media })));
    if (m) await supabase.from("produtos_cadastro").update({ custo_producao: m.preco, atualizado_em: new Date().toISOString() }).eq("id", pid);
  }
}

/** Fornecedor pelo CNPJ (cria se não existir). → { id } | { error } */
export async function fornecedorDaNota({ lojaId, emitente, fornecedores }) {
  const cnpj = String(emitente?.cnpj || "");
  const achou = cnpj ? (fornecedores || []).find((f) => String(f.cnpj || "").replace(/\D/g, "") === cnpj) : null;
  if (achou) return { id: achou.id };
  const { data, error } = await supabase.from("fornecedores").insert({ loja_id: lojaId || null, nome: emitente?.nome || "Fornecedor", cnpj: cnpj || null, uf: emitente?.uf || null }).select("id").single();
  return error ? { error: erro(error) } : { id: data.id };
}

/**
 * Grava a nota inteira.
 * @param linhas  custoDosItens() + { produtoId } (itens sem produto ficam de fora)
 * @param caixa   { pagoCom, jaPaga, parcelas: [{ venc, valor }] } — vazio = uma saída na emissão
 */
export async function gravarNota({ lojaId, nota, linhas, fornecedores, difal, contarMedia = true, caixa = {}, novosProdutos = [] }) {
  if (!supabase) return { error: { message: "sem banco" } };
  const f = await fornecedorDaNota({ lojaId, emitente: nota.emitente, fornecedores });
  if (f.error) return f;
  // produtos novos (cadastrados a partir do item da nota)
  const idsNovos = {};
  for (const n of novosProdutos) {
    const { data, error } = await supabase
      .from("produtos_cadastro")
      .insert({ loja_id: lojaId || null, nome: n.nome, ean: n.ean || null, origem: "revenda", fornecedor_id: f.id, custo_producao: cent(n.custo), embalagem_padrao: 0, frete_padrao: 0 })
      .select("id")
      .single();
    if (error) return { error: erro(error) };
    idsNovos[n.chave] = data.id;
  }
  const usadas = linhas.map((l) => ({ ...l, produtoId: l.produtoId === "novo" ? idsNovos[l.n] : l.produtoId })).filter((l) => l.produtoId);
  if (!usadas.length) return { error: { message: "Nenhum item ligado a um produto." } };
  const t = nota.totais || {};
  const difalTotal = cent(usadas.reduce((s, l) => s + l.difal, 0));
  const { data: compra, error: ec } = await supabase
    .from("compras_revenda")
    .insert({
      loja_id: lojaId || null,
      fornecedor_id: f.id,
      chave_nfe: nota.chave || null,
      numero: nota.numero,
      serie: nota.serie,
      emissao: nota.emissao,
      uf_origem: nota.emitente?.uf || null,
      uf_destino: nota.ufDestino || null,
      total_produtos: t.vProd,
      total_ipi: t.vIPI,
      total_st: t.vST,
      total_frete: t.vFrete,
      total_outros: cent((t.vSeg || 0) + (t.vOutro || 0)),
      total_desconto: t.vDesc,
      total_nota: t.vNF,
      difal: difalTotal,
      aliquota_interna: difal?.ligado ? difal.aliquotaInterna : null,
      contar_media: contarMedia,
    })
    .select("id")
    .single();
  if (ec) return { error: /duplicate|unique/i.test(ec.message) ? { message: `A NF ${nota.numero} já foi importada — não entra duas vezes.` } : erro(ec) };
  const rIt = await supabase.from("compras_revenda_itens").insert(
    usadas.map((l) => ({
      loja_id: lojaId || null,
      compra_id: compra.id,
      produto_id: l.produtoId,
      codigo: l.codigo,
      ean: l.ean,
      descricao: l.descricao,
      unidade: l.unidade,
      qtd_nota: l.qtd,
      fator: l.fator,
      quantidade: l.quantidade,
      preco_un: Math.round(l.precoUn * 10000) / 10000,
      ipi_un: Math.round(l.ipiUn * 10000) / 10000,
      st_un: Math.round(l.stUn * 10000) / 10000,
      frete_un: Math.round(l.freteUn * 10000) / 10000,
      difal_un: Math.round(l.difalUn * 10000) / 10000,
      custo_un: l.custoUn,
    }))
  );
  if (rIt.error) {
    await supabase.from("compras_revenda").delete().eq("id", compra.id);
    return { error: erro(rIt.error) };
  }
  await supabase.from("estoque_movimentos").insert(usadas.map((l) => ({ loja_id: lojaId || null, produto_id: l.produtoId, data: nota.emissao, tipo: "entrada", quantidade: l.quantidade, custo_un: l.custoUn, motivo: `NF ${nota.numero}`, compra_id: compra.id })));
  // de-para: o próximo XML desse fornecedor já sabe qual produto é cada item
  await supabase.from("fornecedor_itens").upsert(
    usadas.filter((l) => l.codigo).map((l) => ({ loja_id: lojaId || null, fornecedor_id: f.id, codigo: l.codigo, ean: l.ean, descricao: l.descricao, produto_id: l.produtoId, fator: l.fator })),
    { onConflict: "loja_id,fornecedor_id,codigo" }
  );
  // produto ligado passa a ser de revenda (e ganha o EAN da nota se não tinha)
  for (const l of usadas) {
    const campos = { origem: "revenda", fornecedor_id: f.id };
    if (l.ean && !l.produtoTemEan) campos.ean = l.ean;
    await supabase.from("produtos_cadastro").update(campos).eq("id", l.produtoId);
  }
  // Caixa: as duplicatas da nota (ou uma saída na emissão)
  const nome = nota.emitente?.nome || "fornecedor";
  const parcelas = (caixa.parcelas || []).length ? caixa.parcelas : [{ venc: nota.emissao, valor: t.vNF }];
  const grupo = parcelas.length > 1 ? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`) : null;
  const lanc = parcelas.map((p, i) => ({
    loja_id: lojaId || null,
    tipo: "saida",
    categoria: "mercadoria",
    descricao: `NF ${nota.numero} — ${nome}${parcelas.length > 1 ? ` (${i + 1}/${parcelas.length})` : ""}`,
    valor: cent(p.valor),
    data_prevista: p.venc,
    data_realizada: caixa.jaPaga && i === 0 ? p.venc : null,
    recorrencia: "nenhuma",
    parcela_grupo: grupo,
    parcela_num: grupo ? i + 1 : null,
    parcela_total: grupo ? parcelas.length : null,
    pago_com: caixa.pagoCom || "loja",
    compra_revenda_id: compra.id,
  }));
  if (difalTotal > 0)
    lanc.push({ loja_id: lojaId || null, tipo: "saida", categoria: "taxas", descricao: `DIFAL da NF ${nota.numero}`, valor: difalTotal, data_prevista: nota.emissao, data_realizada: null, recorrencia: "nenhuma", pago_com: caixa.pagoCom || "loja", compra_revenda_id: compra.id });
  const rc = await supabase.from("lancamentos_caixa").insert(lanc);
  await recalcularCustoRevenda(usadas.map((l) => l.produtoId));
  recarregarRevenda();
  recarregarCatalogo();
  window.dispatchEvent(new Event("focus"));
  return { error: null, avisoCaixa: rc.error ? `A nota entrou, mas o Caixa não: ${rc.error.message}` : null, compraId: compra.id, itens: usadas.length };
}

/** Exclui a nota: itens e entradas de estoque saem; parcelas EM ABERTO saem do Caixa (pagas ficam). */
export async function excluirNota(compra, itens) {
  if (!supabase) return { error: { message: "sem banco" } };
  await supabase.from("lancamentos_caixa").delete().eq("compra_revenda_id", compra.id).is("data_realizada", null);
  const { error } = await supabase.from("compras_revenda").delete().eq("id", compra.id);
  if (error) return { error: erro(error) };
  await recalcularCustoRevenda((itens || []).filter((i) => i.compra_id === compra.id).map((i) => i.produto_id));
  recarregarRevenda();
  recarregarCatalogo();
  return { error: null };
}

/** Ajuste de exceção (perda, brinde, amostra, uso…) — quantidade com sinal. */
export async function ajustarEstoque({ lojaId, produtoId, quantidade, motivo, data }) {
  if (!supabase) return { error: { message: "sem banco" } };
  const { error } = await supabase.from("estoque_movimentos").insert({ loja_id: lojaId || null, produto_id: produtoId, data, tipo: "ajuste", quantidade, motivo: motivo || null });
  recarregarRevenda();
  return { error: error ? erro(error) : null };
}

/** Inventário: cada diferença vira um movimento 'inventario' com o motivo. */
export async function gravarInventario({ lojaId, diferencas, data }) {
  if (!supabase) return { error: { message: "sem banco" } };
  if (!diferencas.length) return { error: null };
  const { error } = await supabase.from("estoque_movimentos").insert(diferencas.map((d) => ({ loja_id: lojaId || null, produto_id: d.produtoId, data, tipo: "inventario", quantidade: d.diferenca, motivo: `inventário: ${d.motivo || "não sei"}` })));
  recarregarRevenda();
  return { error: error ? erro(error) : null };
}

export async function excluirMovimento(id) {
  const { error } = await supabase.from("estoque_movimentos").delete().eq("id", id);
  recarregarRevenda();
  return { error: error ? erro(error) : null };
}

export async function salvarFornecedor({ lojaId, fornecedor }) {
  const campos = {
    nome: fornecedor.nome,
    cnpj: fornecedor.cnpj || null,
    uf: fornecedor.uf || null,
    prazo_dias: fornecedor.prazo_dias === "" || fornecedor.prazo_dias == null ? null : Number(fornecedor.prazo_dias),
    pedido_minimo: fornecedor.pedido_minimo === "" || fornecedor.pedido_minimo == null ? null : Number(String(fornecedor.pedido_minimo).replace(",", ".")),
    contato: fornecedor.contato || null,
    observacao: fornecedor.observacao || null,
  };
  const r = fornecedor.id ? await supabase.from("fornecedores").update(campos).eq("id", fornecedor.id) : await supabase.from("fornecedores").insert({ ...campos, loja_id: lojaId || null });
  recarregarRevenda();
  return { error: r.error ? erro(r.error) : null };
}

export async function excluirFornecedor(id) {
  const { error } = await supabase.from("fornecedores").delete().eq("id", id);
  recarregarRevenda();
  return { error: error ? erro(error) : null };
}

/** Campos de revenda do produto (prazo/folga do estoque). */
export async function salvarEstoqueCfg(produtoId, cfg) {
  const { error } = await supabase.from("produtos_cadastro").update({ estoque_cfg: cfg }).eq("id", produtoId);
  recarregarCatalogo();
  return { error: error ? erro(error) : null };
}
