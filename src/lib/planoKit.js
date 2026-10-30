// Planejar produção de kit (Otimização) — conta ÚNICA, só consulta.
// Dois jeitos de produzir N kits:
//  • Estoque (chapas cheias): cada produto do kit na chapa cheia dele
//    (pecas_por_impressao); sobras ficam em estoque.
//  • Chapa do kit (sob pedido): uma chapa mista com as peças do kit
//    (kits.chapa_kit, schema v49 = { kitsPorChapa, tempo (min, total),
//    comprimento (m, total), materialNome }).
// O PREÇO do kit continua vindo das peças (custo por peça × qtd, como no
// catálogo); a chapa do kit só COMPARA e avisa a diferença.
import { calcProducao, custoArtesanal, DEFAULTS_PRODUCAO, entradaDoDetalhe } from "./calc.js";
import { totalItens } from "../components/SeletorItens.jsx";

export const DIFERENCA_AVISO = 0.5; // R$ por kit

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// Custo por peça de um produto e de onde ele vem (pra mostrar no kit).
export function infoPeca(produto) {
  return {
    custoPeca: num(produto?.custo_producao),
    pecasChapa: Math.max(1, num(produto?.pecas_por_impressao) || 1),
    manual: !produto?.producao_detalhe,
    // minutos da chapa cheia: Otimização (tempo_impressao_horas) › detalhamento
    tempoChapaMin: num(produto?.tempo_impressao_horas) > 0 ? num(produto.tempo_impressao_horas) * 60 : num(produto?.producao_detalhe?.tempo),
  };
}

// Componentes do kit [{ produtoId, quantidade }] com os produtos AO VIVO.
export function linhasDoKit(componentes, produtos) {
  return (componentes || [])
    .map((c) => {
      const p = (produtos || []).find((x) => x.id === c.produtoId);
      if (!p) return null;
      const q = num(c.quantidade);
      const i = infoPeca(p);
      return { produto: p, quantidade: q, ...i, subtotal: i.custoPeca * q };
    })
    .filter(Boolean);
}

// Estoque: chapas cheias de cada produto pra N kits.
export function planoEstoque(linhas, nKits) {
  const n = Math.max(0, Math.round(num(nKits)));
  const itens = linhas.map((l) => {
    const pecas = l.quantidade * n;
    const chapas = pecas > 0 ? Math.ceil(pecas / l.pecasChapa) : 0;
    return { ...l, pecas, chapas, sobra: chapas * l.pecasChapa - pecas, horas: (chapas * l.tempoChapaMin) / 60 };
  });
  const custoKit = linhas.reduce((t, l) => t + l.subtotal, 0);
  const minutosPorKit = linhas.reduce((t, l) => t + (l.tempoChapaMin / l.pecasChapa) * l.quantidade, 0);
  return { itens, custoKit, chapas: itens.reduce((t, x) => t + x.chapas, 0), horas: itens.reduce((t, x) => t + x.horas, 0), minutosPorKit, semTempo: linhas.some((l) => !(l.tempoChapaMin > 0)) };
}

// Chapa do kit: custo de UM kit impresso na chapa mista. Usa o detalhamento
// do 1º produto com detalhamento (diâmetro, densidade, % de falhas/manutenção/
// acabamento) e a impressora dele; consumíveis e modelagem somam por peça.
export function custoChapaKit(chapa, linhas, materiais) {
  const c = chapa || {};
  const kitsPorChapa = Math.max(1, num(c.kitsPorChapa) || 1);
  if (!(num(c.tempo) > 0) || !(num(c.comprimento) > 0)) return null;
  const base = linhas.find((l) => l.produto.producao_detalhe)?.produto || null;
  const detBase = { ...DEFAULTS_PRODUCAO, ...(base?.producao_detalhe || {}) };
  const filamentos = (materiais || []).filter((m) => (m.tipo || "filamento") === "filamento");
  const nomeMat = c.materialNome || detBase.materialNome;
  const material = filamentos.find((m) => m.nome === nomeMat) || filamentos[0] || null;
  const consCat = (materiais || []).filter((m) => m.tipo === "consumivel").map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));
  let consumiveis = 0;
  let modelagem = 0;
  for (const l of linhas) {
    const d = l.produto.producao_detalhe;
    if (!d) continue;
    consumiveis += totalItens(consCat, d.consumiveisItens || []) * l.quantidade;
    modelagem += num(d.modelagem) * l.quantidade;
    // Parte artesanal (vela, cimento…) não vai pra chapa: soma por peça.
    modelagem += (custoArtesanal(d, materiais)?.porPeca || 0) * l.quantidade;
  }
  const entrada = entradaDoDetalhe({ ...detBase, comprimento: num(c.comprimento), tempo: num(c.tempo), materialNome: material?.nome || nomeMat, modelagem: 0, sem3d: false, impressao: "uma" }, {
    precoKg: material?.preco ?? 0,
    consumiveis: 0,
    pecasPorPlaca: kitsPorChapa,
    maquina: base?._maquina || null,
  });
  const r = calcProducao(entrada);
  return { custoKit: r.total + consumiveis + modelagem, kitsPorChapa, minutosPorKit: num(c.tempo) / kitsPorChapa, material: material?.nome || nomeMat };
}

// Kits por dia (só impressora): minutos disponíveis ÷ minutos de impressora por kit.
export function kitsPorDia(minutosPorKit, loja) {
  const min = num(loja?.impressoras) * num(loja?.horas_impressora_dia) * 60;
  return minutosPorKit > 0 && min > 0 ? Math.floor(min / minutosPorKit) : null;
}
