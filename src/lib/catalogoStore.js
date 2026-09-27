// Store ÚNICO do catálogo (produtos, kits, variações, materiais, embalagens,
// canais, preços salvos) da loja atual. Antes cada tela que usava
// useRankingData buscava tudo de novo e abria o seu próprio canal de
// realtime (10+ cópias ao mesmo tempo); agora todas compartilham UMA busca e
// UMA inscrição, e qualquer mudança em qualquer tabela envolvida (inclusive
// feita em outro aparelho) recarrega o catálogo pra todas as telas juntas.
import { supabase } from "./supabaseClient.js";

const VAZIO = {
  produtos: [],
  kits: [],
  kitProdutos: [],
  kitEmbalagens: [],
  embalagens: [],
  canais: [],
  precos: [],
  materiais: [],
  produtoEmbalagens: [],
  variacoes: [],
  concorrentes: [],
  publicacoes: [],
  carregando: true,
};

const TABELAS = [
  "produtos_cadastro",
  "canais",
  "kits",
  "kit_produtos",
  "kit_embalagens",
  "embalagens",
  "precos_canal",
  "produto_variacoes",
  "produto_embalagens",
  "materiais",
  "precos_concorrente",
  "publicacoes_olist",
];

let estado = { ...VAZIO, carregando: !!supabase };
let lojaAtual; // undefined = ainda não iniciado
let usuarios = 0;
let canalRealtime = null;
let timerRecarga = null;
let geracao = 0; // descarta respostas de uma loja anterior
const ouvintes = new Set();

function emitir(novo) {
  estado = novo;
  for (const fn of ouvintes) fn();
}

async function carregar() {
  if (!supabase) {
    emitir({ ...VAZIO, carregando: false });
    return;
  }
  const minhaGeracao = geracao;
  const lojaId = lojaAtual;
  const porLoja = (q) => (lojaId ? q.eq("loja_id", lojaId) : q);
  try {
    const [rp, rc, rk, re, rpc, rm, rv, rcc, rpo] = await Promise.all([
      porLoja(supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true })),
      porLoja(supabase.from("canais").select("*").eq("ativo", true).order("tipo")),
      porLoja(supabase.from("kits").select("*").order("nome")),
      porLoja(supabase.from("embalagens").select("*").order("nome")),
      porLoja(supabase.from("precos_canal").select("*")),
      porLoja(supabase.from("materiais").select("*")),
      // Só existe depois do schema v26 — sem ela, segue sem variações.
      porLoja(supabase.from("produto_variacoes").select("*").order("quantidade")),
      // Só existem depois do schema v27 — sem elas, segue sem concorrentes/publicações.
      porLoja(supabase.from("precos_concorrente").select("*")),
      porLoja(supabase.from("publicacoes_olist").select("*")),
    ]);
    if (minhaGeracao !== geracao) return;
    const produtos = rp.error ? estado.produtos : rp.data || [];
    const kits = rk.error ? estado.kits : rk.data || [];
    const produtoIds = produtos.map((x) => x.id);
    const kitIds = kits.map((k) => k.id);
    const [rpe, rkp, rke] = await Promise.all([
      produtoIds.length ? supabase.from("produto_embalagens").select("*").in("produto_id", produtoIds) : Promise.resolve({ data: [] }),
      kitIds.length ? supabase.from("kit_produtos").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
      kitIds.length ? supabase.from("kit_embalagens").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
    ]);
    if (minhaGeracao !== geracao) return;
    emitir({
      produtos,
      kits,
      canais: rc.error ? estado.canais : rc.data || [],
      embalagens: re.error ? estado.embalagens : re.data || [],
      precos: rpc.error ? estado.precos : rpc.data || [],
      materiais: rm.error ? estado.materiais : rm.data || [],
      variacoes: rv.error ? [] : rv.data || [],
      concorrentes: rcc.error ? [] : rcc.data || [],
      publicacoes: rpo.error ? [] : rpo.data || [],
      produtoEmbalagens: rpe.error ? [] : rpe.data || [],
      kitProdutos: rkp.error ? estado.kitProdutos : rkp.data || [],
      kitEmbalagens: rke.error ? estado.kitEmbalagens : rke.data || [],
      carregando: false,
    });
  } catch {
    // falha de rede — mantém o que já estava carregado
    if (minhaGeracao === geracao && estado.carregando) emitir({ ...estado, carregando: false });
  }
}

// Várias mudanças seguidas (ex.: salvar um produto grava produto + receita
// de embalagem) viram UMA recarga só.
function agendarRecarga() {
  clearTimeout(timerRecarga);
  timerRecarga = setTimeout(carregar, 150);
}

function iniciar(lojaId) {
  if (lojaAtual === lojaId && (canalRealtime || !supabase)) return;
  encerrar();
  lojaAtual = lojaId;
  geracao++;
  emitir({ ...VAZIO, carregando: !!supabase });
  carregar();
  if (!supabase) return;
  let ch = supabase.channel(`catalogo-compartilhado-${geracao}`);
  for (const tabela of TABELAS) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: tabela }, agendarRecarga);
  canalRealtime = ch.subscribe();
}

function encerrar() {
  clearTimeout(timerRecarga);
  if (canalRealtime && supabase) supabase.removeChannel(canalRealtime);
  canalRealtime = null;
}

// Rede de segurança pro "ao vivo": se o realtime cair (celular dormiu, wifi
// trocou), recarrega ao voltar pra aba/janela ou quando a internet volta.
if (typeof window !== "undefined") {
  const aoVoltar = () => {
    if (lojaAtual !== undefined && (typeof document === "undefined" || document.visibilityState === "visible")) agendarRecarga();
  };
  window.addEventListener("focus", aoVoltar);
  window.addEventListener("online", aoVoltar);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", aoVoltar);
}

// Uma tela começou a usar o catálogo dessa loja.
export function usarCatalogo(lojaId) {
  usuarios++;
  iniciar(lojaId ?? null);
  return () => {
    usuarios--;
    // Mantém o catálogo vivo enquanto alguma tela ainda usa (todas as abas
    // ficam montadas ao mesmo tempo, então na prática fica sempre vivo).
    if (usuarios <= 0) {
      usuarios = 0;
      encerrar();
      lojaAtual = undefined;
    }
  };
}

export function assinarCatalogo(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export const lerCatalogo = () => estado;

// Força uma recarga (ex.: logo depois de salvar algo, sem esperar o realtime).
export const recarregarCatalogo = () => agendarRecarga();
