// Nota por setor da Sede (etapa D, 28/10/2026 — combinado com o Gustavo pela prévia):
// uma nota de 0 a 10 por semana pra Financeiro, Comercial e Operação, sempre com as
// partes que a formam ("sem falso 100%": contas em dia, mas 90% saiu do seu bolso ≠ 10).
// PURO. Quem grava o histórico (tabela sede_notas, schema v68): sedeNotasAcoes.js.
import { adsNoPeriodo, despesasFixasDoMes, somaPedidos } from "./resumoLoja.js";

const num = (v) => Number(v) || 0;
const r1 = (v) => Math.round(v * 10) / 10;
const lim = (v) => Math.max(0, Math.min(10, v));
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const pct = (v) => `${Math.round(v * 100)}%`;
const brl = (v) => `R$ ${num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Segunda-feira da semana de `hoje` (chave da semana em sede_notas). */
export function semanaDe(hoje) {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay() || 7;
  return somarDias(hoje, -(dow - 1));
}

export const SETORES_NOTA = [
  { k: "financeiro", nome: "Financeiro", gerente: "bia" },
  { k: "comercial", nome: "Comercial", gerente: "celia" },
  { k: "operacao", nome: "Operação", gerente: "teo" },
];
/** Pesos do Financeiro (definidos com o Gustavo): contas em dia 30 · a loja se paga 30 · caixa saudável 25 · dados em dia 15. */
export const PESOS_FINANCEIRO = { contas: 0.3, sePaga: 0.3, caixa: 0.25, dados: 0.15 };
export const DIAS_CAIXA_IDEAL = 90; // o caixa paga as contas fixas por 3 meses sem vender = 10

/** Média ponderada só das partes que têm dado (parte sem dado sai e os pesos se redistribuem). */
export function juntarPartes(partes) {
  const com = partes.filter((p) => p.nota != null);
  const peso = com.reduce((s, p) => s + p.peso, 0);
  if (!peso) return null;
  return r1(com.reduce((s, p) => s + p.nota * p.peso, 0) / peso);
}
const notaDosAvisos = (avisos) => {
  const l = avisos || [];
  const res = l.filter((p) => p.grupo === "resolver").length, aten = l.filter((p) => p.grupo === "rotina").length;
  return { nota: r1(lim(10 - 3 * res - 0.7 * aten)), texto: res || aten ? `${res ? `${res} pra resolver` : ""}${res && aten ? " · " : ""}${aten ? `${aten} de atenção` : ""}` : "sem pendência" };
};

function financeiro({ hoje, lancamentos, saldoCaixa, bom }) {
  const lanc = (lancamentos || []).filter((l) => l.recorrencia !== "mensal");
  const atrasadas = lanc.filter((l) => l.tipo === "saida" && !l.data_realizada && String(l.data_prevista).slice(0, 10) < hoje).length;
  const de30 = somarDias(hoje, -29);
  const pagas = lanc.filter((l) => l.tipo === "saida" && l.data_realizada && String(l.data_realizada).slice(0, 10) >= de30 && String(l.data_realizada).slice(0, 10) <= hoje && !["transferencia", "retirada"].includes(l.categoria));
  const total = pagas.reduce((s, l) => s + num(l.valor), 0);
  const daLoja = pagas.filter((l) => l.pago_com !== "bolso").reduce((s, l) => s + num(l.valor), 0);
  const fixas = despesasFixasDoMes(lancamentos || [], hoje.slice(0, 7)).total;
  let caixa = null, txtCaixa = "sem o saldo do caixa";
  if (saldoCaixa != null) {
    if (saldoCaixa <= 0) { caixa = 0; txtCaixa = `caixa em ${brl(saldoCaixa)}`; }
    else if (fixas <= 0) txtCaixa = "cadastre as contas fixas no Caixa pra medir quantos dias o caixa aguenta";
    else {
      const dias = saldoCaixa / (fixas / 30);
      caixa = r1(lim((dias / DIAS_CAIXA_IDEAL) * 10));
      txtCaixa = `~${Math.round(dias)} dias de contas fixas no caixa (ideal ${DIAS_CAIXA_IDEAL})`;
    }
  }
  const falta = bom ? (bom.faltando || []).length : null;
  return [
    { k: "contas", nome: "Contas em dia", peso: PESOS_FINANCEIRO.contas, nota: r1(lim(10 - 4 * atrasadas)), texto: atrasadas ? `${atrasadas} conta${atrasadas === 1 ? "" : "s"} atrasada${atrasadas === 1 ? "" : "s"}` : "nenhuma atrasada" },
    { k: "sePaga", nome: "A loja se paga", peso: PESOS_FINANCEIRO.sePaga, nota: total > 0 ? r1(lim((daLoja / total) * 10)) : null, texto: total > 0 ? `${pct(daLoja / total)} das contas de 30 dias pagas com o caixa da loja (${pct(1 - daLoja / total)} do seu bolso)` : "nenhuma conta paga em 30 dias" },
    { k: "caixa", nome: "Caixa saudável", peso: PESOS_FINANCEIRO.caixa, nota: caixa, texto: txtCaixa },
    { k: "dados", nome: "Dados em dia", peso: PESOS_FINANCEIRO.dados, nota: falta == null ? null : r1(lim(10 - 5 * falta)), texto: falta == null ? "sem o Bom dia" : falta ? `falta subir: ${bom.faltando.map((f) => f.texto).join(" · ")}` : "arquivos de ontem enviados" },
  ];
}
function comercial({ hoje, porSala, pedidos, linhasAds }) {
  const av = notaDosAvisos(porSala?.comercial);
  const a = somaPedidos(pedidos, somarDias(hoje, -6), hoje), b = somaPedidos(pedidos, somarDias(hoje, -13), somarDias(hoje, -7));
  const de30 = somarDias(hoje, -29);
  const m = somaPedidos(pedidos, de30, hoje);
  const ads = adsNoPeriodo(linhasAds, de30, hoje);
  const margem = m.vendas > 0 ? (m.lucro - ads) / m.vendas : null;
  return [
    { k: "avisos", nome: "Anúncios e preços sem pendência", peso: 0.4, nota: av.nota, texto: av.texto },
    { k: "vendas", nome: "Vendas da semana × a anterior", peso: 0.3, nota: b.vendas > 0 ? r1(lim((a.vendas / b.vendas) * 10)) : a.vendas > 0 ? 10 : null, texto: b.vendas > 0 ? `${brl(a.vendas)} × ${brl(b.vendas)} (${a.vendas >= b.vendas ? "+" : ""}${pct(a.vendas / b.vendas - 1)})` : "sem vendas na semana anterior" },
    { k: "lucro", nome: "Lucro depois do Ads", peso: 0.3, nota: margem == null ? null : r1(lim((margem / 0.25) * 10)), texto: margem == null ? "sem vendas em 30 dias" : `${pct(margem)} das vendas de 30 dias sobram depois do Ads (ideal 25%)` },
  ];
}
function operacao({ porSala, cheias, estoqueRepor }) {
  const av = notaDosAvisos(porSala?.operacao);
  const n = Array.isArray(estoqueRepor) ? estoqueRepor.length : null;
  return [
    { k: "avisos", nome: "Produção, manutenção e expedição", peso: 0.5, nota: av.nota, texto: av.texto },
    { k: "capacidade", nome: "Capacidade folgada", peso: 0.25, nota: cheias?.operacao ? 5 : 10, texto: cheias?.operacao ? "setor lotado pelas vendas de 14 dias" : "com folga" },
    { k: "estoque", nome: "Estoque da revenda", peso: 0.25, nota: n == null ? null : r1(lim(10 - 2 * n)), texto: n == null ? "sem revenda" : n ? `${n} produto${n === 1 ? "" : "s"} pra repor` : "estoque em dia" },
  ];
}

/** Notas desta semana (ao vivo): { semana, setores: { k: { nota, partes } } }. */
export function notasDaSemana(ctx) {
  const montar = { financeiro, comercial, operacao };
  const setores = {};
  for (const s of SETORES_NOTA) {
    const partes = montar[s.k](ctx);
    setores[s.k] = { nota: juntarPartes(partes), partes };
  }
  return { semana: semanaDe(ctx.hoje), setores };
}

/** Nota da semana passada (histórico gravado) e a seta: ↑ ↓ → (±0,3). */
export function comparaSemana(historico, setor, semana, notaAgora) {
  const ant = (historico || []).filter((h) => h.setor === setor && h.semana < semana).sort((a, b) => (a.semana < b.semana ? 1 : -1))[0];
  if (!ant || notaAgora == null) return { anterior: ant ? num(ant.nota) : null, seta: null };
  const d = notaAgora - num(ant.nota);
  return { anterior: num(ant.nota), seta: d >= 0.3 ? "↑" : d <= -0.3 ? "↓" : "→", dif: r1(d) };
}
export const notaTexto = (n) => (n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
