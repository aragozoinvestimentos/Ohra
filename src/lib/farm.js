// "Minha farm" (schema v47): os dados da máquina vivem num lugar só — a
// impressora (valor pago, vida útil, potência, manutenção/hora) e a config da
// farm (horas de operação por dia, tarifa do kWh). Conta ÚNICA do custo por
// hora, do desgaste estimado e dos avisos; o cálculo do custo de produção
// (calc.js) recebe o resultado pronto em `produto._maquina`.
import { hojeSP } from "./datas.js";

export const VIDA_UTIL_PADRAO = 8000;
export const AVISO_DESGASTE = 0.625; // 5.000 de 8.000 h
export const QUEDA_LUCRO_RELEVANTE = 0.2; // custo subiu e o lucro caiu ≥ 20%

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// Custo por hora de impressão. Máquina = valor pago ÷ vida útil (continua
// sendo cobrado depois da vida útil — vira o fundo da próxima máquina);
// horas/dia NÃO entram aqui (só no desgaste e na previsão).
export function custoHora(imp, cfg) {
  if (!imp) return null;
  const vida = num(imp.vida_util_horas) || VIDA_UTIL_PADRAO;
  const maquina = num(imp.valor_pago) / vida;
  const energia = (num(imp.potencia_w) / 1000) * num(cfg?.tarifa_kwh);
  const manutencao = num(imp.manutencao_hora);
  return { maquina, energia, manutencao, total: maquina + energia + manutencao };
}

export const impressoraPadrao = (impressoras) => {
  const ativas = (impressoras || []).filter((i) => i.ativa !== false);
  return ativas.find((i) => i.padrao) || ativas[0] || null;
};

// Impressora do produto: a escolhida (se ativa) ou a padrão.
export function impressoraDoProduto(produto, impressoras) {
  const lista = impressoras || [];
  const escolhida = produto?.impressora_id ? lista.find((i) => i.id === produto.impressora_id) : null;
  if (escolhida && escolhida.ativa !== false) return escolhida;
  return impressoraPadrao(lista);
}

// O que o cálculo do custo de produção precisa da máquina. null = farm ainda
// não configurada (v47 não rodado / sem impressora) → calc.js usa os campos
// antigos do detalhamento, como antes.
export function maquinaDoProduto(produto, impressoras, cfg) {
  if (!cfg) return null;
  const imp = impressoraDoProduto(produto, impressoras);
  if (!imp) return null;
  const h = custoHora(imp, cfg);
  return {
    impressoraId: imp.id,
    nome: imp.nome,
    custoHoraMaquina: h.maquina + h.manutencao,
    tarifa: num(cfg.tarifa_kwh),
    potencia: num(imp.potencia_w),
    custoHora: h.total,
  };
}

// Produtos com a máquina aplicada (o store do catálogo faz isso uma vez).
export const comMaquina = (produtos, impressoras, cfg) =>
  (produtos || []).map((p) => ({ ...p, _maquina: maquinaDoProduto(p, impressoras, cfg) }));

const diasEntre = (a, b) => Math.max(0, Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000));
const somarDias = (iso, d) => {
  const x = new Date(`${iso}T12:00:00`);
  x.setDate(x.getDate() + Math.round(d));
  return x.toISOString().slice(0, 10);
};

// Desgaste ESTIMADO: horas iniciais + horas/dia × dias desde o cadastro.
export function desgaste(imp, cfg, hoje = hojeSP()) {
  const vida = num(imp.vida_util_horas) || VIDA_UTIL_PADRAO;
  const porDia = num(cfg?.horas_dia_operacao);
  const desde = imp.data_cadastro || hoje;
  const horas = num(imp.horas_iniciais) + porDia * diasEntre(desde, hoje);
  const pct = vida > 0 ? horas / vida : 0;
  const faltam = Math.max(0, vida - horas);
  // Pelo custo/hora cobrado, o valor pago volta inteiro ao chegar na vida útil.
  const fimVida = porDia > 0 ? somarDias(hoje, faltam / porDia) : null;
  return { horas, vida, pct, faltam, fimVida, porDia };
}

// Avisos de desgaste (Início → Atenção e rotina): um por impressora ativa.
export function avisosDesgaste(impressoras, cfg, hoje = hojeSP()) {
  if (!cfg) return [];
  const out = [];
  for (const imp of impressoras || []) {
    if (imp.ativa === false) continue;
    const d = desgaste(imp, cfg, hoje);
    const h = (v) => Math.round(v).toLocaleString("pt-BR");
    if (d.pct >= 1 && !imp.aviso_fim_visto)
      out.push({ tipo: "fim", imp, d, texto: `${h(d.horas)} de ${h(d.vida)} h (estimativa) — passou da vida útil; o custo/hora continua indo pro fundo da próxima máquina` });
    else if (d.pct >= AVISO_DESGASTE && d.pct < 1 && !imp.aviso_desgaste_visto)
      out.push({ tipo: "desgaste", imp, d, texto: `${h(d.horas)} de ${h(d.vida)} h (estimativa) — avaliar venda/troca` });
  }
  return out;
}

// Mudança na farm: entra no aviso só o que PIOROU — lucro abaixo do mínimo /
// prejuízo, ou queda de lucro ≥ 20%. Custo caiu = nada.
export function motivoDaPiora(l) {
  if (!(l.diferenca < -0.005)) return null;
  if (l.prejuizo && !l.prejuizoDiscreto) return "prejuízo";
  if (l.abaixoMinimo) return "abaixo do mínimo";
  if (l.lucroHoje > 0 && -l.diferenca / l.lucroHoje >= QUEDA_LUCRO_RELEVANTE) return `lucro caiu ${Math.round((-l.diferenca / l.lucroHoje) * 100)}%`;
  return null;
}
export const ehGrave = (motivo) => motivo === "prejuízo" || motivo === "abaixo do mínimo";
