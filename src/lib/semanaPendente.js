// Semana pendente (Início + Crescimento + bolinha do menu) — conta ÚNICA.
// Por produto × canal em rampa e por item com afiliado ativo fora de rampa:
// pendente quando o último registro (ou o início) tem mais de 7 dias. Um
// registro na data D cobre até a véspera (D − 1), então o período sem
// registro começa em D. "Não registrar esta semana" / "Lembrar amanhã"
// ficam na tabela `lembretes` (schema v40) — iguais em todos os aparelhos;
// nada mais é gravado e o período continua em aberto.
import { comissaoDoItem, idPrefixado } from "./afiliados.js";
import { dataSP } from "./datas.js";

export const DIAS_SEMANA_PENDENTE = 7;

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
export const somarDiasIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const maior = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

export const chaveSemanaRampa = (rampaId) => `semana|rampa:${rampaId}`;
export const chaveSemanaAf = (tipo, id, canalId) => `semana|af:${tipo}|${id}|${canalId}`;

// Último registro de uma rampa (semana ou início); sem nenhum, o começo dela.
export function ultimoRegistroRampa(rampa, registros) {
  let u = null;
  for (const g of registros || []) if (g.rampa_id === rampa.id && (g.tipo === "semana" || g.tipo === "inicio")) u = maior(u, String(g.data).slice(0, 10));
  return u || rampa.desde || (rampa.criado_em ? dataSP(rampa.criado_em) : null);
}

// Último registro de afiliado do item × canal; sem nenhum, o dia em que o item entrou.
export function ultimoRegistroAf(tipo, id, canalId, afRegistros, configRow = null) {
  let u = null;
  for (const g of afRegistros || []) if (g.item_tipo === tipo && g.item_id === id && g.canal_id === canalId) u = maior(u, String(g.data).slice(0, 10));
  return u || (configRow?.criado_em ? dataSP(configRow.criado_em) : null);
}

// Período sem registro até `data` (registro na data cobre até a véspera).
export function periodoEmAberto(ultimo, data) {
  if (!ultimo || !data) return null;
  const dias = diasEntre(ultimo, data);
  return { de: ultimo, ate: somarDiasIso(data, -1), dias, pendente: dias > DIAS_SEMANA_PENDENTE };
}

// Todos os itens que precisam de registro semanal, com o estado de cada um.
// → { itens: [...], pendentes: [...], adiados: [...] }; item = { chave, tipo:
// 'rampa'|'afiliado', rampaId?, itemTipo, itemId, canal, nome, ultimo, dias,
// pendente, lembrete }.
export function semanasPendentes({ rampas = [], rampaRegistros = [], afConfig = [], afRegistros = [], adsPeriodos = [], itens = [], canais = [], precos = [], lembretes = [], hoje }) {
  const out = [];
  const lembreteDe = (chave) => lembretes.find((l) => l.chave === chave && String(l.adiado_ate).slice(0, 10) > hoje) || null;
  for (const r of rampas) {
    const canal = canais.find((c) => c.id === r.canal_id);
    const item = itens.find((i) => i.id === `p:${r.produto_id}`);
    if (!canal || !item) continue;
    const ultimo = ultimoRegistroRampa(r, rampaRegistros);
    if (!ultimo) continue;
    const dias = diasEntre(ultimo, hoje);
    const chave = chaveSemanaRampa(r.id);
    out.push({ chave, tipo: "rampa", rampaId: r.id, itemTipo: "produto", itemId: r.produto_id, canal, nome: item.nome, ultimo, dias, pendente: dias > DIAS_SEMANA_PENDENTE, lembrete: lembreteDe(chave) });
  }
  for (const row of afConfig) {
    if (!row.item_tipo || !row.item_id || !row.ativo) continue;
    const canal = canais.find((c) => c.id === row.canal_id);
    const item = itens.find((i) => i.id === idPrefixado(row.item_tipo, row.item_id));
    if (!canal || !item) continue;
    if (!comissaoDoItem(afConfig, row.item_tipo, row.item_id, row.canal_id).ativo) continue;
    // produto em rampa no canal já é cobrado pelo registro da rampa
    if (row.item_tipo === "produto" && rampas.some((r) => r.produto_id === row.item_id && r.canal_id === row.canal_id)) continue;
    const salvo = precos.find((p) => p.item_tipo === row.item_tipo && p.item_id === row.item_id && p.canal_id === row.canal_id);
    if (!salvo || !(Number(salvo.preco) > 0)) continue;
    const ultimo = ultimoRegistroAf(row.item_tipo, row.item_id, row.canal_id, afRegistros, row);
    if (!ultimo) continue;
    const dias = diasEntre(ultimo, hoje);
    const chave = chaveSemanaAf(row.item_tipo, row.item_id, row.canal_id);
    out.push({ chave, tipo: "afiliado", itemTipo: row.item_tipo, itemId: row.item_id, canal, nome: item.nome, ultimo, dias, pendente: dias > DIAS_SEMANA_PENDENTE, lembrete: lembreteDe(chave) });
  }
  // Item só com Ads ligado (período ativo, schema v44), fora de rampa e sem
  // afiliado: registra a semana no mesmo afiliado_registros (vendas_total + Ads).
  for (const p of adsPeriodos) {
    if (p.motivo_fim || (p.fim && p.fim < hoje)) continue;
    const chave = chaveSemanaAf(p.item_tipo, p.item_id, p.canal_id);
    if (out.some((x) => x.chave === chave)) continue;
    if (p.item_tipo === "produto" && rampas.some((r) => r.produto_id === p.item_id && r.canal_id === p.canal_id)) continue;
    const canal = canais.find((c) => c.id === p.canal_id);
    const item = itens.find((i) => i.id === idPrefixado(p.item_tipo, p.item_id));
    if (!canal || !item) continue;
    let ultimo = null;
    for (const g of afRegistros) if (g.item_tipo === p.item_tipo && g.item_id === p.item_id && g.canal_id === p.canal_id) ultimo = maior(ultimo, String(g.data).slice(0, 10));
    ultimo = ultimo || String(p.inicio).slice(0, 10);
    const dias = diasEntre(ultimo, hoje);
    out.push({ chave, tipo: "afiliado", itemTipo: p.item_tipo, itemId: p.item_id, canal, nome: item.nome, ultimo, dias, pendente: dias > DIAS_SEMANA_PENDENTE, lembrete: lembreteDe(chave) });
  }
  out.sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome));
  return {
    itens: out,
    pendentes: out.filter((x) => x.pendente && !x.lembrete),
    adiados: out.filter((x) => x.pendente && x.lembrete),
  };
}

// Até quando um lembrete esconde o aviso: "pular" = até a semana seguinte; "amanha" = 1 dia.
export const adiadoAte = (tipo, hoje) => somarDiasIso(hoje, tipo === "amanha" ? 1 : DIAS_SEMANA_PENDENTE);
