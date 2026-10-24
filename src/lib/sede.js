// Sede da <loja> (24/10/2026): o que é PURO da Sede — salas, elenco, nomes por
// loja e de que sala é cada aviso do Início. Desenho e movimento: sedeMotor.js.
import { chaveDoDestino } from "./marcas.js";

// Planta (grade 40 × 26, quadradinhos de 16 px). Corredor nas linhas 11–13.
export const SALAS_SEDE = [
  { k: "diretoria", nome: "Diretoria", x0: 1, y0: 2, x1: 11, y1: 9, piso: ["#a9774e", "#9c6c45"], porta: [6, 10], aba: "inicio", rotulo: "Abrir o Início" },
  { k: "live", nome: "Estúdio de Live", x0: 13, y0: 2, x1: 20, y1: 9, piso: ["#e9cfd8", "#e0c3cd"], porta: [16, 10], aba: "live", rotulo: "Abrir Live" },
  { k: "financeiro", nome: "Financeiro", x0: 22, y0: 2, x1: 28, y1: 9, piso: ["#d9ded6", "#cfd5cb"], porta: [25, 10], aba: "caixa", rotulo: "Abrir Dinheiro" },
  { k: "revenda", nome: "Revenda", x0: 30, y0: 2, x1: 38, y1: 9, piso: ["#ddd3c4", "#d4c9b8"], porta: [34, 10], aba: null, rotulo: null },
  { k: "comercial", nome: "Comercial", x0: 1, y0: 15, x1: 15, y1: 23, piso: ["#ded6c8", "#d4cbbc"], porta: [8, 14], aba: "anuncios", rotulo: "Abrir Anúncios" },
  { k: "producao", nome: "Produção", x0: 17, y0: 15, x1: 25, y1: 23, piso: ["#b3b2ae", "#a9a8a3"], porta: [21, 14], aba: "farm", rotulo: "Abrir Minha farm" },
  { k: "estoque", nome: "Estoque & Expedição", x0: 27, y0: 15, x1: 38, y1: 23, piso: ["#cdbb9e", "#c3b092"], porta: [32, 14], aba: "importar", rotulo: "Atualizar dados" },
];

// Elenco: papel fixo (rotina, mesa, roupa), nome configurável por loja.
// Os donos (ceo1/ceo2) e os bichos mudam de cara conforme a loja (estilo "ohra" ou "outra").
export const ELENCO = [
  { id: "ceo1", funcao: "CEO", tipo: "dono" },
  { id: "ceo2", funcao: "CEO", tipo: "dono" },
  { id: "bia", funcao: "Financeiro", nome: "Bia" },
  { id: "rafa", funcao: "Preços", nome: "Rafa" },
  { id: "nina", funcao: "Anúncios e Rampa", nome: "Nina" },
  { id: "leo", funcao: "Ads", nome: "Leo" },
  { id: "celia", funcao: "Análise", nome: "Célia" },
  { id: "teo", funcao: "Produção", nome: "Téo" },
  { id: "duda", funcao: "Estoque", nome: "Duda" },
  { id: "ze", funcao: "Recepção / carteiro", nome: "Zé" },
  { id: "consultor", funcao: "Consultor (de óculos)", nome: "Consultor" },
  { id: "miau", funcao: "gato do escritório", tipo: "bicho" },
  { id: "bento", funcao: "pug preto", tipo: "bicho" },
  { id: "nick", funcao: "pug bege", tipo: "bicho" },
];

/** A Ohra tem Gustavo, Juliana, o gato Miau e os pugs Bento e Nick; as outras lojas, Hevair e Natalia (sem bichos). */
export const ehOhra = (nomeLoja) => /ohra/i.test(String(nomeLoja || ""));
export function nomesPadrao(nomeLoja) {
  const base = Object.fromEntries(ELENCO.filter((e) => e.nome).map((e) => [e.id, e.nome]));
  return ehOhra(nomeLoja)
    ? { ...base, ceo1: "Gustavo", ceo2: "Juliana", miau: "Miau", bento: "Bento", nick: "Nick" }
    : { ...base, ceo1: "Hevair", ceo2: "Natalia", miau: "Miau", bento: "Bento", nick: "Nick" };
}
/** Quem NÃO aparece na Sede (botão ao lado do nome; gravado em `sede:personagens._ocultos`). Padrão: sem o gato na Ohra; sem bichos nas outras. */
export function ocultosDaLoja(nomeLoja, salvos) {
  if (Array.isArray(salvos?._ocultos)) return new Set(salvos._ocultos);
  return new Set(ehOhra(nomeLoja) ? ["miau"] : ["miau", "bento", "nick"]);
}
/** Nomes gravados (preferencias_loja `sede:personagens`) por cima do padrão; bicho com nome vazio não aparece. */
export function nomesDaLoja(nomeLoja, salvos) {
  const p = nomesPadrao(nomeLoja);
  const out = { ...p };
  for (const e of ELENCO) {
    const v = salvos?.[e.id];
    if (typeof v !== "string") continue;
    const t = v.trim().slice(0, 18);
    if (t || e.tipo === "bicho") out[e.id] = t;
  }
  return out;
}

// De que sala é cada aviso (pela aba de destino) e de quem é.
const SALA_DA_ABA = {
  live: "live",
  caixa: "financeiro", metas: "financeiro", ranking: "financeiro", resumoMes: "financeiro",
  farm: "producao", registroImpressoes: "producao", otimizacao: "producao", producao: "producao", insumos: "producao",
  importar: "estoque",
};
export function salaDoAviso(p) {
  const k = chaveDoDestino(p.ir);
  if (!k) return "comercial";
  if (k === "analise:xyz") return "estoque";
  return SALA_DA_ABA[k.split(":")[0]] || "comercial";
}
export function pessoaDoAviso(p) {
  const k = chaveDoDestino(p.ir) || "";
  const sala = salaDoAviso(p);
  if (sala === "financeiro") return "bia";
  if (sala === "producao") return "teo";
  if (sala === "estoque") return k.startsWith("importar") ? "ze" : "duda";
  if (sala === "live") return "ceo2";
  if (k.startsWith("crescimento:ads") || k.startsWith("crescimento:afiliados")) return "leo";
  if (k.startsWith("crescimento") || k === "canal:publicar" || k.startsWith("anuncio")) return "nina";
  if (k.startsWith("analise") || k === "diagnostico" || k === "carrinhos" || k === "compararPeriodos") return "celia";
  return "rafa";
}
const PESO = { resolver: 3, rotina: 2, oportunidade: 1 };
const LUZ = { resolver: "r", rotina: "a", oportunidade: "o" };
const pior = (lista) => lista.reduce((m, p) => ((PESO[p.grupo] || 2) > (PESO[m?.grupo] || 0) ? p : m), null);

/** Avisos do Início → { porSala: {k: [avisos]}, luz: {k: r|a|o|n}, porPessoa: {id: r|a|o} }. A Diretoria recebe os urgentes de todas. */
export function avisosDaSede(pendencias) {
  const porSala = Object.fromEntries(SALAS_SEDE.map((s) => [s.k, []]));
  const porPessoaL = {};
  for (const p of pendencias || []) {
    if (p.tarefa) continue;
    const s = salaDoAviso(p);
    porSala[s].push(p);
    if (p.grupo === "resolver") porSala.diretoria.push(p);
    (porPessoaL[pessoaDoAviso(p)] ||= []).push(p);
  }
  const ordenar = (l) => l.sort((a, b) => (PESO[b.grupo] || 2) - (PESO[a.grupo] || 2));
  Object.values(porSala).forEach(ordenar);
  const luz = {};
  for (const s of SALAS_SEDE) {
    const w = pior(porSala[s.k]);
    luz[s.k] = w ? LUZ[w.grupo] || "a" : s.k === "revenda" ? "n" : "o";
  }
  const porPessoa = {};
  for (const [id, l] of Object.entries(porPessoaL)) porPessoa[id] = LUZ[pior(l).grupo] || "a";
  return { porSala, luz, porPessoa };
}

// Salas abertas pelo que a loja TEM (24/10/2026, decisão do Gustavo: 100%
// automático, sem botão — sala aberta = tem trabalho lá; o que a loja não usa
// fica fechada com o motivo escrito). Só o NOME da sala é editável (✎ Nomes).
export function salasDaLoja({ impressoras = [], produtos = [], canais = [], lives = [], temRevenda = false }) {
  const fechadas = {};
  const temImpressao = (impressoras || []).some((i) => i.ativa !== false) || (produtos || []).some((p) => p.producao_detalhe && !p.producao_detalhe.sem3d);
  if (!temImpressao) fechadas.producao = "abre quando você cadastrar a primeira impressora (Produção → Minha farm) ou um produto com custo de impressão";
  const temCanalLive = (canais || []).some((c) => c.tipo === "tiktok" || c.tipo === "shopee");
  if (!temCanalLive || !(lives || []).length) fechadas.live = temCanalLive ? "abre quando você criar a primeira live (menu Live)" : "abre quando a loja tiver TikTok ou Shopee e criar a primeira live";
  if (!temRevenda) fechadas.revenda = "abre quando você cadastrar o primeiro produto de revenda (comprado pronto pra vender)";
  return fechadas;
}
/** Nomes das salas: o gravado em `sede:personagens._salas` por cima do padrão. */
export function nomesDasSalas(salvos) {
  const out = {};
  for (const s of SALAS_SEDE) {
    const v = salvos?._salas?.[s.k];
    out[s.k] = typeof v === "string" && v.trim() ? v.trim().slice(0, 22) : s.nome;
  }
  return out;
}
