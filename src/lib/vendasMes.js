import { lucroNoPreco } from "./escada.js";
import { mesDe } from "./fluxoCaixa.js";

// Vendas do mês (Fluxo de Caixa → 3ª sub-aba) — Fase A, ESTIMADA (out/2026).
// Conta ÚNICA. Fonte = o que já entra pelo Registrar semana (Crescimento):
//   • rampa_registros tipo "semana" (produto em rampa) — vendas no preço do degrau;
//   • afiliado_registros com vendas_total (item fora de rampa: afiliado ou só Ads).
// Cada venda vale o preço da semana (o de AGORA naquela semana) com o custo e as
// taxas de HOJE: recebe (o canal repassa) − repor o produto (custo) = lucro.
//   • vendas_organicas (schema v52): venda orgânica registrada à mão no próprio
//     Vendas do mês (produto fora de rampa) — SÓ financeiro, no preço digitado,
//     no mês da data "Até". Ads/Afiliados/Rampa não leem essa tabela.
// Unidades vendidas em kit contam como unidades no preço da semana (estimativa).
// A semana entra no mês do ÚLTIMO dia dela (o registro cobre até a véspera da data).
// REAL (aba Análise, v55): pedidos importados da Olist + vendas físicas
// (`pedidos` = linhas de pedidos.enriquecer, `cobertura` = coberturaPedidos).
// Nos dias em que a plataforma tem pedidos importados, a estimativa daquela
// semana sai (só o Ads/comissão registrados continuam) e valem os pedidos —
// valor pago de verdade, lucro com custo e taxas de hoje.

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;

/** Último dia coberto pelo registro (data − 1 dia). */
export function diaFimRegistro(data) {
  const d = new Date(`${String(data).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ID_PREFIXO = { produto: "p", variacao: "v", kit: "k" };

/**
 * → { linhas: [{ chave, item, canal, unidades, faturamento, recebe, repor, lucro, ads, comissao, semanas }],
 *     total: { unidades, faturamento, recebe, repor, lucro, ads, comissao, sobra }, semanas }
 */
export function vendasDoMes({ mes, rampas = [], rampasGrupo = [], rampaRegistros = [], afRegistros = [], organicas = [], itens = [], canais = [], cfgDoProduto = () => null, pedidos = [], cobertura = null, itemNoCanal = null }) {
  const porChave = new Map();
  const itemDe = (tipo, id) => itens.find((i) => i.id === `${ID_PREFIXO[tipo] || "p"}:${id}`) || null;
  const novaLinha = (chave, item, canal) => porChave.get(chave) || { chave, item, canal, unidades: 0, faturamento: 0, recebe: 0, repor: 0, imposto: 0, lucro: 0, ads: 0, comissao: 0, semanas: 0, aMao: 0, real: 0 };
  const coberto = (canal, data) => !!(cobertura && canal && cobertura.cobre(canal, diaFimRegistro(data)));
  const somar = ({ tipo, id, canalId, unidades, preco, ads, comissao, aMao = false, soCustos = false }) => {
    const item = itemDe(tipo, id);
    const canal = canais.find((c) => c.id === canalId);
    if (soCustos) {
      // Semana já coberta pelos pedidos reais: só o Ads/comissão registrados.
      if (!item || !canal || !(num(ads) > 0 || num(comissao) > 0)) return;
      const chave = `${item.id}|${canal.id}`;
      const l = novaLinha(chave, item, canal);
      l.ads += num(ads);
      l.comissao += num(comissao);
      porChave.set(chave, l);
      return;
    }
    if (!item || !canal || !(unidades > 0) || !(preco > 0)) return;
    const itemC = itemNoCanal ? itemNoCanal(item, canal) : item; // orgânico: embalagem dele (v56)
    const cfg = cfgDoProduto(item.produtoId || (tipo === "produto" ? id : null));
    const custo = num(itemC.custoTotal);
    const lucroUn = lucroNoPreco(canal, preco, custo, num(item.peso), cfg) ?? 0;
    const chave = `${item.id}|${canal.id}`;
    const l = novaLinha(chave, item, canal);
    l.unidades += unidades;
    l.faturamento += unidades * preco;
    l.recebe += unidades * (lucroUn + custo);
    l.repor += unidades * custo;
    l.lucro += unidades * lucroUn;
    l.ads += num(ads);
    l.comissao += num(comissao);
    if (aMao) l.aMao += unidades;
    else l.semanas += 1;
    porChave.set(chave, l);
  };
  const doMes = (g) => g.data && mesDe(diaFimRegistro(g.data)) === mes;
  // Ads do anúncio com vários itens (v54): as vendas dele entram por opção
  // (vendas_organicas com grupo_id); aqui só o gasto de Ads, no total.
  let adsAnuncios = 0;

  // Comissão de afiliado dos produtos em rampa: linha de afiliado_registros
  // sem vendas_total, no mesmo produto × canal × data.
  const comissaoRampa = new Map();
  for (const g of afRegistros)
    if (g.vendas_total == null && doMes(g)) {
      const k = `${g.item_id}|${g.canal_id}|${String(g.data).slice(0, 10)}`;
      comissaoRampa.set(k, (comissaoRampa.get(k) || 0) + num(g.comissao));
    }

  for (const g of rampaRegistros) {
    if (g.tipo !== "semana" || !doMes(g)) continue;
    const r = rampas.find((x) => x.id === g.rampa_id);
    if (!r) {
      if (rampasGrupo.some((x) => x.id === g.rampa_id)) adsAnuncios += num(g.ads_gasto);
      continue;
    }
    const k = `${r.produto_id}|${r.canal_id}|${String(g.data).slice(0, 10)}`;
    const cob = coberto(canais.find((c) => c.id === r.canal_id), g.data);
    somar({ tipo: "produto", id: r.produto_id, canalId: r.canal_id, unidades: num(g.vendas), preco: num(g.preco), ads: g.ads_gasto, comissao: comissaoRampa.get(k) || 0, soCustos: cob });
  }
  for (const g of afRegistros) {
    if (g.vendas_total == null || !doMes(g)) continue;
    if (g.item_tipo === "grupo") {
      adsAnuncios += num(g.ads_gasto);
      continue;
    }
    const cob = coberto(canais.find((c) => c.id === g.canal_id), g.data);
    somar({ tipo: g.item_tipo, id: g.item_id, canalId: g.canal_id, unidades: num(g.vendas_total), preco: num(g.preco), ads: g.ads_gasto, comissao: g.comissao, soCustos: cob });
  }

  for (const o of organicas) {
    if (!o.data || mesDe(String(o.data).slice(0, 10)) !== mes) continue;
    // Já está nos pedidos importados daquela plataforma → não conta de novo.
    if (cobertura && cobertura.cobre(canais.find((c) => c.id === o.canal_id), String(o.data).slice(0, 10))) continue;
    somar({ tipo: o.item_tipo, id: o.item_id, canalId: o.canal_id, unidades: num(o.unidades), preco: num(o.preco), aMao: true });
  }

  // Pedidos reais do mês (+ vendas físicas): valor pago, lucro com custo e taxas de hoje.
  const FISICO = { id: "fisico", nome: "Venda física", tipo: "custom" };
  for (const p of pedidos) {
    if (!p.valido || !p.item || !p.data || mesDe(String(p.data).slice(0, 10)) !== mes) continue;
    const canal = p.canal || (p.origem === "fisico" ? FISICO : null);
    if (!canal) continue;
    // Venda dentro de um anúncio com vários itens: linha própria da opção,
    // marcada com o anúncio (a tela agrupa debaixo dele).
    const chave = p.grupo ? `g:${p.grupo.id}|${p.item.id}|${canal.id}` : `${p.item.id}|${canal.id}`;
    const l = novaLinha(chave, p.item, canal);
    if (p.grupo) l.grupo = p.grupo;
    l.unidades += p.q;
    l.faturamento += p.pago;
    l.recebe += p.recebe;
    l.imposto += p.imposto || 0;
    l.repor += p.custo;
    l.lucro += p.lucro ?? 0;
    l.real += p.q;
    porChave.set(chave, l);
  }

  const linhas = [...porChave.values()]
    .map((l) => ({ ...l, faturamento: cent(l.faturamento), recebe: cent(l.recebe), repor: cent(l.repor), imposto: cent(l.imposto || 0), lucro: cent(l.lucro), ads: cent(l.ads), comissao: cent(l.comissao) }))
    .sort((a, b) => b.lucro - a.lucro);
  const soma = (k) => cent(linhas.reduce((t, l) => t + l[k], 0));
  const total = { unidades: linhas.reduce((t, l) => t + l.unidades, 0), faturamento: soma("faturamento"), recebe: soma("recebe"), repor: soma("repor"), lucro: soma("lucro"), ads: soma("ads"), comissao: soma("comissao") };
  total.real = linhas.reduce((t, l) => t + l.real, 0);
  total.adsAnuncios = cent(adsAnuncios);
  total.ads = cent(total.ads + adsAnuncios);
  total.sobra = cent(total.lucro - total.ads - total.comissao);
  return { linhas, total };
}

/** Saldo da reserva de produção (separar − usar) e quanto já foi separado por mês. */
export function saldoReserva(registros = []) {
  let saldo = 0;
  const porMes = new Map();
  for (const r of registros) {
    const v = num(r.valor);
    if (r.tipo === "usar") saldo -= v;
    else {
      saldo += v;
      if (r.mes) porMes.set(r.mes, cent((porMes.get(r.mes) || 0) + v));
    }
  }
  return { saldo: cent(saldo), porMes };
}

// Vários meses juntos (19/10/2026, filtro "últimos N meses / todo o período"
// em Vendas do mês): soma as linhas de cada mês pela mesma chave.
const CAMPOS_SOMA = ["unidades", "faturamento", "recebe", "repor", "imposto", "lucro", "ads", "comissao", "semanas", "aMao", "real"];
export function juntarMeses(resultados = []) {
  const porChave = new Map();
  const total = { unidades: 0, faturamento: 0, recebe: 0, repor: 0, lucro: 0, ads: 0, comissao: 0, real: 0, adsAnuncios: 0, sobra: 0 };
  for (const r of resultados) {
    for (const l of r.linhas) {
      const a = porChave.get(l.chave) || { ...l, ...Object.fromEntries(CAMPOS_SOMA.map((c) => [c, 0])) };
      for (const c of CAMPOS_SOMA) a[c] += num(l[c]);
      porChave.set(l.chave, a);
    }
    for (const c of Object.keys(total)) total[c] += num(r.total[c]);
  }
  const linhas = [...porChave.values()].map((l) => ({ ...l, faturamento: cent(l.faturamento), recebe: cent(l.recebe), repor: cent(l.repor), imposto: cent(l.imposto || 0), lucro: cent(l.lucro), ads: cent(l.ads), comissao: cent(l.comissao) })).sort((a, b) => b.lucro - a.lucro);
  for (const c of Object.keys(total)) total[c] = c === "unidades" || c === "real" ? total[c] : cent(total[c]);
  return { linhas, total };
}
// Meses de um período terminando no mês atual: "mes" = só o escolhido; N = últimos N; "tudo" = desde `desde`.
export function mesesDoPeriodo(periodo, mesAtual, mesEscolhido, desde = null) {
  if (!periodo || periodo === "mes") return [mesEscolhido];
  const add = (m, n) => {
    const [a, b] = m.split("-").map(Number);
    const d = new Date(a, b - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const inicio = periodo === "tudo" ? desde || add(mesAtual, -11) : add(mesAtual, -(Number(periodo) - 1));
  const out = [];
  for (let m = inicio; m <= mesAtual && out.length < 60; m = add(m, 1)) out.push(m);
  return out.length ? out : [mesAtual];
}
