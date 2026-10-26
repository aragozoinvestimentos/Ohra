import { PLATAFORMAS } from "./pedidos.js";
// Carteiras do Caixa (schema v67, 26/10/2026, aprovado pelo Gustavo pela
// prévia): onde o dinheiro da loja está agora.
//  - "loja" = Conta da loja (o banco): vendas físicas/orgânicas, contas,
//    aportes, saques que chegaram. Decisão do Gustavo: não tem carteira
//    separada de "dinheiro" — o que vende no orgânico já cai na conta.
//  - uma por plataforma com canal (shopee, tiktok, ml, shein): o saldo dentro
//    do marketplace. Recebe o repasse dos pedidos ENTREGUES; sai pelo saque
//    (transferência pra Conta da loja).
// Dentro da carteira da plataforma:
//  - Liberado = o que o extrato da plataforma diz que já está disponível
//    (último "saldo após" do Extrato do Meu Saldo da Shopee);
//  - A liberar = entregue no app e ainda não liberado (a Shopee segura alguns
//    dias depois da entrega) = saldo da carteira − liberado;
//  - A caminho = pago e ainda não entregue (fora do saldo, como antes).
// Sem extrato = não dá pra separar liberado de a liberar (mostra só o saldo).
// Funções puras.

export const CARTEIRA_LOJA = "loja";
export const ehTransferencia = (l) => l?.categoria === "transferencia";
// Fora das contas de resultado (Metas, Payoff, médias, entradas/saídas do mês):
// o saque só troca o dinheiro de lugar.
export const semTransferencias = (lancamentos) => (lancamentos || []).filter((l) => !ehTransferencia(l));

const IDS_PLAT = new Set(PLATAFORMAS.map((p) => p.id));
/** Carteira de um lançamento (sem o v67, deduz pela origem da importação). */
export function carteiraDe(l) {
  if (l?.carteira) return l.carteira;
  const o = String(l?.origem_import || "");
  if (o.startsWith("pedidos|")) {
    const p = o.split("|")[1];
    if (IDS_PLAT.has(p)) return p;
  }
  return CARTEIRA_LOJA;
}

/**
 * Carteiras da loja: Conta da loja + uma por plataforma que já tem dinheiro
 * passando (lançamento, a caminho ou extrato) — canal cadastrado sem venda
 * não vira carteira vazia na tela.
 */
export function carteirasDaLoja(canais = [], lancamentos = [], extras = []) {
  const usadas = new Set([...(lancamentos || []).map(carteiraDe), ...extras]);
  const plats = PLATAFORMAS.filter((p) => usadas.has(p.id));
  return [{ id: CARTEIRA_LOJA, nome: "Conta da loja", plataforma: false }, ...plats.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, plataforma: true }))];
}
export const nomeCarteira = (id) => (id === CARTEIRA_LOJA ? "Conta da loja" : PLATAFORMAS.find((p) => p.id === id)?.nome || id);

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const assinado = (l) => (l.tipo === "entrada" ? 1 : -1) * n(l.valor);
const doBolsoPago = (l) => l.tipo === "saida" && l.pago_com === "bolso" && !!l.data_realizada;

/** Saldo de uma carteira até `hoje` (realizados, sem as saídas pagas do bolso). */
export function saldoCarteira(lancamentos, carteira, hoje) {
  return r2(
    (lancamentos || [])
      .filter((l) => l.recorrencia !== "mensal" && l.data_realizada && (!hoje || l.data_realizada <= hoje) && !doBolsoPago(l) && carteiraDe(l) === carteira)
      .reduce((s, l) => s + assinado(l), 0)
  );
}

/** Extrato guardado de uma plataforma → { saldo (liberado), ate (data da última transação), n }. */
export function liberadoDoExtrato(extrato, plataforma) {
  const ts = (extrato || []).filter((t) => t.plataforma === plataforma && t.saldo_apos != null);
  if (!ts.length) return null;
  const ult = ts.reduce((a, b) => (String(b.data) > String(a.data) ? b : a));
  return { saldo: r2(ult.saldo_apos), ate: String(ult.data).slice(0, 10), n: ts.length };
}

/**
 * Resumo de cada carteira e do total.
 * aReceber = caixaDosPedidos(...).aReceber (pagos, ainda não entregues).
 * → { carteiras: [{ id, nome, plataforma, saldo, liberado, aLiberar, aCaminho, extrato }], total, liberado, aLiberar, aCaminho, semExtrato: [nomes] }
 */
export function resumoCarteiras({ lancamentos = [], canais = [], hoje, aReceber = [], extrato = [] }) {
  const extras = [...aReceber.filter((x) => n(x.valor) > 0).map((x) => x.plataforma), ...(extrato || []).map((t) => t.plataforma)];
  const lista = carteirasDaLoja(canais, lancamentos, extras).map((c) => {
    const saldo = saldoCarteira(lancamentos, c.id, hoje);
    const aCaminho = r2(aReceber.filter((x) => x.plataforma === c.id).reduce((t, x) => t + n(x.valor), 0));
    if (!c.plataforma) return { ...c, saldo, liberado: saldo, aLiberar: 0, aCaminho: 0, extrato: null };
    const ex0 = liberadoDoExtrato(extrato, c.id);
    if (!ex0) return { ...c, saldo, liberado: null, aLiberar: null, aCaminho, extrato: null };
    // Saque registrado à mão no mesmo dia ou depois do fim do extrato ainda não
    // está no "saldo após" dele: desconta (o que veio do próprio extrato já está).
    const sacadoDepois = (lancamentos || [])
      .filter((l) => ehTransferencia(l) && l.tipo === "saida" && carteiraDe(l) === c.id && l.data_realizada >= ex0.ate && !String(l.origem_import || "").startsWith("extrato|"))
      .reduce((t, l) => t + n(l.valor), 0);
    const ex = { ...ex0, saldo: r2(Math.max(0, ex0.saldo - sacadoDepois)) };
    // A plataforma pode liberar um pedido que a Olist ainda não marcou como
    // entregue: aí o liberado passa do saldo do app — a diferença sai do "a caminho".
    const aLiberar = r2(Math.max(0, saldo - ex.saldo));
    return { ...c, saldo, liberado: ex.saldo, aLiberar, aCaminho, extrato: ex, adiantado: r2(Math.max(0, ex.saldo - saldo)) };
  });
  const soma = (f) => r2(lista.reduce((t, c) => t + n(f(c)), 0));
  return {
    carteiras: lista,
    total: soma((c) => c.saldo),
    // Sem extrato, o saldo da plataforma não entra no liberado (não se sabe).
    liberado: soma((c) => c.liberado ?? 0),
    aLiberar: soma((c) => (c.plataforma ? (c.aLiberar ?? c.saldo) : 0)),
    aCaminho: soma((c) => c.aCaminho),
    semExtrato: lista.filter((c) => c.plataforma && !c.extrato && (c.saldo || c.aCaminho)).map((c) => c.nome),
  };
}

// ---------- Extrato do Meu Saldo (Shopee) ----------
const txt = (v) => String(v ?? "").trim();
const sem = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const numBR = (v) => {
  if (typeof v === "number") return v;
  const s = txt(v).replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const x = s.includes(",") && !/\.\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  const r = Number(x);
  return Number.isFinite(r) ? r : null;
};
const ehSaque = (t) => /saque|retirad|transfer/.test(sem(t.tipo) + " " + sem(t.descricao));

/**
 * Lê as linhas da planilha "my_balance_transaction_report" (Shopee → Minha
 * Renda → Meu Saldo → Exportar). Cabeçalho na linha com "Data" e "Tipo de
 * transação"; período em "De"/"Para".
 * → { ok, erro?, de, ate, transacoes: [{ chave, data, tipo, descricao, pedido, valor (±), status, saldo_apos, saque }] }
 */
export function interpretarExtratoShopee(linhas) {
  const rows = (linhas || []).map((r) => (r || []).map(txt));
  const iCab = rows.findIndex((r) => sem(r[0]) === "data" && r.some((c) => sem(c).startsWith("tipo de transa")));
  if (iCab < 0) return { ok: false, erro: "Não parece o Extrato do Meu Saldo da Shopee (falta a tabela “Data · Tipo de transação · …”)." };
  const cab = rows[iCab].map(sem);
  const col = (re) => cab.findIndex((c) => re.test(c));
  const c = {
    data: 0,
    tipo: col(/^tipo de transa/),
    desc: col(/^descri/),
    pedido: col(/id do pedido/),
    dir: col(/dire/),
    valor: col(/^valor$/),
    status: col(/^status/),
    saldo: col(/balan|saldo apos|saldo/),
  };
  const per = (rot) => rows.find((r) => sem(r[0]) === rot)?.[1] || null;
  const transacoes = [];
  for (const r of rows.slice(iCab + 1)) {
    const data = txt(r[c.data]);
    if (!/^\d{4}-\d{2}-\d{2}/.test(data)) continue;
    const v = Math.abs(numBR(r[c.valor]) ?? 0);
    const saida = /said/.test(sem(r[c.dir]));
    const t = {
      data: data.length === 10 ? `${data} 00:00:00` : data,
      tipo: txt(r[c.tipo]),
      descricao: txt(r[c.desc]),
      pedido: c.pedido >= 0 ? txt(r[c.pedido]) || null : null,
      valor: r2(saida ? -v : v),
      status: c.status >= 0 ? txt(r[c.status]) : "",
      saldo_apos: c.saldo >= 0 ? numBR(r[c.saldo]) : null,
    };
    t.chave = `${t.data}|${t.tipo}|${t.pedido || ""}|${t.valor}`;
    t.saque = saida && ehSaque(t);
    transacoes.push(t);
  }
  if (!transacoes.length) return { ok: false, erro: "O extrato não tem nenhuma transação no período." };
  const datas = transacoes.map((t) => t.data.slice(0, 10)).sort();
  return { ok: true, de: per("de") || datas[0], ate: per("para") || datas[datas.length - 1], transacoes };
}
