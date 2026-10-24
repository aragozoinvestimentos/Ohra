// Relatórios exportáveis do consultor (24/10/2026, aprovado pelo Gustavo):
// modelos FIXOS (sempre o mesmo formato, pra comparar um mês com o outro).
// Montados só no clique ("Gerar"), a partir das contas que já existem:
// pedidos importados (somaPedidos), Ads (adsNaJanela/adsNoPeriodo), contas
// fixas (despesasFixasDoMes). PDF pelo próprio navegador ("salvar como PDF")
// e CSV das tabelas (abre no Excel). Nada aqui grava dado.
import { adsNoPeriodo, despesasFixasDoMes, mesAnterior, somaPedidos } from "./resumoLoja.js";
import { adsNaJanela } from "./ads.js";
import { BRL } from "./format.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const pct = (v) => (v == null || !isFinite(v) ? "—" : `${Math.round(v * 100)}%`);
const variacao = (a, b) => (b > 0 ? (a - b) / b : null);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeDoMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

export const MODELOS_RELATORIO = [
  { k: "fechamento", nome: "Fechamento do mês", quando: "todo dia 1, do mês que fechou", desc: "faturamento, taxas, custo, Ads, contas fixas, lucro líquido, mês × mês anterior, top produtos" },
  { k: "ads", nome: "Ads do mês", quando: "todo dia 1, do mês que fechou", desc: "gasto por anúncio, vendas via Ads, retorno — o que se pagou e o que não" },
  { k: "semana", nome: "Reunião da semana", quando: "toda segunda, da semana que passou", desc: "o que entrou, ideias da equipe (com crédito), o que foi decidido e se deu certo, produtos parados" },
  { k: "parados", nome: "Produtos parados", quando: "quando quiser (também vai na Reunião da semana)", desc: "sem venda há 30 dias ou mais — só informação" },
];

/** Segunda-feira da semana que passou (relatório da semana). */
export function semanaPassada(hoje) {
  const d = new Date(`${hoje}T12:00:00`).getDay(); // 0 dom
  const segundaAtual = somarDias(hoje, -((d + 6) % 7));
  return somarDias(segundaAtual, -7);
}
/** Período padrão de cada modelo. */
export function periodoPadrao(k, hoje) {
  if (k === "semana") return semanaPassada(hoje);
  if (k === "parados") return hoje;
  return mesAnterior(hoje.slice(0, 7));
}
/** Relatórios que o consultor oferece agora (período padrão ainda não gerado). */
export function relatoriosDevidos(gerados, hoje) {
  return ["fechamento", "ads", "semana"].filter((k) => (gerados || {})[k] !== periodoPadrao(k, hoje)).map((k) => ({ ...MODELOS_RELATORIO.find((m) => m.k === k), periodo: periodoPadrao(k, hoje) }));
}

// ---------- peças ----------
const paiDe = (it) => (it?.id?.startsWith("v:") && it.produtoId ? `p:${it.produtoId}` : it?.id);
function porProdutoPai(pedidos, de, ate, nomeDe) {
  const m = new Map();
  for (const p of pedidos || []) {
    if (!p.valido) continue;
    const d = String(p.data).slice(0, 10);
    if (d < de || d > ate) continue;
    const k = paiDe(p.item) || `sku:${p.sku}`;
    const g = m.get(k) || { nome: nomeDe(k) || p.item?.nome || p.sku, unidades: 0, vendas: 0, lucro: 0 };
    g.unidades += num(p.q);
    g.vendas += num(p.pago);
    g.lucro += num(p.lucro);
    m.set(k, g);
  }
  return [...m.values()];
}
function quebraDoDinheiro(pedidos, de, ate) {
  let vendas = 0, taxas = 0, repor = 0;
  for (const p of pedidos || []) {
    if (!p.valido) continue;
    const d = String(p.data).slice(0, 10);
    if (d < de || d > ate) continue;
    vendas += num(p.pago);
    taxas += Math.max(0, num(p.pago) - num(p.recebe));
    repor += num(p.custo);
  }
  return { vendas, taxas, repor };
}
const linhasDeAds = (linhasAds) => [...(linhasAds?.linhas || []), ...(linhasAds?.lojaLinha ? [linhasAds.lojaLinha] : [])];

/** Produtos e kits com preço salvo sem venda há ≥ dias (ou que nunca venderam). */
export function produtosParados({ pedidos, produtos = [], kits = [], precos = [], canais = [], linhasAds, hoje, dias = 30 }) {
  const ultima = new Map();
  for (const p of pedidos || []) {
    if (!p.valido || !p.item) continue;
    const k = paiDe(p.item);
    const d = String(p.data).slice(0, 10);
    if (!ultima.has(k) || ultima.get(k) < d) ultima.set(k, d);
  }
  const comPreco = new Set((precos || []).filter((x) => num(x.preco) > 0).map((x) => `${x.item_tipo === "kit" ? "k" : x.item_tipo === "variacao" ? "v" : "p"}:${x.item_id}`));
  const gasto = new Map();
  for (const l of linhasDeAds(linhasAds)) {
    const a = adsNaJanela(l.periodos || [], l.semanas || [], somarDias(hoje, -29), hoje);
    if (num(a?.gasto) > 0 && l.item?.id) gasto.set(l.item.id, (gasto.get(l.item.id) || 0) + num(a.gasto));
  }
  const limite = somarDias(hoje, -dias);
  const out = [];
  for (const it of [...produtos.map((p) => ({ id: `p:${p.id}`, nome: p.nome })), ...kits.map((k) => ({ id: `k:${k.id}`, nome: k.nome }))]) {
    if (!comPreco.has(it.id)) continue;
    const u = ultima.get(it.id) || null;
    if (u && u > limite) continue;
    out.push({ id: it.id, nome: it.nome, ultima: u, dias: u ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${u}T12:00:00`)) / 86400000) : null, adsGasto: gasto.get(it.id) || 0 });
  }
  void canais;
  return out.sort((a, b) => (b.adsGasto > 0) - (a.adsGasto > 0) || (a.dias == null) - (b.dias == null) || (b.dias || 0) - (a.dias || 0));
}

// ---------- modelos ----------
// Relatório = { titulo, subtitulo, blocos: [{ tipo: "kpis", itens: [{rotulo, valor, sub}] } | { tipo: "tabela", titulo, colunas, linhas } | { tipo: "texto", titulo?, linhas }] }
export function relatorioFechamento(ctx, mes) {
  const { pedidos, linhasAds, lancamentos, hoje, nomeDe } = ctx;
  const de = `${mes}-01`, ate = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
  const ma = mesAnterior(mes), deA = `${ma}-01`, ateA = fimDoMes(ma);
  const p = somaPedidos(pedidos, de, ate), pA = somaPedidos(pedidos, deA, ateA);
  const ads = adsNoPeriodo(linhasAds, de, ate), adsA = adsNoPeriodo(linhasAds, deA, ateA);
  const fixas = despesasFixasDoMes(lancamentos, mes), fixasA = despesasFixasDoMes(lancamentos, ma);
  const liq = p.lucro - ads - fixas.total, liqA = pA.lucro - adsA - fixasA.total;
  const q = quebraDoDinheiro(pedidos, de, ate);
  const v = (a, b) => (variacao(a, b) == null ? "" : `${variacao(a, b) >= 0 ? "+" : ""}${pct(variacao(a, b))} vs ${MESES[Number(ma.slice(5, 7)) - 1]}`);
  const cem = q.vendas > 0 ? (x) => BRL((x / q.vendas) * 100) : () => "—";
  const porCanal = new Map();
  for (const x of pedidos || []) {
    if (!x.valido) continue;
    const d = String(x.data).slice(0, 10);
    if (d < de || d > ate) continue;
    const k = x.canal?.nome || (x.origem === "fisico" || x.plataforma === "fisico" ? "Venda física" : x.plataforma || "—");
    const g = porCanal.get(k) || { pedidos: new Set(), vendas: 0, lucro: 0 };
    g.pedidos.add(x.pedido);
    g.vendas += num(x.pago);
    g.lucro += num(x.lucro);
    porCanal.set(k, g);
  }
  const top = porProdutoPai(pedidos, de, ate, nomeDe).sort((a, b) => b.lucro - a.lucro).slice(0, 10);
  return {
    titulo: `Fechamento de ${nomeDoMes(mes)}`,
    subtitulo: `${dm(de)} a ${dm(ate)}${ate < fimDoMes(mes) ? " (mês ainda aberto)" : ""} · pedidos importados, custo e taxas de hoje`,
    blocos: [
      {
        tipo: "kpis",
        itens: [
          { rotulo: "Faturamento", valor: BRL(p.vendas), sub: `${p.pedidos ?? "—"} pedidos · ${v(p.vendas, pA.vendas)}` },
          { rotulo: "Lucro antes do Ads", valor: BRL(p.lucro), sub: v(p.lucro, pA.lucro) },
          { rotulo: "Ads", valor: BRL(ads), sub: v(ads, adsA) },
          { rotulo: "Contas fixas", valor: fixas.itens.length ? BRL(fixas.total) : "—", sub: fixas.itens.length ? `${fixas.itens.length} conta${fixas.itens.length === 1 ? "" : "s"}` : "nenhuma conta fixa no Caixa" },
          { rotulo: "Lucro líquido", valor: fixas.itens.length ? BRL(liq) : "—", sub: fixas.itens.length && fixasA.itens.length ? v(liq, liqA) : "" },
        ],
      },
      {
        tipo: "tabela",
        titulo: "Pra onde foi cada R$ 100 vendidos",
        colunas: ["Parte", "Valor no mês", "De cada R$ 100"],
        linhas: [
          ["Taxas dos marketplaces", BRL(q.taxas), cem(q.taxas)],
          ["Repor o produto (custo)", BRL(q.repor), cem(q.repor)],
          ["Ads", BRL(ads), cem(ads)],
          ["Contas fixas", BRL(fixas.total), cem(fixas.total)],
          ["Sobrou (lucro líquido)", BRL(liq), cem(liq)],
        ],
      },
      { tipo: "tabela", titulo: "Por canal", colunas: ["Canal", "Pedidos", "Vendas", "Lucro antes do Ads"], linhas: [...porCanal].sort((a, b) => b[1].vendas - a[1].vendas).map(([k, g]) => [k, String(g.pedidos.size), BRL(g.vendas), BRL(g.lucro)]) },
      { tipo: "tabela", titulo: "Top 10 produtos (lucro)", colunas: ["Produto", "Un.", "Vendas", "Lucro", "Margem"], linhas: top.map((g) => [g.nome, String(g.unidades), BRL(g.vendas), BRL(g.lucro), pct(g.vendas > 0 ? g.lucro / g.vendas : null)]) },
      { tipo: "tabela", titulo: "Contas fixas do mês", colunas: ["Conta", "Valor"], linhas: fixas.itens.map((x) => [x.descricao, BRL(x.valor)]) },
    ],
  };
}

export function relatorioAds(ctx, mes) {
  const { linhasAds, hoje } = ctx;
  const de = `${mes}-01`, ate = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
  const linhas = [];
  let gasto = 0, lucroAds = 0;
  for (const l of linhasDeAds(linhasAds)) {
    const a = adsNaJanela(l.periodos || [], l.semanas || [], de, ate);
    if (!(num(a?.gasto) > 0)) continue;
    const lucro = l.lucro != null ? num(a.vendas) * num(l.lucro) : null;
    const retorno = lucro != null && a.gasto > 0 ? lucro / a.gasto : null;
    gasto += num(a.gasto);
    lucroAds += num(lucro);
    linhas.push({ nome: l.item?.nome || l.nome || "—", canal: l.canal?.nome || "—", gasto: num(a.gasto), vendas: num(a.vendas), lucro, retorno });
  }
  linhas.sort((a, b) => b.gasto - a.gasto);
  const pagaram = linhas.filter((x) => x.retorno != null && x.retorno >= 1);
  return {
    titulo: `Ads de ${nomeDoMes(mes)}`,
    subtitulo: `${dm(de)} a ${dm(ate)} · pelos CSVs do Shopee Ads (e semanas registradas) · retorno = lucro das vendas via Ads ÷ gasto`,
    blocos: [
      {
        tipo: "kpis",
        itens: [
          { rotulo: "Gasto de Ads", valor: BRL(gasto), sub: `${linhas.length} campanha${linhas.length === 1 ? "" : "s"}` },
          { rotulo: "Lucro das vendas via Ads", valor: BRL(lucroAds), sub: "antes de descontar o Ads" },
          { rotulo: "Retorno geral", valor: gasto > 0 ? `${(lucroAds / gasto).toFixed(2).replace(".", ",")}×` : "—", sub: "cada R$ 1 voltou isso de lucro" },
          { rotulo: "Se pagaram", valor: `${pagaram.length} de ${linhas.length}`, sub: "retorno ≥ 1×" },
        ],
      },
      {
        tipo: "tabela",
        titulo: "Por anúncio",
        colunas: ["Anúncio", "Canal", "Gasto", "Vendas via Ads", "Lucro dessas vendas", "Retorno", "Se pagou?"],
        linhas: linhas.map((x) => [x.nome, x.canal, BRL(x.gasto), x.vendas.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), x.lucro != null ? BRL(x.lucro) : "—", x.retorno != null ? `${x.retorno.toFixed(2).replace(".", ",")}×` : "—", x.retorno == null ? "—" : x.retorno >= 1 ? "sim" : "não"]),
      },
    ],
  };
}

export function relatorioParados(ctx) {
  const lista = produtosParados(ctx);
  return {
    titulo: "Produtos parados",
    subtitulo: `sem venda há 30 dias ou mais (até ${dm(ctx.hoje)}) · só informação — não é aviso`,
    blocos: [
      { tipo: "texto", linhas: [lista.length ? `${lista.length} produto${lista.length === 1 ? "" : "s"} com preço salvo sem venda há 30 dias ou mais. ${lista.some((x) => x.adsGasto > 0) ? "Atenção aos que ainda gastam Ads." : "Nenhum deles está gastando Ads."}` : "Nenhum produto parado ✓"] },
      ...(lista.length ? [{ tipo: "tabela", titulo: "Lista", colunas: ["Produto", "Última venda", "Dias sem vender", "Ads nos últimos 30 dias"], linhas: lista.map((x) => [x.nome, x.ultima ? dm(x.ultima) : "nunca vendeu", x.dias != null ? String(x.dias) : "—", x.adsGasto > 0 ? `${BRL(x.adsGasto)} ⚠` : "—"]) }] : []),
    ],
  };
}

export function relatorioSemana(ctx, segunda) {
  const { pedidos, linhasAds, registros = [], ideias = [], nomes = {}, funcoes = {}, nomeDe } = ctx;
  const domingo = somarDias(segunda, 6);
  const segA = somarDias(segunda, -7), domA = somarDias(segunda, -1);
  const p = somaPedidos(pedidos, segunda, domingo), pA = somaPedidos(pedidos, segA, domA);
  const ads = adsNoPeriodo(linhasAds, segunda, domingo), adsA = adsNoPeriodo(linhasAds, segA, domA);
  const v = (a, b) => (variacao(a, b) == null ? "" : `${variacao(a, b) >= 0 ? "+" : ""}${pct(variacao(a, b))} vs semana anterior`);
  const top = porProdutoPai(pedidos, segunda, domingo, nomeDe).sort((a, b) => b.lucro - a.lucro).slice(0, 5);
  // decisões tomadas na semana (consultor) e o que já deu resultado
  const decisoes = [];
  const STATUS = { quero: "levar pro Claude", aprovada: "aprovou", "agora-nao": "deixou pra depois", nunca: "não quer mais", levada: "levou pro Claude" };
  for (const r of registros) {
    if (r.tipo !== "consultoria") continue;
    for (const h of r.dados?.historico || []) if (h.data >= segunda && h.data <= domingo) decisoes.push([dm(h.data), r.dados?.titulo || r.chave, STATUS[h.status] || h.status, r.dados?.credito || ""]);
  }
  const resultados = [];
  for (const r of registros) {
    if (r.tipo !== "consultoria") continue;
    for (const res of r.dados?.resultados || []) if (res.em >= segunda && res.em <= domingo) resultados.push([r.dados?.titulo || r.chave, res.status === "resolveu" ? `✓ resolveu em ${res.dias} dias` : `continuou depois de ${res.dias} dias`]);
  }
  const parados = relatorioParados(ctx);
  return {
    titulo: `Reunião da semana — ${dm(segunda)} a ${dm(domingo)}`,
    subtitulo: "o que entrou, ideias da equipe, o que foi decidido e o que deu certo",
    blocos: [
      {
        tipo: "kpis",
        itens: [
          { rotulo: "Vendas", valor: BRL(p.vendas), sub: `${p.pedidos ?? "—"} pedidos · ${v(p.vendas, pA.vendas)}` },
          { rotulo: "Lucro antes do Ads", valor: BRL(p.lucro), sub: v(p.lucro, pA.lucro) },
          { rotulo: "Ads", valor: BRL(ads), sub: v(ads, adsA) },
          { rotulo: "Depois do Ads", valor: BRL(p.lucro - ads), sub: v(p.lucro - ads, pA.lucro - adsA) },
        ],
      },
      { tipo: "tabela", titulo: "Quem mais deu lucro na semana", colunas: ["Produto", "Un.", "Vendas", "Lucro"], linhas: top.map((g) => [g.nome, String(g.unidades), BRL(g.vendas), BRL(g.lucro)]) },
      { tipo: "tabela", titulo: "💡 Ideias da equipe (pra decidir)", colunas: ["Ideia", "De quem", "Por quê", "Como saber se deu certo"], linhas: ideias.map((d) => [d.titulo, `${nomes[d.de] || d.de}${funcoes[d.de] ? ` (${funcoes[d.de]})` : ""}`, d.porque, d.comoSaber]) },
      { tipo: "tabela", titulo: "Decisões da semana", colunas: ["Dia", "Assunto", "Decisão", "Crédito"], linhas: decisoes },
      { tipo: "tabela", titulo: "Deu certo?", colunas: ["Assunto", "Resultado"], linhas: resultados },
      ...parados.blocos.map((b) => ({ ...b, titulo: b.tipo === "tabela" ? "Produtos parados (só informação)" : b.titulo })),
    ],
  };
}

export function montarRelatorio(k, ctx, periodo) {
  if (k === "fechamento") return relatorioFechamento(ctx, periodo);
  if (k === "ads") return relatorioAds(ctx, periodo);
  if (k === "semana") return relatorioSemana(ctx, periodo);
  return relatorioParados(ctx);
}

// ---------- saída: PDF (impressão do navegador) e CSV ----------
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function htmlDoRelatorio(rel, nomeLoja) {
  const blocos = rel.blocos
    .map((b) => {
      if (b.tipo === "kpis") return `<div class="kpis">${b.itens.map((i) => `<div class="kpi"><span>${esc(i.rotulo)}</span><b>${esc(i.valor)}</b><small>${esc(i.sub || "")}</small></div>`).join("")}</div>`;
      if (b.tipo === "texto") return `${b.titulo ? `<h2>${esc(b.titulo)}</h2>` : ""}${b.linhas.map((l) => `<p>${esc(l)}</p>`).join("")}`;
      return `<h2>${esc(b.titulo)}</h2>${b.linhas.length ? `<table><thead><tr>${b.colunas.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p class="vazio">nada no período</p>`}`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(rel.titulo)} — ${esc(nomeLoja)}</title><style>
body{font-family:Manrope,Segoe UI,Arial,sans-serif;color:#1b1a1d;margin:24px;font-size:12px}
header{border-bottom:3px solid #d2622b;padding-bottom:8px;margin-bottom:14px}
header small{color:#d2622b;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
h1{font-size:20px;margin:2px 0}header p{margin:0;color:#666}
h2{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:6px 8px}.kpi span{display:block;font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.05em}
.kpi b{font-size:16px;display:block}.kpi small{color:#666}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f6f3ee;font-size:11px}
.vazio{color:#999}footer{margin-top:18px;color:#999;font-size:10px}
@page{margin:14mm}</style></head><body>
<header><small>Margem Real · ${esc(nomeLoja)}</small><h1>${esc(rel.titulo)}</h1><p>${esc(rel.subtitulo)}</p></header>${blocos}
<footer>Gerado pelo consultor da Sede em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Estimativa com custo e taxas de hoje — o dinheiro real está no Caixa.</footer></body></html>`;
}
/** Abre a janela de impressão do navegador (escolha "Salvar como PDF"). */
export function imprimirRelatorio(rel, nomeLoja) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const doc = f.contentWindow.document;
  doc.open();
  doc.write(htmlDoRelatorio(rel, nomeLoja));
  doc.close();
  setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  }, 300);
}
/** CSV com todas as tabelas (";" e vírgula decimal, como o resto do app). */
export function csvDoRelatorio(rel) {
  const cel = (c) => `"${String(c ?? "").replace(/"/g, '""')}"`;
  const l = [cel(rel.titulo), cel(rel.subtitulo), ""];
  for (const b of rel.blocos) {
    if (b.tipo === "kpis") {
      for (const i of b.itens) l.push([i.rotulo, i.valor, i.sub || ""].map(cel).join(";"));
      l.push("");
    } else if (b.tipo === "tabela") {
      l.push(cel(b.titulo), b.colunas.map(cel).join(";"), ...b.linhas.map((x) => x.map(cel).join(";")), "");
    }
  }
  return l.join("\r\n");
}
export function baixarCsvRelatorio(rel, nomeArquivo) {
  const blob = new Blob(["﻿" + csvDoRelatorio(rel)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
