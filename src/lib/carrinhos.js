// Carrinhos abandonados (23/10/2026, pedido do Gustavo): pedido fechado e não
// pago ("Dados incompletos" na Olist — ver ehNaoPago em pedidos.js). Não conta
// como venda em lugar nenhum; aqui ele vira lista + conversão.
// Memória (preferencias_loja `analise:carrinhos` = { pedido Olist: data em que
// foi visto não pago }): quando o MESMO pedido aparece pago num envio seguinte,
// a linha no banco muda de situação — a memória é o que lembra que ele foi um
// carrinho abandonado. Sem SQL.
import { ehNaoPago } from "./pedidos.js";

export const CHAVE_CARRINHOS = "analise:carrinhos";
export const JANELA_RECUPERA = 7; // dias pra contar como recuperado (decisão do Gustavo)
export const CUPOM_DIAS = 3; // o cupom de recuperação vale 3 dias

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Acrescenta à memória os pedidos não pagos destas linhas. → memória nova ou null se nada mudou. */
export function lembrarCarrinhos(memoria, linhas, hoje) {
  const m = { ...(memoria || {}) };
  let mudou = false;
  for (const l of linhas || []) {
    if (!l?.pedido || !ehNaoPago(l.situacao) || m[l.pedido]) continue;
    m[l.pedido] = String(l.data || hoje).slice(0, 10);
    mudou = true;
  }
  return mudou ? m : null;
}

/**
 * linhas = pedidos enriquecidos (todos, com valido/naoPago). → { lista, resumo }
 * Cada carrinho: { pedido, ordem, data, canal_id, canal, itens [{item, nome, q}], valor,
 * estado: "pago-depois" | "recuperado" | "provavel" | "aguardando" | "perdido",
 * por: { pedido, ordem, data } (a compra que recuperou), cupomAte, ateRecuperar }
 */
export function carrinhosAbandonados({ linhas, memoria, hoje }) {
  const porPedido = new Map();
  for (const l of linhas || []) {
    if (l.origem === "fisico") continue;
    if (!porPedido.has(l.pedido)) porPedido.set(l.pedido, []);
    porPedido.get(l.pedido).push(l);
  }
  const abandonados = new Set(Object.keys(memoria || {}));
  for (const [ped, ls] of porPedido) if (ls.some((l) => ehNaoPago(l.situacao))) abandonados.add(ped);

  // Compras válidas (candidatas a "recuperou"), por data.
  const compras = [];
  for (const [ped, ls] of porPedido) {
    if (abandonados.has(ped)) continue;
    const v = ls.filter((l) => l.valido);
    if (!v.length) continue;
    compras.push({ pedido: ped, ordem: v[0].ordem_compra || null, data: String(v[0].data), canal_id: v[0].canal_id, cliente: v[0].cliente || null, itens: new Set(v.map((l) => l.id_item).filter(Boolean)) });
  }
  compras.sort((a, b) => a.data.localeCompare(b.data));
  const usadas = new Set();

  const lista = [];
  for (const ped of abandonados) {
    const ls = porPedido.get(ped);
    if (!ls?.length) continue; // pedido saiu do banco
    const l0 = ls[0];
    const data = String(memoria?.[ped] && memoria[ped] < l0.data ? memoria[ped] : l0.data).slice(0, 10);
    const c = {
      pedido: ped,
      ordem: l0.ordem_compra || null,
      data,
      canal_id: l0.canal_id,
      canal: l0.canal || null,
      cliente: l0.cliente || null,
      itens: ls.map((l) => ({ item: l.item, id: l.id_item, nome: l.item?.nome || l.descricao || l.sku, q: num(l.q || l.quantidade) })),
      valor: ls.reduce((t, l) => t + num(l.pago), 0),
      cupomAte: somarDias(data, CUPOM_DIAS),
      ateRecuperar: somarDias(data, JANELA_RECUPERA),
      estado: null,
      por: null,
    };
    if (ls.some((l) => l.valido)) {
      c.estado = "pago-depois"; // o mesmo pedido foi pago depois
      c.por = { pedido: ped, ordem: c.ordem, data: String(ls.find((l) => l.valido).data) };
    }
    lista.push(c);
  }
  lista.sort((a, b) => a.data.localeCompare(b.data));

  // Outra compra em até 7 dias: mesmo cliente = recuperado; mesma plataforma e
  // mesmo produto = provável (a plataforma pode criar outro contato).
  const achar = (c, cond) => compras.find((x) => !usadas.has(x.pedido) && x.canal_id === c.canal_id && x.data >= c.data && x.data <= c.ateRecuperar && cond(x));
  for (const c of lista) {
    if (c.estado) continue;
    const ids = new Set(c.itens.map((i) => i.id).filter(Boolean));
    let x = c.cliente ? achar(c, (y) => y.cliente === c.cliente) : null;
    if (x) c.estado = "recuperado";
    else {
      x = achar(c, (y) => [...y.itens].some((id) => ids.has(id)));
      if (x) c.estado = "provavel";
    }
    if (x) {
      usadas.add(x.pedido);
      c.por = { pedido: x.pedido, ordem: x.ordem, data: x.data };
    } else c.estado = hoje <= c.ateRecuperar ? "aguardando" : "perdido";
  }
  lista.reverse(); // mais recentes primeiro
  return { lista, resumo: resumoCarrinhos(lista) };
}

export function resumoCarrinhos(lista) {
  const n = lista.length;
  const valor = lista.reduce((t, c) => t + c.valor, 0);
  const certos = lista.filter((c) => c.estado === "pago-depois" || c.estado === "recuperado");
  const provaveis = lista.filter((c) => c.estado === "provavel");
  const fechados = lista.filter((c) => c.estado !== "aguardando").length; // os que já passaram dos 7 dias ou recuperaram
  return {
    n,
    valor,
    recuperados: certos.length,
    provaveis: provaveis.length,
    aguardando: lista.filter((c) => c.estado === "aguardando").length,
    perdidos: lista.filter((c) => c.estado === "perdido").length,
    valorRecuperado: certos.reduce((t, c) => t + c.valor, 0),
    taxa: fechados ? certos.length / fechados : null,
    taxaComProvaveis: fechados ? (certos.length + provaveis.length) / fechados : null,
  };
}

export const ESTADOS_CARRINHO = {
  "pago-depois": { rot: "pago depois", tipo: "oportunidade", dica: "O mesmo pedido foi pago depois." },
  recuperado: { rot: "recuperado", tipo: "oportunidade", dica: `O mesmo cliente comprou em até ${JANELA_RECUPERA} dias.` },
  provavel: { rot: "provável", tipo: "info", dica: `Não deu pra confirmar o cliente, mas saiu outro pedido do mesmo produto na mesma plataforma em até ${JANELA_RECUPERA} dias.` },
  aguardando: { rot: "aguardando", tipo: "atencao", dica: `Ainda dentro dos ${JANELA_RECUPERA} dias.` },
  perdido: { rot: "não voltou", tipo: "info", dica: `Passaram ${JANELA_RECUPERA} dias sem compra.` },
};
