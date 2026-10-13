// Ads — conta ÚNICA de "vale usar Ads neste produto? aumento, mantenho,
// reduzo ou pauso?" (out/2026, schema v44). Funções puras: recebem os
// registros semanais do item (rampa_registros ou afiliado_registros fora de
// rampa), os períodos de Ads (ads_periodos) e o lucro no preço; devolvem UMA
// situação com o motivo escrito. Quem mostra: Crescimento → Ads, cartão de Ads
// do Detalhe da Rampa e o Início. Ads é custo de venda, não entra no preço.
//
// Método (combinado com o Gustavo, vídeo "Ads não é milagre, é método"):
// 1) 7 dias de aprendizado sem mexer em meta nem orçamento;
// 2) depois, uma decisão por semana: ROAS ≥ meta e gastou quase tudo →
//    aumentar 20% (no máx. 1× por semana); entre o empate e a meta → manter;
//    abaixo do empate → reduzir/subir a meta, 2 semanas → pausar; muitos
//    cliques sem venda → pausar e revisar o anúncio;
// 3) Ads da loja ≤ teto (% do faturamento da semana).
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
  aumento: 0.2, // degrau de aumento do orçamento por semana
  tetoLoja: 0.15, // Ads da semana ≤ 15% do faturamento da semana (loja)
  roasInviavel: 8, // empate acima disso = Ads não se paga neste preço
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
  metaSazonalFator: 2, // Ads sazonal deixa ≥ metade do lucro: meta mínima = 2× o empate
  alavancarAumento: 0.3, // no Alavancar o aumento pode ser de até 30%
  alavancarAprendizado: 3, // e decide a cada 3 dias (pelo andamento)
  andamentoMaxDias: 4, // andamento mais velho que isso: atualize antes de decidir
  // Teto de Ads da loja (out/2026): progressivo pelo faturamento dos últimos
  // 30 dias — cada % vale só pro pedaço da faixa (como imposto de renda) — e
  // NUNCA mais que travaLucro × o lucro dos últimos 30 dias.
  faixasTeto: [
    { ate: 1000, pct: 0.15 },
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
// Teto do mês pelas faixas (cada % sobre o pedaço dentro da faixa).
export function tetoPorFaixas(faturamento, faixas = REGRAS_ADS.faixasTeto) {
  let total = 0;
  let de = 0;
  for (const f of faixas) {
    const ate = f.ate == null ? Infinity : num(f.ate);
    if (faturamento <= de) break;
    total += (Math.min(faturamento, ate) - de) * num(f.pct);
    de = ate;
  }
  return Math.round(total * 100) / 100;
}
// Teto de Ads da loja: { faturamento, lucro, gasto (30 dias), fase, pelaTabela, pelaTrava, teto, pct, acimaTeto, passaria(extraNoMes) }.
export function tetoDaLoja({ faturamento = 0, lucro = 0, gasto = 0, regras = REGRAS_ADS }) {
  const pelaTabela = tetoPorFaixas(faturamento, regras.faixasTeto || REGRAS_ADS.faixasTeto);
  const pelaTrava = Math.max(0, num(regras.travaLucro) * lucro);
  const teto = Math.min(pelaTabela, pelaTrava);
  return {
    faturamento,
    lucro,
    gasto,
    fase: faseDaLoja(faturamento),
    pelaTabela,
    pelaTrava,
    teto,
    limitadoPelaTrava: pelaTrava < pelaTabela - 0.005,
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

// ROAS de empate = preço ÷ lucro antes do Ads.
export const roasEmpate = (preco, lucro) => (lucro > 0 && preco > 0 ? preco / lucro : null);
// Meta sugerida pra começar: o empate arredondado pra cima (1 casa).
export const metaSugerida = (empate) => (empate ? Math.ceil(empate * 10) / 10 : null);
export const valorAumento = (orc, regras = REGRAS_ADS) => Math.ceil(num(orc) * (1 + regras.aumento));

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
export function valoresAtuais(periodo) {
  const aj = Array.isArray(periodo?.ajustes) ? periodo.ajustes : [];
  const ult = aj[aj.length - 1] || {};
  return {
    orcamento: num(ult.orcamento ?? periodo?.orcamento_diario) || null,
    meta: num(ult.meta ?? periodo?.meta_roas) || null,
    ultimoAjuste: ult.data || null,
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
// do Shopee Ads). Cada envio substitui o anterior. Só vale enquanto nenhuma
// semana registrada cobrir essas datas — a semana registrada prevalece.
// Só informa: nenhuma decisão (avaliarAds) usa o andamento.
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

// O que falta registrar na semana: andamento − o que já está nas semanas do período.
export function andamentoParaSemana(periodo, semanas) {
  const a = andamentoValido(periodo, semanas);
  if (!a) return null;
  const ss = semanasNoPeriodo(semanas || [], periodo);
  const soma = (k) => ss.reduce((t, s) => t + num(s[k]), 0);
  const r = (v) => Math.max(0, Math.round(v * 100) / 100);
  return { ate: a.ate, gasto: r(a.gasto - soma("ads_gasto")), cliques: r(a.cliques - soma("ads_cliques")), adsVendas: r(a.vendas - soma("ads_vendas")) };
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
    else if (empate && roas >= empate) resultado = { chave: "valeu", texto: "pagou o Ads" };
    else if (empate && roas >= empate * 0.7) resultado = { chave: "aceitavel", texto: "perto do empate" };
    else resultado = { chave: "caro", texto: "não se pagou" };
  }
  return { semanas: ss.length, gasto, vendas, cliques, receita, roas, custoPorVenda: vendas > 0 ? gasto / vendas : null, resultado };
}

// Menor preço (passos de R$0,50, até 3× o atual) em que o Ads passa a ser
// viável (empate ≤ roasInviavel).
function precoViavel(preco, lucroEm, regras) {
  if (!lucroEm) return null;
  for (let p = Math.ceil(preco * 2) / 2; p <= preco * 3; p += 0.5) {
    const l = lucroEm(p);
    if (l > 0 && p / l <= regras.roasInviavel) return { preco: p, empate: p / l };
  }
  return null;
}

// A avaliação. `semanas` = registros semanais do item (tipo semana, em ordem
// de data, qualquer formato com vendas/ads_*/data/periodo_inicio).
// `anuncio` = aviso de Revisar anúncio da Rampa (funil/teste), se houver.
export function avaliarAds({ preco, lucro, lucroEm = null, semanas = [], periodos = [], anuncio = null, hoje, regras = REGRAS_ADS, tetoLoja = null, sazonal = null }) {
  const ss = (semanas || []).map(porSemana).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const empate = roasEmpate(preco, lucro);
  // Ads sazonal (faseAdsSazonal): na temporada o Ads tem que deixar pelo menos
  // metade do lucro — o "mínimo" das decisões vira 2× o empate.
  const naTemporada = !!sazonal && ["aquecer", "ajustar", "alavancar"].includes(sazonal.fase);
  const minimo = empate ? (naTemporada ? empate * num(regras.metaSazonalFator || 2) : empate) : null;
  const nomeMin = naTemporada ? `o mínimo da temporada (ROAS ${minimo ? um(minimo) : "—"}, metade do lucro)` : `o empate (${empate ? um(empate) : "—"})`;
  const alavancar = sazonal?.fase === "alavancar";
  const rAum = alavancar ? { ...regras, aumento: num(regras.alavancarAumento) || regras.aumento } : regras;
  const pctAum = Math.round(rAum.aumento * 100);
  const ativo = periodoAtivo(periodos, hoje);
  const ultimoFechado = (periodos || []).find((p) => !periodoLigado(p, hoje) && p.fim) || null;
  const base = { empate, minimo, sazonal, ativo, ultimoFechado, preco, lucro };
  const sit = (chave, estado, titulo, texto, extra = {}) => ({ ...base, chave, estado, titulo, texto, ...extra });

  if (ativo) {
    const { orcamento, meta, ultimoAjuste } = valoresAtuais(ativo);
    const dias = diasEntre(ativo.inicio, hoje);
    const r = resumoPeriodo(ativo, ss, preco, empate, regras);
    const numeros = { orcamento, meta, dias, ...r };
    // Desde o último ajuste (ou início), conta de novo o aprendizado.
    const refAprend = ultimoAjuste && ultimoAjuste > ativo.inicio ? ultimoAjuste : ativo.inicio;
    // Teste de lançamento: orçamento fechado, regras e resultado na Rampa.
    if (ativo.tipo === "teste") {
      const total = ativo.fim ? diasEntre(ativo.inicio, ativo.fim) + 1 : regras.aprendizadoDias;
      return sit("teste", "decisao", `Teste de lançamento · dia ${Math.min(dias + 1, total)} de ${total}`, `Orçamento fechado${ativo.fim ? ` até ${dm(ativo.fim)}` : ""}: a régua do ROAS não vale durante o teste. Acompanhe e conclua na Rampa; o resultado entra no histórico daqui.`, { numeros });
    }
    if (sazonal && (sazonal.fase === "corte" || sazonal.fase === "depois"))
      return sit("pausar-corte", "atencao", sazonal.fase === "corte" ? "Corte: pausar o Ads" : "Depois da data: desligar o Ads", sazonal.fase === "corte" ? `A partir de ${dm(sazonal.inicio)} a entrega não chega mais a tempo de ${sazonal.nome}: pause o Ads (Encerrar período).` : `${sazonal.nome} já passou: desligue o Ads até a próxima temporada.`, { numeros });
    // No Alavancar, depois de um ajuste a reavaliação é a cada 3 dias.
    const diasAprendMin = alavancar && ultimoAjuste && ultimoAjuste > ativo.inicio ? num(regras.alavancarAprendizado) || 3 : regras.aprendizadoDias;
    const diasAprend = diasEntre(refAprend, hoje);
    if (r.vendas === 0 && r.cliques >= regras.cliquesSemVenda)
      return sit("pausar-revisar", "resolver", "Pausar e revisar o anúncio", `${r.cliques} cliques pagos e nenhuma venda: o Ads está trazendo gente, mas a página não convence. Pause e revise foto, descrição, medidas e preço antes de gastar mais.`, { numeros });
    if (diasAprend < diasAprendMin)
      return sit("aprendendo", "decisao", `Aprendendo · dia ${diasAprend + 1} de ${diasAprendMin}`, `A plataforma ainda está aprendendo${refAprend !== ativo.inicio ? " depois do último ajuste" : ""}: não mexa na meta nem no orçamento até ${dm(somarDiasIso(refAprend, diasAprendMin))}. Registre a semana normalmente.`, { numeros });
    if (!empate || empate > regras.roasInviavel)
      return sit("inviavel-ativo", "atencao", "Ads não se paga neste preço", empate ? `O empate é ROAS ${um(empate)}: cada R$ 1 de Ads precisa trazer ${moeda(empate)} em vendas. Pause, a não ser que esteja comprando as primeiras vendas de propósito.` : "Sem lucro neste preço: cada venda via Ads aumenta o prejuízo. Pause.", { numeros });
    // Alavancar: decide pelo ANDAMENTO (acumulado do período), atualizado a cada 3–4 dias.
    if (alavancar) {
      const a = andamentoValido(ativo, ss);
      if (!a || diasEntre(a.ate, hoje) > num(regras.andamentoMaxDias || 4))
        return sit("atualizar-andamento", "atencao", "Atualizar o andamento do Ads", `Fase Alavancar (${sazonal.nome}): a decisão é a cada 3–4 dias pelo andamento. ${a ? `O último é de ${dm(a.ate)}.` : "Ainda não tem andamento."} Use "Atualizar andamento" no topo do Ads (gasto, cliques e vendas via Ads desde o início do período).`, { numeros });
      const roasA = a.gasto > 0 ? (a.vendas * preco) / a.gasto : null;
      const diasPer = Math.max(1, diasEntre(ativo.inicio, a.ate) + 1);
      const usoA = orcamento ? a.gasto / (orcamento * diasPer) : null;
      const num2 = { ...numeros, roasSemana: roasA, gastoSemana: a.gasto, usoOrc: usoA, andamento: a };
      if (roasA == null || roasA < minimo)
        return sit("reduzir", "atencao", "Reduzir 20% ou subir a meta", `ROAS ${roasA != null ? um(roasA) : "—"} no andamento até ${dm(a.ate)}, abaixo de ${nomeMin}. Reduza o orçamento ~20% (pra ${moeda(Math.max(regras.minDiario, Math.floor((orcamento || regras.minDiario) * 0.8)))}/dia) ou suba a meta.`, { numeros: num2 });
      if (meta && roasA >= meta && (usoA == null || usoA >= regras.gastoCheio)) {
        const novo = valorAumento(orcamento, rAum);
        if (tetoLoja && tetoLoja.passaria((novo - orcamento) * 30))
          return sit("teto", "info", "Bom resultado, mas no teto da loja", `ROAS ${um(roasA)} ≥ meta ${um(meta)}, mas aumentar passaria do teto de Ads da loja (${moeda(tetoLoja.teto)} no mês). Mantenha ${moeda(orcamento)}/dia.`, { numeros: num2 });
        return sit("aumentar", "oportunidade", `Aumentar ${pctAum}% → ${moeda(novo)}/dia`, `Alavancar (${sazonal.nome}): ROAS ${um(roasA)} ≥ meta ${um(meta)} no andamento até ${dm(a.ate)}. Suba de ${moeda(orcamento)} pra ${moeda(novo)}/dia e reavalie em 3 dias.`, { numeros: num2, novoOrcamento: novo });
      }
      return sit("manter", "ok", "Manter", `ROAS ${um(roasA)} acima de ${nomeMin}${meta ? `, meta ${um(meta)}` : ""} no andamento até ${dm(a.ate)}. Mantenha e atualize de novo em 3–4 dias.`, { numeros: num2 });
    }
    // Semanas depois do aprendizado (só as que já tiveram gasto).
    const depois = semanasNoPeriodo(ss, ativo).filter((s) => s.data > somarDiasIso(refAprend, regras.aprendizadoDias - 1) && num(s.ads_gasto) > 0);
    const ult = depois[depois.length - 1];
    if (!ult) return sit("aguardando", "info", "Aguardando a 1ª semana depois do aprendizado", "Registre a semana (ou importe os relatórios da Shopee) pra avaliar.", { numeros });
    const roas = roasDe(ult, preco);
    const ult2 = depois.slice(-2);
    const abaixo2 = ult2.length === 2 && ult2.every((s) => (roasDe(s, preco) ?? 0) < minimo);
    const gastoSemana = num(ult.ads_gasto);
    const usoOrc = orcamento ? gastoSemana / (orcamento * 7) : null;
    const organico = vendasParaDecisao(ult) > 0 ? Math.max(0, vendasParaDecisao(ult) - num(ult.ads_vendas)) / vendasParaDecisao(ult) : null;
    const semana = { ...numeros, roasSemana: roas, gastoSemana, usoOrc, organico };
    if (abaixo2) return sit("pausar", "atencao", "Pausar o Ads", `ROAS abaixo de ${nomeMin} por 2 semanas: o Ads está tirando lucro. Pause e tente de novo depois de arrumar o anúncio ou o preço.`, { numeros: semana });
    if (roas < minimo)
      return sit("reduzir", "atencao", "Reduzir 20% ou subir a meta", `ROAS ${um(roas)} na última semana, abaixo de ${nomeMin}. Reduza o orçamento ~20% (pra ${moeda(Math.max(regras.minDiario, Math.floor(orcamento * 0.8)))}/dia) ou suba a meta. Se repetir, pause.`, { numeros: semana });
    if (usoOrc != null && usoOrc < regras.gastoBaixo) {
      const novaMeta = meta ? Math.max(minimo, Math.round(meta * 0.9 * 10) / 10) : null;
      return novaMeta && meta && novaMeta < meta - 0.05
        ? sit("meta-alta", "info", "Meta alta demais: baixe ~10%", `Gastou só ${Math.round(usoOrc * 100)}% do orçamento: a Shopee não acha venda nessa meta. Baixe a meta pra ${um(novaMeta)} (nunca abaixo de ${nomeMin}).`, { numeros: semana, novaMeta })
        : sit("pouca-procura", "info", "Pouca entrega mesmo no empate", `Gastou só ${Math.round(usoOrc * 100)}% do orçamento com a meta já no empate: pouca procura pra esse produto. Mantenha ou pause.`, { numeros: semana });
    }
    if (!naTemporada && organico != null && organico >= regras.organicoAlto && depois.length >= 2)
      return sit("reduzir-aos-poucos", "info", "Reduzir aos poucos", `${Math.round(organico * 100)}% das vendas já são orgânicas: o Ads cumpriu o papel. Corte ~20% por semana e veja se as vendas se mantêm.`, { numeros: semana });
    if (meta && roas >= meta && (usoOrc == null || usoOrc >= regras.gastoCheio)) {
      const novo = valorAumento(orcamento, rAum);
      const escala = roas >= regras.folgaEscala * meta ? ` ROAS ${um(roas)} = ${um(roas / meta)}× a meta: dá pra escalar.` : "";
      if (tetoLoja && tetoLoja.passaria((novo - orcamento) * 30))
        return sit("teto", "info", "Bom resultado, mas no teto da loja", `ROAS ${um(roas)} ≥ meta ${um(meta)}, mas aumentar passaria do teto de Ads da loja (${moeda(tetoLoja.teto)} no mês, fase ${tetoLoja.fase}). Mantenha ${moeda(orcamento)}/dia.`, { numeros: semana });
      return sit("aumentar", "oportunidade", `Aumentar ${pctAum}% → ${moeda(novo)}/dia`, `ROAS ${um(roas)} ≥ meta ${um(meta)} e gastou ${Math.round((usoOrc ?? 1) * 100)}% do orçamento.${escala} Suba de ${moeda(orcamento)} pra ${moeda(novo)}/dia (no máx. 1 aumento por semana; a Shopee reaprende uns dias).`, { numeros: semana, novoOrcamento: novo });
    }
    return sit("manter", "ok", "Manter", `ROAS ${um(roas)} acima de ${nomeMin}${meta ? `, meta ${um(meta)}` : ""}. Mantenha orçamento e meta.`, { numeros: semana });
  }

  // ---- Sem Ads ligado ----
  if (sazonal && (sazonal.fase === "corte" || sazonal.fase === "depois"))
    return sit("fora-janela", "info", sazonal.fase === "corte" ? "Corte: não ligar o Ads" : "Depois da data", sazonal.fase === "corte" ? `A entrega não chega mais a tempo de ${sazonal.nome}. Ads só na próxima temporada.` : `${sazonal.nome} já passou: Ads desligado até a próxima temporada.`);
  if (sazonal && sazonal.fase === "fora")
    return sit("fora-temporada", "info", "Fora da temporada", `Produto de ${sazonal.nome}: Ads a partir de ${dm(sazonal.datas.aquecer)} (Aquecer — R$ ${regras.minDiario}/dia pra plataforma aprender).`);
  if (!empate || empate > regras.roasInviavel) {
    const v = precoViavel(preco, lucroEm, regras);
    return sit("nao-viavel", "info", "Ads não compensa neste preço", `${empate ? `Empate em ROAS ${um(empate)} (lucro ${moeda(lucro)} por venda)` : "Sem lucro neste preço"}: o Ads não se paga.${v ? ` Passa a ser viável a partir de ${moeda(v.preco)} (empate ${um(v.empate)}).` : ""} Cresça no orgânico.`, { viavel: v });
  }
  if (anuncio) return sit("arrumar", "atencao", "Arrume o anúncio antes", `${anuncio.titulo || "O anúncio precisa de revisão"}: o Ads só amplifica o que já converte. Comece por: ${anuncio.porOnde || "foto, título e descrição"}.`);
  if (ultimoFechado && diasEntre(ultimoFechado.fim, hoje) < regras.diasTentarDeNovo) {
    const r = resumoPeriodo(ultimoFechado, ss, preco, empate, regras);
    if (r.resultado && r.resultado.chave !== "valeu")
      return sit("aguardar", "info", "Último período não se pagou", `${dm(ultimoFechado.inicio)}–${dm(ultimoFechado.fim)}: ROAS ${r.roas != null ? um(r.roas) : "—"} (${r.resultado.texto}). Tente de novo a partir de ${dm(somarDiasIso(ultimoFechado.fim, regras.diasTentarDeNovo))} ou antes, se mudar preço, fotos ou avaliações.`, { ultimo: r });
  }
  if (naTemporada)
    return sit("ligar-sazonal", "oportunidade", `${sazonal.titulo}: ligar o Ads`, `${sazonal.nome}: ${sazonal.texto} Comece com ${moeda(regras.minDiario)}/dia e meta ${um(metaSugerida(minimo))} (deixa pelo menos metade do lucro de cada venda).`);
  const ult2 = ss.slice(-2);
  const organicas = ult2.length ? ult2.reduce((t, s) => t + Math.max(0, vendasParaDecisao(s) - num(s.ads_vendas)), 0) / ult2.length : 0;
  if (organicas >= regras.vendeSozinho)
    return sit("sem-necessidade", "ok", "Vende sozinho", `${um(organicas)} vendas orgânicas por semana: Ads é opcional. Se quiser acelerar, comece com ${moeda(regras.minDiario)}/dia e meta ${um(metaSugerida(empate))}.`);
  return sit("pode", "oportunidade", "Pode impulsionar", `${ss.length ? "" : "Sem vendas registradas ainda. "}Empate em ROAS ${um(empate)}: comece com ${moeda(regras.minDiario)}/dia e meta ${um(metaSugerida(empate))}, 7 dias sem mexer.`);
}

// Loja: Ads da semana (últimos 7 dias de registros) × faturamento da semana.
export function adsDaLoja(semanasTodas, hoje, regras = REGRAS_ADS) {
  const desde = somarDiasIso(hoje, -7);
  const ss = semanasTodas.map(porSemana).filter((s) => s.data > desde);
  const gasto = ss.reduce((t, s) => t + num(s.ads_gasto), 0);
  const faturamento = ss.reduce((t, s) => t + num(s.vendas_total ?? s.vendas) * num(s.preco), 0);
  const vendas = ss.reduce((t, s) => t + num(s.vendas_total ?? s.vendas), 0);
  const vendasAds = ss.reduce((t, s) => t + num(s.ads_vendas), 0);
  const pct = faturamento > 0 ? gasto / faturamento : null;
  const teto = regras.tetoLoja * faturamento;
  return {
    gasto,
    faturamento,
    pct,
    pctVendasAds: vendas > 0 ? vendasAds / vendas : null,
    acimaTeto: pct != null && pct > regras.tetoLoja,
    dependente: vendas > 0 && vendasAds / vendas > 0.5,
    passaria: (extra) => faturamento > 0 && gasto + extra > teto,
  };
}
