// Aba Análise (schema v55) — conta ÚNICA das vendas reais: pedidos de venda
// exportados da Olist (um arquivo por plataforma) + vendas físicas
// registradas no app, tudo em `pedidos_itens`. Funções puras: leitura do
// arquivo, ligação pelo SKU, valor pago, lucro (custo e taxas de HOJE), curva
// ABC, XYZ com estoque sugerido, comprados juntos, evolução, métricas e o que
// vai pro Fluxo de Caixa (só ENTREGUES — enviado é "a receber", fora do saldo).
// Nunca guarda nome, CPF, endereço nem telefone do cliente.
import { canalComEmbalagem } from "./embalagemCanal.js";
import { lucroNoPreco } from "./escada.js";

const num = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const normSku = (s) => String(s || "").trim().toUpperCase();
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// ---------- Plataformas (padrão universal; cada uma com o mesmo bloco na central) ----------
// `padrao` = formato do número do pedido no marketplace ("Número da ordem de
// compra" na Olist). Só a Shopee foi conferida com arquivo real; nas outras o
// 1º envio pede confirmação (aviso no bloco da plataforma).
export const PLATAFORMAS = [
  { id: "shopee", tipo: "shopee", nome: "Shopee", padrao: /^\d{6}[0-9A-Z]{8}$/, conferido: true },
  { id: "ml", tipo: "ml", nome: "Mercado Livre", padrao: /^2\d{15}$/, conferido: false },
  { id: "tiktok", tipo: "tiktok", nome: "TikTok Shop", padrao: /^5\d{17}$/, conferido: true }, // conferido com o 1º pedido real (21/10/2026)
  { id: "shein", tipo: "shein", nome: "Shein", padrao: null, conferido: false },
];
export const plataformaDoNumero = (ordem) => {
  const s = String(ordem || "").trim().toUpperCase();
  if (!s) return null;
  const p = PLATAFORMAS.find((x) => x.padrao && x.padrao.test(s));
  return p ? p.id : null;
};

// ---------- Situação ----------
export const ehCancelado = (sit) => /cancel|devolv|n[ãa]o entreg|estorn/i.test(String(sit || ""));
export const ehEntregue = (sit) => /entregue/i.test(String(sit || "")) && !ehCancelado(sit);
export const ehValido = (p) => !ehCancelado(p.situacao);

// ---------- Leitura do "Pedidos de venda" da Olist ----------
const COLS = {
  id: ["ID"],
  numero: ["Número do pedido"],
  data: ["Data"],
  cliente: ["ID contato"],
  descPedido: ["Desconto do pedido rateado"],
  frete: ["Frete pedido rateado"],
  situacao: ["Situação"],
  descricao: ["Descrição"],
  qtd: ["Quantidade"],
  vu: ["Valor unitário"],
  descItem: ["Desconto item"],
  ordem: ["Número da ordem de compra"],
  sku: ["Código (SKU)", "Código"],
};
const dataIso = (v) => {
  if (typeof v === "string" && /^\d{5}(\.\d+)?$/.test(v.trim())) v = Number(v);
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(v || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
/**
 * linhas = saída de lerXls. → { itens: [...], periodo: {de, ate}, plataformas: Set } ou lança erro
 * com o motivo (arquivo errado). Ignora nome/CPF/endereço/telefone.
 */
export function interpretarPedidosOlist(linhas) {
  const iCab = (linhas || []).findIndex((l) => (l || []).some((c) => String(c || "").trim() === "Número do pedido"));
  if (iCab < 0) throw new Error("Não é o “Pedidos de venda” da Olist (falta a coluna Número do pedido).");
  const cab = linhas[iCab].map((c) => String(c || "").trim());
  const col = {};
  for (const [k, nomes] of Object.entries(COLS)) col[k] = cab.findIndex((c) => nomes.includes(c));
  const faltam = ["id", "data", "situacao", "qtd", "vu", "sku"].filter((k) => col[k] < 0);
  if (faltam.length) throw new Error(`Faltam colunas no arquivo: ${faltam.map((k) => COLS[k][0]).join(", ")}.`);
  const itens = [];
  const vistos = new Map();
  for (const l of linhas.slice(iCab + 1)) {
    if (!l || !l[col.id]) continue;
    const pedido = String(l[col.id]).trim();
    const sku = normSku(l[col.sku]);
    const data = dataIso(l[col.data]);
    if (!data) continue;
    const k = `${pedido}|${sku}`;
    const n = (vistos.get(k) || 0) + 1;
    vistos.set(k, n);
    itens.push({
      chave: `${pedido}|${sku}|${n}`,
      origem: "olist",
      pedido,
      numero: col.numero >= 0 ? String(l[col.numero] ?? "").trim() : null,
      ordem_compra: col.ordem >= 0 ? String(l[col.ordem] ?? "").trim() || null : null,
      data,
      situacao: String(l[col.situacao] ?? "").trim(),
      sku,
      descricao: col.descricao >= 0 ? String(l[col.descricao] ?? "").trim() : "",
      quantidade: num(l[col.qtd]) || 1,
      valor_unitario: num(l[col.vu]),
      desconto_item: col.descItem >= 0 ? num(l[col.descItem]) : 0,
      desconto_pedido: col.descPedido >= 0 ? num(l[col.descPedido]) : 0,
      frete: col.frete >= 0 ? num(l[col.frete]) : 0,
      cliente: col.cliente >= 0 ? String(l[col.cliente] ?? "").trim() || null : null,
    });
  }
  if (!itens.length) throw new Error("Arquivo sem pedidos.");
  const datas = itens.map((i) => i.data).sort();
  const plataformas = new Set(itens.map((i) => plataformaDoNumero(i.ordem_compra)));
  return { itens, periodo: { de: datas[0], ate: datas[datas.length - 1] }, plataformas };
}

// ---------- Ligação pelo SKU ----------
// SKU exato; senão o SKU cadastrado mais longo que é começo do SKU vendido
// seguido de "-" (cor/opção do anúncio: CH-OC-2-PB → variação CH-OC-2).
export function ligarSku(sku, itens) {
  const s = normSku(sku);
  if (!s) return null;
  let melhor = null;
  for (const it of itens || []) {
    const k = normSku(it.sku);
    if (!k) continue;
    if (k === s) return it;
    if (s.startsWith(`${k}-`) && (!melhor || k.length > normSku(melhor.sku).length)) melhor = it;
  }
  return melhor;
}
const TIPO = { p: "produto", v: "variacao", k: "kit" };
export const tipoEIdDoItem = (it) => (it ? { item_tipo: TIPO[it.id[0]], item_id: it.id.slice(2) } : { item_tipo: null, item_id: null });

// ---------- Valores de cada linha ----------
export const valorBruto = (p) => num(p.quantidade) * num(p.valor_unitario);
export const valorPago = (p) => Math.max(0, valorBruto(p) - num(p.desconto_item) - num(p.desconto_pedido));
const PREF = { produto: "p", variacao: "v", kit: "k" };
export const idItemDoPedido = (p) => (p.item_tipo && p.item_id ? `${PREF[p.item_tipo]}:${p.item_id}` : null);

/**
 * Linhas "ricas" (valor pago, lucro e recebe com custo e taxas de HOJE).
 * ctx = { itens, canais, cfgDoProduto }. Venda física: sem taxa (lucro = pago − custo).
 */
// opcaoDoSku(sku) (opcional): opção de anúncio com vários itens com esse SKU
// exato → { itemId, grupoId, grupoNome, rotulo, doGrupo } — a venda vai pro
// item daquela opção (e fica marcada com o anúncio quando `doGrupo`).
export function enriquecer(pedidos, { itens, canais, cfgDoProduto, itemNoCanal = null, opcaoDoSku = null }) {
  const porId = new Map((itens || []).map((i) => [i.id, i]));
  // Venda física = canal orgânico: usa a embalagem dele (v56, lib/embalagemCanal.js).
  const canalFisico = (canais || []).find((c) => canalComEmbalagem(c)) || null;
  return (pedidos || []).map((p) => {
    const op = opcaoDoSku && p.origem !== "fisico" ? opcaoDoSku(p.sku) : null;
    const id = op && porId.has(op.itemId) ? op.itemId : idItemDoPedido(p);
    const grupo = op && op.doGrupo ? { id: op.grupoId, nome: op.grupoNome, rotulo: op.rotulo } : null;
    const canal = p.canal_id ? (canais || []).find((c) => c.id === p.canal_id) || null : null;
    const item0 = id ? porId.get(id) || null : null;
    const item = item0 && itemNoCanal ? itemNoCanal(item0, canal || (p.origem === "fisico" ? canalFisico : null)) : item0;
    const q = num(p.quantidade) || 1;
    const pago = valorPago(p);
    const custo = item ? num(item.custoTotal) * q : 0;
    let lucro = null;
    if (item) {
      if (canal) {
        const cfg = cfgDoProduto ? cfgDoProduto(item.produtoId || (id.startsWith("p:") ? id.slice(2) : null)) : null;
        const lu = lucroNoPreco(canal, pago / q, num(item.custoTotal), num(item.peso), cfg);
        lucro = lu != null ? lu * q : null;
      } else lucro = pago - custo;
    }
    return { ...p, id_item: id, item, grupo, canal, q, pago, bruto: valorBruto(p), lucro, recebe: lucro != null ? lucro + custo : pago, custo, valido: ehValido(p), entregue: ehEntregue(p.situacao) };
  });
}

// ---------- Semana (seg a dom) ----------
export function inicioSemana(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // seg = 0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// ---------- Fluxo de Caixa ----------
/**
 * Entradas pro caixa: uma por plataforma × semana com os pedidos ENTREGUES
 * (valor = o que a plataforma repassa: pago − taxas) e uma por semana com as
 * vendas físicas. A receber (enviado, não entregue) volta à parte, SÓ pra
 * mostrar (não vira lançamento — fora do saldo e da projeção).
 * → { lancamentos: [{ origem_import, descricao, valor, data, canal_id, n }], aReceber: [{...}] }
 */
export function caixaDosPedidos(linhas) {
  const lanc = new Map();
  const arec = new Map();
  for (const l of linhas) {
    if (!l.valido) continue;
    const sem = inicioSemana(l.data);
    const plat = l.origem === "fisico" ? "fisico" : l.plataforma || "olist";
    const k = `pedidos|${plat}|${sem}`;
    const alvo = l.origem === "fisico" || l.entregue ? lanc : arec;
    const x = alvo.get(k) || { origem_import: k, plataforma: plat, canal_id: l.canal_id || null, semana: sem, valor: 0, pedidos: new Set(), data: l.data };
    x.valor += l.recebe;
    x.pedidos.add(l.pedido);
    if (l.data > x.data) x.data = l.data;
    alvo.set(k, x);
  }
  const nome = (plat) => (plat === "fisico" ? "Vendas físicas" : `Vendas ${PLATAFORMAS.find((p) => p.id === plat)?.nome || plat}`);
  const fmt = (x, txt) => ({ ...x, valor: cent(x.valor), n: x.pedidos.size, descricao: `${nome(x.plataforma)} ${dm(x.semana)}–${dm(somarDias(x.semana, 6))} · ${x.pedidos.size} ${txt}` });
  return {
    lancamentos: [...lanc.values()].map((x) => fmt(x, x.plataforma === "fisico" ? (x.pedidos.size === 1 ? "venda" : "vendas") : x.pedidos.size === 1 ? "pedido entregue" : "pedidos entregues")),
    aReceber: [...arec.values()].map((x) => fmt(x, "enviados (não entregues)")),
  };
}

// ---------- Horas de impressora e chapa ----------
// Horas de impressora por unidade do item (tempo da chapa ÷ peças da chapa ×
// peças do item) e peças por chapa (pra arredondar o estoque).
export function horasDoItem(item, produtos) {
  if (!item) return null;
  const horasProduto = (pid) => {
    const p = (produtos || []).find((x) => x.id === pid);
    if (!p) return null;
    const min = num(p.tempo_impressao_horas) > 0 ? num(p.tempo_impressao_horas) * 60 : num(p.producao_detalhe?.tempo);
    const pecas = Math.max(1, num(p.pecas_por_impressao) || 1);
    return min > 0 ? min / 60 / pecas : null;
  };
  if (item.id.startsWith("k:")) {
    let t = 0;
    for (const c of item.componentes || []) {
      const h = horasProduto(c.produtoId);
      if (h == null) return null;
      t += h * (num(c.quantidade) || 1);
    }
    return t;
  }
  const pid = item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId;
  const h = horasProduto(pid);
  return h != null ? h * (item.id.startsWith("v:") ? num(item.quantidade || item.pecas) || 1 : 1) : null;
}
export function chapaDoItem(item, produtos) {
  if (!item || item.id.startsWith("k:")) return 1;
  const pid = item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId;
  const p = (produtos || []).find((x) => x.id === pid);
  const pecas = Math.max(1, num(p?.pecas_por_impressao) || 1);
  const q = item.id.startsWith("v:") ? num(item.quantidade || item.pecas) || 1 : 1;
  return Math.max(1, Math.floor(pecas / q));
}

// ---------- Agrupar por item (ou produto pai) ----------
function chaveGrupo(l, porPai) {
  if (!l.item) return `sku:${l.sku}`;
  if (!porPai) return l.id_item;
  if (l.id_item.startsWith("v:")) return `p:${l.item.produtoId}`;
  return l.id_item;
}
export function agruparPorItem(linhas, { itens, porPai = false }) {
  const m = new Map();
  for (const l of linhas) {
    if (!l.valido) continue;
    const k = chaveGrupo(l, porPai);
    const item = k.startsWith("sku:") ? null : (itens || []).find((i) => i.id === k) || l.item;
    const g = m.get(k) || { chave: k, item, nome: item?.nome || l.descricao || l.sku, sku: porPai ? item?.sku || l.sku : l.item?.sku || l.sku, qtd: 0, valor: 0, lucro: 0, semLucro: false, plataformas: new Set(), pedidos: new Set(), linhas: [] };
    g.qtd += l.q * (porPai && l.id_item?.startsWith("v:") ? num(l.item.quantidade || l.item.pecas) || 1 : 1);
    g.valor += l.pago;
    if (l.lucro == null) g.semLucro = true;
    else g.lucro += l.lucro;
    g.plataformas.add(l.origem === "fisico" ? "fisico" : l.plataforma || "olist");
    g.pedidos.add(l.pedido);
    g.linhas.push(l);
    m.set(k, g);
  }
  return [...m.values()];
}

// ---------- Curva ABC ----------
// crit: lucro | valor | qtd | hora (lucro por hora de impressora).
// A = até 80% acumulado (o item que cruza os 80% ainda é A), B = até 95%, C = o resto.
export function curvaABC(grupos, { crit = "lucro", produtos } = {}) {
  const base = (g) => {
    if (crit === "valor") return g.valor;
    if (crit === "qtd") return g.qtd;
    if (crit === "hora") {
      const h = horasDoItem(g.item, produtos);
      return h && g.qtd ? g.lucro / (h * g.qtd) : 0;
    }
    return g.lucro;
  };
  const ls = grupos.map((g) => ({ ...g, base: Math.max(0, base(g)), margem: g.valor > 0 ? g.lucro / g.valor : null })).sort((a, b) => b.base - a.base);
  const total = ls.reduce((t, g) => t + g.base, 0);
  let acum = 0;
  for (const g of ls) {
    g.ind = total > 0 ? g.base / total : 0;
    const antes = acum;
    acum += g.ind;
    g.acum = acum;
    g.classe = total <= 0 ? "C" : antes < 0.8 - 1e-9 ? "A" : antes < 0.95 - 1e-9 ? "B" : "C";
    // cruzamento com a margem (informativo)
    g.cruz = g.classe === "A" && g.margem != null && g.margem < 0.25 ? "cuidar-preco" : g.classe === "C" && g.margem != null && g.margem >= 0.35 ? "falta-divulgar" : null;
  }
  return { linhas: ls, total };
}

// ---------- XYZ + estoque sugerido ----------
export const ESTOQUE_PADRAO = { AX: 7, AY: 4, BX: 4, folgaFila: 1 }; // dias de cobertura por classe; o resto = sob pedido
export const ACOES_XYZ = {
  AX: ["estoque", "Deixar impresso em estoque"],
  AY: ["estoque", "Estoque pequeno"],
  BX: ["estoque", "Estoque pequeno"],
  AZ: ["pedido", "Sob pedido"],
  BY: ["pedido", "Sob pedido"],
  BZ: ["pedido", "Sob pedido"],
  CX: ["pedido", "Sob pedido"],
  CY: ["revisar", "Revisar"],
  CZ: ["revisar", "Revisar ou tirar"],
};
/**
 * semanas = [semana iso…] (as últimas N, mais antiga primeiro). abcPorChave = Map(chave → classe).
 * sazonalDe(item) → true se for produto "só na época de…" na temporada.
 */
export function curvaXYZ(grupos, { semanas, abcPorChave, produtos, farmConfig, regras = ESTOQUE_PADRAO, sazonalDe = () => false }) {
  const horasDia = num(farmConfig?.horas_dia_operacao) || 8;
  return grupos
    .map((g) => {
      const v = semanas.map((s) => g.linhas.filter((l) => inicioSemana(l.data) === s).reduce((t, l) => t + l.q, 0));
      const media = v.reduce((t, n) => t + n, 0) / v.length;
      const dp = Math.sqrt(v.reduce((t, n) => t + (n - media) ** 2, 0) / v.length);
      const cv = media > 0 ? dp / media : 9;
      const xyz = cv <= 0.5 ? "X" : cv <= 1 ? "Y" : "Z";
      const abc = abcPorChave.get(g.chave) || "C";
      const sazonal = !!(g.item && sazonalDe(g.item));
      const [acao, titulo] = ACOES_XYZ[abc + xyz];
      // Estoque: cobertura pela classe (sazonal na temporada = ritmo das 2 últimas semanas × 7 dias).
      const chapa = chapaDoItem(g.item, produtos);
      const horasChapa = (horasDoItem(g.item, produtos) || 0) * chapa;
      const lead = num(regras.folgaFila ?? 1) + horasChapa / horasDia;
      let cobertura = num(regras[abc + xyz]) || 0;
      let porDia = media / 7;
      if (sazonal) {
        const rec = (v[v.length - 1] + v[v.length - 2]) / 2;
        if (rec > 0) {
          cobertura = Math.max(cobertura, 7);
          porDia = rec / 7;
        }
      }
      let manter = 0;
      let reimprimir = 0;
      if (cobertura > 0 && porDia > 0) {
        const seg = dp * (cobertura / 7);
        manter = Math.ceil(porDia * (cobertura + lead) + seg - 1e-9);
        if (chapa > 1) manter = Math.ceil(manter / chapa) * chapa;
        reimprimir = Math.max(1, Math.ceil(porDia * lead + seg * 0.5 - 1e-9));
      }
      return { ...g, v, media, dp, cv, xyz, abc, sazonal, acao: sazonal && cobertura > 0 ? "estoque" : acao, titulo: sazonal && cobertura > 0 ? "Temporada: estoque pelo ritmo" : titulo, chapa, manter, reimprimir };
    })
    .sort((a, b) => "ABC".indexOf(a.abc) - "ABC".indexOf(b.abc) || b.media - a.media);
}

// ---------- Comprados juntos ----------
export const MIN_PEDIDOS_CESTA = 10;
export function compradosJuntos(linhas, { itens, min = MIN_PEDIDOS_CESTA } = {}) {
  const porPedido = new Map();
  for (const l of linhas) {
    if (!l.valido || !l.item) continue;
    const pai = l.id_item.startsWith("v:") ? `p:${l.item.produtoId}` : l.id_item;
    if (!porPedido.has(l.pedido)) porPedido.set(l.pedido, new Map());
    porPedido.get(l.pedido).set(l.id_item, pai);
  }
  const contaItem = new Map();
  const contaPar = new Map();
  for (const m of porPedido.values()) {
    const ids = [...m.keys()];
    for (const a of ids) contaItem.set(a, (contaItem.get(a) || 0) + 1);
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < ids.length; j++) if (i !== j) contaPar.set(`${ids[i]}>${ids[j]}`, (contaPar.get(`${ids[i]}>${ids[j]}`) || 0) + 1);
  }
  const nome = (id) => (itens || []).find((i) => i.id === id)?.nome || id;
  const out = [];
  for (const [a, n] of contaItem) {
    if (n < min) continue;
    let melhor = null;
    for (const [k, c] of contaPar) {
      const [x, y] = k.split(">");
      if (x === a && (!melhor || c > melhor.c)) melhor = { b: y, c };
    }
    if (!melhor || melhor.c / n < 0.2) continue;
    const ia = (itens || []).find((i) => i.id === a);
    const ib = (itens || []).find((i) => i.id === melhor.b);
    const paiA = ia?.id.startsWith("v:") ? ia.produtoId : ia?.id.slice(2);
    const paiB = ib?.id.startsWith("v:") ? ib.produtoId : ib?.id.slice(2);
    const kitExiste = (itens || []).some((k) => k.id.startsWith("k:") && (k.componentes || []).some((c) => c.produtoId === paiA) && (k.componentes || []).some((c) => c.produtoId === paiB));
    out.push({ a, b: melhor.b, nomeA: nome(a), nomeB: nome(melhor.b), juntos: melhor.c, pedidosA: n, parte: melhor.c / n, mesmoProduto: paiA && paiA === paiB, kitExiste });
  }
  return out.sort((x, y) => y.parte - x.parte);
}

// ---------- Métricas ----------
export function metricas(linhas, { precoAlvoDe = () => null } = {}) {
  const pedidos = new Map();
  let fat = 0;
  let bruto = 0;
  let cupom = 0;
  let descPreco = 0;
  let baseCheia = 0;
  let unid = 0;
  for (const l of linhas) {
    const p = pedidos.get(l.pedido) || { valido: l.valido, valor: 0, pecas: 0, cliente: l.cliente, data: l.data };
    if (!l.valido) p.valido = false;
    if (l.valido) {
      p.valor += l.pago;
      p.pecas += l.q;
      fat += l.pago;
      bruto += l.bruto;
      unid += l.q;
      cupom += num(l.desconto_item) + num(l.desconto_pedido);
      const alvo = precoAlvoDe(l);
      const cheio = alvo && alvo > num(l.valor_unitario) ? alvo : num(l.valor_unitario);
      descPreco += (cheio - num(l.valor_unitario)) * l.q;
      baseCheia += cheio * l.q;
    }
    pedidos.set(l.pedido, p);
  }
  const todos = [...pedidos.values()];
  const val = todos.filter((p) => p.valido);
  const clientes = new Map();
  for (const p of val) if (p.cliente) clientes.set(p.cliente, (clientes.get(p.cliente) || 0) + 1);
  const comCliente = [...clientes.values()];
  return {
    pedidos: val.length,
    cancelados: todos.length - val.length,
    pctCancel: todos.length ? (todos.length - val.length) / todos.length : null,
    faturamento: fat,
    unidades: unid,
    ticket: val.length ? fat / val.length : null,
    itensPorPedido: val.length ? unid / val.length : null,
    pctMulti: val.length ? val.filter((p) => p.pecas >= 2).length / val.length : null,
    descontoPreco: baseCheia > 0 ? descPreco / baseCheia : null,
    descontoCupom: baseCheia > 0 ? cupom / baseCheia : null,
    descontoTotal: baseCheia > 0 ? (descPreco + cupom) / baseCheia : null,
    clientes: comCliente.length,
    recompra: comCliente.length ? comCliente.filter((n) => n >= 2).length / comCliente.length : null,
    voltaram: comCliente.filter((n) => n >= 2).length,
    bruto,
  };
}

// Vendas (unidades) por dia da semana — só informativo.
export function porDiaDaSemana(linhas) {
  const n = [0, 0, 0, 0, 0, 0, 0]; // seg..dom
  for (const l of linhas) if (l.valido) n[(new Date(`${l.data}T12:00:00`).getDay() + 6) % 7] += l.q;
  return ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d, i) => ({ dia: d, n: n[i] }));
}

// Semana a semana por item (últimas `n` semanas) + tendência (2 últimas × 2 anteriores).
export function evolucaoSemanal(grupos, semanas) {
  return grupos
    .map((g) => {
      const v = semanas.map((s) => g.linhas.filter((l) => inicioSemana(l.data) === s).reduce((t, l) => t + l.q, 0));
      const lucroSem = semanas.map((s) => g.linhas.filter((l) => inicioSemana(l.data) === s).reduce((t, l) => t + (l.lucro || 0), 0));
      const k = v.length;
      const a = k >= 2 ? (v[k - 1] + v[k - 2]) / 2 : v[k - 1] || 0;
      const b = k >= 4 ? (v[k - 3] + v[k - 4]) / 2 : null;
      const tendencia = b ? a / b - 1 : a > 0 && b === 0 ? 1 : null;
      return { ...g, v, lucroSem, tendencia };
    })
    .sort((x, y) => y.v.reduce((t, n) => t + n, 0) - x.v.reduce((t, n) => t + n, 0));
}

// Últimas N semanas (início seg), terminando na semana de `hoje`.
export function ultimasSemanas(hoje, n) {
  const fim = inicioSemana(hoje);
  return Array.from({ length: n }, (_, i) => somarDias(fim, -7 * (n - 1 - i)));
}

// Projeção do mês pelo ritmo: vendido até hoje ÷ dias passados × dias do mês.
export function projecaoMes(linhas, hoje) {
  const mes = hoje.slice(0, 7);
  const doMes = linhas.filter((l) => l.valido && l.data.slice(0, 7) === mes);
  const fat = doMes.reduce((t, l) => t + l.pago, 0);
  const lucro = doMes.reduce((t, l) => t + (l.lucro || 0), 0);
  const dia = Number(hoje.slice(8, 10));
  const [y, m] = mes.split("-").map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  return { faturamento: fat, lucro, projFat: dia > 0 ? (fat / dia) * diasMes : 0, projLucro: dia > 0 ? (lucro / dia) * diasMes : 0, dia, diasMes };
}

// Concentração: quanto do lucro no produto nº 1 e na plataforma nº 1.
export function concentracao(abcLinhas) {
  const total = abcLinhas.reduce((t, g) => t + Math.max(0, g.lucro), 0);
  if (!(total > 0)) return null;
  const top = abcLinhas.reduce((m, g) => (!m || g.lucro > m.lucro ? g : m), null);
  const porPlat = new Map();
  for (const g of abcLinhas) for (const l of g.linhas) if (l.lucro > 0) porPlat.set(l.origem === "fisico" ? "fisico" : l.plataforma, (porPlat.get(l.origem === "fisico" ? "fisico" : l.plataforma) || 0) + l.lucro);
  const [plat, vPlat] = [...porPlat.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  return { produto: top, pctProduto: top.lucro / total, plataforma: plat, pctPlataforma: vPlat / total };
}

// Preço × vendas na Rampa (elasticidade): cada subida de degrau com semanas completas antes e depois.
export function precoVsVendas(linhasRampa) {
  const out = [];
  for (const l of linhasRampa || []) {
    const segs = l.est?.segmentos || [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1];
      const b = segs[i];
      if (b.tipo !== "subida" || !a.completas?.length || !b.completas?.length || !(a.preco > 0) || !(b.preco > 0)) continue;
      const med = (arr, k) => arr.reduce((t, w) => t + num(w[k]), 0) / arr.length;
      const vA = med(a.completas.slice(-2), "vendas");
      const vB = med(b.completas.slice(0, 2), "vendas");
      const lA = med(a.completas.slice(-2), "lucro");
      const lB = med(b.completas.slice(0, 2), "lucro");
      const dPreco = b.preco / a.preco - 1;
      const dVendas = vA > 0 ? vB / vA - 1 : null;
      out.push({
        nome: l.produto?.nome,
        canal: l.canal,
        de: a.preco,
        para: b.preco,
        dPreco,
        vA,
        vB,
        lA,
        lB,
        dVendas,
        leitura: lB >= lA - 0.005 ? "aguenta" : dVendas != null && -dVendas > dPreco * 2 ? "sensivel" : "atencao",
      });
    }
  }
  return out;
}
export { diasEntre, somarDias, normSku };

// ---------- Cobertura: período em que já há pedidos importados ----------
// Dias cobertos por plataforma = união dos períodos dos envios de "Pedidos
// (Olist)" que deram certo. Nesses dias as vendas REAIS valem (Vendas do mês,
// teto do Ads, Registrar semana) e a estimativa das semanas registradas sai.
export function coberturaPedidos(importacoes) {
  const porPlat = new Map();
  for (const i of importacoes || []) {
    if (!i.ok || !String(i.relatorio || "").startsWith("pedidos:") || !i.periodo_de || !i.periodo_ate) continue;
    const plat = i.relatorio.slice(8);
    if (!porPlat.has(plat)) porPlat.set(plat, []);
    porPlat.get(plat).push([String(i.periodo_de).slice(0, 10), String(i.periodo_ate).slice(0, 10)]);
  }
  const platDoCanal = (canal) => (canal ? PLATAFORMAS.find((p) => p.tipo === canal.tipo)?.id || null : null);
  const dia = (plat, d) => (porPlat.get(plat) || []).some(([a, b]) => d >= a && d <= b);
  /** Todos os dias de `de` a `ate` cobertos na plataforma do canal? */
  const cobre = (canal, de, ate = de) => {
    const plat = platDoCanal(canal);
    if (!plat || !porPlat.has(plat) || !de) return false;
    for (let d = de; d <= ate; d = somarDias(d, 1)) if (!dia(plat, d)) return false;
    return true;
  };
  return { cobre, platDoCanal, tem: porPlat.size > 0 };
}
