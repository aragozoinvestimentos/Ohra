// Calendário de vendas da loja (out/2026, sem SQL) — conta ÚNICA.
// Guardado em lojas.config_escada.calendario = {
//   datas:     { chave: false }  → data comemorativa desligada (padrão: ligada)
//   campanhas: { chave: false }  → campanha da plataforma em que NÃO participa (padrão: participa)
//   proprias:  [{ id, nome, mes, dia }] → datas próprias, repetem todo ano
// }
// E o produto diz QUANDO VENDE em produtos_cadastro.escada_config.quandoVende =
//   { tipo: "ano" | "pico" | "epoca", datas: [chave…], limiteDias: { chave: N } }
//   sem quandoVende = "sem classificação" (funciona como o ano todo).
// Campanhas da plataforma NUNCA deixam um produto sazonal — só servem pra
// data-limite (chegar no alvo antes) e pro aviso de preço de campanha.
import { dataSP } from "./datas.js";

const pad = (n) => String(n).padStart(2, "0");
const iso = (a, m, d) => `${a}-${pad(m)}-${pad(d)}`;
const somar = (s, n) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const diasEntreIso = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
export function pascoa(a) {
  const x = a % 19;
  const b = Math.floor(a / 100);
  const c = a % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * x + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((x + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(a, mes, dia);
}
// n-ésimo dia da semana (0 = domingo) do mês.
function nesimo(a, mes, diaSemana, n) {
  const d = new Date(Date.UTC(a, mes - 1, 1, 12));
  const desloc = (diaSemana - d.getUTCDay() + 7) % 7;
  return iso(a, mes, 1 + desloc + (n - 1) * 7);
}
// Última sexta de novembro (Black Friday).
function ultimaSexta(a, mes) {
  const fim = new Date(Date.UTC(a, mes, 0, 12));
  const volta = (fim.getUTCDay() - 5 + 7) % 7;
  return iso(a, mes, fim.getUTCDate() - volta);
}

// Datas comemorativas (ligadas por padrão).
export const DATAS_COMEMORATIVAS = [
  { chave: "consumidor", nome: "Dia do Consumidor", data: (a) => iso(a, 3, 15) },
  { chave: "pascoa", nome: "Páscoa", data: pascoa },
  { chave: "maes", nome: "Dia das Mães", data: (a) => nesimo(a, 5, 0, 2) },
  { chave: "namorados", nome: "Dia dos Namorados", data: (a) => iso(a, 6, 12) },
  { chave: "pais", nome: "Dia dos Pais", data: (a) => nesimo(a, 8, 0, 2) },
  { chave: "criancas", nome: "Dia das Crianças", data: (a) => iso(a, 10, 12) },
  { chave: "halloween", nome: "Halloween", data: (a) => iso(a, 10, 31) },
  { chave: "blackfriday", nome: "Black Friday", data: (a) => ultimaSexta(a, 11) },
  { chave: "natal", nome: "Natal", data: (a) => iso(a, 12, 25) },
];

// Campanhas da plataforma (participa de todas por padrão). "grande" conta pra
// data-limite do produto sazonal (chegar no alvo 7 dias antes).
export const CAMPANHAS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
  chave: `c${m}`,
  nome: `${m}.${m}`,
  grande: m >= 9,
  data: (a) => iso(a, m, m),
}));

// Regras do sazonal (dias).
export const SAZONAL = {
  alvoAntes: 30, // chegar no alvo X dias antes da data…
  campanhaAntes: 7, // …ou 7 dias antes da 1ª campanha grande antes dela
  janelaCampanha: 45, // campanha grande conta se cair nos X dias antes da data
  temporadaAntes: 60, // temporada (e lembrete) começa X dias antes da data
  folgaSubida: 30, // …ou X dias antes da data-limite, se for mais cedo
  lembreteDias: 7, // o lembrete fica X dias no Início
};

export function configCalendario(cfgLoja) {
  const c = cfgLoja?.calendario || {};
  return { datas: c.datas || {}, campanhas: c.campanhas || {}, proprias: Array.isArray(c.proprias) ? c.proprias : [] };
}

// Todas as datas que um produto pode escolher (comemorativas ligadas + próprias).
export function datasEscolhiveis(cal) {
  const c = cal || configCalendario(null);
  return [
    ...DATAS_COMEMORATIVAS.filter((d) => c.datas[d.chave] !== false).map((d) => ({ chave: d.chave, nome: d.nome, data: d.data, tipo: "data" })),
    ...c.proprias.map((p) => ({ chave: `p:${p.id}`, nome: p.nome, tipo: "propria", data: (a) => iso(a, Number(p.mes) || 1, Number(p.dia) || 1) })),
  ];
}
// Nome de uma data (mesmo desligada).
export function nomeDaData(chave, cal) {
  const d = DATAS_COMEMORATIVAS.find((x) => x.chave === chave);
  if (d) return d.nome;
  const p = (cal?.proprias || []).find((x) => `p:${x.id}` === chave);
  return p ? p.nome : chave;
}
function defDaData(chave, cal) {
  const d = DATAS_COMEMORATIVAS.find((x) => x.chave === chave);
  if (d) return d.data;
  const p = (cal?.proprias || []).find((x) => `p:${x.id}` === chave);
  return p ? (a) => iso(a, Number(p.mes) || 1, Number(p.dia) || 1) : null;
}

// Próxima ocorrência (≥ hoje) e a anterior (< hoje).
export function ocorrencias(chave, cal, hoje) {
  const f = defDaData(chave, cal);
  if (!f) return { prox: null, ant: null };
  const a = Number(hoje.slice(0, 4));
  const lista = [f(a - 1), f(a), f(a + 1)];
  return { prox: lista.find((d) => d >= hoje) || null, ant: [...lista].reverse().find((d) => d < hoje) || null };
}

// Campanhas em que a loja participa, com a data de um ano.
export function campanhasAtivas(cal, ano) {
  const c = cal || configCalendario(null);
  return CAMPANHAS.filter((x) => c.campanhas[x.chave] !== false).map((x) => ({ ...x, dia: x.data(ano) }));
}
// Próxima campanha (≥ hoje) em que a loja participa.
export function proximaCampanha(cal, hoje) {
  const a = Number(hoje.slice(0, 4));
  const todas = [...campanhasAtivas(cal, a), ...campanhasAtivas(cal, a + 1)].filter((x) => x.dia >= hoje).sort((x, y) => x.dia.localeCompare(y.dia));
  const p = todas[0];
  return p ? { chave: p.chave, nome: p.nome, data: p.dia, dias: diasEntreIso(hoje, p.dia), grande: p.grande } : null;
}

// Data-limite (estar no alvo): evento − 30 dias, ou 7 dias antes da 1ª campanha
// grande nos 45 dias antes do evento (Natal → 11.11 − 7 = 04/11). O produto pode
// trocar por "N dias antes" (quandoVende.limiteDias[chave]).
export function limiteDoEvento(chave, dataEvento, cal, limiteDias = null) {
  const n = Number(limiteDias);
  if (isFinite(n) && n > 0) return { limite: somar(dataEvento, -Math.round(n)), motivo: `${Math.round(n)} dias antes (seu ajuste)`, proprio: true };
  const a = Number(dataEvento.slice(0, 4));
  const ini = somar(dataEvento, -SAZONAL.janelaCampanha);
  const camp = [...campanhasAtivas(cal, a - 1), ...campanhasAtivas(cal, a)]
    .filter((x) => x.grande && x.dia >= ini && x.dia < dataEvento)
    .sort((x, y) => x.dia.localeCompare(y.dia))[0];
  const porEvento = somar(dataEvento, -SAZONAL.alvoAntes);
  if (camp) {
    const porCamp = somar(camp.dia, -SAZONAL.campanhaAntes);
    if (porCamp < porEvento) return { limite: porCamp, motivo: `${SAZONAL.campanhaAntes} dias antes da ${camp.nome}`, proprio: false };
  }
  return { limite: porEvento, motivo: `${SAZONAL.alvoAntes} dias antes da data`, proprio: false };
}
export function inicioTemporada(dataEvento, limite) {
  const a = somar(dataEvento, -SAZONAL.temporadaAntes);
  const b = somar(limite, -SAZONAL.folgaSubida);
  return a < b ? a : b;
}

export const TIPOS_QUANDO = [
  { chave: "ano", rotulo: "O ano todo" },
  { chave: "pico", rotulo: "O ano todo, com pico em…" },
  { chave: "epoca", rotulo: "Só na época de…" },
];
export function quandoVendeDe(produto) {
  const q = produto?.escada_config?.quandoVende;
  return q && q.tipo ? q : null;
}
export function rotuloQuando(q, cal) {
  if (!q) return "sem classificação";
  if (q.tipo === "ano") return "o ano todo";
  const nomes = (q.datas || []).map((c) => nomeDaData(c, cal)).join(", ") || "—";
  return q.tipo === "pico" ? `ano todo · pico em ${nomes}` : `só em ${nomes}`;
}

// Situação sazonal de um produto hoje (tipo "epoca" ou "pico"):
//  fase "subindo" (temporada, antes da data-limite) · "pico" (entre a
//  data-limite e a data) · "entressafra" (depois da data) · "aguardando" (antes
//  da temporada, sem data anterior). Com várias datas, vale a temporada que já
//  começou mais cedo; senão a entressafra mais recente; senão a próxima data.
export function infoSazonal(q, cal, hoje) {
  if (!q || (q.tipo !== "epoca" && q.tipo !== "pico") || !(q.datas || []).length) return null;
  const evs = q.datas
    .map((chave) => {
      const { prox, ant } = ocorrencias(chave, cal, hoje);
      if (!prox) return null;
      const lim = limiteDoEvento(chave, prox, cal, q.limiteDias?.[chave]);
      const ini = inicioTemporada(prox, lim.limite);
      return { chave, nome: nomeDaData(chave, cal), evento: prox, anterior: ant, limite: lim.limite, motivoLimite: lim.motivo, limiteProprio: lim.proprio, inicioTemporada: ini };
    })
    .filter(Boolean);
  if (!evs.length) return null;
  const naTemporada = evs.filter((e) => hoje >= e.inicioTemporada).sort((a, b) => a.evento.localeCompare(b.evento));
  let e;
  let fase;
  if (naTemporada.length) {
    e = naTemporada[0];
    fase = hoje < e.limite ? "subindo" : "pico";
  } else {
    const comAnt = evs.filter((x) => x.anterior).sort((a, b) => b.anterior.localeCompare(a.anterior));
    if (comAnt.length) {
      e = comAnt[0];
      fase = "entressafra";
    } else {
      e = [...evs].sort((a, b) => a.evento.localeCompare(b.evento))[0];
      fase = "aguardando";
    }
  }
  const proxEv = [...evs].sort((a, b) => a.evento.localeCompare(b.evento))[0];
  const diasAteEvento = diasEntreIso(hoje, proxEv.evento);
  return {
    tipo: q.tipo,
    ...e,
    fase,
    diasAteLimite: diasEntreIso(hoje, e.limite),
    diasAteEvento: diasEntreIso(hoje, e.evento),
    diasDesdeEvento: e.anterior ? diasEntreIso(e.anterior, hoje) : null,
    proximo: proxEv,
    // Lembrete do Início: na 1ª semana dos 60 dias antes da próxima data.
    lembrete: diasAteEvento <= SAZONAL.temporadaAntes && diasAteEvento > SAZONAL.temporadaAntes - SAZONAL.lembreteDias ? proxEv : null,
  };
}

export const hojeCal = () => dataSP(new Date());
