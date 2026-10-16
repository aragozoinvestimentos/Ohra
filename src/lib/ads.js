// Ads — conta ÚNICA de "vale usar Ads neste produto? aumento, mantenho,
// reduzo ou pauso?" (out/2026, schema v44). Funções puras: recebem os
// registros semanais do item (rampa_registros ou afiliado_registros fora de
// rampa), os períodos de Ads (ads_periodos) e o lucro no preço; devolvem UMA
// situação com o motivo escrito. Quem mostra: Crescimento → Ads, cartão de Ads
// do Detalhe da Rampa e o Início. Ads é custo de venda, não entra no preço.
//
// Método (combinado com o Gustavo, vídeo "Ads não é milagre, é método"):
// 1) 7 dias de aprendizado sem mexer em meta nem orçamento;
// 2) depois, decisão AO VIVO (plano de 14/10/2026): pelo andamento (CSV do
//    Shopee Ads) ou pela semana registrada, 3 dias depois de cada
//    ajuste. Retorno = ROAS ÷ ROAS de equilíbrio (= lucro que cada R$ 1 de Ads
//    trouxe — Ads é investimento). Gastou ≥ 80% do orçamento: < 1× → 3 saídas
//    (muitos cliques sem venda → arrumar o anúncio; já no mínimo de R$ 10/dia
//    → subir a meta ou pausar; senão → reduzir); 1–1,2× → manter; 1,2–2× →
//    +20%; ≥ 2× → +30% (máximo — 16/10/2026, "não dá estouro de uma vez").
//    Gastou pouco → baixar a meta;
// 3) Ads da loja ≤ teto (tabela progressiva de 30 dias).
// Método do Luan (16/10/2026, schema v57): produto novo = LANCE AUTOMÁTICO
// (tipo 'auto', sem meta) e orçamento baixo; dia 3 sem venda = parar e
// arrumar o anúncio (vale pra todo período); dia 7 = virar meta de ROAS com o
// ROAS que bateu. Pausar pra revisar mantém o período (ajustes {tipo:'pausa'|
// 'volta'}); GMV Max da Loja = período item_tipo 'loja' (avaliarAdsLoja).
import { porSemana, vendasParaDecisao } from "./rampa.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const somarDiasIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const um = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moeda = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export const REGRAS_ADS = {
  aprendizadoDias: 7, // Shopee: até 7 dias de aprendizado (GMV Max)
  aumento: 0.2, // 1º degrau da escada de aumento (retorno 1,2–2×)
  aumentoMax: 0.3, // retorno ≥ 2× → +30% no máximo (sem +50%/dobrar)
  diaConferencia: 3, // dia 3: sem venda via Ads = parar e arrumar o anúncio
  pausaLembrarDias: 3, // pausado pra revisar há 3 dias → lembrar de despausar
  pausaLongaDias: 21, // pausado há 21 dias → a Shopee começa a perder o aprendizado
  lojaGastoMinDia: 1, // campanha da loja gastando < R$ 1/dia por 7 dias = meta alta demais
  lojaMetaFator: 2, // campanha da loja: meta alta = 2× o equilíbrio da loja
  decisaoDias: 3, // depois de cada ajuste: decide de novo em 3 dias (método do Luan, 16/10/2026)
  metaFator: 1.3, // meta sugerida = equilíbrio × 1,3
  metaAltaFator: 2, // meta > 2× o equilíbrio = alta pra começar
  escada: { manterAte: 1.2, dobroAte: [2, 3] }, // retorno: < 1,2 manter · < 2 +20% · ≥ 2 +30% (aumentoMax)
  cliquesConversao: 30, // cliques no período pra julgar a conversão
  conversaoMin: 0.01, // vendas ÷ cliques abaixo disso = problema é o anúncio
  constanciaDias: 3, // média de 3 dias × os 3 anteriores
  constanciaQueda: 0.3, // caiu > 30% com retorno ≥ 1,2× → sugerir aumento
  constanciaAlta: 0.5, // subiu ≥ 50% e a farm não acompanha → segurar
  andamentoAvisoDias: 3, // Início: andamento mais velho que isso → lembrar
  tetoLoja: 0.15, // Ads da semana ≤ 15% do faturamento da semana (loja)
  roasInviavel: 8, // equilíbrio acima disso = Ads não se paga neste preço
  cliquesSemVenda: 50,
  gastoCheio: 0.8, // gastou ≥ 80% do orçamento da semana = a Shopee achou onde gastar
  gastoBaixo: 0.5, // gastou < 50% = meta alta demais, a Shopee está segurando
  folgaEscala: 2, // ROAS ≥ 2× a meta = dá pra escalar mais
  diasTentarDeNovo: 30,
  organicoAlto: 0.6,
  vendeSozinho: 5, // vendas orgânicas por semana pra "não precisa de Ads"
  minDiario: 10, // mínimo diário de Ads da Shopee
  // Ads sazonal (produto "só na época de…", out/2026) — fases contadas a partir
  // da data-limite (no alvo) e da data: Aquecer → Ajustar → Alavancar → Corte.
  aquecerDias: 45, // Aquecer começa 45 dias antes da data-limite
  ajustarDias: 21, // Ajustar começa 21 dias antes da data-limite
  corteDias: 7, // Corte: pausa 7 dias antes da data (a entrega não chega mais)
  metaSazonalFator: 2, // Ads sazonal deixa ≥ metade do lucro: meta mínima = 2× o equilíbrio
  alavancarAumento: 0.3, // no Alavancar o aumento pode ser de até 30%
  alavancarAprendizado: 3, // e decide a cada 3 dias (pelo andamento)
  andamentoMaxDias: 4, // andamento mais velho que isso: atualize antes de decidir
  // Teto de Ads da loja (out/2026): progressivo pelo faturamento dos últimos
  // 30 dias — cada % vale só pro pedaço da faixa (como imposto de renda) — e
  // NUNCA mais que travaLucro × o lucro dos últimos 30 dias.
  faixasTeto: [
    { ate: 1000, fixo: 150 }, // até R$ 1.000: valor FIXO (decisão do Gustavo: loja começando, R$ 150/mês mesmo vendendo pouco)
    { ate: 3000, pct: 0.12 },
    { ate: 5000, pct: 0.1 },
    { ate: 10000, pct: 0.08 },
    { ate: 30000, pct: 0.07 },
    { ate: 60000, pct: 0.06 },
    { ate: 100000, pct: 0.05 },
    { ate: 150000, pct: 0.04 },
    { ate: null, pct: 0.03 },
  ],
  travaLucro: 0.5,
};

// Fase da loja pelo faturamento (só rótulo): até 5 mil Alavancado, até 60 mil Mediano.
export function faseDaLoja(faturamento) {
  return faturamento <= 5000 ? "Alavancado" : faturamento <= 60000 ? "Mediano" : "Conservador";
}
// Teto do mês pelas faixas (cada % sobre o pedaço dentro da faixa; faixa com
// `fixo` vale aquele valor em R$ inteiro, mesmo sem faturar).
export function tetoPorFaixas(faturamento, faixas = REGRAS_ADS.faixasTeto) {
  let total = 0;
  let de = 0;
  for (const f of faixas) {
    const ate = f.ate == null ? Infinity : num(f.ate);
    if (f.fixo != null) total += num(f.fixo);
    else if (faturamento > de) total += (Math.min(faturamento, ate) - de) * num(f.pct);
    de = ate;
    if (faturamento <= de) break;
  }
  return Math.round(total * 100) / 100;
}
// Valor fixo mínimo (a faixa com `fixo`, se houver) — a trava do lucro não corta abaixo dele.
const fixoDasFaixas = (faixas) => (faixas || []).filter((f) => f.fixo != null).reduce((t, f) => t + num(f.fixo), 0);
// Teto de Ads da loja: { faturamento, lucro, gasto (30 dias), fase, pelaTabela, pelaTrava, teto, pct, acimaTeto, passaria(extraNoMes) }.
export function tetoDaLoja({ faturamento = 0, lucro = 0, gasto = 0, regras = REGRAS_ADS }) {
  const pelaTabela = tetoPorFaixas(faturamento, regras.faixasTeto || REGRAS_ADS.faixasTeto);
  const pelaTrava = Math.max(0, num(regras.travaLucro) * lucro);
  const fixo = fixoDasFaixas(regras.faixasTeto || REGRAS_ADS.faixasTeto);
  const teto = Math.max(fixo, Math.min(pelaTabela, pelaTrava));
  return {
    faturamento,
    lucro,
    gasto,
    fase: faseDaLoja(faturamento),
    pelaTabela,
    pelaTrava,
    teto,
    limitadoPelaTrava: pelaTrava < pelaTabela - 0.005 && teto > fixo + 0.005,
    pct: faturamento > 0 ? gasto / faturamento : null,
    acimaTeto: faturamento > 0 && gasto > teto + 0.005,
    passaria: (extraMes) => faturamento > 0 && gasto + extraMes > teto,
  };
}

// Fase do Ads sazonal hoje (infoSazonal de calendario.js; só tipo "epoca").
// → { fase: fora|aquecer|ajustar|alavancar|corte|depois, nome, evento, limite, inicio, fim, titulo, texto } ou null.
export const FASES_ADS = {
  fora: { titulo: "Fora da temporada", texto: "Ads desligado até começar o Aquecer." },
  aquecer: { titulo: "Aquecer", texto: "Ads barato (R$ 10/dia) pra plataforma aprender quem compra. Não precisa vender muito, mas o que vender tem que deixar lucro." },
  ajustar: { titulo: "Ajustar", texto: "Método normal: uma decisão por semana — lucrou e gastou o orçamento, aumenta; abaixo do mínimo, reduz ou pausa." },
  alavancar: { titulo: "Alavancar", texto: "Mesmo método, mais rápido: decide a cada 3–4 dias pelo andamento atualizado e aumenta até 30% — só se estiver lucrando." },
  corte: { titulo: "Corte", texto: "Pausar o Ads: a entrega não chega mais a tempo da data." },
  depois: { titulo: "Depois da data", texto: "Ads desligado (entressafra)." },
};
export function faseAdsSazonal(sz, hoje, regras = REGRAS_ADS) {
  if (!sz || sz.tipo !== "epoca") return null;
  const ev = sz.fase === "entressafra" || sz.fase === "aguardando" ? sz.proximo : sz;
  if (sz.fase === "entressafra" && num(sz.diasDesdeEvento) <= 30)
    return { fase: "depois", nome: sz.nome, evento: sz.anterior, inicio: somarDiasIso(sz.anterior, 1), fim: null, ...FASES_ADS.depois };
  if (!ev?.limite || !ev?.evento) return null;
  const L = ev.limite;
  const E = ev.evento;
  const ini = { aquecer: somarDiasIso(L, -num(regras.aquecerDias)), ajustar: somarDiasIso(L, -num(regras.ajustarDias)), alavancar: L, corte: somarDiasIso(E, -num(regras.corteDias)) };
  let fase = "fora";
  if (hoje > E) fase = "depois";
  else if (hoje >= ini.corte) fase = "corte";
  else if (hoje >= ini.alavancar) fase = "alavancar";
  else if (hoje >= ini.ajustar) fase = "ajustar";
  else if (hoje >= ini.aquecer) fase = "aquecer";
  const fimDe = { fora: ini.aquecer, aquecer: ini.ajustar, ajustar: ini.alavancar, alavancar: ini.corte, corte: E, depois: null };
  return { fase, nome: ev.nome || sz.nome, evento: E, limite: L, inicio: ini[fase] || null, fim: fimDe[fase], datas: ini, ...FASES_ADS[fase] };
}

export function regrasAds(cfgLoja) {
  return { ...REGRAS_ADS, ...(cfgLoja?.ads || {}) };
}

// ROAS de EQUILÍBRIO = preço ÷ lucro antes do Ads (no preço de AGORA): abaixo
// dele o Ads tira lucro. (Nas variáveis continua "empate".)
export const roasEmpate = (preco, lucro) => (lucro > 0 && preco > 0 ? preco / lucro : null);
// Meta sugerida pra começar: equilíbrio × 1,3 (1 casa, pra cima) — folga pra
// sobrar lucro sem deixar a Shopee seletiva demais (meta alta = entrega pra
// menos gente; meta baixa = mais alcance).
export const metaSugerida = (empate, regras = REGRAS_ADS) => (empate ? Math.ceil(empate * num(regras.metaFator || 1.3) * 10 - 1e-9) / 10 : null);
// Meta alta pra começar: mais que 2× o equilíbrio (Shopee quase não entrega).
export const metaAltaDemais = (meta, empate, regras = REGRAS_ADS) => !!(num(meta) > 0 && empate && num(meta) > empate * num(regras.metaAltaFator || 2) + 1e-9);
// Retorno do Ads = ROAS ÷ equilíbrio = lucro (antes do Ads) que cada R$ 1
// investido trouxe. Ads é investimento: retorno 2,8 = "cada R$ 1 voltou R$ 2,80 de lucro".
export const retornoAds = (roas, empate) => (roas != null && empate ? roas / empate : null);
export const textoRetorno = (ret) => (ret == null ? "" : `cada R$ 1 investido voltou ${moeda(ret)} de lucro`);
export const valorAumento = (orc, regras = REGRAS_ADS) => Math.ceil(num(orc) * (1 + regras.aumento));
// Escada do aumento pelo retorno: 1,2–2× → +20% · ≥ 2× → +30% (máximo).
export function passoDaEscada(retorno, regras = REGRAS_ADS) {
  const e = regras.escada || REGRAS_ADS.escada;
  if (retorno == null || retorno < e.manterAte) return 0;
  const base = num(regras.aumento) || 0.2;
  if (retorno < e.dobroAte[0]) return base;
  return Math.max(base, num(regras.aumentoMax) || 0.3);
}

// Pausas do período (método do Luan, 16/10/2026): "Pausei pra revisar" grava
// um ajuste {tipo:'pausa', data} e "Despausei" um {tipo:'volta', data,
// vendas (andamento na hora)}. O período continua ligado; os dias pausados
// não contam. → { pausado: {desde} | null, diasPausados, ultimaVolta }.
export function pausasDoPeriodo(periodo, hoje) {
  const aj = Array.isArray(periodo?.ajustes) ? periodo.ajustes : [];
  let desde = null;
  let diasPausados = 0;
  let ultimaVolta = null;
  for (const a of aj) {
    if (a?.tipo === "pausa" && !desde) desde = a.data;
    else if (a?.tipo === "volta" && desde) {
      diasPausados += Math.max(0, diasEntre(desde, a.data));
      desde = null;
      ultimaVolta = a;
    }
  }
  if (desde && hoje) diasPausados += Math.max(0, diasEntre(desde, hoje));
  return { pausado: desde ? { desde } : null, diasPausados, ultimaVolta };
}
// "Revisei o anúncio — dar até o 7º dia": ajuste {tipo:'revisei'} silencia o
// aviso de dia 3 sem venda até o 7º dia rodando.
const revisouSemVenda = (periodo) => (Array.isArray(periodo?.ajustes) ? periodo.ajustes : []).some((a) => a?.tipo === "revisei");

const roasDe = (s, preco) => (num(s.ads_gasto) > 0 ? (num(s.ads_vendas) * (num(s.preco) || preco)) / num(s.ads_gasto) : null);

// Períodos do item × canal, mais novo primeiro. Ativo = sem `fim` ou fim ≥ hoje.
export function periodosDoItem(periodos, tipo, id, canalId) {
  return (periodos || [])
    .filter((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canalId)
    .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
}
// Ligado = não foi encerrado (motivo_fim vazio — o "Encerrar" sempre grava um)
// e a data de fim, se houver, ainda não passou.
export const periodoLigado = (p, hoje) => !!p && !p.motivo_fim && (!p.fim || p.fim >= hoje);
export const periodoAtivo = (lista, hoje) => (lista || []).find((p) => periodoLigado(p, hoje)) || null;

// Ajustes do período (aumentou/reduziu orçamento, mudou a meta): o orçamento
// e a meta "de agora" são os do último ajuste.
// Pausa/volta/revisei não mudam orçamento nem meta (ficam fora daqui).
export function valoresAtuais(periodo) {
  const aj = (Array.isArray(periodo?.ajustes) ? periodo.ajustes : []).filter((a) => a && !["pausa", "volta", "revisei"].includes(a.tipo));
  const ultOrc = [...aj].reverse().find((a) => a.orcamento != null);
  const ultMeta = [...aj].reverse().find((a) => a.meta != null);
  const ult = aj[aj.length - 1] || {};
  return {
    orcamento: num(ultOrc?.orcamento ?? periodo?.orcamento_diario) || null,
    meta: num(ultMeta?.meta ?? periodo?.meta_roas) || null,
    ultimoAjuste: ult.data || null,
    // lance automático: vira meta quando um ajuste grava a meta (dia 7)
    automatico: periodo?.tipo === "auto" && !ultMeta,
  };
}

// Semanas (já por semana, × 7 ÷ dias) que caem num período: o registro cobre
// os dias ANTES da data dele, então conta se termina depois do início.
export function semanasNoPeriodo(semanas, periodo) {
  if (!periodo) return [];
  const fimLim = periodo.fim ? somarDiasIso(periodo.fim, 7) : null;
  return semanas.filter((s) => s.data > periodo.inicio && (!fimLim || s.data <= fimLim));
}

// Andamento do período (v48, `ads_periodos.parcial`): números ACUMULADOS
// desde o início, até `ate`, informados no meio do período (à mão ou pelo CSV
// do Shopee Ads). Cada envio substitui o anterior (os anteriores ficam em
// `parcial.historico`, pra constância). Só vale enquanto nenhuma semana
// registrada cobrir essas datas — a semana registrada prevalece. Desde o
// plano de 14/10/2026 o andamento ENTRA nas decisões (depois do aprendizado).
export function andamentoValido(periodo, semanas) {
  const par = periodo?.parcial;
  if (!par || !par.ate) return null;
  const cobertoAte = semanasNoPeriodo(semanas || [], periodo).reduce((m, s) => {
    const fim = somarDiasIso(String(s.data).slice(0, 10), -1);
    return fim > m ? fim : m;
  }, "");
  if (cobertoAte && cobertoAte >= par.ate) return null;
  const gasto = num(par.gasto);
  const vendas = num(par.vendas);
  return { ate: par.ate, em: par.em || null, gasto, cliques: num(par.cliques), vendas, custoPorVenda: vendas > 0 ? gasto / vendas : null };
}

// Constância (plano 14/10/2026): vendas via Ads por dia nos últimos ~3 dias ×
// os ~3 dias anteriores, pelos envios do andamento (parcial + parcial.historico).
// Nunca reage a um dia isolado: precisa de 3 envios com ≥ 3 dias entre eles.
// → { agora, antes (vendas/dia), variacao (−0,4 = caiu 40%), ate } ou null.
export function constanciaAds(periodo, regras = REGRAS_ADS) {
  const par = periodo?.parcial;
  if (!par?.ate) return null;
  const passo = num(regras.constanciaDias) || 3;
  const pontos = new Map();
  for (const h of [...(Array.isArray(par.historico) ? par.historico : []), par]) if (h?.ate) pontos.set(h.ate, num(h.vendas));
  const lista = [...pontos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const s0 = lista[lista.length - 1];
  const s1 = [...lista].reverse().find((x) => diasEntre(x[0], s0[0]) >= passo);
  const s2 = s1 ? [...lista].reverse().find((x) => diasEntre(x[0], s1[0]) >= passo) : null;
  if (!s1 || !s2) return null;
  const agora = (s0[1] - s1[1]) / diasEntre(s1[0], s0[0]);
  const antes = (s1[1] - s2[1]) / diasEntre(s2[0], s1[0]);
  if (!(antes > 0)) return null;
  return { agora, antes, variacao: agora / antes - 1, ate: s0[0] };
}

// Resumo de um período (pra histórico e resultado).
export function resumoPeriodo(periodo, semanas, preco, empate, regras = REGRAS_ADS) {
  const ss = semanasNoPeriodo(semanas, periodo);
  const gasto = ss.reduce((t, s) => t + num(s.ads_gasto), 0);
  const vendas = ss.reduce((t, s) => t + num(s.ads_vendas), 0);
  const cliques = ss.reduce((t, s) => t + num(s.ads_cliques), 0);
  const receita = ss.reduce((t, s) => t + num(s.ads_vendas) * (num(s.preco) || preco), 0);
  const roas = gasto > 0 ? receita / gasto : null;
  let resultado = null;
  if (gasto > 0) {
    if (vendas === 0 && cliques >= regras.cliquesSemVenda) resultado = { chave: "revisar", texto: "cliques sem venda — revisar o anúncio" };
    else if (empate && roas >= empate) resultado = { chave: "valeu", texto: `pagou o Ads · ${textoRetorno(retornoAds(roas, empate))}` };
    else if (empate && roas >= empate * 0.7) resultado = { chave: "aceitavel", texto: "perto do equilíbrio" };
    else resultado = { chave: "caro", texto: "não se pagou" };
  }
  return { semanas: ss.length, gasto, vendas, cliques, receita, roas, retorno: retornoAds(roas, empate), custoPorVenda: vendas > 0 ? gasto / vendas : null, resultado };
}

// Menor preço (passos de R$0,50, até 3× o atual) em que o Ads passa a ser
// viável (equilíbrio ≤ roasInviavel).
function precoViavel(preco, lucroEm, regras) {
  if (!lucroEm) return null;
  for (let p = Math.ceil(preco * 2) / 2; p <= preco * 3; p += 0.5) {
    const l = lucroEm(p);
    if (l > 0 && p / l <= regras.roasInviavel) return { preco: p, empate: p / l };
  }
  return null;
}

// Medida da decisão (ritmo ao vivo, plano 14/10/2026): o mais novo entre
// (a) o ANDAMENTO (acumulado desde o início, menos as semanas que terminaram
// antes do último ajuste) e (b) a última semana registrada depois do
// aprendizado/ajuste. → { fonte, ate, dias, gasto, vendas, cliques, roas } ou null.
function medidaDaDecisao(ativo, ss, refDecisao, gapDias, preco) {
  const noPer = semanasNoPeriodo(ss, ativo);
  const a = andamentoValido(ativo, ss);
  if (a) {
    const antes = noPer.filter((s) => s.data <= refDecisao);
    const soma = (k) => antes.reduce((t, s) => t + num(s[k]), 0);
    const ini = antes.length ? antes.reduce((m, s) => (s.data > m ? s.data : m), refDecisao) : ativo.inicio;
    const dias = diasEntre(ini, a.ate) + 1;
    const gasto = Math.max(0, a.gasto - soma("ads_gasto"));
    const vendas = Math.max(0, a.vendas - soma("ads_vendas"));
    const cliques = Math.max(0, a.cliques - soma("ads_cliques"));
    if (dias >= 3 && gasto > 0 && a.ate >= somarDiasIso(refDecisao, gapDias - 1))
      return { fonte: "andamento", ate: a.ate, dias, gasto, vendas, cliques, roas: (vendas * preco) / gasto };
  }
  const depois = noPer.filter((s) => s.data > somarDiasIso(refDecisao, gapDias - 1) && num(s.ads_gasto) > 0);
  const ult = depois[depois.length - 1];
  if (!ult) return null;
  return { fonte: "semana", ate: somarDiasIso(String(ult.data).slice(0, 10), -1), dias: 7, gasto: num(ult.ads_gasto), vendas: num(ult.ads_vendas), cliques: num(ult.ads_cliques), roas: roasDe(ult, preco), semana: ult, depois };
}

// A avaliação. `semanas` = registros semanais do item (tipo semana, em ordem
// de data, qualquer formato com vendas/ads_*/data/periodo_inicio).
// `anuncio` = aviso de Revisar anúncio da Rampa (funil/teste), se houver.
// `capacidadeDia` = quanto a farm produz por dia deste item (null = sem dado).
export function avaliarAds({ preco, lucro, lucroEm = null, semanas = [], periodos = [], anuncio = null, hoje, regras = REGRAS_ADS, tetoLoja = null, sazonal = null, capacidadeDia = null }) {
  const ss = (semanas || []).map(porSemana).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const empate = roasEmpate(preco, lucro);
  // Ads sazonal (faseAdsSazonal): na temporada o Ads tem que deixar pelo menos
  // metade do lucro — o "mínimo" das decisões vira 2× o equilíbrio.
  const naTemporada = !!sazonal && ["aquecer", "ajustar", "alavancar"].includes(sazonal.fase);
  const minimo = empate ? (naTemporada ? empate * num(regras.metaSazonalFator || 2) : empate) : null;
  const nomeMin = naTemporada ? `o mínimo da temporada (ROAS ${minimo ? um(minimo) : "—"}, metade do lucro)` : `o equilíbrio (ROAS ${empate ? um(empate) : "—"})`;
  const alavancar = sazonal?.fase === "alavancar";
  const rAum = alavancar ? { ...regras, aumento: num(regras.alavancarAumento) || regras.aumento } : regras;
  const ativo = periodoAtivo(periodos, hoje);
  const ultimoFechado = (periodos || []).find((p) => !periodoLigado(p, hoje) && p.fim) || null;
  const base = { empate, minimo, sazonal, ativo, ultimoFechado, preco, lucro };
  const sit = (chave, estado, titulo, texto, extra = {}) => ({ ...base, chave, estado, titulo, texto, ...extra });
  const sugerida = metaSugerida(minimo, regras);

  if (ativo) {
    const { orcamento, meta, ultimoAjuste } = valoresAtuais(ativo);
    const dias = diasEntre(ativo.inicio, hoje);
    const r = resumoPeriodo(ativo, ss, preco, empate, regras);
    // Números do período: o maior entre as semanas e o andamento (CSV) — o que estiver mais completo.
    const aN = andamentoValido(ativo, ss);
    const rN = aN && aN.gasto > r.gasto
      ? { ...r, gasto: aN.gasto, vendas: aN.vendas, cliques: Math.max(r.cliques, aN.cliques), receita: aN.vendas * preco, roas: aN.gasto > 0 ? (aN.vendas * preco) / aN.gasto : null, retorno: retornoAds(aN.gasto > 0 ? (aN.vendas * preco) / aN.gasto : null, empate), custoPorVenda: aN.vendas > 0 ? aN.gasto / aN.vendas : null, fonte: "andamento" }
      : r;
    const numeros = { orcamento, meta, dias, ...rN };
    // Meta alta pra começar (> 2× o equilíbrio) num período sem ajuste: avisa
    // junto de qualquer situação, com o botão "Registrar ajuste: meta X".
    const nAjustes = Array.isArray(ativo.ajustes) ? ativo.ajustes.length : 0;
    const avisoMeta = ativo.tipo !== "teste" && ativo.tipo !== "auto" && !nAjustes && metaAltaDemais(meta, minimo, regras) ? { meta, sugerida } : null;
    const sitA = (chave, estado, titulo, texto, extra = {}) => sit(chave, estado, titulo, texto, { avisoMeta, ...extra });
    // Teste de lançamento: orçamento fechado, regras e resultado na Rampa.
    if (ativo.tipo === "teste") {
      const total = ativo.fim ? diasEntre(ativo.inicio, ativo.fim) + 1 : regras.aprendizadoDias;
      return sit("teste", "decisao", `Teste de lançamento · dia ${Math.min(dias + 1, total)} de ${total}`, `Orçamento fechado${ativo.fim ? ` até ${dm(ativo.fim)}` : ""}: a régua do ROAS não vale durante o teste. Acompanhe e conclua na Rampa; o resultado entra no histórico daqui.`, { numeros });
    }
    if (sazonal && (sazonal.fase === "corte" || sazonal.fase === "depois"))
      return sitA("pausar-corte", "atencao", sazonal.fase === "corte" ? "Corte: pausar o Ads" : "Depois da data: desligar o Ads", sazonal.fase === "corte" ? `A partir de ${dm(sazonal.inicio)} a entrega não chega mais a tempo de ${sazonal.nome}: pause o Ads (Encerrar período).` : `${sazonal.nome} já passou: desligue o Ads até a próxima temporada.`, { numeros });
    // ---- Método do Luan (16/10/2026): pausa, dia 3 sem venda, lance automático ----
    const { automatico } = valoresAtuais(ativo);
    const pz = pausasDoPeriodo(ativo, hoje);
    if (pz.pausado) {
      const dp = diasEntre(pz.pausado.desde, hoje);
      if (dp >= num(regras.pausaLongaDias || 21))
        return sitA("pausa-longa", "atencao", `Pausado há ${dp} dias — a Shopee começa a perder o aprendizado`, `Pausado desde ${dm(pz.pausado.desde)}. Despause (e marque "Despausei") ou, se não vai voltar, encerre o período.`, { numeros, pausado: pz.pausado });
      return dp >= num(regras.pausaLembrarDias || 3)
        ? sitA("despausar", "atencao", "Já revisou? Despause o Ads", `Pausado pra revisar desde ${dm(pz.pausado.desde)} (${dp} dias). Se já arrumou o anúncio, despause na Shopee e marque "Despausei" — a conferência recomeça 3 dias depois da volta.`, { numeros, pausado: pz.pausado })
        : sitA("pausado", "decisao", `Pausado pra revisar desde ${dm(pz.pausado.desde)}`, 'O período continua com as métricas. Depois de arrumar o anúncio, despause na Shopee e marque "Despausei".', { numeros, pausado: pz.pausado });
    }
    const a00 = andamentoValido(ativo, ss);
    // Dias RODANDO (sem as pausas) e vendas desde a última volta.
    const refVolta = pz.ultimaVolta?.data || ativo.inicio;
    const diasRodando = diasEntre(ativo.inicio, hoje) - pz.diasPausados;
    const diasDesdeVolta = diasEntre(refVolta, hoje);
    const vendasTot = Math.max(r.vendas, a00?.vendas || 0);
    const vendasDesdeVolta = pz.ultimaVolta ? Math.max(0, vendasTot - num(pz.ultimaVolta.vendas)) : vendasTot;
    const dia3 = num(regras.diaConferencia || 3);
    // Tem número cobrindo os 3 dias? (andamento até ≥ ref + 2, ou semana registrada depois)
    const temDado = (a00 && a00.ate >= somarDiasIso(refVolta, dia3 - 1)) || semanasNoPeriodo(ss, ativo).some((x) => x.data > somarDiasIso(refVolta, dia3 - 1));
    const limiteRevisao = diasRodando < regras.aprendizadoDias && revisouSemVenda(ativo);
    if (diasDesdeVolta >= dia3 && vendasDesdeVolta === 0 && !limiteRevisao) {
      if (temDado)
        return sitA("sem-venda-dia3", "resolver", `${diasDesdeVolta} dias pagando Ads sem venda — pare e arrume o anúncio`, `O Ads só traz gente até o anúncio; se em ${diasDesdeVolta} dias ninguém comprou, mais dinheiro não resolve. Pause e revise ${anuncio?.porOnde || "a capa, o título, o preço e a descrição"} antes de gastar mais.`, { numeros, semVenda: { dias: diasDesdeVolta, gasto: a00?.gasto ?? r.gasto, cliques: Math.max(r.cliques, a00?.cliques || 0), podeEsperar: diasRodando < regras.aprendizadoDias && !revisouSemVenda(ativo) } });
      if (diasRodando < regras.aprendizadoDias)
        return sitA("conferir-dia3", "atencao", `Dia ${diasRodando + 1}: atualize o andamento`, `Pra saber se o Ads já vendeu: envie o CSV do Shopee Ads (Análise → Importar dados) ou o número à mão em "Atualizar andamento". Sem venda em 3 dias = parar e arrumar o anúncio.`, { numeros });
    }
    // Lance automático: aprende 7 dias (dias rodando), depois vira meta de ROAS.
    if (automatico) {
      if (diasRodando < regras.aprendizadoDias)
        return sitA("auto-aprendendo", "decisao", `Lance automático · dia ${diasRodando + 1} de ${regras.aprendizadoDias}`, `Produto novo no automático: não mexa até o 7º dia. ${vendasTot > 0 ? `Já vendeu ${vendasTot} via Ads ✓.` : "O app confere no dia 3 se vendeu."}`, { numeros, decideEm: somarDiasIso(ativo.inicio, regras.aprendizadoDias + pz.diasPausados) });
      const gastoA = Math.max(r.gasto, a00?.gasto || 0);
      if (!(gastoA > 0)) return sitA("aguardando", "info", "Aguardando números do automático", 'Use "Atualizar andamento" (CSV do Shopee Ads) pra o app dizer a meta de ROAS.', { numeros });
      const roasA = (vendasTot * preco) / gastoA;
      if (minimo && roasA >= minimo) {
        const novaMeta = Math.floor(roasA * 10) / 10;
        return sitA("virar-meta", "oportunidade", `Trocar pra meta de ROAS ${um(novaMeta)}`, `Fim dos ${regras.aprendizadoDias} dias no automático: a Shopee bateu ROAS ${um(roasA)} (${textoRetorno(retornoAds(roasA, empate))}). Na Shopee: editar a campanha → GMV Max – Meta de ROAS → ${um(novaMeta)}, mantendo o orçamento. Daí em diante ele vira "campeão".`, { numeros, novaMeta, roasAuto: roasA });
      }
      return sitA("virar-meta", "atencao", `Não se pagou no aprendizado — meta ${um(sugerida)} ou pause`, `No automático o ROAS ficou ${um(roasA)}, abaixo de ${nomeMin}. Troque pra meta de ROAS ${um(sugerida)} (equilíbrio × 1,3 — nunca uma meta que dê prejuízo) ou pause e arrume o anúncio.`, { numeros, novaMeta: sugerida, roasAuto: roasA });
    }
    // Ritmo (plano 14/10/2026): 7 dias de aprendizado no começo do período;
    // depois de cada ajuste, decide de novo em 3 dias.
    const refDecisao = ultimoAjuste && ultimoAjuste > ativo.inicio ? ultimoAjuste : ativo.inicio;
    const depoisDeAjuste = refDecisao !== ativo.inicio;
    const gapDias = depoisDeAjuste ? (alavancar ? num(regras.alavancarAprendizado) || 3 : num(regras.decisaoDias) || 3) : regras.aprendizadoDias;
    const diasDesde = diasEntre(refDecisao, hoje);
    const a0 = andamentoValido(ativo, ss);
    const totCliques = Math.max(r.cliques, a0?.cliques || 0);
    const totVendas = Math.max(r.vendas, a0?.vendas || 0);
    if (totVendas === 0 && totCliques >= regras.cliquesSemVenda)
      return sitA("pausar-revisar", "resolver", "Pausar e revisar o anúncio", `${totCliques} cliques pagos e nenhuma venda: o Ads está trazendo gente, mas a página não convence. Pause e revise ${anuncio?.porOnde || "foto, descrição, medidas e preço"} antes de gastar mais.`, { numeros });
    if (diasDesde < gapDias)
      return sitA(
        "aprendendo",
        "decisao",
        depoisDeAjuste ? `Depois do ajuste · dia ${diasDesde + 1} de ${gapDias}` : `Aprendendo · dia ${diasDesde + 1} de ${gapDias}`,
        depoisDeAjuste
          ? `Você mudou orçamento/meta em ${dm(refDecisao)}: espere até ${dm(somarDiasIso(refDecisao, gapDias))} pra decidir de novo (a Shopee se ajusta uns dias).`
          : `A plataforma ainda está aprendendo: não mexa na meta nem no orçamento até ${dm(somarDiasIso(refDecisao, gapDias))}. Envie o CSV do Shopee Ads normalmente.`,
        { numeros, decideEm: somarDiasIso(refDecisao, gapDias) }
      );
    if (!empate || empate > regras.roasInviavel)
      return sitA("inviavel-ativo", "atencao", "Ads não se paga neste preço", empate ? `O ROAS de equilíbrio é ${um(empate)}: cada R$ 1 de Ads precisa trazer ${moeda(empate)} em vendas. Pause, a não ser que esteja comprando as primeiras vendas de propósito.` : "Sem lucro neste preço: cada venda via Ads aumenta o prejuízo. Pause.", { numeros });
    // Alavancar (sazonal): exige andamento recente (3–4 dias).
    if (alavancar) {
      if (!a0 || diasEntre(a0.ate, hoje) > num(regras.andamentoMaxDias || 4))
        return sitA("atualizar-andamento", "atencao", "Atualizar o andamento do Ads", `Fase Alavancar (${sazonal.nome}): a decisão é a cada 3–4 dias pelo andamento. ${a0 ? `O último é de ${dm(a0.ate)}.` : "Ainda não tem andamento."} Use "Atualizar andamento" no topo do Ads (gasto, cliques e vendas via Ads desde o início do período).`, { numeros });
    }
    const m = medidaDaDecisao(ativo, ss, refDecisao, gapDias, preco);
    if (!m) return sitA("aguardando", "info", depoisDeAjuste ? "Aguardando números depois do ajuste" : "Aguardando números depois do aprendizado", 'Envie o CSV do Shopee Ads em Análise → Importar dados pra avaliar.', { numeros });
    const roas = m.roas;
    const retorno = retornoAds(roas, minimo);
    const lucroReal = retornoAds(roas, empate);
    const usoOrc = orcamento ? m.gasto / (orcamento * m.dias) : null;
    const ult = m.semana || null;
    const organico = ult && vendasParaDecisao(ult) > 0 ? Math.max(0, vendasParaDecisao(ult) - num(ult.ads_vendas)) / vendasParaDecisao(ult) : null;
    const quando = m.fonte === "andamento" ? `no andamento até ${dm(m.ate)}` : "na última semana";
    const const3 = m.fonte === "andamento" ? constanciaAds(ativo, regras) : null;
    const semana = { ...numeros, roasSemana: roas, gastoSemana: m.gasto, usoOrc, organico, medida: m, retorno, lucroPorReal: lucroReal, constancia: const3, andamento: m.fonte === "andamento" ? a0 : null };
    const retTxt = lucroReal != null ? ` (${textoRetorno(lucroReal)})` : "";
    const depois = (m.depois || semanasNoPeriodo(ss, ativo).filter((s) => s.data > somarDiasIso(refDecisao, gapDias - 1) && num(s.ads_gasto) > 0)).slice(-2);
    const abaixo2 = depois.length === 2 && depois.every((s) => (roasDe(s, preco) ?? 0) < minimo) && (roas ?? 0) < minimo;
    if (abaixo2) return sitA("pausar", "atencao", "Pausar o Ads", `ROAS abaixo de ${nomeMin} por 2 semanas: o Ads está tirando lucro. Pause e tente de novo depois de arrumar o anúncio ou o preço.`, { numeros: semana });

    // Abaixo do equilíbrio: 3 saídas.
    if (roas == null || roas < minimo) {
      const conv = m.cliques > 0 ? m.vendas / m.cliques : null;
      if (m.cliques >= num(regras.cliquesConversao || 30) && conv != null && conv < num(regras.conversaoMin || 0.01))
        return sitA("arrumar-anuncio", "atencao", "Muitos cliques, poucas vendas: arrume o anúncio", `ROAS ${um(roas)} ${quando}, abaixo de ${nomeMin}, com ${m.cliques} cliques e ${m.vendas} venda${m.vendas === 1 ? "" : "s"} (${(conv * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% de conversão): o Ads traz gente, a página não convence. Comece por ${anuncio?.porOnde || "foto, preço, medidas e descrição"} (veja o Funil do anúncio na Rampa) antes de mexer no Ads.`, { numeros: semana });
      if (!orcamento || orcamento <= num(regras.minDiario) + 0.004) {
        const novaMeta = Math.max(sugerida || 0, meta ? Math.ceil(meta * 1.2 * 10) / 10 : 0);
        return sitA("subir-meta", "atencao", `Subir a meta pra ${um(novaMeta)} ou pausar`, `ROAS ${um(roas)} ${quando}, abaixo de ${nomeMin}, e o orçamento já está no mínimo da Shopee (${moeda(regras.minDiario)}/dia). Suba a meta (ROAS alvo) pra ${um(novaMeta)} — a Shopee fica mais seletiva e só entrega pra quem tem mais chance de comprar — ou pause.`, { numeros: semana, novaMeta });
      }
      const novoOrc = Math.max(num(regras.minDiario), Math.floor(orcamento * 0.8));
      return sitA("reduzir", "atencao", `Reduzir o orçamento pra ${moeda(novoOrc)}/dia`, `ROAS ${um(roas)} ${quando}, abaixo de ${nomeMin}. Reduza ~20% (de ${moeda(orcamento)} pra ${moeda(novoOrc)}/dia) ou suba a meta. Se repetir, pause.`, { numeros: semana, novoOrcamento: novoOrc });
    }
    // A Shopee não está gastando o orçamento: a meta está segurando a entrega.
    if (usoOrc != null && usoOrc < regras.gastoBaixo) {
      const novaMeta = meta ? Math.max(minimo, Math.round(meta * 0.9 * 10) / 10) : null;
      return novaMeta && meta && novaMeta < meta - 0.05
        ? sitA("meta-alta", "info", `Baixe a meta pra ${um(novaMeta)}`, `Gastou só ${Math.round(usoOrc * 100)}% do orçamento ${quando}: a meta ${um(meta)} está deixando a Shopee seletiva demais. Baixe ~10% pra ${um(novaMeta)} (mais alcance; nunca abaixo de ${nomeMin}).${retTxt}`, { numeros: semana, novaMeta })
        : sitA("pouca-procura", "info", "Pouca entrega mesmo no equilíbrio", `Gastou só ${Math.round(usoOrc * 100)}% do orçamento com a meta já no equilíbrio: pouca procura pra esse produto. Mantenha ou pause.${retTxt}`, { numeros: semana });
    }
    if (!naTemporada && organico != null && organico >= regras.organicoAlto && depois.length >= 2)
      return sitA("reduzir-aos-poucos", "info", "Reduzir aos poucos", `${Math.round(organico * 100)}% das vendas já são orgânicas: o Ads cumpriu o papel. Corte ~20% por semana e veja se as vendas se mantêm.`, { numeros: semana });
    // Constância: vendas via Ads subiram muito e a farm não acompanha → segurar.
    if (const3 && const3.variacao >= num(regras.constanciaAlta || 0.5) && capacidadeDia != null && const3.agora > capacidadeDia)
      return sitA("segurar-producao", "atencao", "Segurar: a produção não acompanha", `As vendas via Ads subiram ${Math.round(const3.variacao * 100)}% nos últimos 3 dias (${um(const3.agora)}/dia) e a farm faz ~${capacidadeDia} por dia deste item. Mantenha o orçamento até a produção dar conta.${retTxt}`, { numeros: semana });
    const passo = passoDaEscada(retorno, rAum);
    const caiu = const3 && const3.variacao <= -num(regras.constanciaQueda || 0.3);
    const cheio = usoOrc == null || usoOrc >= regras.gastoCheio;
    if (passo > 0 && (cheio || caiu)) {
      // Escada: +20% / +30% (máximo) — sempre dentro do teto da loja.
      let p = alavancar ? Math.max(passo, rAum.aumento) : passo;
      let novo = Math.ceil(num(orcamento) * (1 + p));
      if (tetoLoja && tetoLoja.passaria((novo - orcamento) * 30) && p > (num(regras.aumento) || 0.2) + 1e-9) {
        p = num(regras.aumento) || 0.2;
        novo = Math.ceil(num(orcamento) * (1 + p));
      }
      if (tetoLoja && tetoLoja.passaria((novo - orcamento) * 30))
        return sitA("teto", "info", "Bom resultado, mas no teto da loja", `ROAS ${um(roas)} ${quando}${retTxt}, mas aumentar passaria do teto de Ads da loja (${moeda(tetoLoja.teto)} no mês, fase ${tetoLoja.fase}). Mantenha ${moeda(orcamento)}/dia.`, { numeros: semana });
      const rotulo = `Aumentar ${Math.round(p * 100)}%`;
      const motivo = caiu && !cheio ? ` As vendas via Ads caíram ${Math.round(-const3.variacao * 100)}% nos últimos 3 dias com o retorno bom: mais verba recupera o ritmo.` : ` Gastou ${Math.round((usoOrc ?? 1) * 100)}% do orçamento.`;
      return sitA("aumentar", "oportunidade", `${rotulo} → ${moeda(novo)}/dia`, `ROAS ${um(roas)} ${quando} = ${um(retorno)}× ${naTemporada ? "o mínimo da temporada" : "o equilíbrio"}${retTxt}.${motivo} Suba de ${moeda(orcamento)} pra ${moeda(novo)}/dia e reavalie em ${alavancar ? 3 : num(regras.decisaoDias) || 3} dias.`, { numeros: semana, novoOrcamento: novo, passo: p });
    }
    if (passo > 0)
      return sitA("manter", "ok", "Manter", `ROAS ${um(roas)} ${quando}${retTxt}, mas a Shopee gastou só ${Math.round(usoOrc * 100)}% do orçamento: aumentar agora não adianta. Mantenha.`, { numeros: semana });
    return sitA("manter", "ok", "Manter", `ROAS ${um(roas)} ${quando}, entre ${nomeMin} e 1,2× ele${retTxt}. Mantenha orçamento e meta.`, { numeros: semana });
  }

  // ---- Sem Ads ligado ----
  if (sazonal && (sazonal.fase === "corte" || sazonal.fase === "depois"))
    return sit("fora-janela", "info", sazonal.fase === "corte" ? "Corte: não ligar o Ads" : "Depois da data", sazonal.fase === "corte" ? `A entrega não chega mais a tempo de ${sazonal.nome}. Ads só na próxima temporada.` : `${sazonal.nome} já passou: Ads desligado até a próxima temporada.`);
  if (sazonal && sazonal.fase === "fora")
    return sit("fora-temporada", "info", "Fora da temporada", `Produto de ${sazonal.nome}: Ads a partir de ${dm(sazonal.datas.aquecer)} (Aquecer — R$ ${regras.minDiario}/dia pra plataforma aprender).`);
  if (!empate || empate > regras.roasInviavel) {
    const v = precoViavel(preco, lucroEm, regras);
    return sit("nao-viavel", "info", "Ads não compensa neste preço", `${empate ? `ROAS de equilíbrio ${um(empate)} (lucro ${moeda(lucro)} por venda)` : "Sem lucro neste preço"}: o Ads não se paga.${v ? ` Passa a ser viável a partir de ${moeda(v.preco)} (equilíbrio ${um(v.empate)}).` : ""} Cresça no orgânico.`, { viavel: v });
  }
  if (anuncio) return sit("arrumar", "atencao", "Arrume o anúncio antes", `${anuncio.titulo || "O anúncio precisa de revisão"}: o Ads só amplifica o que já converte. Comece por: ${anuncio.porOnde || "foto, título e descrição"}.`);
  if (ultimoFechado && diasEntre(ultimoFechado.fim, hoje) < regras.diasTentarDeNovo) {
    const r = resumoPeriodo(ultimoFechado, ss, preco, empate, regras);
    if (r.resultado && r.resultado.chave !== "valeu")
      return sit("aguardar", "info", "Último período não se pagou", `${dm(ultimoFechado.inicio)}–${dm(ultimoFechado.fim)}: ROAS ${r.roas != null ? um(r.roas) : "—"} (${r.resultado.texto}). Tente de novo a partir de ${dm(somarDiasIso(ultimoFechado.fim, regras.diasTentarDeNovo))} ou antes, se mudar preço, fotos ou avaliações.`, { ultimo: r });
  }
  if (naTemporada)
    return sit("ligar-sazonal", "oportunidade", `${sazonal.titulo}: ligar o Ads`, `${sazonal.nome}: ${sazonal.texto} Comece com ${moeda(regras.minDiario)}/dia e meta ${um(sugerida)} (deixa pelo menos metade do lucro de cada venda).`);
  const ult2 = ss.slice(-2);
  const organicas = ult2.length ? ult2.reduce((t, s) => t + Math.max(0, vendasParaDecisao(s) - num(s.ads_vendas)), 0) / ult2.length : 0;
  if (organicas >= regras.vendeSozinho)
    return sit("sem-necessidade", "ok", "Vende sozinho", `${um(organicas)} vendas orgânicas por semana: Ads é opcional. Se quiser acelerar, comece com ${moeda(regras.minDiario)}/dia e meta ${um(sugerida)} (equilíbrio ${um(empate)} × 1,3).`);
  return sit("pode", "oportunidade", "Pode impulsionar", `${ss.length ? "" : "Sem vendas registradas ainda. "}ROAS de equilíbrio ${um(empate)}: comece com ${moeda(regras.minDiario)}/dia e meta ${um(sugerida)} (equilíbrio × 1,3), 7 dias sem mexer.`);
}

// Produção (Minha farm): peças por dia que a farm faz de UM produto (todas as
// impressoras ativas × horas/dia ÷ tempo por peça). Só informa.
export function pecasPorDia(produto, impressoras, farmConfig) {
  if (!produto) return null;
  const min = num(produto.tempo_impressao_horas) > 0 ? num(produto.tempo_impressao_horas) * 60 : num(produto.producao_detalhe?.tempo);
  const porPeca = min > 0 ? min / Math.max(1, num(produto.pecas_por_impressao) || 1) : 0;
  const ativas = (impressoras || []).filter((i) => i.ativa !== false).length || 1;
  const horas = num(farmConfig?.horas_dia_operacao) || 8;
  return porPeca > 0 ? Math.floor((ativas * horas * 60) / porPeca) : null;
}
// Quantos deste item (produto, variação ou kit) a farm faz por dia.
export function capacidadeDoItem(item, produtos, impressoras, farmConfig) {
  if (!item) return null;
  if (item.id.startsWith("k:")) {
    const caps = (item.componentes || []).map((c) => {
      const cap = pecasPorDia(produtos.find((p) => p.id === c.produtoId), impressoras, farmConfig);
      return cap != null ? cap / Math.max(1, num(c.quantidade) || 1) : null;
    });
    return caps.length && caps.every((c) => c != null) ? Math.floor(Math.min(...caps)) : null;
  }
  const pid = item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId;
  const cap = pecasPorDia(produtos.find((p) => p.id === pid), impressoras, farmConfig);
  const pecas = Math.max(1, num(item.pecas) || 1);
  return cap != null ? Math.floor(cap / pecas) : null;
}

// Início (plano 14/10/2026): UM aviso "Atualizar o andamento do Ads — último
// envio há N dias" quando o envio MAIS ANTIGO entre os itens com Ads ligado
// (fora o teste de lançamento) tem mais de `andamentoAvisoDias` (3) dias.
// Item sem nenhum envio conta desde o início do período.
export function andamentoAtrasado(periodos, hoje, regras = REGRAS_ADS) {
  let pior = null;
  for (const p of periodos || []) {
    if (!periodoLigado(p, hoje) || p.tipo === "teste" || pausasDoPeriodo(p, hoje).pausado) continue;
    const ref = p.parcial?.ate || p.inicio;
    if (!ref) continue;
    const dias = diasEntre(ref, hoje) - (p.parcial?.ate ? 1 : 0);
    if (!pior || dias > pior.dias) pior = { dias, periodo: p, semEnvio: !p.parcial?.ate };
  }
  return pior && pior.dias > num(regras.andamentoAvisoDias || 3) ? pior : null;
}

// Ads numa janela [de, ate] (teto da loja, Ads na semana, Vendas do mês,
// TACoS — 16/10/2026, "ao vivo"): por período, o MAIOR entre as semanas
// registradas que caem na janela e o ANDAMENTO (CSV/à mão) — só a parte
// dentro da janela: tira as semanas do período que terminaram antes; sem elas
// e começando antes da janela, conta proporcional aos dias. `semanas` =
// registros do item. → { gasto, vendas (via Ads), fonte 'csv'|'semanas'|null, ate }.
export function adsNaJanela(periodos, semanas, de, ate) {
  const noJanela = (semanas || []).filter((s) => {
    const fim = somarDiasIso(String(s.data).slice(0, 10), -1);
    return fim >= de && fim <= ate;
  });
  const sem = { gasto: noJanela.reduce((t, s) => t + num(s.ads_gasto), 0), vendas: noJanela.reduce((t, s) => t + num(s.ads_vendas), 0) };
  const csv = { gasto: 0, vendas: 0, ate: null };
  for (const p of periodos || []) {
    const par = p?.parcial;
    if (!par?.ate || !(num(par.gasto) > 0) || par.ate < de || p.inicio > ate) continue;
    const antes = semanasNoPeriodo(semanas || [], p).filter((s) => somarDiasIso(String(s.data).slice(0, 10), -1) < de);
    let g = num(par.gasto);
    let v = num(par.vendas);
    if (antes.length) {
      g = Math.max(0, g - antes.reduce((t, s) => t + num(s.ads_gasto), 0));
      v = Math.max(0, v - antes.reduce((t, s) => t + num(s.ads_vendas), 0));
    } else if (p.inicio < de) {
      const total = diasEntre(p.inicio, par.ate) + 1;
      const dentro = Math.max(0, diasEntre(de, par.ate) + 1);
      g = total > 0 ? (g * dentro) / total : 0;
      v = total > 0 ? (v * dentro) / total : 0;
    }
    csv.gasto += g;
    csv.vendas += v;
    if (!csv.ate || par.ate > csv.ate) csv.ate = par.ate;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  if (csv.gasto >= sem.gasto && csv.gasto > 0) return { gasto: r2(csv.gasto), vendas: r2(csv.vendas), fonte: "csv", ate: csv.ate };
  if (sem.gasto > 0) return { gasto: r2(sem.gasto), vendas: r2(sem.vendas), fonte: "semanas", ate: null };
  return { gasto: 0, vendas: 0, fonte: null, ate: null };
}
export const gastoAdsNaJanela = (periodos, semanas, de, ate) => adsNaJanela(periodos, semanas, de, ate).gasto;

// ---- GMV Max da Loja (16/10/2026, schema v57: item_tipo 'loja') ----
// Campanha da loja inteira (produtos "reserva"): meta alta, orçamento
// ilimitado. O app só acompanha se vende e se vale a pena: ROAS (vendas em
// R$ ÷ gasto, pelo andamento — parcial.receita) × EQUILÍBRIO DA LOJA
// (faturamento ÷ lucro antes do Ads dos últimos 30 dias). Proporcional: vale
// igual pra loja pequena ou grande.
export function avaliarAdsLoja({ periodos = [], equilibrio, hoje, regras = REGRAS_ADS }) {
  const ativo = periodoAtivo(periodos, hoje);
  const base = { ativo, empate: equilibrio || null, minimo: equilibrio || null, loja: true };
  const sit = (chave, estado, titulo, texto, extra = {}) => ({ ...base, chave, estado, titulo, texto, ...extra });
  const metaAlta = equilibrio ? Math.ceil(equilibrio * num(regras.lojaMetaFator || 2) * 10) / 10 : null;
  if (!ativo)
    return sit("loja-desligada", "info", "Desligada", `Campanha da loja (GMV Max da Loja) pros produtos sem Ads próprio: meta alta${metaAlta ? ` (≈ ${um(metaAlta)}, 2× o equilíbrio da loja ${um(equilibrio)})` : ""} e orçamento ilimitado — a Shopee só gasta quando acha venda boa.`, { metaSugerida: metaAlta });
  const { meta } = valoresAtuais(ativo);
  const pz = pausasDoPeriodo(ativo, hoje);
  const dias = diasEntre(ativo.inicio, hoje) - pz.diasPausados;
  const par = ativo.parcial?.ate ? ativo.parcial : null;
  const gasto = num(par?.gasto);
  const receita = num(par?.receita);
  const roas = gasto > 0 ? receita / gasto : null;
  const retorno = retornoAds(roas, equilibrio);
  const numeros = { dias, gasto, receita, vendas: num(par?.vendas), cliques: num(par?.cliques), roas, retorno, ate: par?.ate || null, meta };
  if (pz.pausado && diasEntre(pz.pausado.desde, hoje) >= num(regras.pausaLongaDias || 21))
    return sit("pausa-longa", "atencao", `Pausada há ${diasEntre(pz.pausado.desde, hoje)} dias — a Shopee começa a perder o aprendizado`, 'Despause (e marque "Despausei") ou, se não vai voltar, encerre o período.', { numeros, pausado: pz.pausado });
  if (pz.pausado) return sit("pausado", "decisao", `Pausada desde ${dm(pz.pausado.desde)}`, 'Quando religar na Shopee, marque "Despausei".', { numeros, pausado: pz.pausado });
  if (dias < regras.aprendizadoDias)
    return sit("aprendendo", "decisao", `Aprendendo · dia ${dias + 1} de ${regras.aprendizadoDias}`, `Não mexa na meta até ${dm(somarDiasIso(ativo.inicio, regras.aprendizadoDias + pz.diasPausados))}.`, { numeros, decideEm: somarDiasIso(ativo.inicio, regras.aprendizadoDias + pz.diasPausados) });
  if (!par) return sit("aguardando", "atencao", "Atualizar o andamento da campanha da loja", 'Informe gasto e vendas (R$) da campanha da loja desde o início em "Atualizar andamento" (CSV do Shopee Ads ou à mão).', { numeros });
  const diasPar = Math.max(1, diasEntre(ativo.inicio, par.ate) + 1);
  if (diasPar >= 7 && gasto / diasPar < num(regras.lojaGastoMinDia || 1)) {
    const novaMeta = meta ? Math.max(equilibrio || 0, Math.round(meta * 0.9 * 10) / 10) : null;
    return sit("loja-nao-gasta", "info", novaMeta ? `Quase não gasta — baixe a meta pra ${um(novaMeta)}` : "Quase não gasta", `Gastou ${moeda(gasto)} em ${diasPar} dias: a meta está alta demais e a Shopee quase não entrega. Baixe ~10% (nunca abaixo do equilíbrio da loja ${um(equilibrio)}).`, { numeros, novaMeta });
  }
  if (!equilibrio) return sit("manter", "ok", "Acompanhando", `ROAS ${um(roas)} — sem vendas importadas pra calcular o equilíbrio da loja.`, { numeros });
  if (roas == null || roas < equilibrio) {
    if (diasPar >= 14) {
      const novaMeta = meta ? Math.ceil(Math.max(meta * 1.2, equilibrio * 1.3) * 10) / 10 : Math.ceil(equilibrio * 1.3 * 10) / 10;
      return sit("loja-abaixo", "atencao", `Abaixo do equilíbrio — suba a meta pra ${um(novaMeta)} ou pause`, `ROAS ${um(roas)} em ${diasPar} dias, abaixo do equilíbrio da loja (${um(equilibrio)}): a campanha está tirando lucro.`, { numeros, novaMeta });
    }
    return sit("manter", "info", "Abaixo do equilíbrio — acompanhe", `ROAS ${um(roas)} em ${diasPar} dias, abaixo do equilíbrio da loja (${um(equilibrio)}). Com 2 semanas abaixo, o app sugere subir a meta ou pausar.`, { numeros });
  }
  return sit("loja-vale", "ok", "Vale a pena", `ROAS ${um(roas)} · equilíbrio da loja ${um(equilibrio)} · ${textoRetorno(retorno)}.`, { numeros });
}
