import { canalDireto } from "./canais.js";
// 4º Anunciar — conta ÚNICA do que digitar em cada plataforma por item × canal
// e se o anúncio está "↻ atualizar" (preço original/promo diferente do que foi
// marcado "feito" em publicacoes_canal). Usada pela aba Anunciar e pelo Início.
import { alertaPreco } from "./estrategia.js";
import { anuncioMudou, descontoDoItem } from "./escada.js";
import { anuncioDoItem, descricaoMudanca } from "./rampaAnuncio.js";
import { itemTipoDoId } from "./variacoes.js";

// Quantidade não anunciada no canal (v41, anunciadoNoCanal) fica de fora: sem ↻ nem lembrete.
export function linhasAnunciar({ itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje, anunciadoNoCanal = null }) {
  const ordem = [];
  for (const p of itens.filter((i) => i.id.startsWith("p:"))) {
    ordem.push(p);
    for (const v of itens.filter((i) => i.id.startsWith("v:") && i.produtoId === p.id.slice(2)).sort((a, b) => (a.pecas || 0) - (b.pecas || 0))) ordem.push(v);
  }
  for (const k of itens.filter((i) => i.id.startsWith("k:"))) ordem.push(k);
  return ordem
    .map((item) => {
      const tipo = itemTipoDoId(item.id);
      const id = item.id.slice(2);
      const porCanal = {};
      for (const c of canais) {
        if (canalDireto(c)) continue; // venda direta: sem anúncio/promo pra digitar
        const s = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === c.id);
        if (!s || !(Number(s.preco) > 0)) continue;
        if (anunciadoNoCanal && !anunciadoNoCanal(item, c)) continue;
        const { desconto, proprio } = descontoDoItem(item.id, c, { itens, produtos, kits });
        const ra = mapaRampa.get(`${item.id}|${c.id}`) || null;
        // Já anunciado = riscado FIXO (só a promo muda) — anuncioDoItem, conta única.
        const an = ra ? { original: ra.original, promo: ra.promo, clientePaga: ra.clientePaga, real: ra.real, riscadoFixo: ra.riscadoFixo, acimaDoRiscado: ra.acimaDoRiscado, riscadoSugerido: ra.riscadoSugerido, desconto } : anuncioDoItem({ itemId: item.id, canal: c, real: Number(s.preco), desconto, publicacoes: publicacoesCanal });
        const salvo = publicacoesCanal.find((x) => x.item_tipo === tipo && x.item_id === id && x.canal_id === c.id) || null;
        const mudou = anuncioMudou(salvo, an);
        // Regra de 4× da Shopee: sempre pelo preço SALVO (alvo) — a promo
        // temporária da rampa não decide quantas unidades cabem no anúncio.
        const anSalvo = ra ? anuncioDoItem({ itemId: item.id, canal: c, real: Number(s.preco), desconto, publicacoes: publicacoesCanal }) : an;
        // Frete grátis (v38): pelo que o cliente PAGA (cliente_paga, depois da promo).
        const frete = alertaPreco({ preco: an.real, canal: c, valorCliente: clientePagaHoje(item, c) ?? an.clientePaga }).frete;
        porCanal[c.id] = { ...an, proprio, salvo, mudou, nunca: !salvo, rampa: ra, anSalvo, frete, oQueMudou: mudou && salvo ? descricaoMudanca(salvo, an) : null };
      }
      if (!Object.keys(porCanal).length) return null;
      const pendentes = Object.values(porCanal).filter((x) => x.mudou).length;
      return { item, tipo, id, porCanal, pendentes };
    })
    .filter(Boolean);
}
