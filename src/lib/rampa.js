// Rampa de preço (aba Crescimento, schema v33) — lógica pura.
//
// Ideia combinada com o Gustavo (out/2026): o produto entra na plataforma
// perto do 0 a 0 pra ganhar vendas/avaliações no orgânico e sobe em degraus
// pequenos (até ~5%, finais ,49/,99) até o PREÇO ALVO = o preço salvo em
// Produtos precificados, que NÃO muda (a rampa é uma camada à parte).
// Sobe só quando passa em todos os portões (avaliações, vendas, nota, dias no
// degrau, sem avaliação ruim recente); depois de subir, confere se o lucro
// da semana não caiu e se as vendas ficaram ≥ 60% — 1 semana ruim = segurar,
// 2 seguidas = sugerir voltar um degrau.
import { lucroNoPreco, precoMinimoAceitavel, precoParaLucro, precoParaMargem } from "./escada.js";
import { dataSP } from "./datas.js";
import { menorFinalComFreteGratis } from "./freteGratis.js";

export const REGRAS_PADRAO = {
  avaliacoes: 10, // avaliações novas por degrau
  vendas: 30, // vendas por degrau
  nota: 4.7, // nota mínima pra subir
  dias: 7, // dias mínimos no degrau
  pisoVendas: 0.6, // depois de subir: vendas/semana ≥ 60% da semana antes
  passo: 0.05, // tamanho máximo do degrau
  lucroEntrada: 0.5, // R$ de lucro no 1º degrau (0 a 0 + isso)
  notaAlerta: 4.5, // abaixo disso: alerta pra revisar o produto
  roasInviavel: 8, // ROAS mínimo acima disso = Ads inviável no degrau
  revisarDias: 14, // dias no lançamento com < metade das vendas → revisar anúncio
  semVendaDias: 7, // dias no degrau sem NENHUMA venda → aviso âmbar "conferir anúncio" (antes do diagnóstico completo)
  maxDegraus: 8, // máximo de degraus do 1º ao alvo (passo cresce se a distância for grande)
  saltoVendas: 2, // vendas desde o degrau ≥ 2× o portão → sugere subir 2 degraus
  diasAposSalto: 14, // depois de salto duplo ou de voltar: dias mínimos até a próxima mudança
  // Decisão pelo LUCRO da semana (out/2026): patamar = lucro médio por semana
  // nas 2 primeiras semanas completas do degrau.
  lucroFica: 0.9, // depois de subir: lucro ≥ 90% do degrau anterior = fica
  lucroVolta: 0.75, // < 75% por 2 semanas (ou vendas < pisoVendas) = voltar
  lucroSobe: 1.2, // lucro ≥ 120% do patamar atual por 2 semanas = pode subir de novo
  // Atalho pelo ritmo (1º degrau e rampa sazonal)
  ritmoPedidosDia: 2, // pedidos por dia
  ritmoDias: 4, // dias no degrau (rampa normal, + 1 avaliação nova)
  ritmoDiasSazonal: 3, // dias no degrau (rampa sazonal)
  // Rampa sazonal
  sazonalDiasMin: 3, // dias mínimos por degrau / entre subidas
  sazonalPassoMax: 0.1, // passo máximo quando o tempo é curto
  sazonalRitmoMin: 1, // pedidos por dia pra seguir o cronograma
  sazonalQuedaVolta: 0.5, // ritmo caiu mais que isso vs o degrau anterior = voltar
  sazonalAcimaDias: 7, // no alvo, vendendo muito: teste de +5% por 7 dias
  sazonalCorteDias: 7, // corte da entrega: dias antes da data (Ads pausa; teste acima tem que acabar antes)
  entressafraEspera: 3, // dias depois da data antes de começar a descer
  entressafraPasso: 0.08, // cada descida
  entressafraQueda: 0.5, // desce com lucro/semana < 50% do patamar da temporada por 2 semanas
  // Teste de lançamento com Ads (rampa que começou sem vendas)
  testeObservarDias: 5, // dias observando só o orgânico antes de recomendar
  testeDispensaVendas: 3, // vendas que dispensam o teste (o orgânico pegou)
  testeMeta: 10, // vendas que o teste busca
  testeMin: 30, // orçamento mínimo (R$)
  testeMax: 100, // orçamento máximo (R$)
  testeDias: 7, // prazo do teste
  testeMinDiario: 10, // orçamento diário mínimo do Ads na plataforma (R$) — a Shopee exige R$10/dia
  testeCliquesSemVenda: 50, // tantos cliques sem venda = problema é o anúncio
  // Acima do alvo
  acimaDias: 14, // dias no alvo antes de sugerir testar acima / duração do teste acima
  acimaSemanas: 3, // semanas de vendas estáveis no alvo
  acimaMax: 0.2, // no máximo +20% acima do alvo
  acimaBloqueioDias: 30, // se o teste acima falhar, não tenta de novo por X dias
  // Funil do anúncio (Impressões de Produto → Cliques Por Produto → Pedidos)
  funilDiasMin: 14, // dias desde o início da rampa antes de diagnosticar
  funilVisMin: 300, // impressões de produto em 2 semanas abaixo disso = pouca exibição
  funilCtrMin: 0.02, // CTR mínimo (referência geral)
  funilConvMin: 0.01, // taxa de conversão de pedidos mínima (referência geral)
  funilVisitasMin: 50, // cliques em 2 semanas pra julgar a conversão
};

// Orçamento sugerido do teste de lançamento: meta × lucro por venda no alvo,
// entre o mínimo e o máximo, arredondado pra cima de 5 em 5 — e nunca abaixo
// do mínimo diário da plataforma × dias do teste (a Shopee não aceita menos
// de R$10/dia). Se esse mínimo passar do máximo, vale o mínimo mesmo assim
// (acimaMax = true, a tela avisa).
export function detalheOrcamentoTeste(lucroAlvo, regras = REGRAS_PADRAO) {
  const bruto = num(regras.testeMeta) * Math.max(0, num(lucroAlvo));
  const base = Math.ceil(Math.min(num(regras.testeMax), Math.max(num(regras.testeMin), bruto)) / 5) * 5;
  const minimo = num(regras.testeMinDiario) * num(regras.testeDias);
  const valor = Math.ceil(Math.max(base, minimo) / 5) * 5;
  return { valor, base, minimo, porMinimo: minimo > base, acimaMax: valor > num(regras.testeMax) };
}
export function orcamentoTeste(lucroAlvo, regras = REGRAS_PADRAO) {
  return detalheOrcamentoTeste(lucroAlvo, regras).valor;
}

const maisDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;

export function regrasDaLoja(configEscada) {
  return { ...REGRAS_PADRAO, ...(configEscada?.crescimento || {}) };
}

// Finais ,49 / ,99: o maior ≤ v e o menor ≥ v.
export const finalAbaixo = (v) => cent(Math.floor((v + 0.01 + 1e-9) * 2) / 2 - 0.01);
export const finalAcima = (v) => cent(Math.ceil((v + 0.01 - 1e-9) * 2) / 2 - 0.01);

// Ponto de equilíbrio (lucro zero) no canal, com custo/peso ao vivo.
export function zeroAZero(canal, custo, peso, cfg) {
  const p = precoParaMargem(canal, 0, custo, peso, cfg);
  return p != null ? Math.ceil(p * 100 - 1e-6) / 100 : null;
}

// Degraus sugeridos: do 1º (0 a 0 + lucroEntrada, final ,49/,99 — nunca abaixo
// do frete grátis do canal) até o alvo,
// cada um no máximo `passo` acima do anterior (arredondado pros finais).
export function sugerirDegraus({ canal, custo, peso, cfg, alvo, regras = REGRAS_PADRAO }) {
  const a = cent(num(alvo));
  if (!(a > 0)) return [];
  const pe = precoParaLucro(canal, num(regras.lucroEntrada), custo, peso, cfg);
  let p = pe != null ? finalAcima(pe) : a;
  // Nenhum degrau sugerido abaixo do pedido mínimo do frete grátis (v38): o 1º
  // vira o menor final ,49/,99 que já tem frete grátis, se for maior.
  const pFrete = menorFinalComFreteGratis(canal, finalAcima);
  if (pFrete != null && pFrete > p) p = pFrete;
  if (p >= a) return [a];
  const out = [p];
  for (let i = 0; i < 40; i++) {
    let prox = finalAbaixo(p * (1 + num(regras.passo) || 0.05));
    if (prox <= p) prox = finalAcima(p + 0.02);
    if (prox >= a - 0.2) break; // o alvo vem logo em seguida
    out.push(prox);
    p = prox;
  }
  out.push(a);
  const max = Math.max(2, Math.round(num(regras.maxDegraus)) || 8);
  if (out.length <= max) return out;
  // Muitos degraus: reparte a distância em `max` degraus iguais em % (finais ,49/,99).
  const p0 = out[0];
  const r = Math.pow(a / p0, 1 / (max - 1));
  const lim = [p0];
  for (let k = 1; k < max - 1; k++) {
    let v = finalAbaixo(p0 * Math.pow(r, k));
    if (v <= lim[lim.length - 1]) v = finalAcima(lim[lim.length - 1] + 0.02);
    if (v >= a - 0.2) break;
    lim.push(v);
  }
  lim.push(a);
  return lim;
}

// Degraus da rampa SAZONAL (produto "só na época de…"): chegar no alvo até a
// data-limite. Produto novo começa no preço que dá METADE do lucro do alvo
// (na temporada a procura já vem sozinha); produto que já vende começa do
// preço de hoje. Cada degrau fica pelo menos `sazonalDiasMin` dias; o passo
// se ajusta ao tempo que sobra (5% a 10%). Se nem com 10% der tempo, a
// largada sobe (aviso). Menos de 2 semanas até a data-limite = direto no alvo.
export function sugerirDegrausSazonal({ canal, custo, peso, cfg, alvo, regras = REGRAS_PADRAO, hoje, limite, inicioPreco = null }) {
  const a = cent(num(alvo));
  if (!(a > 0)) return { degraus: [], aviso: null };
  const dias = limite && hoje ? diasEntre(hoje, limite) : 0;
  if (dias < 14) return { degraus: [a], aviso: dias < 0 ? "A data-limite já passou: vende direto no alvo." : "Menos de 2 semanas até a data-limite: vende direto no alvo." };
  let p0;
  let origem;
  if (num(inicioPreco) > 0) {
    p0 = cent(num(inicioPreco));
    origem = "preço de hoje";
  } else {
    const lA = lucroNoPreco(canal, a, custo, peso, cfg);
    const pm = lA > 0 ? precoParaLucro(canal, lA / 2, custo, peso, cfg) : null;
    p0 = pm != null ? finalAcima(pm) : a;
    origem = "metade do lucro do alvo";
  }
  if (p0 >= a - 0.004) return { degraus: [a], aviso: null, origem };
  const minD = Math.max(1, num(regras.sazonalDiasMin) || 3);
  const passoMin = num(regras.passo) || 0.05;
  const passoMax = Math.max(passoMin, num(regras.sazonalPassoMax) || 0.1);
  const maxSubidas = Math.max(1, Math.min(Math.floor(dias / minD), (Math.round(num(regras.maxDegraus)) || 8) - 1));
  const precisa = Math.ceil(Math.log(a / p0) / Math.log(1 + passoMin));
  let k = Math.max(1, Math.min(precisa, maxSubidas));
  let aviso = null;
  if (Math.pow(a / p0, 1 / k) - 1 > passoMax + 1e-9) {
    const novo = finalAcima(a / Math.pow(1 + passoMax, k));
    aviso = `Não dá tempo de começar em ${moeda(p0)} subindo até ${Math.round(passoMax * 100)}% a cada ${minD} dias: começa em ${moeda(novo)}.`;
    p0 = novo;
  }
  const r = Math.pow(a / p0, 1 / k);
  const lista = [p0];
  for (let j = 1; j < k; j++) {
    let v = finalAbaixo(p0 * Math.pow(r, j));
    if (v <= lista[lista.length - 1]) v = finalAcima(lista[lista.length - 1] + 0.02);
    if (v >= a - 0.2) break;
    lista.push(v);
  }
  lista.push(a);
  return { degraus: lista, aviso, origem, dias };
}

// Normaliza a lista digitada: números > 0, ordem crescente, sem repetidos.
export function normalizarDegraus(lista) {
  const vals = [...new Set((lista || []).map((v) => cent(num(v))).filter((v) => v > 0))].sort((x, y) => x - y);
  return vals;
}

// Alvo mudou: o preço salvo (alvo) do produto no canal não está mais nos degraus
// (alguém mexeu no preço salvo depois de montar a rampa). Testar acima do alvo
// não conta — o alvo continua nos degraus. "Manter como está" grava o alvo em
// checklist.alvoMantido e o aviso some até o alvo mudar de novo.
export function alvoMudouDaRampa(degraus, alvo, checklist) {
  const lista = (degraus || []).map(num).filter((d) => d > 0);
  const a = cent(num(alvo));
  if (!(a > 0) || !lista.length) return null;
  if (lista.some((d) => Math.abs(d - a) < 0.005)) return null;
  const mantido = num(checklist?.alvoMantido);
  if (mantido > 0 && Math.abs(mantido - a) < 0.005) return null;
  const de = lista[lista.length - 1];
  return { de, para: a, subiu: a > de };
}

// "Ajustar degraus até o novo alvo": tira os degraus acima do novo alvo,
// acrescenta o novo alvo no fim e mantém o degrau atual se ainda estiver abaixo;
// se o atual ficar acima (ou igual), o atual passa a ser o novo alvo.
export function ajustarDegrausAoAlvo(degraus, i, alvo) {
  const lista = (degraus || []).map(num).filter((d) => d > 0);
  const a = cent(num(alvo));
  const atual = lista[Math.max(0, Math.min(lista.length - 1, i ?? 0))] ?? null;
  const novos = normalizarDegraus([...lista.filter((d) => d < a - 0.004), a]);
  const manter = atual != null && atual < a - 0.004;
  const idx = manter ? novos.findIndex((d) => Math.abs(d - atual) < 0.005) : novos.length - 1;
  return { degraus: novos, i: idx, precoAntes: atual, precoDepois: novos[idx], mudouPreco: atual == null || Math.abs(atual - novos[idx]) >= 0.005 };
}

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ---- Conhecidos (schema v39) ----
// Vendas de amigos/família: passam pelo marketplace (taxa, caixa, avaliação),
// mas não vieram de busca nem de Ads. Contam nas vendas totais e no lucro da
// semana; NÃO contam em nenhuma decisão (portão de vendas, check da subida,
// acima do alvo, conversão do funil, vendas baixas no lançamento, teste de
// lançamento). null = 0. Toda regra de decisão usa estas funções.
export const conhecidosDe = (r) => Math.max(0, num(r?.conhecidos));
export const vendasParaDecisao = (r) => Math.max(0, num(r?.vendas) - conhecidosDe(r));
export const pedidosParaDecisao = (r) => Math.max(0, num(r?.pedidos) - conhecidosDe(r));

// ---- Registro por período (schema v40) ----
// Registro normal = 7 dias (até a véspera da data). Depois de pular semanas,
// o registro cobre de `periodo_inicio` até a véspera da data (N dias). Toda
// regra SEMANAL (check da subida, acima do alvo, ROAS/Ads, funil, lucro da
// semana, gráficos) usa os números por semana (× 7 ÷ N); somas acumuladas
// (vendas desde o degrau, vendas no total, teste de lançamento) usam o real.
// Número por semana pra mostrar: inteiro quando é inteiro, senão 1 casa ("2,3").
export const fmtSemana = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1).replace(".", ","));
export const CAMPOS_POR_SEMANA = ["vendas", "conhecidos", "ads_vendas", "ads_gasto", "ads_cliques", "visualizacoes", "visitas", "pedidos", "vendas_total", "comissao"];
export function diasDoRegistro(r) {
  if (!r?.periodo_inicio || !r?.data) return 7;
  const d = diasEntre(String(r.periodo_inicio).slice(0, 10), String(r.data).slice(0, 10));
  return d > 0 ? d : 7;
}
export function porSemana(r) {
  const dias = diasDoRegistro(r);
  if (dias === 7) return r;
  const f = 7 / dias;
  const out = { ...r, diasPeriodo: dias };
  for (const k of CAMPOS_POR_SEMANA) if (r[k] != null && r[k] !== "") out[k] = num(r[k]) * f;
  return out;
}

// ---- Funil do anúncio ----
// Semanas válidas = registros "semana" com impressões e cliques preenchidos,
// só no preço atual (degrau atual). Prefere semanas sem Ads (o Ads infla as
// impressões e distorce o CTR); se não houver 2 sem Ads, usa as que tiver e
// marca comAds. Usa as 2 últimas; conversão por pedidos quando todas as
// semanas usadas têm pedidos, senão pelas vendas.
const FUNIL_SEMANAS = 2;

export function metricasFunil(rampa, registros, regras, hoje) {
  const degraus = (rampa.degraus || []).map(num);
  const i = Math.max(0, Math.min(degraus.length - 1, rampa.degrau_atual ?? 0));
  const preco = degraus[i] ?? null;
  const regs = (registros || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const temFunil = (r) => r.tipo === "semana" && r.visualizacoes != null && r.visitas != null;
  // Registro por período: impressões/cliques/pedidos por semana (× 7 ÷ N).
  const comDados = regs.filter(temFunil).map(porSemana);
  const inicio = [...regs].reverse().find((r) => r.tipo === "inicio")?.data || (rampa.criado_em ? dataSP(rampa.criado_em) : hoje);
  const diasRampa = Math.max(0, diasEntre(inicio, hoje));
  const noPreco = comDados.filter((r) => preco != null && Math.abs(num(r.preco) - preco) < 0.005);
  const semAds = noPreco.filter((r) => !(num(r.ads_gasto) > 0));
  const usadas = (semAds.length >= FUNIL_SEMANAS ? semAds : noPreco).slice(-FUNIL_SEMANAS);
  const comAds = usadas.some((r) => num(r.ads_gasto) > 0);
  const usaPedidos = usadas.length > 0 && usadas.every((r) => r.pedidos != null);
  const visualizacoes = usadas.reduce((t, r) => t + num(r.visualizacoes), 0);
  const visitas = usadas.reduce((t, r) => t + num(r.visitas), 0);
  const vendas = usadas.reduce((t, r) => t + (usaPedidos ? pedidosParaDecisao(r) : vendasParaDecisao(r)), 0);
  const ctr = visualizacoes > 0 ? visitas / visualizacoes : null;
  const conversao = visitas > 0 ? vendas / visitas : null;
  const faltamDias = Math.max(0, num(regras.funilDiasMin) - diasRampa);
  const faltamSemanas = Math.max(0, FUNIL_SEMANAS - noPreco.length);
  const status = !comDados.length ? "sem-dados" : faltamDias > 0 || faltamSemanas > 0 ? "coletando" : "pronto";
  const r1 = (v) => Math.round(v * 10) / 10;
  return { status, faltamDias, faltamSemanas, visualizacoes: Math.round(visualizacoes), visitas: Math.round(visitas), vendas: r1(vendas), usaPedidos, ctr, conversao, comAds, semanas: usadas.length };
}

// Mediana de CTR e conversão dos produtos da loja com funil calculável —
// só vale como referência com 5 ou mais produtos.
export function referenciaFunilLoja(lista) {
  const prontos = (lista || []).filter((m) => m && m.status === "pronto" && m.ctr != null);
  if (prontos.length < 5) return null;
  const mediana = (xs) => {
    const v = xs.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return { ctr: mediana(prontos.map((m) => m.ctr)), conversao: mediana(prontos.map((m) => m.conversao)), n: prontos.length };
}

const pctFunil = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`;

// Diagnóstico pelo funil, na ordem: exibição → vitrine (CTR) → página (conversão).
export function diagnosticarFunil(m, regras, refLoja) {
  const usaLoja = !!(refLoja && refLoja.ctr != null);
  const referencia = usaLoja ? "média da loja" : "referência geral";
  const limCtr = usaLoja ? refLoja.ctr * 0.5 : num(regras.funilCtrMin);
  const limConv = usaLoja && refLoja.conversao != null ? refLoja.conversao * 0.5 : num(regras.funilConvMin);
  const base = { ...m, referencia, limiteCtr: limCtr, limiteConversao: limConv, diagnostico: null };
  if (m.status === "sem-dados") return base;
  if (m.status === "coletando") {
    const partes = [];
    if (m.faltamDias > 0) partes.push(`${m.faltamDias} dia${m.faltamDias === 1 ? "" : "s"}`);
    if (m.faltamSemanas > 0) partes.push(`${m.faltamSemanas} semana${m.faltamSemanas === 1 ? "" : "s"} com impressões e cliques neste preço`);
    return { ...base, texto: `coletando dados (faltam ${partes.join(" / ")})` };
  }
  const ref = usaLoja ? `metade da média da loja: ${pctFunil(limCtr)}` : `referência geral: ${pctFunil(limCtr)}`;
  const refConv = usaLoja ? `metade da média da loja: ${pctFunil(limConv)}` : `referência geral: ${pctFunil(limConv)}`;
  const tom = (v, lim) => (v < 0.5 * lim ? "bad" : "warn");
  let d;
  if (m.visualizacoes < num(regras.funilVisMin))
    d = {
      chave: "titulo",
      tom: tom(m.visualizacoes, num(regras.funilVisMin)),
      titulo: "Pouca gente está vendo o anúncio",
      texto: `${m.visualizacoes} impressões em 2 semanas (mínimo ${num(regras.funilVisMin)}). Revise o título com palavras de busca, a categoria e os atributos — é o que faz o anúncio aparecer.`,
      itens: ["titulo", "concorrente"],
    };
  else if (m.ctr < limCtr)
    d = {
      chave: "vitrine",
      tom: tom(m.ctr, limCtr),
      titulo: "Aparece mas pouca gente clica",
      texto: `CTR de ${pctFunil(m.ctr)} (${ref}). Revise a foto principal e o preço/desconto que aparece na busca.`,
      itens: ["foto", "concorrente"],
    };
  else if (m.visitas >= num(regras.funilVisitasMin) && m.conversao < limConv)
    d = {
      chave: "pagina",
      tom: tom(m.conversao, limConv),
      titulo: "Clicam mas não compram",
      texto: `Taxa de conversão de ${pctFunil(m.conversao)} (${refConv}). Revise fotos de uso e medidas, vídeo, descrição, frete e avaliações.`,
      itens: ["uso", "medidas", "video", "descricao", "avaliacao"],
    };
  else
    d = {
      chave: "ok",
      tom: "good",
      titulo: "Funil saudável",
      texto:
        m.visitas < num(regras.funilVisitasMin)
          ? `Impressões e CTR ok. A conversão ainda tem poucos cliques pra julgar (${m.visitas} de ${num(regras.funilVisitasMin)}).`
          : "Impressões, CTR e conversão dentro da referência.",
      itens: [],
    };
  return { ...base, diagnostico: d };
}

// ---- Segmentos: cada mudança de preço (início, subida, descida) abre um ----
// Semana COMPLETA num segmento = período inteiro no preço dele (começou no dia
// da mudança ou depois). Lucro da semana = vendas sem conhecidos × lucro por
// venda no preço da semana (custo/taxas de hoje), por semana (× 7 ÷ N).
const MARCOS = ["inicio", "subida", "descida"];
const ordenarRegs = (registros) =>
  (registros || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
export const inicioDoPeriodo = (r) => (r?.periodo_inicio ? String(r.periodo_inicio).slice(0, 10) : menosDias(String(r.data).slice(0, 10), 7));
const media = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);

export function segmentosRampa(registros, lucroEm) {
  const regs = ordenarRegs(registros);
  const marcos = regs.filter((r) => MARCOS.includes(r.tipo));
  const semanas = regs.filter((r) => r.tipo === "semana");
  return marcos.map((m, k) => {
    const ini = String(m.data).slice(0, 10);
    const fim = marcos[k + 1] ? String(marcos[k + 1].data).slice(0, 10) : null;
    const linha = (s) => {
      const n = porSemana(s);
      return { data: s.data, lucro: vendasParaDecisao(n) * (lucroEm(num(s.preco) || num(m.preco)) ?? 0), vendas: vendasParaDecisao(n), vendasReais: vendasParaDecisao(s), dias: diasDoRegistro(s) };
    };
    const doSeg = semanas.filter((s) => s.data > ini && (fim == null || s.data <= fim));
    const completas = doSeg.filter((s) => inicioDoPeriodo(s) >= ini).map(linha);
    const todas = doSeg.map(linha);
    const base = completas.length ? completas : todas;
    return {
      tipo: m.tipo,
      observacao: m.observacao || null,
      inicio: ini,
      fim,
      preco: num(m.preco),
      completas,
      todas,
      // Patamar = 2 primeiras semanas completas; saída = 2 últimas (o nível em que o degrau foi deixado).
      patamar: completas.length >= 2 ? media(completas.slice(0, 2).map((x) => x.lucro)) : null,
      saida: base.length ? media(base.slice(-2).map((x) => x.lucro)) : null,
      saidaVendas: base.length ? media(base.slice(-2).map((x) => x.vendas)) : null,
      mediaLucro: base.length ? media(base.map((x) => x.lucro)) : null,
      mediaVendas: base.length ? media(base.map((x) => x.vendas)) : null,
      // Ritmo (pedidos/dia, sem conhecidos) no segmento — rampa sazonal.
      vendasReais: todas.reduce((t, x) => t + x.vendasReais, 0),
    };
  });
}

// Veredito de um segmento vs o anterior (gráfico e "Vale a pena?"):
// compara o lucro por semana com o nível em que o degrau anterior foi deixado.
export function vereditoSegmento(seg, ant, regras = REGRAS_PADRAO) {
  if (!seg || !ant || ant.saida == null || !(ant.saida > 0)) return null;
  if (!seg.completas.length) return { chave: "coletando", texto: "coletando (1ª semana completa ainda não fechou)" };
  const lucro = seg.mediaLucro;
  const vendas = seg.mediaVendas;
  const pL = lucro / ant.saida - 1;
  const pV = ant.saidaVendas > 0 ? vendas / ant.saidaVendas - 1 : null;
  const pct = (v) => `${Math.abs(Math.round(v * 100))}%`;
  const parteV = pV == null ? "" : Math.abs(pV) < 0.005 ? "vendeu igual" : `vendeu ${pct(pV)} ${pV < 0 ? "menos" : "mais"}`;
  const parteL = Math.abs(pL) < 0.005 ? "lucrou igual" : `lucrou ${pct(pL)} ${pL < 0 ? "menos" : "mais"}`;
  const r = lucro / ant.saida;
  const chave = r >= num(regras.lucroFica) ? "compensou" : r >= num(regras.lucroVolta) ? "quase" : "nao";
  const fim = { compensou: "compensou", quase: "quase o mesmo lucro", nao: "não compensou" }[chave];
  return { chave, texto: `${[parteV, parteL].filter(Boolean).join(" e ")} → ${fim}`, lucro, vendas, ref: ant.saida, refVendas: ant.saidaVendas, semanas: seg.completas.length };
}

// Estado completo de uma rampa (portões, check da subida, Ads, sugestão).
// ctx = { canal, custo, peso, cfg } do produto (ao vivo); registros = da rampa.
export function estadoRampa(rampa, registros, regras, ctx, hoje) {
  const degraus = (rampa.degraus || []).map(num);
  const i = Math.max(0, Math.min(degraus.length - 1, rampa.degrau_atual ?? 0));
  const preco = degraus[i] ?? null;
  // Alvo = preço salvo do produto no canal (ao vivo); sem ele, o último degrau.
  const alvo = num(ctx.alvo) > 0 ? cent(num(ctx.alvo)) : degraus[degraus.length - 1] ?? null;
  const acimaAtivo = preco != null && alvo != null && preco > alvo + 0.004;
  const proximo = i < degraus.length - 1 && !(preco >= alvo - 0.004) ? degraus[i + 1] : null;
  // Rampa do anúncio com vários itens (grupoRampa.js): o lucro médio por venda vem pronto.
  const lucroEm = ctx.lucroEm
    ? (p) => (p > 0 ? ctx.lucroEm(p) : null)
    : (p) => (p > 0 && ctx.canal ? lucroNoPreco(ctx.canal, p, ctx.custo, ctx.peso, ctx.cfg) : null);
  // Preço com um lucro (só pro anúncio com vários itens, sem custo único): busca binária.
  const precoComLucro = (alvoLucro, ate) => {
    let lo = 0.01;
    let hi = Math.max(1, num(ate));
    if (!((lucroEm(hi) ?? -1) >= alvoLucro)) return null;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if ((lucroEm(m) ?? -Infinity) >= alvoLucro) hi = m;
      else lo = m;
    }
    return cent(hi);
  };
  const regs = (registros || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const semanas = regs.filter((r) => r.tipo === "semana");
  const ultimaSemana = semanas[semanas.length - 1] || null;
  // Por semana (registro por período normalizado × 7 ÷ N) — regras semanais.
  const semanasN = semanas.map(porSemana);
  const ultimaSemanaN = semanasN[semanasN.length - 1] || null;
  const comAval = [...regs].reverse().find((r) => r.avaliacoes != null);
  const avaliacoesTotal = comAval ? num(comAval.avaliacoes) : num(rampa.base_avaliacoes);
  const comNota = [...regs].reverse().find((r) => r.nota != null && r.nota !== "");
  const nota = comNota ? num(comNota.nota) : null;
  const desde = rampa.desde || hoje;
  // Dias depois da última semana fechada (pedidos importados até hoje — semanas
  // automáticas, lib/semanasAuto.js): contam nas vendas desde o degrau e no ritmo.
  const parcialV = ctx.parcial && ctx.parcial.de >= desde ? num(ctx.parcial.vendas) : 0;
  const vendasDesde = semanas.filter((s) => s.data >= desde).reduce((s, r) => s + vendasParaDecisao(r), 0) + parcialV;
  const conhecidosDesde = semanas.filter((s) => s.data >= desde).reduce((s, r) => s + conhecidosDe(r), 0);
  // "sobra" = dias soltos antes de um marco (semanasAuto.js): só nas somas.
  const sobras = regs.filter((r) => r.tipo === "sobra");
  const vendasTotal = num(rampa.vendas_iniciais) + [...semanas, ...sobras].reduce((s, r) => s + num(r.vendas), 0) + (ctx.parcial ? num(ctx.parcial.vendas) : 0);
  const vendasTotalDecisao = num(rampa.vendas_iniciais) + [...semanas, ...sobras].reduce((s, r) => s + vendasParaDecisao(r), 0) + (ctx.parcial ? num(ctx.parcial.vendas) : 0);
  const conhecidosTotal = semanas.reduce((s, r) => s + conhecidosDe(r), 0);
  const avaliacoesDesde = Math.max(0, avaliacoesTotal - num(rampa.base_avaliacoes));
  const dias = Math.max(0, diasEntre(desde, hoje));
  const corte7 = menosDias(hoje, 7);
  const ruins7 = regs.filter((r) => r.data > corte7).reduce((s, r) => s + num(r.avaliacoes_ruins), 0);
  const noAlvo = preco != null && alvo != null && preco >= alvo - 0.004;
  const fase = acimaAtivo
    ? { chave: "acima", rotulo: "Acima do alvo" }
    : noAlvo
      ? { chave: "alvo", rotulo: "No alvo" }
      : i === 0
        ? { chave: "lancamento", rotulo: "Lançamento" }
        : { chave: "tracao", rotulo: "Tração" };

  // Última mudança de preço: salto duplo ou descida pedem mais tempo parado.
  const mudancas = regs.filter((r) => r.tipo === "subida" || r.tipo === "descida");
  const ultMud = mudancas[mudancas.length - 1] || null;
  let saltoAnterior = 1;
  if (ultMud) {
    const antes = [...regs].reverse().find((r) => r !== ultMud && r.degrau != null && (r.data < ultMud.data || (r.data === ultMud.data && String(r.criado_em || "") < String(ultMud.criado_em || ""))));
    if (antes) saltoAnterior = Math.abs(num(ultMud.degrau) - num(antes.degrau)) || 1;
  }
  const diasMin = ultMud && (ultMud.tipo === "descida" || saltoAnterior >= 2) ? Math.max(regras.dias, num(regras.diasAposSalto)) : regras.dias;

  // ---- Decisão pelo LUCRO da semana (out/2026) ----
  const segs = segmentosRampa(regs, lucroEm);
  const segAtual = segs[segs.length - 1] || null;
  const segAnt = segs[segs.length - 2] || null;
  const ehPrimeiro = !segAtual || segAtual.tipo === "inicio";
  const fica = num(regras.lucroFica);
  const volta = num(regras.lucroVolta);
  const sobe = num(regras.lucroSobe);

  // Depois de subir: compara com o nível em que o degrau anterior foi deixado.
  let lucroCheck = null;
  if (segAtual && segAtual.tipo === "subida" && segAnt && !acimaAtivo && segAtual.observacao !== "acima do alvo") {
    const ref = segAnt.saida;
    const refVendas = segAnt.saidaVendas;
    const lucroPV = lucroEm(preco);
    const precisaVender = ref > 0 && lucroPV > 0 ? ref / lucroPV : null;
    const base = { de: segAnt.preco, para: segAtual.preco, ref, refVendas, lucroPorVenda: lucroPV, precisaVender, precisaPct: precisaVender != null && refVendas > 0 ? precisaVender / refVendas : null };
    if (!(ref > 0)) lucroCheck = { ...base, status: "sem-ref", semanas: [] };
    else {
      const sem = segAtual.completas.map((w) => {
        const pct = w.lucro / ref;
        const pctV = refVendas > 0 ? w.vendas / refVendas : null;
        return { ...w, pct, pctV, ruim: pct < volta || (pctV != null && pctV < num(regras.pisoVendas)) };
      });
      const ult = sem[sem.length - 1] || null;
      const status = !ult ? "coletando" : sem.length >= 2 && sem.slice(-2).every((w) => w.ruim) ? "voltar" : ult.ruim || ult.pct < fica ? "sinaliza" : "fica";
      lucroCheck = { ...base, status, semanas: sem, ultima: ult };
    }
  }

  // Subir de novo (depois do 1º degrau): lucro ≥ 120% do patamar do degrau
  // nas 2 últimas semanas completas DEPOIS das 2 que formam o patamar.
  let lucroSubir = null;
  if (!ehPrimeiro && segAtual) {
    const pat = segAtual.patamar;
    const depois = segAtual.completas.slice(2);
    const ult2 = depois.slice(-2);
    lucroSubir = {
      patamar: pat,
      meta: pat != null ? pat * sobe : null,
      semanas: ult2,
      medindo: pat == null,
      faltamPatamar: Math.max(0, 2 - segAtual.completas.length),
      ok: pat > 0 && ult2.length === 2 && ult2.every((w) => w.lucro >= sobe * pat - 0.005),
    };
  }

  const portoes = [
    { chave: "avaliacoes", rotulo: "Avaliações desde o último degrau", ok: avaliacoesDesde >= regras.avaliacoes, valor: `+${avaliacoesDesde} de +${regras.avaliacoes}`, falta: Math.max(0, regras.avaliacoes - avaliacoesDesde), curto: "avaliações" },
    { chave: "vendas", rotulo: "Vendas desde o último degrau", ok: vendasDesde >= regras.vendas, valor: `+${vendasDesde} de +${regras.vendas}${conhecidosDesde ? ` (fora ${conhecidosDesde} de conhecidos)` : ""}`, falta: Math.max(0, regras.vendas - vendasDesde), curto: "vendas" },
    { chave: "nota", rotulo: `Nota ≥ ${String(regras.nota).replace(".", ",")}`, ok: nota != null && nota >= regras.nota, valor: nota != null ? String(nota).replace(".", ",") : "—", curto: "nota" },
    { chave: "dias", rotulo: `Tempo no degrau ≥ ${diasMin} dias${diasMin > regras.dias ? (ultMud?.tipo === "descida" ? " (voltou de degrau)" : " (depois de salto duplo)") : ""}`, ok: dias >= diasMin, valor: `${dias} dia${dias === 1 ? "" : "s"}`, falta: Math.max(0, diasMin - dias), curto: "dias" },
    { chave: "ruins", rotulo: "Nenhuma avaliação 1–2★ nos últimos 7 dias", ok: ruins7 === 0, valor: String(ruins7), curto: "sem 1–2★" },
  ];
  if (lucroSubir)
    portoes.push({
      chave: "lucro",
      rotulo: `Lucro da semana ≥ ${Math.round(sobe * 100)}% do patamar do degrau (2 semanas)`,
      ok: lucroSubir.ok,
      valor: lucroSubir.medindo
        ? `medindo o patamar (${2 - lucroSubir.faltamPatamar} de 2 semanas completas)`
        : `${lucroSubir.semanas.length ? lucroSubir.semanas.map((w) => moeda(w.lucro)).join(" · ") : "sem semana depois do patamar"} vs ${moeda(lucroSubir.meta)}`,
      curto: "lucro",
    });
  const portoesOk = portoes.every((p) => p.ok);

  // Atalho pelo ritmo: no 1º degrau, 2 pedidos/dia por 4 dias + 1 avaliação nova.
  const ritmo = dias > 0 ? vendasDesde / dias : 0;
  const atalho = ehPrimeiro
    ? {
        dias: num(regras.ritmoDias),
        pedidosDia: num(regras.ritmoPedidosDia),
        ritmo,
        ok: dias >= num(regras.ritmoDias) && ritmo >= num(regras.ritmoPedidosDia) && avaliacoesDesde >= 1 && (nota == null || nota >= regras.nota) && ruins7 === 0,
      }
    : null;

  // ---- Rampa sazonal (produto "só na época de…") ----
  const S = ctx.sazonal && ctx.sazonal.tipo === "epoca" ? ctx.sazonal : null;
  let sazonal = null;
  if (S) {
    const acimaDe = (x) => degraus.filter((d) => d > x + 0.004 && d <= alvo + 0.004);
    const restantes = preco != null && alvo != null && preco < alvo - 0.004 ? acimaDe(preco).length : 0;
    const minD = Math.max(1, num(regras.sazonalDiasMin));
    sazonal = { ...S, restantes };
    if (S.fase === "subindo" || S.fase === "pico") {
      const ini = desde > S.inicioTemporada ? desde : S.inicioTemporada;
      const intervalo = restantes > 0 ? Math.max(minD, Math.floor(Math.max(0, diasEntre(ini, S.limite)) / restantes)) : null;
      const proximaData = restantes > 0 ? (S.fase === "pico" ? maisDias(desde, minD) : maisDias(ini, intervalo)) : null;
      const cronograma = [];
      if (restantes > 0) {
        let d = proximaData;
        for (const v of acimaDe(preco)) {
          cronograma.push({ preco: v, data: d });
          d = maisDias(d, intervalo || minD);
        }
      }
      const ritmoAnt = segAnt && segAtual?.tipo === "subida" ? segAnt.vendasReais / Math.max(1, diasEntre(segAnt.inicio, segAnt.fim || hoje)) : null;
      const voltar = ritmoAnt > 0 && dias >= minD && ritmo < num(regras.sazonalQuedaVolta) * ritmoAnt;
      const pelaData = !!proximaData && hoje >= proximaData && ritmo >= num(regras.sazonalRitmoMin);
      const pelaPressa = ritmo >= num(regras.ritmoPedidosDia) && dias >= num(regras.ritmoDiasSazonal);
      const subir = restantes > 0 && dias >= minD && ruins7 === 0 && (pelaData || pelaPressa);
      const atrasado = restantes > 0 && !subir && !!proximaData && hoje >= proximaData && dias >= minD;
      sazonal = { ...sazonal, proximaData, intervalo, cronograma, ritmo, ritmoAnt, subir, atrasado, voltar, pelaPressa: subir && pelaPressa && !pelaData };
    } else if (S.fase === "entressafra") {
      const lucroAlvo = lucroEm(alvo);
      const pMetade = lucroAlvo > 0 ? (ctx.lucroEm ? precoComLucro(lucroAlvo / 2, alvo) : ctx.canal ? precoParaLucro(ctx.canal, lucroAlvo / 2, ctx.custo, ctx.peso, ctx.cfg) : null) : null;
      let pMin = null;
      try {
        pMin = !ctx.lucroEm && ctx.canal && ctx.cfg ? precoMinimoAceitavel(ctx.canal, ctx.custo, ctx.peso, ctx.cfg) : null;
      } catch {
        pMin = null;
      }
      const piso = Math.max(pMetade != null ? finalAcima(pMetade) : 0, pMin != null ? finalAcima(pMin) : 0) || null;
      const espera = S.diasDesdeEvento <= num(regras.entressafraEspera);
      const segEvento = segs.find((g) => g.inicio <= S.anterior && (g.fim == null || g.fim > S.anterior)) || null;
      const patTemp = segEvento ? segEvento.patamar ?? segEvento.mediaLucro : null;
      const pos = (segAtual?.completas || []).filter((w) => w.data > S.anterior);
      const ult2 = pos.slice(-2);
      const ultDescEntressafra = segAtual?.tipo === "descida" && segAtual.observacao === "entressafra";
      const naoAjudou = ultDescEntressafra && !!segAnt && segAtual.completas.length >= 2 && segAtual.mediaLucro <= (segAnt.saida ?? 0) + 0.005;
      let precoNovo = preco != null ? finalAbaixo(preco * (1 - num(regras.entressafraPasso))) : null;
      if (piso != null && precoNovo != null && precoNovo < piso) precoNovo = piso;
      const noPiso = piso != null && preco != null && preco <= piso + 0.004;
      const desce = !espera && !noPiso && !naoAjudou && patTemp > 0 && ult2.length === 2 && ult2.every((w) => w.lucro < num(regras.entressafraQueda) * patTemp) && precoNovo < preco - 0.004;
      sazonal = { ...sazonal, piso, espera, patTemp, semanasPos: ult2, naoAjudou, noPiso, desce, precoNovo };
    }
  }

  // Aviso de campanha (informativo, nada bloqueia): a plataforma costuma pedir
  // preço abaixo do menor preço dos últimos 30 dias.
  let campanhaAviso = null;
  const pc = ctx.proximaCampanha || null;
  if (pc && pc.dias >= 0 && pc.dias <= 30 && preco != null) {
    const corte30 = menosDias(hoje, 30);
    const lista = [preco];
    for (const r of regs) if (r.preco != null && r.data >= corte30) lista.push(num(r.preco));
    const antes = [...regs].reverse().find((r) => r.preco != null && r.data < corte30);
    if (antes) lista.push(num(antes.preco));
    for (const a of Array.isArray(rampa.checklist?.ajustesDegrau) ? rampa.checklist.ajustesDegrau : []) if (a.data >= corte30) lista.push(num(a.de));
    const menor = Math.min(...lista.filter((v) => v > 0));
    campanhaAviso = { ...pc, menor, lucro: lucroEm(menor) };
  }

  // Ads: última semana com gasto.
  const lucroAtual = lucroEm(preco);
  const roasMin = lucroAtual > 0 ? preco / lucroAtual : null;
  const semanasAds = semanasN.filter((s) => num(s.ads_gasto) > 0);
  const roasDe = (s) => (num(s.ads_gasto) > 0 ? (num(s.ads_vendas) * (num(s.preco) || preco)) / num(s.ads_gasto) : null);
  // % orgânico = (total − Ads − conhecidos) ÷ (total − conhecidos).
  const organicoDe = (s) => (vendasParaDecisao(s) > 0 ? Math.max(0, vendasParaDecisao(s) - num(s.ads_vendas)) / vendasParaDecisao(s) : null);
  const ultAds = semanasAds[semanasAds.length - 1] || null;
  const roas = ultAds ? roasDe(ultAds) : null;
  const organico = ultimaSemanaN ? organicoDe(ultimaSemanaN) : null;
  const organicoAntes = semanasN.length > 1 ? organicoDe(semanasN[semanasN.length - 2]) : null;
  // A sugestão de Ads (usar? aumentar? pausar?) é decidida SÓ em lib/ads.js.

  const alertaNota = nota != null && nota < regras.notaAlerta;

  // ---- Teste de lançamento (Ads com orçamento fechado) ----
  // Rampa refeita grava um novo "inicio": vale o mais recente.
  const inicioReg = [...regs].reverse().find((r) => r.tipo === "inicio");
  const inicioRampa = inicioReg?.data || (rampa.criado_em ? dataSP(rampa.criado_em) : hoje);
  const diasRampa = Math.max(0, diasEntre(inicioRampa, hoje));
  const lucroNoAlvo = lucroEm(alvo);
  const orcInfo = detalheOrcamentoTeste(lucroNoAlvo, regras);
  const orcSugerido = orcInfo.valor;
  let teste;
  if (rampa.teste_status === "pulado") teste = { status: "pulado" };
  else if (rampa.teste_status === "iniciado" || rampa.teste_status === "concluido") {
    const ini = rampa.teste_inicio || hoje;
    const prazo = num(rampa.teste_dias) || regras.testeDias;
    const meta = num(rampa.teste_meta) || regras.testeMeta;
    const orc = num(rampa.teste_orcamento) || orcSugerido;
    const ate = rampa.teste_fim || maisDias(ini, prazo);
    const doTeste = regs.filter((r) => r.data >= ini && r.data <= ate);
    const gasto = doTeste.reduce((s, r) => s + num(r.ads_gasto), 0);
    const cliques = doTeste.reduce((s, r) => s + num(r.ads_cliques), 0);
    const vendasAds = doTeste.reduce((s, r) => s + num(r.ads_vendas), 0);
    const custoVenda = vendasAds > 0 ? gasto / vendasAds : null;
    const diasPassados = Math.max(0, diasEntre(ini, hoje));
    const semVenda = cliques >= regras.testeCliquesSemVenda && vendasAds === 0;
    const acabou = rampa.teste_status === "concluido" || vendasAds >= meta || (orc > 0 && gasto >= orc - 0.01) || diasPassados >= prazo || semVenda;
    let resultado = null;
    if (acabou) {
      if (semVenda) resultado = { chave: "revisar", tom: "bad", titulo: "Revisar anúncio", texto: `${cliques} cliques e nenhuma venda: as pessoas chegam mas não compram — o problema é foto, título ou preço, não visita.` };
      else if (custoVenda == null) resultado = { chave: "sem-dados", tom: "warn", titulo: "Sem vendas pelo Ads", texto: gasto > 0 ? `Gastou ${moeda(gasto)} sem venda.` : "Registre o gasto, os cliques e as vendas via Ads do teste." };
      else if (lucroNoAlvo > 0 && custoVenda <= lucroNoAlvo) resultado = { chave: "valeu", tom: "good", titulo: "Valeu a pena", texto: `Custo por venda ${moeda(custoVenda)} ≤ lucro no alvo (${moeda(lucroNoAlvo)}). Desligue o Ads e siga no orgânico com a rampa.` };
      else if (lucroNoAlvo > 0 && custoVenda > 2 * lucroNoAlvo) resultado = { chave: "caro", tom: "bad", titulo: "Saiu caro", texto: `Custo por venda ${moeda(custoVenda)}, mais que 2× o lucro no alvo (${moeda(lucroNoAlvo)}). Não repita — foque no orgânico e no anúncio.` };
      else resultado = { chave: "ok", tom: "warn", titulo: "Aceitável", texto: `Custo por venda ${moeda(custoVenda)} (lucro no alvo ${moeda(lucroNoAlvo)}). Cumpriu o papel; não repita sem necessidade.` };
    }
    teste = {
      status: acabou ? "concluido" : "andamento",
      salvoConcluido: rampa.teste_status === "concluido",
      inicio: ini, ate, prazo, meta, orc, gasto, cliques, vendasAds, custoVenda,
      diasRestantes: Math.max(0, prazo - diasPassados), resultado,
    };
  } else if (ctx.adsAtivo) teste = { status: "ads-ligado", periodo: ctx.adsAtivo };
  else if (num(rampa.vendas_iniciais) >= regras.testeMeta) teste = { status: "nao-aplica" };
  else if (vendasTotalDecisao >= regras.testeDispensaVendas) teste = { status: "nao-precisa" };
  else if (diasRampa < regras.testeObservarDias) teste = { status: "observando", dia: diasRampa + 1, de: regras.testeObservarDias };
  else teste = { status: "recomendado" };
  teste.orcSugerido = orcSugerido;
  teste.orcInfo = orcInfo;
  teste.porDia = cent(orcSugerido / regras.testeDias);

  // ---- Acima do alvo (teste controlado, até +acimaMax) ----
  let acima = null;
  const bloqueadoAte = rampa.checklist?.acimaBloqueadoAte || null;
  // Rampa sazonal no alvo (out/2026): "vendendo muito — suba +5%" com teste
  // curto (sazonalAcimaDias, 7) e só enquanto faltar tempo até o corte da entrega.
  const diasAcima = S ? num(regras.sazonalAcimaDias) || 7 : regras.acimaDias;
  if ((noAlvo || acimaAtivo) && alvo > 0) {
    const tetoAcima = finalAbaixo(alvo * (1 + num(regras.acimaMax)));
    const semNoPreco = semanasN.filter((s) => s.data >= desde);
    const ult3 = semNoPreco.slice(-regras.acimaSemanas);
    const estaveis = ult3.length >= regras.acimaSemanas && vendasParaDecisao(ult3[ult3.length - 1]) >= 0.9 * vendasParaDecisao(ult3[0]) && vendasParaDecisao(ult3[0]) > 0;
    if (acimaAtivo) {
      // Testando acima: compara o lucro médio por semana neste preço com as semanas no preço anterior.
      const antesSem = semanasN.filter((s) => s.data < desde).slice(-regras.acimaSemanas);
      const lucroSem = (s) => vendasParaDecisao(s) * (lucroEm(num(s.preco) || preco) ?? 0);
      const media = (arr) => (arr.length ? arr.reduce((t, s) => t + lucroSem(s), 0) / arr.length : null);
      const lAntes = media(antesSem);
      const lDepois = media(semNoPreco);
      const pronto = dias >= diasAcima && semNoPreco.length > 0 && lAntes != null;
      acima = {
        ativo: true,
        preco,
        anterior: degraus[i - 1] ?? alvo,
        lucroAntes: lAntes,
        lucroDepois: lDepois,
        diasFaltam: Math.max(0, diasAcima - dias),
        aprovado: pronto && lDepois >= lAntes - 0.005,
        reprovado: pronto && lDepois < lAntes - 0.005,
        proximo: (() => {
          const pn = finalAbaixo(preco * (1 + num(regras.passo)));
          return pn > preco && pn <= tetoAcima ? pn : null;
        })(),
      };
    } else {
      let prox = finalAbaixo(alvo * (1 + num(regras.passo)));
      if (prox <= alvo) prox = finalAcima(alvo + 0.02);
      const lAgora = lucroEm(alvo);
      const lProx = lucroEm(prox);
      const podePerder = lAgora > 0 && lProx > lAgora ? 1 - lAgora / lProx : null;
      const bloqueado = bloqueadoAte && bloqueadoAte > hoje;
      const criterios = [
        { rotulo: `${regras.acimaDias} dias no alvo`, ok: dias >= regras.acimaDias, valor: `${dias} dia${dias === 1 ? "" : "s"}` },
        { rotulo: `${regras.acimaSemanas} semanas de vendas estáveis`, ok: estaveis, valor: ult3.length ? ult3.map((s) => fmtSemana(vendasParaDecisao(s))).join(" → ") : "sem registro" },
        { rotulo: `Nota ≥ ${String(regras.nota).replace(".", ",")} e nenhuma 1–2★ recente`, ok: nota != null && nota >= regras.nota && ruins7 === 0, valor: nota != null ? String(nota).replace(".", ",") : "—" },
      ];
      if (bloqueado) criterios.push({ rotulo: "Teste anterior falhou", ok: false, valor: `liberado em ${bloqueadoAte.slice(8, 10)}/${bloqueadoAte.slice(5, 7)}` });
      acima = { ativo: false, prox: prox <= tetoAcima ? prox : null, teto: tetoAcima, lucroAgora: lAgora, lucroProx: lProx, podePerder, criterios, pronto: criterios.every((c) => c.ok) && prox <= tetoAcima };
      // Sazonal: na temporada, no alvo e vendendo 2× o ritmo do cronograma por
      // alguns dias → sugere +5% já (sem esperar 14 dias / 3 semanas), desde que
      // o teste de 7 dias termine antes do corte da entrega.
      if (sazonal && (sazonal.fase === "subindo" || sazonal.fase === "pico")) {
        const r = num(sazonal.ritmo);
        const folga = num(sazonal.diasAteEvento) - num(regras.sazonalCorteDias || 7) - diasAcima;
        const vendendoMuito = r >= 2 * num(regras.sazonalRitmoMin) && dias >= num(regras.ritmoDiasSazonal) && ruins7 === 0;
        acima = {
          ...acima,
          sazonal: true,
          criterios: [
            { rotulo: `Vendendo ${2 * num(regras.sazonalRitmoMin)}+ pedidos/dia há ${regras.ritmoDiasSazonal}+ dias`, ok: vendendoMuito, valor: `${String(Math.round(r * 10) / 10).replace(".", ",")}/dia · ${dias} dia${dias === 1 ? "" : "s"}` },
            { rotulo: `Teste de ${diasAcima} dias acaba antes do corte da entrega`, ok: folga >= 0, valor: `${sazonal.diasAteEvento} dias até ${sazonal.nome}` },
            { rotulo: "Nenhuma 1–2★ recente", ok: ruins7 === 0, valor: ruins7 ? `${ruins7}` : "ok" },
          ],
          pronto: vendendoMuito && folga >= 0 && !!acima.prox && !(bloqueadoAte && bloqueadoAte > hoje),
        };
      }
    }
  }

  // Funil do anúncio (ctx.funilLoja = mediana da loja, quando houver 5+ produtos).
  const funil = diagnosticarFunil(metricasFunil(rampa, registros, regras, hoje), regras, ctx.funilLoja || null);

  // Revisar anúncio — UMA fonte (diagnosticoAnuncio). ROAS nunca durante o
  // teste de lançamento, e as semanas do teste não contam pra régua depois.
  // (com Ads inviável o problema é a margem do degrau, não a conversão)
  const noTeste = (s) => teste.inicio && s.data >= teste.inicio && s.data <= teste.ate;
  const adsForaTeste = semanasAds.filter((s) => !noTeste(s)).slice(-2);
  // Ads ligado ainda no aprendizado (19/10/2026, Gustavo): espera os 7 dias
  // do Ads antes de pedir pra arrumar o anúncio por poucas vendas/ROAS — sem
  // venda nenhuma, o aviso do dia 3 do próprio Ads já cobre.
  const adsAprendendo = !!ctx.adsAtivo && diasEntre(ctx.adsAtivo.inicio, hoje) < num(regras.adsAprendizadoDias ?? 7);
  const revisarPorAds =
    !adsAprendendo &&
    teste.status !== "andamento" &&
    adsForaTeste.length === 2 &&
    roasMin != null &&
    roasMin <= regras.roasInviavel &&
    adsForaTeste.every((s) => (roasDe(s) ?? 0) < roasMin);
  const revisarPorLancamento = !adsAprendendo && i === 0 && dias >= regras.revisarDias && vendasDesde < regras.vendas / 2;
  const vendasDepoisTeste = teste.ate ? semanas.filter((s) => s.data > teste.ate).reduce((t, s) => t + vendasParaDecisao(s), 0) : 0;
  const revisarPorTeste = teste.resultado?.chave === "revisar" && vendasDepoisTeste === 0;
  const anuncio = diagnosticoAnuncio({
    funil,
    teste: revisarPorTeste ? teste : null,
    roas: revisarPorAds ? { roas: roasDe(adsForaTeste[1]), roasMin } : null,
    lancamento: revisarPorLancamento ? { dias, vendas: vendasDesde } : null,
  });
  const revisar = !!anuncio;
  // Aviso mais cedo (out/2026): N dias no degrau sem nenhuma venda (fora conhecidos).
  const semVenda = !noAlvo && !acimaAtivo && dias >= num(regras.semVendaDias ?? 7) && vendasDesde === 0 ? { dias } : null;

  // Sugestão — rampa normal: voltar (lucro) > revisar anúncio > sinaliza >
  // subir (1º degrau: portões OU atalho pelo ritmo; depois: portões + lucro
  // ≥ 120% do patamar) > segurar. Rampa sazonal: cronograma/entressafra.
  const salto = (ok) => ok && vendasDesde >= num(regras.saltoVendas) * regras.vendas && i + 2 <= degraus.length - 1 && !(degraus[i + 2] > alvo + 0.004);
  const podeSubir = !alertaNota && (portoesOk || !!atalho?.ok);
  let sugestao;
  if (acimaAtivo) {
    sugestao = acima?.aprovado
      ? { chave: "acima-aprovado", tom: "good", rotulo: "Acima aprovado" }
      : acima?.reprovado
        ? { chave: "acima-voltar", tom: "bad", rotulo: "Voltar ao alvo" }
        : { chave: "acima-testando", tom: "warn", rotulo: `Testando acima (${acima?.diasFaltam ?? 0}d)` };
  } else if (sazonal) {
    const z = sazonal;
    const dm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
    if (z.fase === "entressafra")
      sugestao = z.desce
        ? { chave: "descer", tom: "warn", rotulo: `Descer pra ${moeda(z.precoNovo)}`, preco: z.precoNovo }
        : { chave: "segurar", tom: "neu", rotulo: z.espera ? "Depois da data: aguarde" : z.noPiso ? "No piso da entressafra" : z.naoAjudou ? "Estacionado" : "Entressafra" };
    else if (z.fase === "aguardando") sugestao = { chave: "segurar", tom: "neu", rotulo: `Aguardando a temporada (${dm(z.inicioTemporada)})` };
    else if (noAlvo)
      sugestao = acima?.sazonal && acima.pronto ? { chave: "testar-acima", tom: "good", rotulo: "Vendendo muito — testar +5%" } : { chave: "alvo", tom: "good", rotulo: `No alvo · ${z.nome}` };
    else if (z.voltar) sugestao = { chave: "voltar", tom: "bad", rotulo: "Voltar degrau" };
    else if (revisar) sugestao = { chave: "revisar", tom: "bad", rotulo: "Revisar anúncio" };
    else if (z.subir && !alertaNota) sugestao = { chave: "subir", tom: "good", rotulo: z.pelaPressa ? "Subir degrau (vendendo rápido)" : "Subir degrau (cronograma)", saltos: 1 };
    else if (z.atrasado) sugestao = { chave: "atrasado", tom: "warn", rotulo: "Atrasado no cronograma" };
    else sugestao = { chave: "segurar", tom: "neu", rotulo: z.proximaData ? `No cronograma · próximo ${dm(z.proximaData)}` : "Segurar" };
  } else if (noAlvo) sugestao = acima?.pronto ? { chave: "testar-acima", tom: "good", rotulo: "Testar acima do alvo" } : { chave: "alvo", tom: "good", rotulo: "No alvo" };
  else if (lucroCheck?.status === "voltar") sugestao = { chave: "voltar", tom: "bad", rotulo: "Voltar degrau" };
  else if (revisar) sugestao = { chave: "revisar", tom: "bad", rotulo: "Revisar anúncio" };
  else if (semVenda) sugestao = { chave: "sem-venda", tom: "warn", rotulo: `${semVenda.dias} dias sem venda` };
  else if (lucroCheck?.status === "sinaliza") sugestao = { chave: "segurar", tom: "warn", rotulo: lucroCheck.ultima?.ruim ? "Segurar (semana abaixo)" : "Lucrando menos" };
  else if (podeSubir && salto(portoesOk)) sugestao = { chave: "subir", tom: "good", rotulo: "Subir 2 degraus", saltos: 2 };
  else if (podeSubir) sugestao = { chave: "subir", tom: "good", rotulo: !portoesOk && atalho?.ok ? "Subir degrau (vendendo rápido)" : "Subir degrau", saltos: 1, peloRitmo: !portoesOk && !!atalho?.ok };
  else sugestao = { chave: "segurar", tom: lucroCheck?.status === "fica" ? "neu" : "warn", rotulo: lucroCheck?.status === "fica" ? "Fica: lucro mantido" : "Segurar" };

  // Uma mudança por vez (B, 31/10/2026): mexeu no Ads (ligou, orçamento, meta,
  // volta da pausa) há menos de 7 dias → não sugere subir degrau ainda.
  let adsMexeu = null;
  if (ctx.adsAtivo && sugestao.chave === "subir") {
    const a = ctx.adsAtivo;
    const ds = [String(a.inicio || "").slice(0, 10), ...(Array.isArray(a.ajustes) ? a.ajustes.filter((x) => x && x.tipo !== "pausa" && x.tipo !== "revisei").map((x) => String(x.data || "").slice(0, 10)) : [])].filter((d) => d && d <= hoje).sort();
    const ult = ds[ds.length - 1];
    const espera = num(regras.adsMexeuDias ?? 7);
    if (ult && diasEntre(ult, hoje) < espera) {
      const ate = new Date(`${ult}T12:00:00`);
      ate.setDate(ate.getDate() + espera);
      const ateIso = ate.toISOString().slice(0, 10);
      adsMexeu = { data: ult, ate: ateIso };
      sugestao = { chave: "segurar", tom: "neu", rotulo: `Ads mudou em ${ult.slice(8, 10)}/${ult.slice(5, 7)} — subir a partir de ${ateIso.slice(8, 10)}/${ateIso.slice(5, 7)}`, adsMexeu: true, saltos: sugestao.saltos };
    }
  }

  // "Pode vender até N% menos e ganhar o mesmo" no próximo degrau.
  const lucroProx = lucroEm(sugestao.saltos === 2 ? degraus[i + 2] : proximo);
  const podePerder = lucroAtual > 0 && lucroProx > lucroAtual ? 1 - lucroAtual / lucroProx : null;

  // Lucro da semana AO VIVO (23/10/2026): com ctx.seteDias (pedidos dos últimos
  // 7 dias + Ads do CSV), não espera a semana fechar; sem ele, a última semana fechada.
  const sete = ctx.seteDias;
  const lucroSemana = sete ? num(sete.vendas) * (lucroEm(preco) ?? 0) : ultimaSemanaN && ultimaSemanaN.data > corte7 ? num(ultimaSemanaN.vendas) * (lucroEm(num(ultimaSemanaN.preco) || preco) ?? 0) : null;
  const lucroSemanaAds = lucroSemana != null ? lucroSemana - (sete ? num(sete.ads) : num(ultimaSemanaN.ads_gasto)) : null;
  const lucroSemanaAlvo = sete ? num(sete.vendas) * (lucroEm(alvo) ?? 0) : ultimaSemanaN && ultimaSemanaN.data > corte7 ? num(ultimaSemanaN.vendas) * (lucroEm(alvo) ?? 0) : null;

  const alvoMudou = num(ctx.alvo) > 0 ? alvoMudouDaRampa(degraus, alvo, rampa.checklist) : null;

  return {
    alvoMudou, adsMexeu,
    degraus, i, preco, alvo, proximo, fase, acimaAtivo, noAlvo, teste, acima, diasRampa,
    lucroAtual, lucroAlvo: lucroEm(alvo), lucroProximo: lucroEm(proximo), lucroEm,
    zero: ctx.lucroEm ? precoComLucro(0, alvo) : ctx.canal ? zeroAZero(ctx.canal, ctx.custo, ctx.peso, ctx.cfg) : null,
    parcial: ctx.parcial || null,
    avaliacoesTotal, nota, vendasDesde, vendasTotal, vendasTotalDecisao, conhecidosTotal, avaliacoesDesde, dias, ruins7,
    portoes, portoesOk, roasMin, roas, organico, organicoAntes, ultAds,
    revisar, semVenda, revisarPorAds, revisarPorLancamento, revisarPorTeste, anuncio, alertaNota, sugestao, ultimaSemana, diasMin, campanhaAviso,
    segmentos: segs, lucroCheck, lucroSubir, atalho, ritmo, ehPrimeiro, sazonal, podePerder,
    lucroSemana, lucroSemanaAds, lucroSemanaAlvo, semanas, registros: regs, funil,
  };
}

// Aviso ÚNICO de "Revisar anúncio" (sugestão da linha, alerta do Detalhe,
// checklist destacado e resultado do teste leem daqui). No máximo um aviso,
// pela prioridade: 1) funil (só diagnosticando: titulo/vitrine/pagina);
// 2) teste de lançamento com cliques sem venda; 3) ROAS abaixo do mínimo por
// 2 semanas (Ads viável, fora do teste); 4) poucas vendas no 1º degrau.
// As outras fontes que concordam vão em `tambem` ("também indica: …").
// → null ou { motivo, titulo, texto, porOnde, itens, tambem: [{ motivo, titulo }] }
export function diagnosticoAnuncio({ funil, teste, roas, lancamento }) {
  const fontes = [];
  const d = funil?.status === "pronto" ? funil.diagnostico : null;
  if (d && ["titulo", "vitrine", "pagina"].includes(d.chave))
    fontes.push({ motivo: `funil-${d.chave}`, titulo: d.titulo, curto: "funil do anúncio", texto: d.texto, itens: d.itens });
  if (teste?.resultado?.chave === "revisar")
    fontes.push({
      motivo: "teste",
      titulo: "Cliques sem venda no teste de lançamento",
      curto: "teste de lançamento",
      texto: `${teste.cliques} cliques e nenhuma venda no teste: as pessoas chegam mas não compram — revise a página (fotos de uso, medidas, descrição) e o preço frente ao concorrente.`,
      itens: ["uso", "medidas", "descricao", "concorrente"],
    });
  if (roas)
    fontes.push({
      motivo: "roas",
      titulo: "Ads não se paga há 2 semanas",
      curto: "ROAS do Ads",
      texto: `ROAS ${roas.roas != null ? roas.roas.toFixed(1).replace(".", ",") : "—"} abaixo do mínimo (${roas.roasMin.toFixed(1).replace(".", ",")}) por 2 semanas: o anúncio recebe clique mas não converte.`,
      itens: ["uso", "medidas", "descricao", "concorrente"],
    });
  if (lancamento)
    fontes.push({
      motivo: "lancamento",
      titulo: "Poucas vendas no lançamento",
      curto: "vendas do lançamento",
      texto: `${lancamento.dias} dias no 1º degrau e só ${lancamento.vendas} venda${lancamento.vendas === 1 ? "" : "s"}: o preço já está perto do 0 a 0, então o problema provavelmente não é preço.`,
      itens: ["titulo", "foto", "concorrente"],
    });
  if (!fontes.length) return null;
  const [p, ...resto] = fontes;
  const rot = (k) => CHECKLIST_ANUNCIO.find((c) => c[0] === k)?.[1] || k;
  return {
    motivo: p.motivo,
    titulo: p.titulo,
    texto: p.texto,
    porOnde: p.itens.map(rot).join(", "),
    itens: p.itens,
    tambem: resto.map((f) => ({ motivo: f.motivo, titulo: f.curto })),
  };
}

function moeda(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Itens do checklist "Revisar anúncio".
export const CHECKLIST_ANUNCIO = [
  ["foto", "Foto principal limpa", "Fundo claro, produto grande ocupando a foto, sem texto poluído"],
  ["uso", "Foto de uso/ambiente", "Instalado/em uso, mostrando o tamanho real"],
  ["medidas", "Foto com medidas", "Altura × largura (e quanto aguenta, se for o caso)"],
  ["video", "Vídeo curto (até 15 s)", "Instalando ou em uso — a Shopee destaca anúncios com vídeo"],
  ["titulo", "Título com palavras de busca", "Tipo + uso + material + diferencial"],
  ["descricao", "Primeiras linhas da descrição", "Benefício e o que vem na embalagem antes do detalhe técnico"],
  ["variacoes", "Variações com foto própria", "Cada cor/opção com a sua foto"],
  ["kit", "Kit visível no mesmo anúncio", "“Leve 2/3” puxa o ticket e a conversão"],
  ["concorrente", "Comparar com o concorrente", "Preço, frete, prazo e avaliações dos 3 primeiros da busca (sem concorrente direto: compare com um substituto)"],
  ["avaliacao", "Pedir avaliação com foto", "Cartão no pacote — as primeiras avaliações com foto pesam muito"],
];
