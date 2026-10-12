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
};

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
export const periodoAtivo = (lista, hoje) => (lista || []).find((p) => !p.fim || p.fim >= hoje) || null;

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
export function avaliarAds({ preco, lucro, lucroEm = null, semanas = [], periodos = [], anuncio = null, hoje, regras = REGRAS_ADS, tetoLoja = null }) {
  const ss = (semanas || []).map(porSemana).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const empate = roasEmpate(preco, lucro);
  const ativo = periodoAtivo(periodos, hoje);
  const ultimoFechado = (periodos || []).find((p) => p.fim && p.fim < hoje) || null;
  const base = { empate, ativo, ultimoFechado, preco, lucro };
  const sit = (chave, estado, titulo, texto, extra = {}) => ({ ...base, chave, estado, titulo, texto, ...extra });

  if (ativo) {
    const { orcamento, meta, ultimoAjuste } = valoresAtuais(ativo);
    const dias = diasEntre(ativo.inicio, hoje);
    const r = resumoPeriodo(ativo, ss, preco, empate, regras);
    const numeros = { orcamento, meta, dias, ...r };
    // Desde o último ajuste (ou início), conta de novo o aprendizado.
    const refAprend = ultimoAjuste && ultimoAjuste > ativo.inicio ? ultimoAjuste : ativo.inicio;
    const diasAprend = diasEntre(refAprend, hoje);
    if (r.vendas === 0 && r.cliques >= regras.cliquesSemVenda)
      return sit("pausar-revisar", "resolver", "Pausar e revisar o anúncio", `${r.cliques} cliques pagos e nenhuma venda: o Ads está trazendo gente, mas a página não convence. Pause e revise foto, descrição, medidas e preço antes de gastar mais.`, { numeros });
    if (diasAprend < regras.aprendizadoDias)
      return sit("aprendendo", "decisao", `Aprendendo · dia ${diasAprend + 1} de ${regras.aprendizadoDias}`, `A Shopee ainda está aprendendo${refAprend !== ativo.inicio ? " depois do último ajuste" : ""}: não mexa na meta nem no orçamento até ${dm(somarDiasIso(refAprend, regras.aprendizadoDias))}. Registre a semana normalmente.`, { numeros });
    if (!empate || empate > regras.roasInviavel)
      return sit("inviavel-ativo", "atencao", "Ads não se paga neste preço", empate ? `O empate é ROAS ${um(empate)}: cada R$ 1 de Ads precisa trazer ${moeda(empate)} em vendas. Pause, a não ser que esteja comprando as primeiras vendas de propósito.` : "Sem lucro neste preço: cada venda via Ads aumenta o prejuízo. Pause.", { numeros });
    // Semanas depois do aprendizado (só as que já tiveram gasto).
    const depois = semanasNoPeriodo(ss, ativo).filter((s) => s.data > somarDiasIso(refAprend, regras.aprendizadoDias - 1) && num(s.ads_gasto) > 0);
    const ult = depois[depois.length - 1];
    if (!ult) return sit("aguardando", "info", "Aguardando a 1ª semana depois do aprendizado", "Registre a semana (ou importe os relatórios da Shopee) pra avaliar.", { numeros });
    const roas = roasDe(ult, preco);
    const ult2 = depois.slice(-2);
    const abaixo2 = ult2.length === 2 && ult2.every((s) => (roasDe(s, preco) ?? 0) < empate);
    const gastoSemana = num(ult.ads_gasto);
    const usoOrc = orcamento ? gastoSemana / (orcamento * 7) : null;
    const organico = vendasParaDecisao(ult) > 0 ? Math.max(0, vendasParaDecisao(ult) - num(ult.ads_vendas)) / vendasParaDecisao(ult) : null;
    const semana = { ...numeros, roasSemana: roas, gastoSemana, usoOrc, organico };
    if (abaixo2) return sit("pausar", "atencao", "Pausar o Ads", `ROAS abaixo do empate (${um(empate)}) por 2 semanas: o Ads está tirando lucro. Pause e tente de novo depois de arrumar o anúncio ou o preço.`, { numeros: semana });
    if (roas < empate)
      return sit("reduzir", "atencao", "Reduzir 20% ou subir a meta", `ROAS ${um(roas)} na última semana, abaixo do empate (${um(empate)}). Reduza o orçamento ~20% (pra ${moeda(Math.max(regras.minDiario, Math.floor(orcamento * 0.8)))}/dia) ou suba a meta. Se repetir, pause.`, { numeros: semana });
    if (usoOrc != null && usoOrc < regras.gastoBaixo) {
      const novaMeta = meta ? Math.max(empate, Math.round(meta * 0.9 * 10) / 10) : null;
      return novaMeta && meta && novaMeta < meta - 0.05
        ? sit("meta-alta", "info", "Meta alta demais: baixe ~10%", `Gastou só ${Math.round(usoOrc * 100)}% do orçamento: a Shopee não acha venda nessa meta. Baixe a meta pra ${um(novaMeta)} (nunca abaixo do empate, ${um(empate)}).`, { numeros: semana, novaMeta })
        : sit("pouca-procura", "info", "Pouca entrega mesmo no empate", `Gastou só ${Math.round(usoOrc * 100)}% do orçamento com a meta já no empate: pouca procura pra esse produto. Mantenha ou pause.`, { numeros: semana });
    }
    if (organico != null && organico >= regras.organicoAlto && depois.length >= 2)
      return sit("reduzir-aos-poucos", "info", "Reduzir aos poucos", `${Math.round(organico * 100)}% das vendas já são orgânicas: o Ads cumpriu o papel. Corte ~20% por semana e veja se as vendas se mantêm.`, { numeros: semana });
    if (meta && roas >= meta && (usoOrc == null || usoOrc >= regras.gastoCheio)) {
      const novo = valorAumento(orcamento, regras);
      const escala = roas >= regras.folgaEscala * meta ? ` ROAS ${um(roas)} = ${um(roas / meta)}× a meta: dá pra escalar.` : "";
      if (tetoLoja && tetoLoja.passaria((novo - orcamento) * 7))
        return sit("teto", "info", "Bom resultado, mas no teto da loja", `ROAS ${um(roas)} ≥ meta ${um(meta)}, mas aumentar passaria do teto de Ads da loja (${Math.round(regras.tetoLoja * 100)}% do faturamento). Mantenha ${moeda(orcamento)}/dia.`, { numeros: semana });
      return sit("aumentar", "oportunidade", `Aumentar 20% → ${moeda(novo)}/dia`, `ROAS ${um(roas)} ≥ meta ${um(meta)} e gastou ${Math.round((usoOrc ?? 1) * 100)}% do orçamento.${escala} Suba de ${moeda(orcamento)} pra ${moeda(novo)}/dia (no máx. 1 aumento por semana; a Shopee reaprende uns dias).`, { numeros: semana, novoOrcamento: novo });
    }
    return sit("manter", "ok", "Manter", `ROAS ${um(roas)} acima do empate (${um(empate)})${meta ? `, meta ${um(meta)}` : ""}. Mantenha orçamento e meta.`, { numeros: semana });
  }

  // ---- Sem Ads ligado ----
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
