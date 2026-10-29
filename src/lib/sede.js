// Sede da <loja> (24/10/2026): o que é PURO da Sede — salas, elenco, nomes por
// loja e de que sala é cada aviso do Início. Desenho e movimento: sedeMotor.js.
import { chaveDoDestino } from "./marcas.js";

// Planta da Sede nova (27/10/2026, vista B em perspectiva — aprovada pela prévia):
// prédio 63 × 33 (unidades do chão isométrico). Fileira de cima: Diretoria · Gerente
// Geral · Reunião · Live · Financeiro; corredor (y 12–17); embaixo: Comercial ·
// Operação (produção, estoque, expedição e revenda) · Recepção (copa, coleta, Zé).
// `porta` = x da porta na parede do fundo (salas de baixo); a Diretoria tem mureta com porta na frente.
export const SALAS_SEDE = [
  { k: "diretoria", nome: "Diretoria", x: 1, y: 1, w: 13, h: 11, aba: "inicio", rotulo: "Abrir o Início" },
  { k: "gg", nome: "Gerente Geral", curto: "Ger. Geral", x: 15, y: 1, w: 8, h: 11, aba: null, rotulo: "Falar com o Gerente Geral" },
  { k: "reuniao", nome: "Sala de reunião", curto: "Reunião", x: 24, y: 1, w: 12, h: 11, aba: null, rotulo: null },
  { k: "live", nome: "Estúdio de Live", curto: "Live", x: 37, y: 1, w: 10, h: 11, aba: "live", rotulo: "Abrir Live" },
  { k: "financeiro", nome: "Financeiro", x: 48, y: 1, w: 14, h: 11, aba: "caixa", rotulo: "Abrir Dinheiro" },
  { k: "comercial", nome: "Comercial", x: 1, y: 17, w: 22, h: 15, porta: 19.6, aba: "anuncios", rotulo: "Abrir Anúncios" },
  { k: "operacao", nome: "Operação", x: 24, y: 17, w: 26, h: 15, porta: 33.6, aba: "farm", rotulo: "Abrir Minha farm" },
  { k: "recepcao", nome: "Recepção", x: 51, y: 17, w: 11, h: 15, porta: 52.3, aba: "importar", rotulo: "Atualizar dados" },
];
// salas da planta antiga (até 26/10/2026) → sala nova (nomes gravados, consultor)
export const SALA_ANTIGA = { producao: "operacao", estoque: "operacao", revenda: "operacao" };
export const salaNova = (k) => SALA_ANTIGA[k] || k;

// Elenco: papel fixo (rotina, mesa, roupa), nome configurável por loja.
// Os donos (ceo1/ceo2) e os bichos mudam de cara conforme a loja (estilo "ohra" ou "outra").
export const ELENCO = [
  { id: "ceo1", funcao: "CEO", tipo: "dono", sala: "diretoria" },
  { id: "ceo2", funcao: "CEO", tipo: "dono", sala: "diretoria" },
  { id: "consultor", funcao: "Gerente Geral (consultor)", nome: "Consultor", sala: "gg" },
  { id: "bia", funcao: "Gerente financeira", nome: "Bia", sala: "financeiro" },
  { id: "lia", funcao: "Analista Shopee", nome: "Lia", sala: "financeiro" },
  { id: "kai", funcao: "Analista TikTok", nome: "Kai", sala: "financeiro" },
  { id: "celia", funcao: "Gerente comercial", nome: "Célia", sala: "comercial" },
  { id: "rafa", funcao: "Preços", nome: "Rafa", sala: "comercial" },
  { id: "nina", funcao: "Anúncios e Rampa", nome: "Nina", sala: "comercial" },
  { id: "leo", funcao: "Ads e Afiliados", nome: "Leo", sala: "comercial" },
  { id: "teo", funcao: "Gerente de operação", nome: "Téo", sala: "operacao" },
  { id: "ivo", funcao: "Técnico de impressão", nome: "Ivo", sala: "operacao" },
  { id: "duda", funcao: "Expedição e estoque", nome: "Duda", sala: "operacao" },
  { id: "rui", funcao: "Analista de revenda", nome: "Rui", sala: "operacao" },
  { id: "ze", funcao: "Estagiário · recepção", nome: "Zé", sala: "recepcao" },
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
  farm: "operacao", registroImpressoes: "operacao", otimizacao: "operacao", producao: "operacao", insumos: "operacao", estoque: "operacao",
  importar: "recepcao",
};
export function salaDoAviso(p) {
  const k = chaveDoDestino(p.ir);
  if (!k) return "comercial";
  if (k === "analise:xyz") return "operacao";
  return SALA_DA_ABA[k.split(":")[0]] || "comercial";
}
export function pessoaDoAviso(p) {
  const k = chaveDoDestino(p.ir) || "";
  const id = String(p.id || "");
  const sala = salaDoAviso(p);
  if (sala === "financeiro") return id.includes("tiktok") ? "kai" : id.includes("shopee") || id.startsWith("ads|recarregar") ? "lia" : "bia";
  if (sala === "operacao") {
    if (k.startsWith("estoque")) return "duda";
    if (k.startsWith("registroImpressoes") || id.startsWith("farm-manut") || id.startsWith("manut")) return "ivo";
    if (k === "analise:xyz") return "duda";
    return "teo";
  }
  if (sala === "recepcao") return "ze";
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
    luz[s.k] = w ? LUZ[w.grupo] || "a" : "o";
  }
  const porPessoa = {};
  for (const [id, l] of Object.entries(porPessoaL)) porPessoa[id] = LUZ[pior(l).grupo] || "a";
  return { porSala, luz, porPessoa };
}

// O que a loja TEM (24/10/2026, decisão do Gustavo: 100% automático, sem botão).
// Sala inteira fechada só a Live (sem live criada). Dentro da Operação, as
// impressoras e o canto da Revenda acendem quando existem (Ivo e Rui junto).
export function salasDaLoja({ canais = [], lives = [] }) {
  const fechadas = {};
  const temCanalLive = (canais || []).some((c) => c.tipo === "tiktok" || c.tipo === "shopee");
  if (!temCanalLive || !(lives || []).length) fechadas.live = temCanalLive ? "abre quando você criar a primeira live (menu Live)" : "abre quando a loja tiver TikTok ou Shopee e criar a primeira live";
  return fechadas;
}
/** Partes da Operação que dependem do que a loja tem: impressoras (Ivo) e revenda (Rui). */
export function partesDaLoja({ impressoras = [], produtos = [], fornecedores = [], compras = [] }) {
  const ativas = (impressoras || []).filter((i) => i.ativa !== false).length;
  const temImpressao = ativas > 0 || (produtos || []).some((p) => p.producao_detalhe && !p.producao_detalhe.sem3d);
  const temRevenda = (produtos || []).some((p) => p.origem === "revenda") || (fornecedores || []).length > 0 || (compras || []).length > 0;
  return { impressoras: temImpressao ? Math.max(1, Math.min(3, ativas || 1)) : 0, revenda: temRevenda };
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
