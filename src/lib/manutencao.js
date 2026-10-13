// Manutenção das impressoras (Minha farm, schema v50) — conta ÚNICA, por
// calendário (não por horas). Cada item tem um intervalo em dias; a próxima
// data = última vez feita + dias (nunca feito = dia de referência da
// impressora + dias). Com várias impressoras, o dia de referência é
// espalhado de N em N dias (farm_config.manutencao_espaco_dias).
import { hojeSP } from "./datas.js";

export const ANTECEDENCIA_DIAS = 3; // Início avisa a partir de 3 dias antes

// Modelo Bambu Lab A1 (wiki oficial + prática comum; editável por impressora).
export const PLANO_A1 = [
  { id: "mesa", nome: "Limpar a mesa PEI (água e sabão neutro ou álcool isopropílico)", dias: 30 },
  { id: "limpeza", nome: "Limpeza geral: poeira, restos de filamento, purga e cortador", dias: 30 },
  { id: "trilhos", nome: "Trilhos X e Y: limpar e passar óleo (nunca graxa no trilho X)", dias: 30 },
  { id: "bico", nome: "Bico e hotend: ver desgaste/entupimento e limpar", dias: 30 },
  { id: "extrusora", nome: "Extrusora: limpar as engrenagens", dias: 30 },
  { id: "correias", nome: "Correias: rodar a calibração (a A1 confere a tensão)", dias: 30 },
  { id: "fuso-z", nome: "Fuso do eixo Z: limpar e passar graxa", dias: 90 },
  { id: "parafusos", nome: "Parafusos e folgas", dias: 90 },
  { id: "ptfe", nome: "Tubo PTFE (AMS lite): ver desgaste", dias: 180 },
];

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
export const somarDias = (iso, d) => {
  const x = new Date(`${iso}T12:00:00`);
  x.setDate(x.getDate() + Math.round(d));
  return x.toISOString().slice(0, 10);
};
export const diasAte = (de, ate) => Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 86400000);

export function planoDe(imp) {
  const p = Array.isArray(imp?.manutencao_plano) ? imp.manutencao_plano.filter((x) => x && x.nome && num(x.dias) > 0) : null;
  return p && p.length ? p : PLANO_A1;
}

// Dia de referência: o escolhido, ou cadastro + posição × espaço (várias máquinas).
export function inicioManutencao(imp, impressoras, cfg) {
  if (imp?.manutencao_inicio) return imp.manutencao_inicio;
  const ativas = (impressoras || []).filter((i) => i.ativa !== false);
  const pos = Math.max(0, ativas.findIndex((i) => i.id === imp.id));
  const espaco = num(cfg?.manutencao_espaco_dias) || 3;
  const base = ativas[0]?.data_cadastro || imp.data_cadastro || hojeSP();
  return somarDias(base, pos * espaco);
}

// Situação de cada item: última vez, próxima data e dias que faltam (< 0 = atrasado).
export function itensDaImpressora(imp, registros, { impressoras, cfg, hoje = hojeSP() } = {}) {
  const inicio = inicioManutencao(imp, impressoras, cfg);
  const meus = (registros || []).filter((r) => r.impressora_id === imp.id);
  return planoDe(imp).map((it) => {
    const ult = meus.filter((r) => r.item_id === it.id).reduce((m, r) => (!m || r.feita_em > m ? r.feita_em : m), null);
    const proxima = somarDias(ult || inicio, num(it.dias));
    const faltam = diasAte(hoje, proxima);
    return { ...it, ultima: ult, proxima, faltam, vencendo: faltam <= ANTECEDENCIA_DIAS };
  });
}

// Resumo pro Início: um aviso por impressora com algo vencendo (≤ 3 dias ou atrasado).
export function avisosManutencao(impressoras, registros, cfg, hoje = hojeSP()) {
  if (!cfg) return [];
  const out = [];
  for (const imp of impressoras || []) {
    if (imp.ativa === false) continue;
    const itens = itensDaImpressora(imp, registros, { impressoras, cfg, hoje }).filter((x) => x.vencendo);
    if (!itens.length) continue;
    const pior = Math.min(...itens.map((x) => x.faltam));
    out.push({ imp, itens, faltam: pior });
  }
  return out;
}

export const textoPrazo = (faltam) =>
  faltam < 0 ? `atrasada ${-faltam} dia${faltam === -1 ? "" : "s"}` : faltam === 0 ? "hoje" : faltam === 1 ? "amanhã" : `em ${faltam} dias`;
