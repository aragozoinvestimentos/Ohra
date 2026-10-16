import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { lembrarIdsShopee, relatorioDoGuardado } from "../lib/relatorioShopee.js";

// Aba Análise (schema v55): itens de pedidos importados/vendas físicas
// (pedidos_itens), arquivos enviados na central (importacoes) e SKUs
// descartados. Store ÚNICO (uma busca + um canal de realtime pra todas as
// telas que usam — Análise, Crescimento, Vendas do mês, Início). Sem as
// tabelas (SQL não rodado) → disponivel = false.
const VAZIO = { pedidos: [], importacoes: [], ignorados: [], disponivel: true, carregando: true, lojaId: undefined };
let estado = VAZIO;
const ouvintes = new Set();
let lojaAtual;
let canal = null;
let timer = null;
let usuarios = 0;
let seq = 0;
let geracao = 0;

const publicar = (novo) => {
  estado = novo;
  ouvintes.forEach((f) => f());
};

async function carregar() {
  if (!supabase) return publicar({ ...VAZIO, carregando: false, lojaId: lojaAtual });
  const g = ++geracao;
  const lojaId = lojaAtual;
  try {
    const q = (t, ordem) => {
      let x = supabase.from(t).select("*").order(ordem, { ascending: true });
      if (lojaId) x = x.eq("loja_id", lojaId);
      return x;
    };
    // pedidos_itens pode passar de 1000 linhas: busca em páginas.
    const pedidos = [];
    for (let de = 0; de < 50000; de += 1000) {
      const r = await q("pedidos_itens", "data").range(de, de + 999);
      if (r.error) {
        if (g === geracao) publicar({ ...VAZIO, disponivel: false, carregando: false, lojaId });
        return;
      }
      pedidos.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    const [ri, rg] = await Promise.all([q("importacoes", "criado_em"), q("skus_ignorados", "criado_em")]);
    if (g !== geracao) return;
    // Ligação ID do item da Shopee → SKU (o CSV do Ads só traz o ID): refeita a
    // partir dos Desempenhos guardados no BANCO — vale em qualquer aparelho.
    for (const i of ri.data || []) {
      if (!i.ok || i.relatorio !== "shopee:desempenho" || !i.dados) continue;
      const r = relatorioDoGuardado(i.dados);
      if (r) lembrarIdsShopee([r]);
    }
    publicar({ pedidos, importacoes: ri.error ? [] : ri.data || [], ignorados: rg.error ? [] : rg.data || [], disponivel: true, carregando: false, lojaId });
  } catch {
    if (g === geracao) publicar({ ...estado, carregando: false });
  }
}
const agendar = () => {
  clearTimeout(timer);
  timer = setTimeout(carregar, 200);
};
const aoVoltar = () => document.visibilityState === "visible" && agendar();

function ligar() {
  if (!supabase || canal) return;
  canal = supabase
    .channel(`pedidos-${++seq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos_itens" }, agendar)
    .on("postgres_changes", { event: "*", schema: "public", table: "importacoes" }, agendar)
    .on("postgres_changes", { event: "*", schema: "public", table: "skus_ignorados" }, agendar)
    .subscribe();
  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("focus", agendar);
  window.addEventListener("ohra:pedidos", agendar);
}
function desligar() {
  if (!canal) return;
  supabase.removeChannel(canal);
  canal = null;
  document.removeEventListener("visibilitychange", aoVoltar);
  window.removeEventListener("focus", agendar);
  window.removeEventListener("ohra:pedidos", agendar);
}

const assinar = (f) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};

export function usePedidos() {
  const { lojaId } = useLoja();
  const s = useSyncExternalStore(assinar, () => estado, () => estado);
  useEffect(() => {
    usuarios++;
    if (!canal || lojaAtual !== lojaId || estado.lojaId !== lojaId) {
      lojaAtual = lojaId;
      carregar();
    }
    ligar();
    return () => {
      usuarios--;
      if (usuarios <= 0) desligar();
    };
  }, [lojaId]);
  return s.lojaId === lojaId || s.lojaId === undefined ? s : { ...VAZIO, lojaId };
}

export const recarregarPedidos = () => window.dispatchEvent(new Event("ohra:pedidos"));
