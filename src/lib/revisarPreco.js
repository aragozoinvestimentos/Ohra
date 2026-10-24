import { canalDireto } from "./canais.js";
import { dataSP } from "./datas.js";
import { itemTipoDoId } from "./variacoes.js";

// "Vale revisar o preço?" — SÓ no canal de venda direta (Orgânico, out/2026;
// decisão do Gustavo: marketplaces já são acompanhados pela Rampa). Conta
// ÚNICA: avisa quando o preço salvo está parado há REVISAR_MESES ou quando o
// custo de hoje subiu REVISAR_CUSTO desde que o preço foi salvo. Vendas não
// contam (no canal próprio tem atacado e venda em quantidade).
export const REVISAR_MESES = 12;
export const REVISAR_CUSTO = 0.1;

const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
function mesesEntre(de, ate) {
  const a = new Date(`${de}T12:00:00`);
  const b = new Date(`${ate}T12:00:00`);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
}

/** → [{ item, canal, linha, custoHoje, motivos: [{ tipo: 'tempo'|'custo', texto }] }]
 * `itemNoCanal` (useRankingData): o custo de hoje é o DO CANAL — embalagem e
 * frete do Orgânico, os mesmos usados quando o preço foi salvo. Sem isso o
 * custo de marketplace (caixa, etiqueta, frete) parecia "subiu 150%". */
export function revisoesPrecoDireto({ itens = [], canais = [], precos = [], hoje, itemNoCanal }) {
  const out = [];
  for (const canal of canais.filter(canalDireto)) {
    for (const item of itens) {
      const tipo = itemTipoDoId(item.id);
      const linha = precos.find((p) => p.item_tipo === tipo && p.item_id === item.id.slice(2) && p.canal_id === canal.id);
      if (!linha || !(num(linha.preco) > 0)) continue;
      const motivos = [];
      const salvoEm = linha.atualizado_em ? dataSP(linha.atualizado_em) : null;
      const meses = salvoEm ? mesesEntre(salvoEm, hoje) : 0;
      if (salvoEm && meses >= REVISAR_MESES) motivos.push({ tipo: "tempo", texto: `preço salvo há ${meses} meses` });
      const custoSalvo = num(linha.custo_salvo ?? linha.custo_total);
      const custoHoje = num((itemNoCanal ? itemNoCanal(item, canal) : item)?.custoTotal ?? item.custoTotal);
      if (custoSalvo > 0 && custoHoje >= custoSalvo * (1 + REVISAR_CUSTO))
        motivos.push({ tipo: "custo", texto: `custo subiu ${Math.round((custoHoje / custoSalvo - 1) * 100)}% desde que salvou` });
      if (motivos.length) out.push({ item, canal, linha, custoHoje, motivos });
    }
  }
  return out;
}

// "✓ Revisado — manter o preço": o preço salvo continua o mesmo; o custo de
// referência passa a ser o de hoje (e o lucro/margem de hoje) e a data vira
// hoje — o aviso só volta se o custo subir +10% de novo ou daqui a 12 meses.
export function camposRevisado(linha, custoHoje, lucroHoje) {
  const preco = num(linha.preco);
  const c = Math.round(num(custoHoje) * 100) / 100;
  const out = { custo_total: c, atualizado_em: new Date().toISOString() };
  if (lucroHoje != null && isFinite(Number(lucroHoje))) {
    out.lucro = Math.round(Number(lucroHoje) * 100) / 100;
    if (preco > 0) out.margem = Number(lucroHoje) / preco;
  }
  return out;
}
