// Consultor da Sede: anota sozinho os ERROS do app e quantas vezes cada TELA
// é aberta (pedido do Gustavo, 24/10/2026). Sempre na loja escolhida. Erros de
// rede/realtime e do próprio navegador ficam de fora (não são bug do app).
import { supabase } from "./supabaseClient.js";
import { hojeSP } from "./datas.js";

let tela = "inicio";
let ligado = false;
const contagem = new Map(); // 'AAAA-MM-DD|tela' → vezes ainda não gravadas
const errosVistos = new Map(); // msg → último envio (ms)
const IGNORAR = /ResizeObserver|WebSocket|Failed to fetch|NetworkError|Load failed|ChunkLoadError|Importing a module script failed|dynamically imported module|AbortError|realtime/i;

const lojaAtual = () => {
  try {
    return localStorage.getItem("ohra:loja-atual") || null;
  } catch {
    return null;
  }
};
const hashCurto = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

async function somar(lojaId, tipo, chave, mudar) {
  const q = await supabase.from("consultor_registros").select("id,dados").eq("loja_id", lojaId).eq("tipo", tipo).eq("chave", chave).maybeSingle();
  if (q.error) return;
  const dados = mudar(q.data?.dados || {});
  await supabase
    .from("consultor_registros")
    .upsert({ loja_id: lojaId, tipo, chave, dados, atualizado_em: new Date().toISOString() }, { onConflict: "loja_id,tipo,chave" });
}

export function registrarErro(msg) {
  const texto = String(msg || "").slice(0, 400);
  if (!supabase || !texto || IGNORAR.test(texto)) return;
  const lojaId = lojaAtual();
  if (!lojaId) return;
  const agora = Date.now();
  if (agora - (errosVistos.get(texto) || 0) < 60000) return; // o mesmo erro no máx. 1× por minuto
  errosVistos.set(texto, agora);
  const chave = `${hojeSP()}|${hashCurto(texto)}`;
  somar(lojaId, "erro", chave, (d) => ({ msg: texto, tela, vezes: (Number(d.vezes) || 0) + 1, ultima: new Date().toISOString() })).catch(() => {});
}

async function gravarUso() {
  const lojaId = lojaAtual();
  if (!supabase || !lojaId || !contagem.size) return;
  const itens = [...contagem.entries()];
  contagem.clear();
  for (const [chave, n] of itens) await somar(lojaId, "uso", chave, (d) => ({ n: (Number(d.n) || 0) + n })).catch(() => {});
}

export function telaAberta(aba) {
  tela = aba;
  const k = `${hojeSP()}|${aba}`;
  contagem.set(k, (contagem.get(k) || 0) + 1);
}

export function iniciarCaptura() {
  if (ligado || typeof window === "undefined") return;
  ligado = true;
  window.addEventListener("error", (e) => registrarErro(e?.error?.stack?.split("\n").slice(0, 3).join(" | ") || e?.message));
  window.addEventListener("unhandledrejection", (e) => registrarErro(e?.reason?.stack?.split("\n").slice(0, 3).join(" | ") || e?.reason?.message || String(e?.reason || "")));
  setInterval(() => gravarUso().catch(() => {}), 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") gravarUso().catch(() => {});
  });
}
