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
import { lucroNoPreco, precoParaLucro, precoParaMargem } from "./escada.js";

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
  maxDegraus: 8, // máximo de degraus do 1º ao alvo (passo cresce se a distância for grande)
  saltoVendas: 2, // vendas desde o degrau ≥ 2× o portão → sugere subir 2 degraus
  diasAposSalto: 14, // depois de salto duplo ou de voltar: dias mínimos até a próxima mudança
  diasCampanha: 14, // não subir nos X dias antes de uma campanha marcada
  // Teste de lançamento com Ads (rampa que começou sem vendas)
  testeObservarDias: 5, // dias observando só o orgânico antes de recomendar
  testeDispensaVendas: 3, // vendas que dispensam o teste (o orgânico pegou)
  testeMeta: 10, // vendas que o teste busca
  testeMin: 30, // orçamento mínimo (R$)
  testeMax: 100, // orçamento máximo (R$)
  testeDias: 7, // prazo do teste
  testeCliquesSemVenda: 50, // tantos cliques sem venda = problema é o anúncio
  // Acima do alvo
  acimaDias: 14, // dias no alvo antes de sugerir testar acima / duração do teste acima
  acimaSemanas: 3, // semanas de vendas estáveis no alvo
  acimaMax: 0.2, // no máximo +20% acima do alvo
  acimaBloqueioDias: 30, // se o teste acima falhar, não tenta de novo por X dias
};

// Orçamento sugerido do teste de lançamento: meta × lucro por venda no alvo,
// entre o mínimo e o máximo, arredondado pra cima de 5 em 5.
export function orcamentoTeste(lucroAlvo, regras = REGRAS_PADRAO) {
  const bruto = num(regras.testeMeta) * Math.max(0, num(lucroAlvo));
  const lim = Math.min(num(regras.testeMax), Math.max(num(regras.testeMin), bruto));
  return Math.ceil(lim / 5) * 5;
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

// Degraus sugeridos: do 1º (0 a 0 + lucroEntrada, final ,49/,99) até o alvo,
// cada um no máximo `passo` acima do anterior (arredondado pros finais).
export function sugerirDegraus({ canal, custo, peso, cfg, alvo, regras = REGRAS_PADRAO }) {
  const a = cent(num(alvo));
  if (!(a > 0)) return [];
  const pe = precoParaLucro(canal, num(regras.lucroEntrada), custo, peso, cfg);
  let p = pe != null ? finalAcima(pe) : a;
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

// Normaliza a lista digitada: números > 0, ordem crescente, sem repetidos.
export function normalizarDegraus(lista) {
  const vals = [...new Set((lista || []).map((v) => cent(num(v))).filter((v) => v > 0))].sort((x, y) => x - y);
  return vals;
}

export function faseDe(rampa) {
  const n = (rampa?.degraus || []).length;
  const i = rampa?.degrau_atual ?? 0;
  if (!n) return { chave: "lancamento", rotulo: "Lançamento" };
  if (i >= n - 1) return { chave: "alvo", rotulo: "No alvo" };
  if (i === 0) return { chave: "lancamento", rotulo: "Lançamento" };
  return { chave: "tracao", rotulo: "Tração" };
}

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

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
  const lucroEm = (p) => (p > 0 && ctx.canal ? lucroNoPreco(ctx.canal, p, ctx.custo, ctx.peso, ctx.cfg) : null);
  const regs = (registros || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const semanas = regs.filter((r) => r.tipo === "semana");
  const ultimaSemana = semanas[semanas.length - 1] || null;
  const comAval = [...regs].reverse().find((r) => r.avaliacoes != null);
  const avaliacoesTotal = comAval ? num(comAval.avaliacoes) : num(rampa.base_avaliacoes);
  const comNota = [...regs].reverse().find((r) => r.nota != null && r.nota !== "");
  const nota = comNota ? num(comNota.nota) : null;
  const desde = rampa.desde || hoje;
  const vendasDesde = semanas.filter((s) => s.data >= desde).reduce((s, r) => s + num(r.vendas), 0);
  const vendasTotal = num(rampa.vendas_iniciais) + semanas.reduce((s, r) => s + num(r.vendas), 0);
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
  const campanha = rampa.checklist?.campanha || null;
  const diasAteCampanha = campanha ? diasEntre(hoje, campanha) : null;
  const campanhaPerto = diasAteCampanha != null && diasAteCampanha >= 0 && diasAteCampanha <= num(regras.diasCampanha);

  const portoes = [
    { chave: "avaliacoes", rotulo: "Avaliações desde o último degrau", ok: avaliacoesDesde >= regras.avaliacoes, valor: `+${avaliacoesDesde} de +${regras.avaliacoes}`, falta: Math.max(0, regras.avaliacoes - avaliacoesDesde), curto: "avaliações" },
    { chave: "vendas", rotulo: "Vendas desde o último degrau", ok: vendasDesde >= regras.vendas, valor: `+${vendasDesde} de +${regras.vendas}`, falta: Math.max(0, regras.vendas - vendasDesde), curto: "vendas" },
    { chave: "nota", rotulo: `Nota ≥ ${String(regras.nota).replace(".", ",")}`, ok: nota != null && nota >= regras.nota, valor: nota != null ? String(nota).replace(".", ",") : "—", curto: "nota" },
    { chave: "dias", rotulo: `Tempo no degrau ≥ ${diasMin} dias${diasMin > regras.dias ? (ultMud?.tipo === "descida" ? " (voltou de degrau)" : " (depois de salto duplo)") : ""}`, ok: dias >= diasMin, valor: `${dias} dia${dias === 1 ? "" : "s"}`, falta: Math.max(0, diasMin - dias), curto: "dias" },
    { chave: "ruins", rotulo: "Nenhuma avaliação 1–2★ nos últimos 7 dias", ok: ruins7 === 0, valor: String(ruins7), curto: "sem 1–2★" },
  ];
  if (campanha) portoes.push({ chave: "campanha", rotulo: `Sem campanha nos próximos ${regras.diasCampanha} dias`, ok: !campanhaPerto, valor: diasAteCampanha >= 0 ? `campanha em ${diasAteCampanha} dia${diasAteCampanha === 1 ? "" : "s"}` : "já passou", curto: campanhaPerto ? "campanha perto" : "campanha" });
  const portoesOk = portoes.every((p) => p.ok);

  // Check depois da última mudança de degrau (subida): compara cada semana
  // registrada depois dela com a última semana antes dela.
  const ultimaSubida = [...regs].reverse().find((r) => r.tipo === "subida" || r.tipo === "descida");
  let check = null;
  if (ultimaSubida && ultimaSubida.tipo === "subida") {
    const antes = [...semanas].reverse().find((s) => s.data < ultimaSubida.data || (s.data === ultimaSubida.data && String(s.criado_em || "") < String(ultimaSubida.criado_em || "")));
    const depois = semanas.filter((s) => s.data > ultimaSubida.data || (s.data === ultimaSubida.data && String(s.criado_em || "") > String(ultimaSubida.criado_em || "")));
    if (antes && depois.length) {
      const lucroSem = (s) => num(s.vendas) * (lucroEm(num(s.preco) || preco) ?? 0);
      const lAntes = lucroSem(antes);
      const avaliar = depois.map((s) => {
        const lucroOk = lucroSem(s) >= lAntes - 0.005;
        const vendasOk = num(s.vendas) >= regras.pisoVendas * num(antes.vendas);
        return { s, lucro: lucroSem(s), lucroOk, vendasOk, ok: lucroOk && vendasOk };
      });
      let falhasSeguidas = 0;
      for (let k = avaliar.length - 1; k >= 0 && !avaliar[k].ok; k--) falhasSeguidas++;
      const ult = avaliar[avaliar.length - 1];
      check = {
        de: num(antes.preco),
        para: num(ultimaSubida.preco),
        lucroAntes: lAntes,
        lucroDepois: ult.lucro,
        vendasAntes: num(antes.vendas),
        vendasDepois: num(ult.s.vendas),
        lucroOk: ult.lucroOk,
        vendasOk: ult.vendasOk,
        falhasSeguidas,
      };
    } else if (antes) check = { de: num(antes.preco), para: num(ultimaSubida.preco), pendente: true };
  }

  // Ads: última semana com gasto.
  const lucroAtual = lucroEm(preco);
  const roasMin = lucroAtual > 0 ? preco / lucroAtual : null;
  const semanasAds = semanas.filter((s) => num(s.ads_gasto) > 0);
  const roasDe = (s) => (num(s.ads_gasto) > 0 ? (num(s.ads_vendas) * (num(s.preco) || preco)) / num(s.ads_gasto) : null);
  const organicoDe = (s) => (num(s.vendas) > 0 ? Math.max(0, num(s.vendas) - num(s.ads_vendas)) / num(s.vendas) : null);
  const ultAds = semanasAds[semanasAds.length - 1] || null;
  const roas = ultAds ? roasDe(ultAds) : null;
  const organico = ultimaSemana ? organicoDe(ultimaSemana) : null;
  const organicoAntes = semanas.length > 1 ? organicoDe(semanas[semanas.length - 2]) : null;
  const ultimas2Ads = semanasAds.slice(-2);
  const abaixo2 = ultimas2Ads.length === 2 && roasMin != null && ultimas2Ads.every((s) => (roasDe(s) ?? 0) < roasMin);
  const muitoAbaixo2 = ultimas2Ads.length === 2 && roasMin != null && ultimas2Ads.every((s) => (roasDe(s) ?? 0) < 0.8 * roasMin);
  let ads;
  if (roasMin == null || roasMin > regras.roasInviavel)
    ads = { chave: "inviavel", tom: "bad", titulo: "Ads inviável neste degrau", texto: roasMin == null ? "Sem lucro neste preço: cada venda paga dá prejuízo. Cresça no orgânico." : `Com lucro de ${moeda(lucroAtual)} por venda, cada R$ 1 de Ads precisa trazer ${moeda(roasMin)} de venda só pra empatar. Cresça no orgânico.` };
  else if (muitoAbaixo2) ads = { chave: "pausar", tom: "bad", titulo: "Pausar Ads", texto: "ROAS abaixo de 80% do mínimo por 2 semanas: o Ads está dando prejuízo." };
  else if (abaixo2) ads = { chave: "reduzir", tom: "warn", titulo: "Reduzir Ads em 25%", texto: "ROAS abaixo do mínimo por 2 semanas." };
  else if (organico != null && organico >= 0.6 && organicoAntes != null && organico >= organicoAntes - 0.05 && semanasAds.length)
    ads = { chave: "reduzir-aos-poucos", tom: "good", titulo: "Reduzir aos poucos", texto: `${Math.round(organico * 100)}% das vendas já são orgânicas: o anúncio anda sozinho. Corte 20–30% do orçamento por semana.` };
  else if (roas != null && roas >= 1.5 * roasMin && organico != null && organicoAntes != null && organico >= organicoAntes)
    ads = { chave: "aumentar", tom: "good", titulo: "Pode aumentar ~20%", texto: "ROAS bem acima do mínimo e o orgânico subindo." };
  else if (roas != null && roas >= roasMin) ads = { chave: "manter", tom: "neu", titulo: "Manter", texto: "ROAS acima do mínimo." };
  else if (roas != null) ads = { chave: "atencao", tom: "warn", titulo: "Atenção", texto: "ROAS abaixo do mínimo nesta semana — se repetir na próxima, reduza 25%." };
  else ads = { chave: "sem", tom: "neu", titulo: "Ads viável a partir deste degrau", texto: `ROAS mínimo para empatar: ${roasMin.toFixed(1).replace(".", ",")}. Se ligar, registre gasto e vendas via Ads na semana.` };
  // A partir de qual degrau o Ads fica viável
  let viavelEm = null;
  for (let k = i; k < degraus.length; k++) {
    const l = lucroEm(degraus[k]);
    if (l > 0 && degraus[k] / l <= regras.roasInviavel) {
      viavelEm = { preco: degraus[k], roasMin: degraus[k] / l };
      break;
    }
  }

  // Revisar anúncio
  // (com Ads inviável o problema é a margem do degrau, não a conversão)
  const revisarPorAds = abaixo2 && roasMin != null && roasMin <= regras.roasInviavel;
  const revisarPorLancamento = i === 0 && dias >= regras.revisarDias && vendasDesde < regras.vendas / 2;
  const revisar = revisarPorAds || revisarPorLancamento;
  const alertaNota = nota != null && nota < regras.notaAlerta;

  // ---- Teste de lançamento (Ads com orçamento fechado) ----
  const inicioReg = regs.find((r) => r.tipo === "inicio");
  const inicioRampa = inicioReg?.data || String(rampa.criado_em || hoje).slice(0, 10);
  const diasRampa = Math.max(0, diasEntre(inicioRampa, hoje));
  const lucroNoAlvo = lucroEm(alvo);
  const orcSugerido = orcamentoTeste(lucroNoAlvo, regras);
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
  } else if (num(rampa.vendas_iniciais) >= regras.testeMeta) teste = { status: "nao-aplica" };
  else if (vendasTotal >= regras.testeDispensaVendas) teste = { status: "nao-precisa" };
  else if (diasRampa < regras.testeObservarDias) teste = { status: "observando", dia: diasRampa + 1, de: regras.testeObservarDias };
  else teste = { status: "recomendado" };
  teste.orcSugerido = orcSugerido;
  teste.porDia = Math.ceil((orcSugerido / regras.testeDias) * 2) / 2;

  // ---- Acima do alvo (teste controlado, até +acimaMax) ----
  let acima = null;
  const bloqueadoAte = rampa.checklist?.acimaBloqueadoAte || null;
  if ((noAlvo || acimaAtivo) && alvo > 0) {
    const tetoAcima = finalAbaixo(alvo * (1 + num(regras.acimaMax)));
    const semNoPreco = semanas.filter((s) => s.data >= desde);
    const ult3 = semNoPreco.slice(-regras.acimaSemanas);
    const estaveis = ult3.length >= regras.acimaSemanas && num(ult3[ult3.length - 1].vendas) >= 0.9 * num(ult3[0].vendas) && num(ult3[0].vendas) > 0;
    if (acimaAtivo) {
      // Testando acima: compara o lucro médio por semana neste preço com as semanas no preço anterior.
      const antesSem = semanas.filter((s) => s.data < desde).slice(-regras.acimaSemanas);
      const lucroSem = (s) => num(s.vendas) * (lucroEm(num(s.preco) || preco) ?? 0);
      const media = (arr) => (arr.length ? arr.reduce((t, s) => t + lucroSem(s), 0) / arr.length : null);
      const lAntes = media(antesSem);
      const lDepois = media(semNoPreco);
      const pronto = dias >= regras.acimaDias && semNoPreco.length > 0 && lAntes != null;
      acima = {
        ativo: true,
        preco,
        anterior: degraus[i - 1] ?? alvo,
        lucroAntes: lAntes,
        lucroDepois: lDepois,
        diasFaltam: Math.max(0, regras.acimaDias - dias),
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
        { rotulo: `${regras.acimaSemanas} semanas de vendas estáveis`, ok: estaveis, valor: ult3.length ? ult3.map((s) => num(s.vendas)).join(" → ") : "sem registro" },
        { rotulo: `Nota ≥ ${String(regras.nota).replace(".", ",")} e nenhuma 1–2★ recente`, ok: nota != null && nota >= regras.nota && ruins7 === 0, valor: nota != null ? String(nota).replace(".", ",") : "—" },
      ];
      if (campanha) criterios.push({ rotulo: "Sem campanha perto", ok: !campanhaPerto, valor: campanhaPerto ? `em ${diasAteCampanha} dias` : "ok" });
      if (bloqueado) criterios.push({ rotulo: "Teste anterior falhou", ok: false, valor: `liberado em ${bloqueadoAte.slice(8, 10)}/${bloqueadoAte.slice(5, 7)}` });
      acima = { ativo: false, prox: prox <= tetoAcima ? prox : null, teto: tetoAcima, lucroAgora: lAgora, lucroProx: lProx, podePerder, criterios, pronto: criterios.every((c) => c.ok) && prox <= tetoAcima };
    }
  }

  let sugestao;
  if (acimaAtivo) {
    sugestao = acima?.aprovado
      ? { chave: "acima-aprovado", tom: "good", rotulo: "Acima aprovado" }
      : acima?.reprovado
        ? { chave: "acima-voltar", tom: "bad", rotulo: "Voltar ao alvo" }
        : { chave: "acima-testando", tom: "warn", rotulo: `Testando acima (${acima?.diasFaltam ?? 0}d)` };
  } else if (noAlvo) sugestao = acima?.pronto ? { chave: "testar-acima", tom: "good", rotulo: "Testar acima do alvo" } : { chave: "alvo", tom: "good", rotulo: "No alvo" };
  else if (check && !check.pendente && check.falhasSeguidas >= 2) sugestao = { chave: "voltar", tom: "bad", rotulo: "Voltar degrau" };
  else if (revisar) sugestao = { chave: "revisar", tom: "bad", rotulo: "Revisar anúncio" };
  else if (check && !check.pendente && check.falhasSeguidas === 1) sugestao = { chave: "segurar", tom: "warn", rotulo: "Segurar" };
  else if (portoesOk && !alertaNota && vendasDesde >= num(regras.saltoVendas) * regras.vendas && i + 2 <= degraus.length - 1)
    sugestao = { chave: "subir", tom: "good", rotulo: "Subir 2 degraus", saltos: 2 };
  else if (portoesOk && !alertaNota) sugestao = { chave: "subir", tom: "good", rotulo: "Subir degrau", saltos: 1 };
  else sugestao = { chave: "segurar", tom: "warn", rotulo: "Segurar" };

  const lucroSemana = ultimaSemana && ultimaSemana.data > corte7 ? num(ultimaSemana.vendas) * (lucroEm(num(ultimaSemana.preco) || preco) ?? 0) : null;
  const lucroSemanaAds = lucroSemana != null ? lucroSemana - num(ultimaSemana.ads_gasto) : null;
  const lucroSemanaAlvo = ultimaSemana && ultimaSemana.data > corte7 ? num(ultimaSemana.vendas) * (lucroEm(alvo) ?? 0) : null;

  return {
    degraus, i, preco, alvo, proximo, fase, acimaAtivo, noAlvo, teste, acima, diasRampa,
    lucroAtual, lucroAlvo: lucroEm(alvo), lucroProximo: lucroEm(proximo), lucroEm,
    zero: ctx.canal ? zeroAZero(ctx.canal, ctx.custo, ctx.peso, ctx.cfg) : null,
    avaliacoesTotal, nota, vendasDesde, vendasTotal, avaliacoesDesde, dias, ruins7,
    portoes, portoesOk, check, roasMin, roas, organico, organicoAntes, ads, viavelEm, ultAds,
    revisar, revisarPorAds, revisarPorLancamento, alertaNota, sugestao, ultimaSemana, diasMin, campanha, diasAteCampanha, campanhaPerto,
    lucroSemana, lucroSemanaAds, lucroSemanaAlvo, semanas, registros: regs,
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
  ["concorrente", "Comparar com o concorrente", "Preço, frete, prazo e avaliações dos 3 primeiros da busca"],
  ["avaliacao", "Pedir avaliação com foto", "Cartão no pacote — as primeiras avaliações com foto pesam muito"],
];
