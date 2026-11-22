// Meta de ticket médio do mês (22/11/2026, pedido do Gustavo: "na hora que eu atingir
// os R$ 30 ele fica ultrapassado"). Conta ÚNICA, PURA.
// Base = ticket médio do mês que FECHOU (com < 20 pedidos, os 30 dias antes do dia 1º);
// degraus +10% (meta do mês) · +20% (bom) · +35% (ótimo), pra cima de R$ 5 em 5.
// Fica parada o mês inteiro: a partir do dia 7 (quando os pedidos do mês anterior
// já foram importados) a tela grava o retrato em preferencias_loja `analise:meta-ticket`
// = { "<canalId|todas>": { "AAAA-MM": { base, origem, n, degraus: [v1, v2, v3] } } }.
// Bateu ou não, a base do mês seguinte é o ticket real do mês — a escada anda junto.
import { pedidosAgrupados } from "./resumoLoja.js";

export const DEGRAUS_TICKET = [
  { k: "meta", rot: "Meta do mês", pct: 0.1 },
  { k: "bom", rot: "Bom", pct: 0.2 },
  { k: "otimo", rot: "Ótimo", pct: 0.35 },
];
export const MIN_PEDIDOS_BASE = 20;
export const DIA_CONGELA = 7;

const r2 = (v) => Math.round(v * 100) / 100;
const teto5 = (v) => Math.ceil(v / 5 - 1e-9) * 5;
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
export const mesAntes = (mes) => {
  let [a, m] = mes.split("-").map(Number);
  m -= 1;
  if (m < 1) {
    m = 12;
    a -= 1;
  }
  return `${a}-${String(m).padStart(2, "0")}`;
};
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Ticket médio de uma lista de pedidos (pedidosAgrupados). */
export function ticketDe(peds = []) {
  const n = peds.length;
  const total = peds.reduce((t, p) => t + (Number(p.total) || 0), 0);
  return { n, total: r2(total), ticket: n ? r2(total / n) : null };
}

/** Os 3 degraus em cima da base: de R$ 5 em 5, sempre acima da base e subindo. */
export function degrausDoTicket(base) {
  if (!(base > 0)) return [];
  let ant = base;
  return DEGRAUS_TICKET.map((d) => {
    let v = teto5(base * (1 + d.pct));
    while (v <= ant + 0.001) v += 5;
    ant = v;
    return { ...d, valor: v };
  });
}

/** Compras mínimas de cupom que puxam pros degraus: 34,90 · 39,90 · 44,90 (+ o próximo). */
export function minimosDoTicket(degraus = []) {
  if (!degraus.length) return [];
  const vs = degraus.map((d) => r2(d.valor - 0.1));
  vs.push(r2(degraus[degraus.length - 1].valor + 5 - 0.1));
  return [...new Set(vs)];
}

/** Base do mês: o ticket do mês anterior inteiro (≥ 20 pedidos) ou os 30 dias antes do dia 1º. */
export function baseDoMes(linhas, mes, canalId = null) {
  const ant = mesAntes(mes);
  const pm = ticketDe(pedidosAgrupados(linhas, `${ant}-01`, fimDoMes(ant), canalId));
  if (pm.n >= MIN_PEDIDOS_BASE) return { base: pm.ticket, origem: "mes", n: pm.n, mesBase: ant };
  const ate = somarDias(`${mes}-01`, -1);
  const p30 = ticketDe(pedidosAgrupados(linhas, somarDias(ate, -29), ate, canalId));
  if (p30.n) return { base: p30.ticket, origem: "30dias", n: p30.n, mesBase: ant };
  return null;
}

/**
 * Meta do mês + andamento. guardados = o objeto da preferência pra esse canal ({ "AAAA-MM": retrato }).
 * → { mes, base, origem, n, degraus, guardado, congelar (retrato pra gravar ou null), atual: { ticket, n, falta, pct, degrau } } | null
 */
export function metaTicketDoMes({ linhas = [], mes, hoje, canalId = null, guardados = {} }) {
  const g = guardados?.[mes];
  const b = g?.base > 0 ? { base: g.base, origem: g.origem, n: g.n } : baseDoMes(linhas, mes, canalId);
  if (!b) return null;
  const degraus = g?.degraus?.length === DEGRAUS_TICKET.length ? DEGRAUS_TICKET.map((d, i) => ({ ...d, valor: g.degraus[i] })) : degrausDoTicket(b.base);
  const dia = Number(String(hoje).slice(8, 10));
  const congelar = !g && hoje.slice(0, 7) === mes && dia >= DIA_CONGELA ? { base: b.base, origem: b.origem, n: b.n, degraus: degraus.map((d) => d.valor) } : null;
  const at = ticketDe(pedidosAgrupados(linhas, `${mes}-01`, hoje < fimDoMes(mes) ? hoje : fimDoMes(mes), canalId));
  const meta = degraus[0]?.valor || null;
  const alcancado = at.ticket != null ? [...degraus].reverse().find((d) => at.ticket >= d.valor) || null : null;
  const atual = { ticket: at.ticket, n: at.n, falta: at.ticket != null && meta ? r2(Math.max(0, meta - at.ticket)) : null, pct: at.ticket != null && meta ? Math.min(1, at.ticket / meta) : 0, degrau: alcancado };
  return { mes, ...b, degraus, guardado: !!g, congelar, atual };
}

/** Meses fechados com retrato guardado: base, meta e o ticket real do mês. Mais novo primeiro. */
export function historicoTicket({ linhas = [], guardados = {}, hoje, canalId = null }) {
  const atual = String(hoje).slice(0, 7);
  return Object.keys(guardados || {})
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && m < atual)
    .sort((a, b) => b.localeCompare(a))
    .map((m) => {
      const g = guardados[m];
      const real = ticketDe(pedidosAgrupados(linhas, `${m}-01`, fimDoMes(m), canalId));
      const meta = g.degraus?.[0] || null;
      return { mes: m, base: g.base, meta, resultado: real.ticket, n: real.n, bateu: real.ticket != null && meta != null && real.ticket >= meta };
    });
}
