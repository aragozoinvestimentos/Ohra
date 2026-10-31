// Saldo de filamento (01/11/2026, aprovado pelo Gustavo, schema v73) — conta
// ÚNICA, PURA. Por material (o filamento cadastrado em Materiais):
//   saldo = última contagem (soma das cores contadas naquele dia)
//         + compras de material registradas DEPOIS dela (kg)
//         − o que as impressões registradas DEPOIS dela gastaram (estimado pelo
//           peso do fatiador; falha = só o % impresso; kit = as peças).
// As cores vêm só da contagem (o app não sabe a cor de cada impressão). Sem
// contagem = "conte o que tem" (o app não chuta saldo).

import { custoProdutoPorPeca } from "./calc.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dia = (v) => String(v || "").slice(0, 10);
const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
export const DIAS_AVISO_FILAMENTO = 14;

/** Gramas de cada filamento (pelo nome) em UMA unidade do produto. */
export function gramasPorMaterial(produto, materiais) {
  const out = new Map();
  if (!produto || produto.origem === "revenda" || produto.producao_detalhe?.sem3d) return out;
  const r = custoProdutoPorPeca(produto, materiais);
  if (!r) return out;
  const d = produto.producao_detalhe || {};
  if (Array.isArray(r.mesas) && r.mesas.length) {
    for (const m of r.mesas) {
      const fator = num(m.leva) / Math.max(1, num(m.rende));
      for (const f of m.fils || []) {
        const nome = f.purga ? m.fils[0]?.nome || d.materialNome : f.nome || d.materialNome;
        if (!nome) continue;
        out.set(nome, (out.get(nome) || 0) + num(f.pesoG) * fator);
      }
    }
    return out;
  }
  const g = num(r.peso3d ?? r.peso);
  const nome = d.materialNome || produto.material_nome;
  if (g > 0 && nome) out.set(nome, g);
  return out;
}

/** Gramas por material que UM registro de impressão gastou. */
export function consumoDoRegistro(reg, { produtos = [], kits = [], materiais = [] }) {
  const out = new Map();
  const fator = reg.status === "falha" ? num(reg.falha_pct) / 100 : 1;
  if (!(fator > 0)) return out;
  const somar = (produto, qtd) => {
    for (const [nome, g] of gramasPorMaterial(produto, materiais)) out.set(nome, (out.get(nome) || 0) + g * qtd * fator);
  };
  const lote = Math.max(1, num(reg.quantidade_lote) || 1);
  if (reg.produto_id) {
    somar(produtos.find((p) => p.id === reg.produto_id), lote);
    return out;
  }
  // Kit impresso junto: "<kit> (kit)"
  const nomeKit = String(reg.produto_nome || "").replace(/ \(kit\)$/, "");
  const kit = kits.find((k) => k.nome === nomeKit);
  for (const c of kit?.componentes || kit?.kit_produtos || []) somar(produtos.find((p) => p.id === (c.produtoId || c.produto_id)), lote * num(c.quantidade || 1));
  return out;
}

export function saldoFilamentos({ materiais = [], contagens = [], compras = [], registros = [], produtos = [], kits = [], hoje }) {
  const fils = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  // consumo por (material, dia)
  const consumos = [];
  for (const r of registros) {
    const d = dia(r.criado_em ? new Date(r.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : r.data);
    for (const [nome, g] of consumoDoRegistro(r, { produtos, kits, materiais })) consumos.push({ nome, data: d, kg: g / 1000 });
  }
  const ini30 = (() => {
    const x = new Date(`${hoje}T12:00:00`);
    x.setDate(x.getDate() - 30);
    return x.toISOString().slice(0, 10);
  })();
  return fils.map((m) => {
    const cs = contagens.filter((c) => c.material_id === m.id);
    const ultimaData = cs.reduce((u, c) => (dia(c.data) > u ? dia(c.data) : u), "");
    const daContagem = cs.filter((c) => dia(c.data) === ultimaData);
    const cores = daContagem.map((c) => ({ cor: c.cor || "", kg: num(c.kg) })).sort((a, b) => b.kg - a.kg);
    const base = cores.reduce((t, c) => t + c.kg, 0);
    const entrou = compras.filter((c) => c.material_id === m.id && (!ultimaData || dia(c.data) > ultimaData)).reduce((t, c) => t + num(c.quantidade), 0);
    const gastou = consumos.filter((c) => c.nome === m.nome && (!ultimaData || c.data > ultimaData)).reduce((t, c) => t + c.kg, 0);
    const gasto30 = consumos.filter((c) => c.nome === m.nome && c.data > ini30 && c.data <= hoje).reduce((t, c) => t + c.kg, 0);
    const porDia = gasto30 / 30;
    const saldo = ultimaData ? Math.round((base + entrou - gastou) * 1000) / 1000 : null;
    const dura = saldo != null && porDia > 0 ? Math.floor(Math.max(0, saldo) / porDia) : null;
    let estado = "ok";
    if (saldo == null) estado = gasto30 > 0 ? "contar" : "sem-uso";
    else if (saldo <= 0) estado = "acabou";
    else if (dura != null && dura < DIAS_AVISO_FILAMENTO) estado = "comprar";
    return { material: m, ultimaData: ultimaData || null, diasDesde: ultimaData ? dias(ultimaData, hoje) : null, cores, base, entrou, gastou, gasto30, porDia, saldo, dura, estado };
  });
}
