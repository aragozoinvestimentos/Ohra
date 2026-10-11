// "Tirar do <canal>" (out/2026) — item removido do marketplace. Conta ÚNICA,
// usada por Produtos precificados e Anunciar (TirarDoCanalDialog.jsx). Só
// mexe no item × ESSE canal; os outros canais não mudam. Sempre com
// ConfirmDialog e ação do Gustavo.
//   'relancar' = removi o anúncio mas vou relançar → apaga só a marcação em
//                publicacoes_canal (riscado fixo); o preço salvo fica e a
//                Anunciar volta a sugerir o preço de cadastro.
//   'tudo'     = apaga precos_canal, publicacoes_canal, afiliado_config do
//                item × canal e o canal em produtos_cadastro.quantidades_anuncio;
//                a rampa (+ registros, em cascata) só se confirmada à parte.
import { supabase } from "./supabaseClient.js";
import { recarregarCatalogo } from "./catalogoStore.js";

export const tipoDoId = (id) => ({ p: "produto", v: "variacao", k: "kit" })[String(id || "")[0]] || null;
const idCru = (id) => String(id || "").slice(2);

// Produto do item (p: = ele mesmo; v: = o pai; k: = nenhum).
export const produtoDoItem = (item) => (item?.id?.startsWith("p:") ? item.id.slice(2) : item?.id?.startsWith("v:") ? item.produtoId : null);

// Família: o produto, as variações dele e os kits que o contêm.
export function familiaDoItem(item, itens) {
  const pid = produtoDoItem(item);
  if (!pid) return [item];
  const out = [];
  for (const i of itens) {
    if (i.id === `p:${pid}`) out.push(i);
    else if (i.id.startsWith("v:") && i.produtoId === pid) out.push(i);
    else if (i.id.startsWith("k:") && (i.componentes || []).some((c) => c.produtoId === pid)) out.push(i);
  }
  if (!out.some((i) => i.id === item.id)) out.unshift(item);
  return out;
}

// O que existe de cada item naquele canal (só o que tem algo).
export function oQueExisteNoCanal({ itensAlvo, canal, precos = [], publicacoes = [], afConfig = [], rampas = [], rampaRegistros = [] }) {
  const linhas = [];
  for (const it of itensAlvo) {
    const tipo = tipoDoId(it.id);
    const id = idCru(it.id);
    const mesmo = (r) => r.item_tipo === tipo && r.item_id === id && r.canal_id === canal.id;
    const preco = precos.find(mesmo) || null;
    const publicacao = publicacoes.find(mesmo) || null;
    const afiliado = afConfig.filter(mesmo);
    const rampa = tipo === "produto" ? rampas.find((r) => r.produto_id === id && r.canal_id === canal.id) || null : null;
    const semanas = rampa ? rampaRegistros.filter((g) => g.rampa_id === rampa.id && g.tipo === "semana").length : 0;
    if (preco || publicacao || afiliado.length || rampa) linhas.push({ item: it, tipo, id, preco, publicacao, afiliado, rampa, semanas });
  }
  return linhas;
}

// Executa. linhas = oQueExisteNoCanal(...); produtos = produtos crus (quantidades_anuncio).
export async function tirarDoCanal({ modo, linhas, canal, apagarRampa = false, produtos = [] }) {
  const erros = [];
  const del = async (tabela, filtro) => {
    let q = supabase.from(tabela).delete();
    for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
    const { error } = await q;
    if (error) erros.push(`${tabela}: ${error.message}`);
  };
  for (const l of linhas) {
    const f = { item_tipo: l.tipo, item_id: l.id, canal_id: canal.id };
    if (l.publicacao) await del("publicacoes_canal", f);
    if (modo !== "tudo") continue;
    if (l.preco) await del("precos_canal", f);
    if (l.afiliado.length) await del("afiliado_config", f);
    if (l.rampa && apagarRampa) await del("rampas_preco", { id: l.rampa.id });
    if (l.tipo === "produto") {
      const p = produtos.find((x) => x.id === l.id);
      const q = p?.quantidades_anuncio;
      if (q && Object.prototype.hasOwnProperty.call(q, canal.id)) {
        const novo = { ...q };
        delete novo[canal.id];
        const { error } = await supabase.from("produtos_cadastro").update({ quantidades_anuncio: novo }).eq("id", l.id);
        if (error) erros.push(`quantidades_anuncio: ${error.message}`);
      }
    }
  }
  recarregarCatalogo();
  window.dispatchEvent(new Event("focus")); // rampas/afiliados recarregam
  return erros;
}
