// Lista de ANÚNCIOS (remap 21/10/2026): cada produto/kit/anúncio com vários
// itens em cada canal onde tem preço salvo. SÓ JUNTA o que as outras contas
// já decidem — preço alvo × agora (useEscada.agoraDe), alerta do preço
// (alertaDe), rampa (useCrescimento.linhas/linhasGrupo), Ads (linhasAds) e
// vendas reais (pedidos importados). Nenhuma regra nova aqui.
import { estadoDoAlerta, estadoSugestaoRampa, piorEstado } from "./estados.js";
import { irParaAba } from "./navegar.js";
import { numerosDoPeriodo } from "./ads.js";
import { diagnosticoDoAnuncio, referenciaDaLoja, taxasDoFunil } from "./diagnostico.js";
import { infoSazonal, quandoVendeDe } from "./calendario.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// Abre o Painel do anúncio (aba = resumo | vendas | preco | rampa | ads | anuncio | custo).
export function abrirAnuncio(itemId, canalId, aba = "resumo") {
  irParaAba("anuncio", { itemId, canalId, aba });
}
// Abre a Página do produto (itemId p:/k:; aba = visao | cadastro | custo | variacoes).
export function abrirProduto(itemId, aba = "visao") {
  irParaAba("produto", { itemId, aba });
}

// Números do período de Ads ligado (o maior entre semanas e o CSV).
export function numerosAds(ads) {
  const ativo = ads?.av?.ativo;
  if (!ativo) return null;
  return numerosDoPeriodo(ativo, ads.semanas || [], ads.preco, ads.av.empate);
}

const ESTADO_ADS = { resolver: "resolver", atencao: "atencao", oportunidade: "oportunidade", decisao: "decisao" };

/** Vendas reais (pedidos válidos) de um anúncio nos últimos `dias` dias até `hoje`. */
// todos = true → TODAS as vendas do item (também as que vieram por um anúncio com
// vários itens), com `via` = [{ grupoId, nome, unidades }] — é o que a Página do
// produto mostra (o item é um só; o anúncio é só por onde vendeu). Sem `todos`,
// só as do anúncio próprio dele (Painel do anúncio, lista de Anúncios).
export function vendasDoAnuncio(pedidos, { itemId, canalId, produtoId = null, grupoId = null, todos = false }, hoje, dias = 30, ate = null) {
  const de = somarDias(ate || hoje, -dias);
  const fim = ate || hoje;
  let un = 0;
  let fat = 0;
  let lucro = 0;
  let pedidosN = 0;
  const vistos = new Set();
  const via = new Map();
  for (const l of pedidos || []) {
    if (!l.valido || l.canal_id !== canalId) continue;
    const d = String(l.data);
    if (d <= de || d > fim) continue;
    const doItem = l.id_item === itemId || (produtoId && l.item?.produtoId === produtoId);
    const meu = grupoId ? l.grupo?.id === grupoId : doItem && (todos || !l.grupo);
    if (!meu) continue;
    un += num(l.q);
    fat += num(l.pago);
    lucro += num(l.lucro);
    if (!grupoId && l.grupo) {
      const g = via.get(l.grupo.id) || { grupoId: l.grupo.id, nome: l.grupo.nome, unidades: 0 };
      g.unidades += num(l.q);
      via.set(l.grupo.id, g);
    }
    if (!vistos.has(l.pedido)) {
      vistos.add(l.pedido);
      pedidosN++;
    }
  }
  return { unidades: un, faturamento: fat, lucro, pedidos: pedidosN, via: [...via.values()] };
}

/**
 * Monta as linhas da lista de Anúncios.
 * esc = useEscada(), cres = useCrescimento(), pedidos = cres.pedidosValidos.
 */
export function montarAnuncios({ esc, cres, pedidos, hoje }) {
  const out = [];
  const tem = (tipo, id, canalId) => esc.precos.some((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canalId && num(p.preco) > 0);
  const adsDe = (chave) => (cres.linhasAds?.linhas || []).find((l) => l.chave === chave) || null;
  for (const canal of esc.canais) {
    // Produtos (o anúncio do avulso; as variações dele vão junto)
    for (const p of esc.produtos) {
      const item = esc.itens.find((i) => i.id === `p:${p.id}`);
      if (!item) continue;
      const variacoes = esc.itens.filter((i) => i.id.startsWith("v:") && i.produtoId === p.id && tem("variacao", i.id.slice(2), canal.id));
      if (!tem("produto", p.id, canal.id) && !variacoes.length) continue;
      const rampa = (cres.linhas || []).find((l) => !l.ehKit && l.r.produto_id === p.id && l.r.canal_id === canal.id) || null;
      out.push(linha({ esc, cres, pedidos, hoje, canal, item, tipo: "produto", variacoes, rampa, ads: adsDe(`produto|${p.id}|${canal.id}`) }));
    }
    // Kits
    for (const k of esc.kits || []) {
      const item = esc.itens.find((i) => i.id === `k:${k.id}`);
      if (!item || !tem("kit", k.id, canal.id)) continue;
      const rampa = (cres.linhas || []).find((l) => l.ehKit && l.r.kit_id === k.id && l.r.canal_id === canal.id) || null;
      out.push(linha({ esc, cres, pedidos, hoje, canal, item, tipo: "kit", variacoes: [], rampa, ads: adsDe(`kit|${k.id}|${canal.id}`) }));
    }
    // Anúncios com vários itens (só onde alguma opção tem preço salvo)
    for (const g of esc.gruposAnuncio || []) {
      const ops = Array.isArray(g.opcoes) ? g.opcoes : [];
      const algum = ops.some((o) => tem(o.item_tipo, o.item_id, canal.id));
      if (!algum) continue;
      const ads = adsDe(`grupo|${g.id}|${canal.id}`);
      const rampa = (cres.linhasGrupo || []).find((l) => l.grupo.id === g.id && l.canal.id === canal.id) || null;
      const v = vendasDoAnuncio(pedidos, { canalId: canal.id, grupoId: g.id }, hoje);
      const estAds = ads?.av?.estado && ESTADO_ADS[ads.av.estado] ? { tipo: ads.av.estado, motivo: `Ads: ${ads.av.titulo}` } : null;
      const estRampa = rampa ? ((t) => (t ? { tipo: t, motivo: rampa.est.sugestao?.rotulo } : null))(estadoSugestaoRampa(rampa.est)) : null;
      const pior = piorEstado([estAds, estRampa]);
      const op = [estRampa, estAds].find((e) => e?.tipo === "oportunidade") || null;
      out.push({
        chave: `g:${g.id}|${canal.id}`,
        itemId: `g:${g.id}`,
        nome: `Anúncio: ${g.nome}`,
        sku: "",
        tipo: "grupo",
        canal,
        grupo: g,
        opcoes: ops.length,
        agora: ads ? { preco: ads.preco, lucro: ads.lucro } : null,
        alvo: null,
        emRampa: !!rampa,
        rampa,
        ads,
        adsNum: numerosAds(ads),
        vendas: v,
        estado: pior || op,
      });
    }
  }
  // Diagnóstico comercial (24/10/2026): Desempenho mais recente de cada anúncio,
  // referência da loja (mediana) e um diagnóstico por anúncio (lib/diagnostico.js).
  if (cres.desempenhoDoAnuncio) {
    for (const l of out) l.desempenho = l.canal?.tipo === "shopee" ? cres.desempenhoDoAnuncio({ sku: l.tipo === "grupo" ? null : l.sku, grupoId: l.tipo === "grupo" ? l.grupo.id : null, canalId: l.canal.id }) : null;
    const ref = referenciaDaLoja(out.map((l) => (l.desempenho ? taxasDoFunil(l.desempenho.item) : null)));
    for (const l of out) {
      const prodId = l.tipo === "produto" ? l.itemId.slice(2) : null;
      const produto = prodId ? (esc.produtos || []).find((p) => p.id === prodId) : null;
      const sazonal = produto && cres.calendario ? infoSazonal(quandoVendeDe(produto), cres.calendario, hoje) : null;
      const filtro = l.tipo === "grupo" ? { canalId: l.canal.id, grupoId: l.grupo.id } : { itemId: l.itemId, canalId: l.canal.id, produtoId: prodId };
      const v7 = vendasDoAnuncio(pedidos, filtro, hoje, 7).unidades;
      const v7antes = vendasDoAnuncio(pedidos, filtro, hoje, 7, somarDias(hoje, -7)).unidades;
      const cfg = esc.cfgDoProduto ? esc.cfgDoProduto(prodId || l.item?.produtoId || null) : null;
      l.funil = l.desempenho ? taxasDoFunil(l.desempenho.item) : null;
      l.refFunil = ref;
      l.diagnosticos = diagnosticoDoAnuncio({ l, d: l.desempenho, ref, cfg, sazonal, v7, v7antes });
    }
  }
  return out;
}

function linha({ esc, cres, pedidos, hoje, canal, item, tipo, variacoes, rampa, ads }) {
  const id = item.id.slice(2);
  const aa = esc.agoraDe(item, canal);
  const al = esc.alertaDe(item, canal);
  const estPreco = estadoDoAlerta(al);
  const sug = rampa ? estadoSugestaoRampa(rampa.est) : null;
  const estRampa = sug ? { tipo: sug, motivo: `Rampa: ${rampa.est.sugestao?.rotulo || ""}` } : null;
  const estAds = ads?.av?.estado && ESTADO_ADS[ads.av.estado] ? { tipo: ads.av.estado, motivo: `Ads: ${ads.av.titulo}` } : null;
  const pior = piorEstado([estPreco, estRampa, estAds]);
  const op = [estRampa, estAds].find((e) => e?.tipo === "oportunidade") || null;
  const pub = (esc.publicacoesCanal || []).some((x) => x.item_id === id && x.canal_id === canal.id);
  return {
    chave: `${item.id}|${canal.id}`,
    itemId: item.id,
    nome: item.nome,
    sku: item.sku || "",
    tipo,
    canal,
    item,
    variacoes,
    alvo: aa?.alvo || null,
    agora: aa?.agora || null,
    emRampa: !!aa?.emRampa,
    rampa,
    ads,
    adsNum: numerosAds(ads),
    alerta: al,
    anunciado: pub,
    soNoGrupo: (cres.soNoGrupo && cres.soNoGrupo.has?.(item.id)) || false,
    vendas: vendasDoAnuncio(pedidos, { itemId: item.id, canalId: canal.id, produtoId: tipo === "produto" ? id : null }, hoje),
    // Todas as vendas do item neste canal (anúncio próprio + por anúncio com vários itens).
    vendasItem: vendasDoAnuncio(pedidos, { itemId: item.id, canalId: canal.id, produtoId: tipo === "produto" ? id : null, todos: true }, hoje),
    estado: pior || op,
  };
}
