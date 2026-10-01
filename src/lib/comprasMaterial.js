// Compras de material (schema v32) e parcelamento no Fluxo de Caixa.
// - O preço do material (materiais.preco) passa a ser a MÉDIA PONDERADA pela
//   quantidade das 3 últimas compras que contam na média (contar_media).
//   O app recalcula e GRAVA em materiais.preco a cada compra registrada ou
//   excluída — assim todo o resto do app (custo ao vivo) continua igual.
// - Um lançamento parcelado vira N linhas em lancamentos_caixa com o mesmo
//   parcela_grupo (1/N, 2/N…), uma por mês, a partir da data da 1ª parcela.
import { dataNoMes, mesDe, somarMeses } from "./fluxoCaixa.js";

export const COMPRAS_NA_MEDIA = 3;
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const centavos = (v) => Math.round(v * 100) / 100;

// Média ponderada das últimas N compras que contam (mais recentes primeiro).
export function precoMedio(compras, n = COMPRAS_NA_MEDIA) {
  const validas = (compras || [])
    .filter((c) => c.contar_media !== false && num(c.quantidade) > 0)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.criado_em || "").localeCompare(String(a.criado_em || "")))
    .slice(0, n);
  const qtd = validas.reduce((s, c) => s + num(c.quantidade), 0);
  if (!(qtd > 0)) return null;
  const valor = validas.reduce((s, c) => s + num(c.valor_total), 0);
  return { preco: centavos(valor / qtd), compras: validas.length };
}

// Divide um valor em N parcelas (centavos que sobram vão na 1ª).
export function dividirParcelas(total, n) {
  const qtd = Math.max(1, Math.round(n) || 1);
  const base = Math.floor((num(total) * 100) / qtd) / 100;
  const resto = centavos(num(total) - base * qtd);
  return Array.from({ length: qtd }, (_, i) => centavos(i === 0 ? base + resto : base));
}

const novoId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// Linhas de lancamentos_caixa pra um lançamento parcelado (ou à vista, n = 1).
// `base` = campos comuns (loja_id, tipo, descricao, categoria, canal_id,
// observacao…). A 1ª parcela pode já entrar como realizada.
export function linhasParceladas(base, { valorTotal, parcelas, data1, primeiraRealizada = false, hoje }) {
  const n = Math.max(1, Math.round(parcelas) || 1);
  const valores = dividirParcelas(valorTotal, n);
  const grupo = n > 1 ? novoId() : null;
  return valores.map((valor, i) => {
    const data = i === 0 ? data1 : dataNoMes(data1, somarMeses(mesDe(data1), i));
    return {
      ...base,
      descricao: n > 1 ? `${base.descricao} (${i + 1}/${n})` : base.descricao,
      valor,
      data_prevista: data,
      data_realizada: i === 0 && primeiraRealizada ? (data <= hoje ? data : hoje) : null,
      recorrencia: "nenhuma",
      parcela_grupo: grupo,
      parcela_num: n > 1 ? i + 1 : null,
      parcela_total: n > 1 ? n : null,
    };
  });
}

// Recalcula a média do material e grava em materiais.preco. Devolve a média
// (ou null se não houver compra que conte — aí o preço manual fica como está).
export async function recalcularPrecoMaterial(supabase, materialId) {
  const { data, error } = await supabase.from("compras_material").select("*").eq("material_id", materialId);
  if (error) return { error };
  const m = precoMedio(data || []);
  if (!m) return { media: null };
  const { error: e2 } = await supabase.from("materiais").update({ preco: m.preco, atualizado_em: new Date().toISOString() }).eq("id", materialId);
  return e2 ? { error: e2 } : { media: m };
}

// Exclui a compra: apaga as parcelas ainda NÃO pagas no caixa (as pagas
// ficam, sem o vínculo) e recalcula a média do material.
export async function excluirCompra(supabase, compra) {
  await supabase.from("lancamentos_caixa").delete().eq("compra_material_id", compra.id).is("data_realizada", null);
  const { error } = await supabase.from("compras_material").delete().eq("id", compra.id);
  if (error) return { error };
  return recalcularPrecoMaterial(supabase, compra.material_id);
}
