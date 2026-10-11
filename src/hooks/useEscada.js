import { useCallback, useMemo } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "./useRankingData.js";
import { useRampas } from "./useRampas.js";
import { configEscada, descontoDoItem, escadaDoProduto, pareceAtracao, precoMinimoAceitavel } from "../lib/escada.js";
import { alertaPreco, estrategiaEfetiva, produtosEmRampa } from "../lib/estrategia.js";
import { anuncioDoItem, mapaAnuncioRampa, valorClientePagaHoje } from "../lib/rampaAnuncio.js";
import { quantidadeAnunciada } from "../lib/quantidadesAnuncio.js";

// Tudo que as telas de preço por quantidade/Anunciar/Produtos precificados
// precisam, em cima do catálogo AO VIVO (mudou custo, preço salvo, taxa,
// acréscimo ou a config da escada → recalcula sozinho).
// Também a ESTRATÉGIA do preço (estrategia.js): `estrategiaDe(item, canal)` e
// `alertaDe(item, canal)` são o único jeito das telas saberem se um preço
// salvo está em alerta (prejuízo / abaixo do mínimo) — nada de conta paralela.
export function useEscada() {
  const { lojas, lojaId } = useLoja();
  const dados = useRankingData();
  const { rampas } = useRampas();
  const cfgLoja = useMemo(() => lojas.find((l) => l.id === lojaId)?.config_escada || null, [lojas, lojaId]);
  const produtosPorId = useMemo(() => new Map(dados.produtos.map((p) => [p.id, p])), [dados.produtos]);

  const cfgDoProduto = useCallback((produtoId) => configEscada(cfgLoja, produtosPorId.get(produtoId)?.escada_config || null), [cfgLoja, produtosPorId]);

  const { itens, precos, concorrentes } = dados;
  // Produtos em rampa abaixo do alvo ("produtoId|canalId").
  const emRampa = useMemo(() => produtosEmRampa(rampas, precos), [rampas, precos]);
  const escada = useCallback(
    (produtoId, canal, opcoes = {}) =>
      escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg: cfgDoProduto(produtoId), emRampa: !!canal && emRampa.has(`${produtoId}|${canal.id}`), ...opcoes }),
    [itens, precos, concorrentes, cfgDoProduto, emRampa]
  );

  // "O que digitar" da Rampa (riscado fixo + promo do degrau) pros itens em
  // rampa e os que dependem deles — e o que o cliente PAGA HOJE (frete grátis).
  const mapaRampa = useMemo(
    () => mapaAnuncioRampa({ rampas, canais: dados.canais, itens, produtos: dados.produtos, kits: dados.kits, precos, concorrentes, cfgDoProduto, publicacoes: dados.publicacoesCanal }),
    [rampas, dados.canais, itens, dados.produtos, dados.kits, precos, concorrentes, cfgDoProduto, dados.publicacoesCanal]
  );
  const clientePagaHoje = useCallback(
    (item, canal) => valorClientePagaHoje(item?.id, canal, { mapaRampa, precos, itens, produtos: dados.produtos, kits: dados.kits, publicacoes: dados.publicacoesCanal })?.valor ?? null,
    [mapaRampa, precos, itens, dados.produtos, dados.kits, dados.publicacoesCanal]
  );

  const estrategiaDe = useCallback((item, canal, opcoes = {}) => estrategiaEfetiva(item, canal, { precos, emRampa, ...opcoes }), [precos, emRampa]);

  // Alerta do preço SALVO do item no canal (com custo, taxas e estratégia de hoje).
  const alertaDe = useCallback(
    (item, canal) => {
      if (!item || !canal) return null;
      const tipo = { p: "produto", v: "variacao", k: "kit" }[item.id[0]];
      const linha = precos.find((p) => p.item_tipo === tipo && p.item_id === item.id.slice(2) && p.canal_id === canal.id);
      if (!linha) return null;
      const cfg = cfgDoProduto(item.produtoId || (tipo === "produto" ? item.id.slice(2) : null));
      const minimo = precoMinimoAceitavel(canal, Number(item.custoTotal) || 0, Number(item.peso) || 0, cfg);
      const estrategia = estrategiaEfetiva(item, canal, { precos, emRampa });
      return { linha, minimo, estrategia, ...alertaPreco({ lucro: linha.lucro, preco: Number(linha.preco), minimo, estrategia, canal, valorCliente: clientePagaHoje(item, canal) }) };
    },
    [precos, cfgDoProduto, emRampa, clientePagaHoje]
  );

  // Avulso abaixo do mínimo que "parece atração" (margem abaixo da desejada,
  // mas o kit 2 compensa) e ainda sem estratégia escolhida → só sugestão.
  const pareceAtracaoDe = useCallback(
    (item, canal, al = null) => {
      const a = al || alertaDe(item, canal);
      if (!item?.id?.startsWith("p:") || !a || a.tipo !== "abaixo-minimo" || a.estrategia.origem !== "padrao" || a.linha?.estrategia) return false;
      const d = escada(item.id.slice(2), canal);
      return !!d && pareceAtracao(d.escada, d.p1, cfgDoProduto(item.id.slice(2)));
    },
    [alertaDe, escada, cfgDoProduto]
  );

  // Quantidades anunciadas por canal (v41, lib/quantidadesAnuncio.js). Padrão
  // da Shopee = regra de 4× pelos preços SALVOS (avulso + variações), com o
  // riscado já anunciado fixo — a mesma conta da Anunciar.
  const linhas4x = useMemo(() => {
    const out = new Map();
    for (const c of dados.canais.filter((x) => x.tipo === "shopee")) {
      for (const p of dados.produtos) {
        const doProduto = itens.filter((i) => i.id === `p:${p.id}` || (i.id.startsWith("v:") && i.produtoId === p.id));
        const linhas = [];
        for (const it of doProduto) {
          const tipo = it.id.startsWith("p:") ? "produto" : "variacao";
          const s = precos.find((x) => x.item_tipo === tipo && x.item_id === it.id.slice(2) && x.canal_id === c.id);
          if (!s || !(Number(s.preco) > 0)) continue;
          const { desconto } = descontoDoItem(it.id, c, { itens, produtos: dados.produtos, kits: dados.kits });
          const an = anuncioDoItem({ itemId: it.id, canal: c, real: Number(s.preco), desconto, publicacoes: dados.publicacoesCanal });
          linhas.push({ n: tipo === "produto" ? 1 : Number(it.pecas || it.quantidade) || 1, promo: Number(s.preco), original: an?.original ?? Number(s.preco) });
        }
        if (linhas.length) out.set(`${p.id}|${c.id}`, linhas);
      }
    }
    return out;
  }, [dados.canais, dados.produtos, dados.kits, dados.publicacoesCanal, itens, precos]);
  // Item (p:/v:) anunciado no canal? Kit = sempre (escolha é por produto).
  const anunciadoNoCanal = useCallback(
    (item, canal) => {
      if (!item || !canal || item.id.startsWith("k:")) return true;
      const pid = item.id.startsWith("p:") ? item.id.slice(2) : item.produtoId;
      const n = item.id.startsWith("p:") ? 1 : Number(item.pecas || item.quantidade) || 1;
      return quantidadeAnunciada({ produto: produtosPorId.get(pid), canal, n, linhas4x: linhas4x.get(`${pid}|${canal.id}`) });
    },
    [produtosPorId, linhas4x]
  );

  // Conta ÚNICA (out/2026): o item "está" nesse canal? Só então o app mostra
  // sugerido e cobra ação (Produtos precificados, "Sugerido ≠ salvo", Anunciar,
  // Ficha, Lançamento, Início). Variação: preço próprio salvo, ou o pai (avulso)
  // com preço salvo E a quantidade anunciada no canal. Kit de produtos
  // diferentes: preço próprio ou alguma peça com preço salvo. Produto: sempre.
  const noCanal = useCallback(
    (item, canal) => {
      if (!item || !canal) return false;
      const tem = (tipo, id) => dados.precos.some((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id && Number(p.preco) > 0);
      if (item.id.startsWith("v:")) return tem("variacao", item.id.slice(2)) || (tem("produto", item.produtoId) && anunciadoNoCanal(item, canal));
      if (item.id.startsWith("k:")) return tem("kit", item.id.slice(2)) || (item.componentes || []).some((c) => tem("produto", c.produtoId));
      return true;
    },
    [dados.precos, anunciadoNoCanal]
  );
  // Pra Anunciar/Início/Ficha: anunciado E no canal.
  const cobraNoCanal = useCallback((item, canal) => anunciadoNoCanal(item, canal) && noCanal(item, canal), [anunciadoNoCanal, noCanal]);

  return { ...dados, cfgLoja, cfgDoProduto, escada, rampas, emRampa, estrategiaDe, alertaDe, pareceAtracaoDe, mapaRampa, clientePagaHoje, anunciadoNoCanal, noCanal, cobraNoCanal };
}
