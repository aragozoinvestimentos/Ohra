// Dinheiro → 4 · Payoff (19/10/2026, aprovado pela prévia): quanto o Gustavo
// tirou do bolso pra loja, quanto a loja já pagou, quanto entrou e quando o
// dinheiro dele volta no ritmo de hoje. Conta ÚNICA, funções puras; só lê o
// Caixa (lancamentos_caixa) e os pedidos importados. Nada é gravado.
//
// - "Do seu bolso" = entradas aporte + saldo inicial.
// - "A loja já pagou" = saídas pagas (menos retirada/pró-labore — isso é
//   dinheiro voltando pra você, não custo). Recarga de Ads conta aqui; o
//   gasto dos CSVs não (seria 2×).
// - "Entrou de vendas" = entradas recebidas de venda/encomenda (o que caiu no
//   caixa, já sem as taxas). "Outras entradas" e vendas lançadas à mão em
//   semana que já tem os pedidos importados (prováveis duplicadas) ficam fora.
// - Resultado = entrou − pagou. Falta recuperar = −(resultado + saldo de Ads
//   ainda na Shopee) — o aporte não soma de novo às saídas, porque foi ele
//   que pagou parte delas.
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const r2 = (x) => Math.round(x * 100) / 100;
const mesDe = (iso) => String(iso || "").slice(0, 7);
const somarMes = (m, n) => {
  const [a, b] = m.split("-").map(Number);
  const d = new Date(a, b - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const DO_BOLSO = new Set(["saldo_inicial", "aporte"]);
export const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (m) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export function payoff({ lancamentos = [], hoje, saldoAdsShopee = 0, mesesMedia = 3 }) {
  const reais = lancamentos.filter((l) => l.recorrencia !== "mensal" && l.data_realizada && l.data_realizada <= hoje);
  // Venda lançada À MÃO numa semana que já tem a entrada dos pedidos
  // importados (mesmo canal, ou sem canal) = provável duplicada: fica fora do
  // "entrou" e aparece no quadro "De onde vem o que entrou".
  const semanaDe = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const importadas = reais.filter((l) => l.tipo === "entrada" && String(l.origem_import || "").startsWith("pedidos|"));
  const semImport = new Set(importadas.map((l) => `${String(l.origem_import).split("|")[2]}|${l.canal_id || ""}`));
  const semanasComImport = new Set(importadas.map((l) => String(l.origem_import).split("|")[2]));
  const duplicada = (l) =>
    l.tipo === "entrada" && !l.origem_import && ["venda", "encomenda"].includes(l.categoria) && (l.canal_id ? semImport.has(`${semanaDe(l.data_realizada)}|${l.canal_id}`) : semanasComImport.has(semanaDe(l.data_realizada)));
  const origem = { pedidos: 0, aMao: 0, encomenda: 0, outras: 0, duplicadas: 0, nDuplicadas: 0 };
  let doBolso = 0;
  let entrou = 0;
  let pagou = 0;
  let retiradas = 0;
  let pagouBolso = 0; // saídas pagas do bolso do Gustavo (v63) — também são dinheiro dele na loja
  const porCat = new Map();
  const porMes = new Map();
  const mes = (m) => porMes.get(m) || { mes: m, entrou: 0, pagou: 0 };
  for (const l of reais) {
    const v = num(l.valor);
    const m = mesDe(l.data_realizada);
    if (l.tipo === "entrada") {
      if (DO_BOLSO.has(l.categoria)) doBolso += v;
      else if (duplicada(l)) {
        origem.duplicadas += v;
        origem.nDuplicadas++;
      } else if (l.categoria !== "venda" && l.categoria !== "encomenda") origem.outras += v;
      else {
        if (l.origem_import) origem.pedidos += v;
        else if (l.categoria === "encomenda") origem.encomenda += v;
        else origem.aMao += v;
        entrou += v;
        const x = mes(m);
        x.entrou += v;
        porMes.set(m, x);
      }
    } else if (l.tipo === "saida") {
      if (l.categoria === "retirada") {
        retiradas += v;
        continue;
      }
      pagou += v;
      if (l.pago_com === "bolso") pagouBolso += v;
      porCat.set(l.categoria || "outros", (porCat.get(l.categoria || "outros") || 0) + v);
      const x = mes(m);
      x.pagou += v;
      porMes.set(m, x);
    }
  }
  // Ainda vai sair: saídas previstas (não pagas), parcelas e equipamento.
  const aVencer = lancamentos
    .filter((l) => l.tipo === "saida" && l.recorrencia !== "mensal" && !l.data_realizada && (l.parcela_grupo || l.categoria === "equipamento"))
    .reduce((t, l) => t + num(l.valor), 0);
  const resultado = r2(entrou - pagou);
  // "Falta" líquida = o que ainda falta mesmo se a loja te devolvesse hoje o
  // caixa dela e o saldo de Ads (= −(resultado + saldo de Ads)); é por ela que
  // a previsão conta. A bruta = tudo que você colocou − o que já retirou.
  const falta = r2(Math.max(0, -(resultado + num(saldoAdsShopee))));
  const colocado = r2(doBolso + pagouBolso);
  const faltaBruta = r2(Math.max(0, colocado - retiradas));
  const voltou = colocado > 0 ? Math.min(1, Math.max(0, retiradas / colocado)) : null;

  // Série mês a mês (do 1º mês com movimento até o atual), acumulada.
  const meses = [...porMes.keys()].sort();
  const serie = [];
  if (meses.length) {
    let m = meses[0];
    const fim = mesDe(hoje);
    let accE = 0;
    let accP = 0;
    while (m <= fim) {
      const x = porMes.get(m) || { entrou: 0, pagou: 0 };
      accE += x.entrou;
      accP += x.pagou;
      serie.push({ mes: m, entrou: r2(x.entrou), pagou: r2(x.pagou), resultado: r2(x.entrou - x.pagou), accEntrou: r2(accE), accPagou: r2(accP) });
      m = somarMes(m, 1);
    }
  }
  // Ritmo: resultado médio dos últimos N meses FECHADOS (sem o mês atual).
  const fechados = serie.filter((x) => x.mes < mesDe(hoje)).slice(-mesesMedia);
  const media = fechados.length ? r2(fechados.reduce((t, x) => t + x.resultado, 0) / fechados.length) : null;
  let previsao = null;
  if (falta <= 0) previsao = { status: "voltou" };
  else if (media != null && media > 0) {
    const n = Math.ceil(falta / media);
    previsao = { status: "volta", meses: n, mes: somarMes(mesDe(hoje), n), media, base: fechados };
  } else previsao = { status: media == null ? "sem-dados" : "nao-volta", media, base: fechados };
  const tendencia = fechados.length >= 2 ? fechados[fechados.length - 1].resultado - fechados[0].resultado : null;

  const categorias = [...porCat.entries()].map(([cat, v]) => ({ cat, valor: r2(v), pct: pagou > 0 ? v / pagou : 0 })).sort((a, b) => b.valor - a.valor);
  const equipamento = r2(porCat.get("equipamento") || 0);
  return {
    doBolso: r2(doBolso),
    pagouBolso: r2(pagouBolso),
    pagouLoja: r2(pagou - pagouBolso),
    colocado,
    faltaBruta,
    entrou: r2(entrou),
    pagou: r2(pagou),
    equipamento,
    operar: r2(pagou - equipamento),
    retiradas: r2(retiradas),
    origem: { pedidos: r2(origem.pedidos), aMao: r2(origem.aMao), encomenda: r2(origem.encomenda), outras: r2(origem.outras), duplicadas: r2(origem.duplicadas), nDuplicadas: origem.nDuplicadas },
    resultado,
    falta,
    voltou,
    aVencer: r2(aVencer),
    serie,
    previsao,
    tendencia,
    categorias,
  };
}

// Ritmo de vendas resumido (pedidos, não produtos): por semana (seg–dom) e
// por mês, com tendência (média das 4 últimas semanas × 4 anteriores).
const inicioSemana = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
export function ritmoPedidos(linhas = [], hoje) {
  const peds = new Map();
  for (const l of linhas) {
    if (!l.valido || !l.data || String(l.data) > hoje) continue;
    const k = l.pedido || l.chave;
    const p = peds.get(k) || { data: String(l.data).slice(0, 10), valor: 0 };
    p.valor += num(l.pago);
    peds.set(k, p);
  }
  const semAtual = inicioSemana(hoje);
  const semanas = new Map();
  const meses = new Map();
  for (const p of peds.values()) {
    const s = inicioSemana(p.data);
    const sx = semanas.get(s) || { n: 0, valor: 0 };
    sx.n++;
    sx.valor += p.valor;
    semanas.set(s, sx);
    const m = mesDe(p.data);
    const mx = meses.get(m) || { n: 0, valor: 0 };
    mx.n++;
    mx.valor += p.valor;
    meses.set(m, mx);
  }
  // Últimas 8 semanas COMPLETAS (sem a atual).
  const ultSem = [];
  for (let i = 8; i >= 1; i--) {
    const d = new Date(`${semAtual}T12:00:00`);
    d.setDate(d.getDate() - 7 * i);
    const s = d.toISOString().slice(0, 10);
    ultSem.push({ semana: s, n: semanas.get(s)?.n || 0, valor: semanas.get(s)?.valor || 0 });
  }
  const media = (l) => (l.length ? l.reduce((t, x) => t + x.n, 0) / l.length : 0);
  const recentes = ultSem.slice(-4);
  const antes = ultSem.slice(0, 4);
  const porSemana = media(recentes);
  const varSemana = media(antes) > 0 ? porSemana / media(antes) - 1 : null;
  const valR = recentes.reduce((t, x) => t + x.valor, 0);
  const nR = recentes.reduce((t, x) => t + x.n, 0);
  const valA = antes.reduce((t, x) => t + x.valor, 0);
  const nA = antes.reduce((t, x) => t + x.n, 0);
  const ticket = nR ? valR / nR : null;
  const varTicket = nA && ticket != null ? ticket / (valA / nA) - 1 : null;
  // Meses: últimos 6 (o atual projetado pelo ritmo do mês).
  const mAtual = mesDe(hoje);
  const dia = Number(hoje.slice(8, 10));
  const diasMes = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0).getDate();
  const ultMes = [];
  for (let i = 5; i >= 0; i--) {
    const m = somarMes(mAtual, -i);
    const n = meses.get(m)?.n || 0;
    ultMes.push({ mes: m, n, projetado: m === mAtual ? Math.round((n / dia) * diasMes) : null });
  }
  const atual = ultMes[ultMes.length - 1];
  const anterior = ultMes[ultMes.length - 2];
  const nMesAtual = atual.projetado ?? atual.n;
  const varMes = anterior.n > 0 ? nMesAtual / anterior.n - 1 : null;
  return { temDados: peds.size > 0, semanas: ultSem, porSemana, varSemana, meses: ultMes, nMesAtual, varMes, ticket, varTicket };
}

// ↑ / ↓ / → (estável até ±5%)
export function seta(v) {
  if (v == null) return null;
  if (v > 0.05) return { s: "↑", tipo: "oportunidade" };
  if (v < -0.05) return { s: "↓", tipo: "atencao" };
  return { s: "→", tipo: "info" };
}
