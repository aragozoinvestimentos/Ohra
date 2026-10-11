import { dataSP } from "./datas.js";
// Lógica da aba "Fluxo de Caixa" — funções puras (sem Supabase), pra ser
// fácil de conferir. Datas sempre como string "YYYY-MM-DD" (coluna date do
// Supabase) e meses como "YYYY-MM", comparadas como texto — evita erro de
// fuso horário que aparece ao converter pra Date.

export const CATEGORIAS = {
  entrada: [
    { key: "venda", label: "Venda" },
    { key: "encomenda", label: "Encomenda direta" },
    { key: "saldo_inicial", label: "Saldo inicial" },
    { key: "aporte", label: "Aporte / investimento" },
    { key: "outros", label: "Outras entradas" },
  ],
  saida: [
    { key: "filamento", label: "Filamento / material" },
    { key: "embalagem", label: "Embalagem" },
    { key: "frete", label: "Frete" },
    { key: "anuncios", label: "Anúncios / Ads" },
    { key: "taxas", label: "Taxas / impostos" },
    { key: "equipamento", label: "Impressora / equipamento" },
    { key: "manutencao", label: "Manutenção / peças" },
    { key: "energia", label: "Energia / internet" },
    { key: "retirada", label: "Retirada (pró-labore)" },
    { key: "outros", label: "Outras saídas" },
  ],
};

export function rotuloCategoria(tipo, key) {
  return (CATEGORIAS[tipo] || []).find((c) => c.key === key)?.label || "Outros";
}

const pad = (n) => String(n).padStart(2, "0");

// "Hoje" (ou a data de `d`) no fuso de São Paulo — ver lib/datas.js.
export function hojeISO(d = new Date()) {
  return dataSP(d);
}

export const mesDe = (iso) => (iso || "").slice(0, 7);

export function somarMeses(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function rotuloMes(mes, comAno = true) {
  const [a, m] = mes.split("-").map(Number);
  return comAno ? `${NOMES_MES[m - 1]}/${String(a).slice(2)}` : NOMES_MES[m - 1];
}

// Data da ocorrência de um modelo recorrente num mês: mesmo dia do mês da
// data_prevista original, limitado ao último dia do mês (31 → 30/28…).
export function dataNoMes(dataBase, mes) {
  const dia = Number(dataBase.slice(8, 10)) || 1;
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${mes}-${pad(Math.min(dia, ultimo))}`;
}

const valorAssinado = (l) => (l.tipo === "entrada" ? 1 : -1) * (Number(l.valor) || 0);

// Ocorrências virtuais de modelos recorrentes entre dois meses (inclusive),
// pulando meses que já têm um lançamento confirmado vindo daquele modelo.
export function ocorrenciasRecorrentes(lancamentos, mesIni, mesFim) {
  const modelos = lancamentos.filter((l) => l.recorrencia === "mensal");
  const confirmados = new Set(
    lancamentos.filter((l) => l.recorrencia_origem_id).map((l) => `${l.recorrencia_origem_id}|${mesDe(l.data_prevista)}`)
  );
  const out = [];
  for (const mod of modelos) {
    const inicio = mesDe(mod.data_prevista);
    const fim = mod.recorrencia_ate ? mesDe(mod.recorrencia_ate) : null;
    let mes = inicio > mesIni ? inicio : mesIni;
    while (mes <= mesFim && (!fim || mes <= fim)) {
      if (!confirmados.has(`${mod.id}|${mes}`)) {
        out.push({
          ...mod,
          id: `virtual:${mod.id}:${mes}`,
          virtual: true,
          modeloId: mod.id,
          recorrencia: "nenhuma",
          data_prevista: dataNoMes(mod.data_prevista, mes),
          data_realizada: null,
        });
      }
      mes = somarMeses(mes, 1);
    }
  }
  return out;
}

// Lançamentos "de verdade" (não modelos). Modelo recorrente não entra em
// saldo nem em total — só as ocorrências dele.
export const lancamentosReais = (lancamentos) => lancamentos.filter((l) => l.recorrencia !== "mensal");

export function saldoRealizado(lancamentos, ateData = null) {
  return lancamentosReais(lancamentos)
    .filter((l) => l.data_realizada && (!ateData || l.data_realizada <= ateData))
    .reduce((s, l) => s + valorAssinado(l), 0);
}

// Média mensal de um tipo de lançamento realizado nos últimos N meses
// fechados (não conta o mês atual, que ainda está em andamento). Recorrentes
// ficam de fora pra não contar duas vezes na projeção (eles já são projetados
// sozinhos).
// Divide só pelos meses que a loja já tinha caixa (a partir do mês do 1º
// lançamento) — quem começou no mês passado não fica com a média dividida
// por 3 meses vazios.
export function mesesDaMedia(lancamentos, mesAtual, n = 3) {
  const primeiroMes = lancamentosReais(lancamentos).reduce((m, l) => {
    const mes = mesDe(l.data_realizada || l.data_prevista);
    return mes && (!m || mes < m) ? mes : m;
  }, null);
  const meses = new Set();
  for (let i = 1; i <= n; i++) {
    const mes = somarMeses(mesAtual, -i);
    if (primeiroMes && mes >= primeiroMes) meses.add(mes);
  }
  return meses;
}

export function mediaMensal(lancamentos, tipo, mesAtual, n = 3) {
  const meses = mesesDaMedia(lancamentos, mesAtual, n);
  if (!meses.size) return 0;
  let soma = 0;
  for (const l of lancamentosReais(lancamentos)) {
    if (l.tipo !== tipo || !l.data_realizada || l.recorrencia_origem_id || l.categoria === "saldo_inicial" || l.categoria === "aporte") continue;
    if (meses.has(mesDe(l.data_realizada))) soma += Number(l.valor) || 0;
  }
  return soma / meses.size;
}

// Projeção mês a mês: mês atual + os próximos (total `meses`). Pra cada mês:
//  - realizado: o que já caiu/saiu naquele mês;
//  - previsto: lançamentos ainda não realizados com data prevista no mês
//    (os atrasados, de meses anteriores, entram no mês atual) + ocorrências
//    de recorrentes;
//  - estimado: nos meses FUTUROS (não no atual), a estimativa mensal de
//    vendas/custos variáveis informada na tela.
// O saldo acumulado começa no saldo realizado até o fim do mês anterior.
// `mesesPassados` > 0 devolve também `passado`: os N meses antes do atual só
// com o que de fato caiu/saiu (realizado), com o saldo no fim de cada um —
// pra ver como foi o passado ao lado da projeção. Não mexe em `linhas`.
export function projetar(lancamentos, { mesAtual, meses = 12, mesesPassados = 0, vendasEstimadas = 0, custosEstimados = 0 }) {
  const mesFim = somarMeses(mesAtual, meses - 1);
  const reais = lancamentosReais(lancamentos);
  const virtuais = ocorrenciasRecorrentes(lancamentos, mesAtual, mesFim);
  const inicioMesAtual = `${mesAtual}-01`;
  let saldo = reais
    .filter((l) => l.data_realizada && l.data_realizada < inicioMesAtual)
    .reduce((s, l) => s + valorAssinado(l), 0);
  const saldoInicial = saldo;

  const passado = [];
  if (mesesPassados > 0) {
    const mesIni = somarMeses(mesAtual, -mesesPassados);
    let sp = reais.filter((l) => l.data_realizada && l.data_realizada < `${mesIni}-01`).reduce((s, l) => s + valorAssinado(l), 0);
    for (let i = 0; i < mesesPassados; i++) {
      const mes = somarMeses(mesIni, i);
      const linha = { mes, passado: true, entradasRealizadas: 0, saidasRealizadas: 0, entradasPrevistas: 0, saidasPrevistas: 0, entradasEstimadas: 0, saidasEstimadas: 0 };
      for (const l of reais) {
        if (!l.data_realizada || mesDe(l.data_realizada) !== mes) continue;
        if (l.tipo === "entrada") linha.entradasRealizadas += Number(l.valor) || 0;
        else linha.saidasRealizadas += Number(l.valor) || 0;
      }
      linha.entradas = linha.entradasRealizadas;
      linha.saidas = linha.saidasRealizadas;
      linha.resultado = linha.entradas - linha.saidas;
      sp += linha.resultado;
      linha.saldoFinal = sp;
      passado.push(linha);
    }
  }

  const linhas = [];
  for (let i = 0; i < meses; i++) {
    const mes = somarMeses(mesAtual, i);
    const linha = { mes, entradasRealizadas: 0, saidasRealizadas: 0, entradasPrevistas: 0, saidasPrevistas: 0, entradasEstimadas: 0, saidasEstimadas: 0 };
    for (const l of reais) {
      const v = Number(l.valor) || 0;
      if (l.data_realizada) {
        if (mesDe(l.data_realizada) !== mes) continue;
        if (l.tipo === "entrada") linha.entradasRealizadas += v;
        else linha.saidasRealizadas += v;
      } else {
        const mp = mesDe(l.data_prevista);
        const entra = i === 0 ? mp <= mes : mp === mes;
        if (!entra) continue;
        if (l.tipo === "entrada") linha.entradasPrevistas += v;
        else linha.saidasPrevistas += v;
      }
    }
    for (const l of virtuais) {
      if (mesDe(l.data_prevista) !== mes) continue;
      const v = Number(l.valor) || 0;
      if (l.tipo === "entrada") linha.entradasPrevistas += v;
      else linha.saidasPrevistas += v;
    }
    if (i > 0) {
      linha.entradasEstimadas = Number(vendasEstimadas) || 0;
      linha.saidasEstimadas = Number(custosEstimados) || 0;
    }
    linha.entradas = linha.entradasRealizadas + linha.entradasPrevistas + linha.entradasEstimadas;
    linha.saidas = linha.saidasRealizadas + linha.saidasPrevistas + linha.saidasEstimadas;
    linha.resultado = linha.entradas - linha.saidas;
    saldo += linha.resultado;
    linha.saldoFinal = saldo;
    linhas.push(linha);
  }
  return { saldoInicial, linhas, passado };
}

// Status de exibição de um lançamento (não-modelo).
export function statusLancamento(l, hoje) {
  if (l.data_realizada) return l.tipo === "entrada" ? "recebido" : "pago";
  return l.data_prevista < hoje ? "atrasado" : "previsto";
}

// Estimativa mensal de vendas/custos variáveis da projeção (campo da tela do
// Fluxo de Caixa; "" = média dos 3 últimos meses fechados), por loja, no navegador.
const ESTIMATIVA_KEY = "ohra:caixa:estimativas";

export function loadEstimativas(lojaId) {
  try {
    const raw = JSON.parse(localStorage.getItem(ESTIMATIVA_KEY) || "{}");
    return raw[lojaId || "sem-loja"] || { vendas: "", custos: "" };
  } catch {
    return { vendas: "", custos: "" };
  }
}

export function saveEstimativas(lojaId, valor) {
  try {
    const raw = JSON.parse(localStorage.getItem(ESTIMATIVA_KEY) || "{}");
    raw[lojaId || "sem-loja"] = valor;
    localStorage.setItem(ESTIMATIVA_KEY, JSON.stringify(raw));
  } catch {
    // sem problema, só não lembra da próxima vez
  }
}


// Faturamento real (vendas/encomendas recebidas) e resultado real (entradas −
// saídas, sem saldo inicial/aporte) dos lançamentos realizados de um mês —
// mesma conta da aba Metas.
export function realDoMes(lancamentos, mes) {
  const validos = (lancamentos || []).filter(
    (l) => l.recorrencia !== "mensal" && l.data_realizada && mesDe(l.data_realizada) === mes && l.categoria !== "saldo_inicial" && l.categoria !== "aporte"
  );
  const faturamento = validos.filter((l) => l.tipo === "entrada" && (l.categoria === "venda" || l.categoria === "encomenda")).reduce((s, l) => s + Number(l.valor || 0), 0);
  const resultado = validos.reduce((s, l) => s + (l.tipo === "entrada" ? 1 : -1) * Number(l.valor || 0), 0);
  return { faturamento, resultado };
}

// Resumo do caixa pro Início (as mesmas contas da aba Fluxo de Caixa):
// saldo de hoje, menor saldo previsto nos próximos `meses`, contas atrasadas
// (previstas não realizadas, inclusive recorrentes ainda não confirmadas) e
// os próximos `dias` dias.
export function resumoCaixa(lancamentos, { hoje, estimativas = { vendas: "", custos: "" }, meses = 3, dias = 7 } = {}) {
  const mesAtual = mesDe(hoje);
  const vendasEst = estimativas.vendas === "" ? mediaMensal(lancamentos, "entrada", mesAtual) : Number(estimativas.vendas) || 0;
  const custosEst = estimativas.custos === "" ? mediaMensal(lancamentos, "saida", mesAtual) : Number(estimativas.custos) || 0;
  const proj = projetar(lancamentos, { mesAtual, meses, vendasEstimadas: vendasEst, custosEstimados: custosEst });
  const menor = proj.linhas.reduce((m, l) => (!m || l.saldoFinal < m.saldoFinal ? l : m), null);
  const limite = (() => {
    const d = new Date(`${hoje}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  })();
  const abertos = [...lancamentosReais(lancamentos).filter((l) => !l.data_realizada), ...ocorrenciasRecorrentes(lancamentos, mesAtual, somarMeses(mesAtual, 1))];
  const atrasados = abertos.filter((l) => l.data_prevista < hoje).sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
  const proximos = abertos.filter((l) => l.data_prevista >= hoje && l.data_prevista <= limite).sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
  return {
    saldoHoje: saldoRealizado(lancamentos, hoje),
    menor,
    mesAtual: proj.linhas[0] || null,
    atrasados,
    proximos,
    ...realDoMes(lancamentos, mesAtual),
    temLancamentos: lancamentos.length > 0,
    temSaldoInicial: lancamentos.some((l) => l.categoria === "saldo_inicial"),
  };
}
