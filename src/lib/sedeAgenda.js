// Agenda viva da Sede (etapa B, 28/10/2026 — combinada com o Gustavo pela prévia):
// o dia do escritório segue o relógio de São Paulo e o conteúdo vem dos dados reais.
// PURO e SÓ MOSTRA: nada aqui grava dado. O motor (sedeMotor.js) chama
// `momentoDaAgenda` a cada 30 s e move as pessoas; a TV da Reunião mostra
// `textoDaTV`; o painel "ver ata" usa `ataDoBomDia`.

const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const brl = (v) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Agora em São Paulo: { data 'YYYY-MM-DD', h, m, dow (0 = domingo), minutos }. */
export function agoraSP(d = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const h = Number(partes.hour) % 24, m = Number(partes.minute);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday);
  return { data: `${partes.year}-${partes.month}-${partes.day}`, h, m, dow, minutos: h * 60 + m };
}
/** Relógio da Sede: o de São Paulo; `window.__sedeHora = "2026-10-28 09:05"` força a hora (só pra conferir a agenda). */
export function agoraDaSede() {
  const t = typeof window !== "undefined" && window.__sedeHora;
  if (t) {
    const [d, hm] = String(t).split(" ");
    const [h, m] = hm.split(":").map(Number);
    return { data: d, h, m, dow: new Date(`${d}T12:00:00Z`).getUTCDay(), minutos: h * 60 + m };
  }
  return agoraSP();
}
const ultimoDiaDoMes = (data) => {
  const [a, mm] = data.split("-").map(Number);
  return new Date(Date.UTC(a, mm, 0)).getUTCDate();
};

// Almoço em 2 turnos: sempre fica alguém em cada setor.
export const TURNOS_ALMOCO = {
  a: ["ceo1", "consultor", "lia", "rafa", "leo", "ivo", "rui"],
  b: ["ceo2", "bia", "kai", "celia", "nina", "teo", "duda", "ze"],
};
// Quem vai em cada reunião (as cadeiras da Reunião: 4 de um lado, 4 do outro).
export const QUEM_NA_REUNIAO = {
  bomdia: ["consultor", "bia", "celia", "teo"],
  semana: ["consultor", "ceo1", "ceo2", "bia", "celia", "teo"],
  fechamento: ["consultor", "ceo1", "ceo2", "bia"],
  treinamento: ["consultor", "rafa", "nina", "leo", "lia", "kai"],
};

/**
 * O que está acontecendo agora pela agenda fixa (horário de São Paulo):
 * 9h–9h20 Bom dia · dia 1 10h–10h30 fechamento do mês (Bia) · segunda 10h–10h30 reunião da semana ·
 * café 10h30 e 15h30 (15 min) · almoço 12h–13h em 2 turnos · 14h–14h20 treinamento (só com novidade
 * do consultor dos últimos 7 dias) · 16h–16h20 coleta · último dia do mês 17h–18h festa do fechamento.
 * Devolve { k, titulo, sala?, quem?, turno? } ou null. Fim de semana: só a festa (se cair) — loja descansando.
 */
export function momentoDaAgenda(agora, { novidade = null } = {}) {
  const { data, dow, minutos } = agora;
  const entre = (de, ate) => minutos >= min(de) && minutos < min(ate);
  const dia = Number(data.slice(8, 10));
  const ultimo = dia === ultimoDiaDoMes(data);
  if (ultimo && entre("17:00", "18:00")) return { k: "festa", titulo: "Festa do fechamento do mês" };
  if (dow === 0 || dow === 6) return null;
  if (entre("09:00", "09:20")) return { k: "bomdia", titulo: "Reunião do Bom dia", sala: "reuniao", quem: QUEM_NA_REUNIAO.bomdia };
  if (dia === 1 && entre("10:00", "10:30")) return { k: "fechamento", titulo: "Fechamento do mês", sala: "reuniao", quem: QUEM_NA_REUNIAO.fechamento };
  if (dow === 1 && entre("10:00", "10:30")) return { k: "semana", titulo: "Reunião da semana", sala: "reuniao", quem: QUEM_NA_REUNIAO.semana };
  if (entre("10:30", "10:45") || entre("15:30", "15:45")) return { k: "cafe", titulo: "Café" };
  if (entre("12:00", "12:30")) return { k: "almoco", titulo: "Almoço (1º turno)", turno: "a", quem: TURNOS_ALMOCO.a };
  if (entre("12:30", "13:00")) return { k: "almoco", titulo: "Almoço (2º turno)", turno: "b", quem: TURNOS_ALMOCO.b };
  if (novidade && entre("14:00", "14:20")) return { k: "treinamento", titulo: "Treinamento", sala: "reuniao", quem: QUEM_NA_REUNIAO.treinamento };
  if (entre("16:00", "16:20")) return { k: "coleta", titulo: "Coleta dos pedidos" };
  return null;
}

/** Novidade do consultor dos últimos 7 dias (vira treinamento às 14h), ou null. */
export function novidadeRecente(novidades, hoje) {
  const n = (novidades || []).filter((x) => x?.data && x.data <= hoje).sort((a, b) => (a.data < b.data ? 1 : -1))[0];
  if (!n) return null;
  const dias = Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${n.data}T12:00:00`)) / 86400000);
  return dias <= 7 ? n : null;
}

/** Caixas no pallet: 1 caixa a cada 5 pedidos (no máx. 8 na pilha). */
export const PEDIDOS_POR_CAIXA = 5;
export const caixasDoDia = (nPedidos) => Math.max(0, Math.min(8, Math.ceil((Number(nPedidos) || 0) / PEDIDOS_POR_CAIXA)));

/** Zé entrega o arquivo importado SÓ pra quem usa ele. relatorio = importacoes.relatorio. */
export function destinosDoArquivo(relatorio) {
  const r = String(relatorio || "");
  if (r.startsWith("pedidos")) return ["celia", "bia", "duda"];
  if (r === "shopee:ads" || r === "shopee:gmv") return ["leo"];
  if (r === "shopee:desempenho") return ["nina"];
  if (r === "shopee:extrato") return ["lia"];
  if (r.includes("nfe") || r.includes("revenda") || r.includes("compra")) return ["rui", "bia"];
  return ["celia"];
}
export function nomeDoArquivo(relatorio) {
  const r = String(relatorio || "");
  if (r.startsWith("pedidos")) return "pedidos";
  return { "shopee:ads": "Ads da Shopee", "shopee:gmv": "GMV Max da Loja", "shopee:desempenho": "Desempenho da Shopee", "shopee:extrato": "extrato da Shopee" }[r] || "arquivo";
}

/** Linhas do "ontem" (Bom dia) — nunca zero quando falta arquivo: "aguardando arquivo". */
function linhasDoOntem(bom) {
  if (!bom) return ["aguardando os números do Início"];
  const out = [];
  if (bom.pedidos) {
    const p = bom.pedidos;
    const vs = p.mediaVendas > 0 ? ` (média ${brl(p.mediaVendas)})` : "";
    out.push(`Ontem (${dm(bom.ontem)}): ${brl(p.vendas)} em ${p.n} pedido${p.n === 1 ? "" : "s"}${vs}`);
    out.push(`Lucro de ontem: ${brl(p.lucro)}`);
  } else out.push(`Vendas de ontem (${dm(bom.ontem)}): aguardando arquivo`);
  if (bom.ads) out.push(`Ads de ontem: ${brl(bom.ads.gasto)} de ${brl(bom.ads.orcamento)}/dia`);
  if (bom.contas?.atrasadas) out.push(`${bom.contas.atrasadas} conta${bom.contas.atrasadas === 1 ? "" : "s"} atrasada${bom.contas.atrasadas === 1 ? "" : "s"}`);
  else if (bom.contas?.hoje) out.push(`${bom.contas.hoje} conta${bom.contas.hoje === 1 ? "" : "s"} vencendo hoje`);
  if ((bom.faltando || []).length) out.push(`Falta subir: ${bom.faltando.map((f) => f.texto).join(" · ")}`);
  return out;
}

/** A ata da reunião do Bom dia (montada na hora, a partir dos mesmos números). */
export function ataDoBomDia({ bom, top3 = [], data }) {
  return {
    titulo: `Reunião do Bom dia — ${dm(data)} às 9h`,
    presentes: QUEM_NA_REUNIAO.bomdia,
    ontem: linhasDoOntem(bom),
    prioridades: (top3 || []).slice(0, 3),
  };
}

/**
 * O que a TV da Reunião mostra agora: { titulo, linhas[], ata (botão "ver ata") }.
 * Na reunião = os números; fora dela = "Reunião do Bom dia às 9h" (antes) ou "Reunião de hoje às 9h ✓".
 */
export function textoDaTV({ momento, agora, bom, top3 = [], novidade = null, recorde = null }) {
  const k = momento?.k;
  if (k === "bomdia") return { titulo: "BOM DIA ☀️", linhas: [...linhasDoOntem(bom).slice(0, 2), ...top3.slice(0, 3).map((t, i) => `${i + 1}. ${t}`)], ata: false };
  if (k === "treinamento" && novidade) return { titulo: "TREINAMENTO 📚", linhas: [`O consultor aprendeu (${dm(novidade.data)}):`, String(novidade.texto).slice(0, 110) + (String(novidade.texto).length > 110 ? "…" : "")], ata: false };
  if (k === "fechamento") return { titulo: "FECHAMENTO DO MÊS 📊", linhas: [recorde?.valor ? `Recorde: ${recorde.valor} (${recorde.mes})` : "Primeiro mês fechado", "Bia apresenta o mês que fechou"], ata: false };
  if (k === "semana") return { titulo: "REUNIÃO DA SEMANA 📅", linhas: [...top3.slice(0, 3).map((t, i) => `${i + 1}. ${t}`)], ata: false };
  if (k === "festa") return { titulo: "FECHAMOS O MÊS! 🎉", linhas: [recorde?.pct ? `Este mês: ${recorde.pct} do recorde` : "Obrigado, equipe!"], ata: false };
  const fimDeSemana = agora && (agora.dow === 0 || agora.dow === 6);
  if (fimDeSemana) return { titulo: "Bom fim de semana", linhas: ["Reunião do Bom dia na segunda às 9h"], ata: false };
  if (agora && agora.minutos < min("09:00")) return { titulo: "Reunião do Bom dia às 9h", linhas: [], ata: false };
  return { titulo: "Reunião de hoje às 9h ✓", linhas: [], ata: true };
}

/** A festa do fim do mês é com confete e bolo quando bateu a meta ou passou o recorde. */
export const festaComBolo = ({ metaPct, recordePct }) => (Number(metaPct) || 0) >= 1 || (Number(recordePct) || 0) >= 1;

/** A agenda de hoje (pro painel da Reunião): [{ hora, titulo, estado: feito|agora|depois }]. */
export function agendaDoDia(agora, { novidade = null } = {}) {
  const { data, dow, minutos } = agora;
  const dia = Number(data.slice(8, 10));
  const l = [];
  if (dow !== 0 && dow !== 6) {
    l.push(["09:00", "09:20", "Reunião do Bom dia (gerentes + Gerente Geral)"]);
    if (dia === 1) l.push(["10:00", "10:30", "Fechamento do mês (Bia)"]);
    else if (dow === 1) l.push(["10:00", "10:30", "Reunião da semana (com os CEOs)"]);
    l.push(["10:30", "10:45", "Café"]);
    l.push(["12:00", "13:00", "Almoço em 2 turnos"]);
    if (novidade) l.push(["14:00", "14:20", "Treinamento: o que o consultor aprendeu"]);
    l.push(["15:30", "15:45", "Café"]);
    l.push(["16:00", "16:20", "Coleta dos pedidos (carteiro)"]);
  }
  if (dia === ultimoDiaDoMes(data)) l.push(["17:00", "18:00", "Festa do fechamento do mês"]);
  return l.map(([de, ate, titulo]) => ({ hora: de.replace(/^0/, "").replace(":00", "h").replace(":", "h"), titulo, estado: minutos >= min(ate) ? "feito" : minutos >= min(de) ? "agora" : "depois" }));
}
