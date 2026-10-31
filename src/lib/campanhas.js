import { lucroNoPreco, lucroMinimoAceitavel } from "./escada.js";
import { descontoNoPedido } from "./live.js";

// Campanhas do TikTok (31/10/2026, aprovado pela prévia "Campanhas TikTok"):
// no TikTok o desconto é um % só pra todos os produtos que entram na campanha.
// Regra do Gustavo: o TikTok fica no preço mais cheio e uma RESERVA fixa do
// desconto (padrão 10%) fica guardada pro cupom da live — fora da live, campanha
// + cupom ativo + desconto de frete não podem comer essa reserva. Todo desconto
// é considerado pago pela loja (o que a plataforma bancar aparece como lucro a
// mais nos pedidos importados). As promoções SOMAM entre camadas (preço do
// produto + cupom + frete no mesmo pedido — "Guia de Preços: Combinação de
// Várias Promoções" do TikTok); dentro da camada de preço vale uma só (pior
// caso: a maior). Pior caso do pedido: 1 unidade. Conta PURA; só informa.

export const TIPOS_CAMPANHA = [
  { v: "produto", t: "Desconto no produto", camada: "preco" },
  { v: "relampago", t: "Oferta relâmpago", camada: "preco" },
  { v: "relampago-live", t: "Oferta relâmpago da LIVE", camada: "preco", live: true },
  { v: "frete", t: "Desconto na taxa de envio", camada: "frete" },
];
export const RESERVA_LIVE_PADRAO = 10;
const PCT_MAX = 90;
const cent = (v) => Math.round(v * 100) / 100;
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

export const tipoDaCampanha = (v) => TIPOS_CAMPANHA.find((t) => t.v === v) || TIPOS_CAMPANHA[0];

/** Vigente = não encerrada e com o fim hoje ou depois (sem fim = vigente). */
export function campanhaVigente(c, hoje) {
  return !!c && !c.encerrada && (!c.fim || String(c.fim) >= hoje);
}

/** Campanha vale pro anúncio? Frete pode valer pra loja inteira. */
export function campanhaNoAnuncio(c, anuncioId) {
  if (c.tipo === "frete" && c.todos) return true;
  return (c.itens || []).includes(anuncioId);
}

/**
 * O que já está tirando desconto do anúncio FORA da live, num pedido de 1 un.:
 * campanha de preço (a maior vigente que leva o anúncio; a da LIVE fica de fora),
 * cupom ativo (faixa alcançada no preço já com a campanha) e desconto de frete.
 * `ignorar` = id de uma campanha (a que está sendo simulada no lugar).
 */
export function descontosForaDaLive({ campanhas = [], anuncioId, preco, faixas = [], hoje, ignorar = null, simulada = null }) {
  const vig = campanhas.filter((c) => c.id !== ignorar && campanhaVigente(c, hoje));
  if (simulada) vig.push(simulada);
  let camp = 0;
  let campNome = null;
  for (const c of vig) {
    const t = tipoDaCampanha(c.tipo);
    if (t.camada !== "preco" || t.live || !campanhaNoAnuncio(c, anuncioId)) continue;
    if (num(c.pct) > camp) {
      camp = num(c.pct);
      campNome = c.nome || t.t;
    }
  }
  const depoisCamp = preco * (1 - camp / 100);
  const { desconto: cupom } = faixas.length ? descontoNoPedido(faixas, depoisCamp) : { desconto: 0 };
  const pago = depoisCamp - (cupom || 0);
  let frete = 0;
  for (const c of vig) {
    if (c.tipo !== "frete" || !campanhaNoAnuncio(c, anuncioId)) continue;
    if (num(c.minimo) > 0 && pago < num(c.minimo) - 0.004) continue;
    frete = Math.max(frete, num(c.valor));
  }
  return { camp, campNome, cupom: cent(cupom || 0), frete: cent(frete) };
}

function lucroCom(x, desconto, extra) {
  const novo = cent(x.preco - desconto);
  if (!(novo > 0)) return { lucro: -Infinity, minimo: 0 };
  const l = lucroNoPreco(x.canal, novo, x.custo, x.peso, x.cfg);
  return { lucro: l == null ? null : cent(l - extra), minimo: cent(lucroMinimoAceitavel(novo, x.cfg)) };
}

/**
 * Espaço do item: com os descontos de fora da live, quanto ainda cabe (em % do
 * preço cheio) até o lucro mínimo — é o que sobra pro cupom da live.
 * x = { canal, preco, custo, peso, cfg }; fora = descontosForaDaLive(...).
 * → { maxSem (desconto máximo sem nada), foraPct, lucroFora, minimoFora, sobra, estado }
 *   estado: ok | come-live (sobra < reserva) | abaixo | prejuizo | sem-dado
 */
export function espacoNoItem(x, fora, reserva = RESERVA_LIVE_PADRAO) {
  if (!(x?.preco > 0) || !x.canal) return null;
  const descFora = (x.preco * fora.camp) / 100 + fora.cupom;
  const r0 = lucroCom(x, descFora, fora.frete);
  if (r0.lucro == null) return { estado: "sem-dado" };
  let sobra = -1;
  for (let d = 0; d <= PCT_MAX; d++) {
    const r = lucroCom(x, descFora + (x.preco * d) / 100, fora.frete);
    if (r.lucro == null || r.lucro < r.minimo - 0.004) break;
    sobra = d;
  }
  let maxSem = 0;
  for (let d = 1; d <= PCT_MAX; d++) {
    const r = lucroCom(x, (x.preco * d) / 100, 0);
    if (r.lucro == null || r.lucro < r.minimo - 0.004) break;
    maxSem = d;
  }
  const estado = r0.lucro < 0 ? "prejuizo" : r0.lucro < r0.minimo - 0.004 ? "abaixo" : sobra < reserva ? "come-live" : "ok";
  return {
    maxSem,
    foraPct: ((descFora + fora.frete) / x.preco) * 100,
    campPct: fora.camp,
    cupomPct: (fora.cupom / x.preco) * 100,
    fretePct: (fora.frete / x.preco) * 100,
    lucroFora: r0.lucro,
    minimoFora: r0.minimo,
    sobra: Math.max(0, sobra),
    estado,
  };
}

/**
 * Maior % de campanha de preço que este item aguenta e ainda guarda a reserva da
 * live (com o cupom ativo e o frete que já valem pra ele). -1 = nem sem campanha.
 */
export function capDaCampanha(x, { campanhas, anuncioId, faixas, hoje, ignorar, reserva = RESERVA_LIVE_PADRAO }) {
  let cap = -1;
  for (let c = 0; c <= PCT_MAX; c++) {
    const simulada = { id: "_sim", tipo: "produto", pct: c, itens: [anuncioId] };
    const fora = descontosForaDaLive({ campanhas, anuncioId, preco: x.preco, faixas, hoje, ignorar, simulada });
    const e = espacoNoItem(x, fora, reserva);
    if (!e || e.estado !== "ok") break;
    cap = c;
  }
  return cap;
}

const PIOR = { prejuizo: 4, abaixo: 3, "come-live": 2, ok: 1, "sem-dado": 0 };

/**
 * Anúncios do canal (o TikTok põe o % no produto inteiro, variações juntas):
 * produto + variações com preço salvo, kit. Uma linha por anúncio, com a pior
 * variação. dados = useEscada() (itens, precos, cobraNoCanal, itemNoCanal, cfgDoProduto, agoraDe).
 */
export function anunciosDaCampanha(dados, canal) {
  if (!canal) return [];
  const { itens = [], precos = [], cobraNoCanal, itemNoCanal, cfgDoProduto, agoraDe } = dados;
  const porAnuncio = new Map();
  for (const p of precos) {
    if (p.canal_id !== canal.id) continue;
    const pre = { produto: "p", variacao: "v", kit: "k" }[p.item_tipo];
    const it0 = itens.find((i) => i.id === `${pre}:${p.item_id}`);
    if (!it0 || (cobraNoCanal && !cobraNoCanal(it0, canal))) continue;
    const it = itemNoCanal ? itemNoCanal(it0, canal) : it0;
    const anuncioId = pre === "v" ? `p:${it.produtoId}` : it.id;
    const pai = itens.find((i) => i.id === anuncioId);
    const preco = Number(agoraDe?.(it0, canal)?.agora?.preco) || Number(p.preco);
    const cfg = cfgDoProduto ? cfgDoProduto(it.produtoId || (pre === "p" ? p.item_id : null)) : {};
    const x = { canal, preco, custo: Number(it.custoTotal) || 0, peso: Number(it.peso) || 0, cfg };
    if (!porAnuncio.has(anuncioId)) porAnuncio.set(anuncioId, { id: anuncioId, nome: pai?.nome || it.nome, itens: [] });
    porAnuncio.get(anuncioId).itens.push({ item: it, rotulo: pre === "v" ? it.nome.replace(`${pai?.nome || ""} — `, "") : pre === "k" ? "kit" : "1 un.", x });
  }
  return [...porAnuncio.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Situação de cada anúncio com as campanhas (e uma simulada, se houver).
 * → [{ id, nome, itens, preco (da 1ª), maxSem, sobra, cap, estado, pior (rótulo da pior variação), e (do pior) }]
 */
export function situacaoDosAnuncios(anuncios, { campanhas = [], faixas = [], hoje, reserva = RESERVA_LIVE_PADRAO, simulada = null }) {
  return anuncios.map((a) => {
    let pior = null;
    let cap = Infinity;
    for (const v of a.itens) {
      const sim = simulada && campanhaNoAnuncio(simulada, a.id) ? simulada : null;
      const fora = descontosForaDaLive({ campanhas, anuncioId: a.id, preco: v.x.preco, faixas, hoje, ignorar: simulada?.id, simulada: sim });
      const e = espacoNoItem(v.x, fora, reserva);
      if (!e) continue;
      const c = capDaCampanha(v.x, { campanhas, anuncioId: a.id, faixas, hoje, ignorar: simulada?.id, reserva });
      cap = Math.min(cap, c);
      if (!pior || PIOR[e.estado] > PIOR[pior.e.estado] || (PIOR[e.estado] === PIOR[pior.e.estado] && e.sobra < pior.e.sobra)) pior = { v, e };
    }
    if (!pior) return { ...a, estado: "sem-dado", cap: null };
    return { ...a, preco: pior.v.x.preco, e: pior.e, estado: pior.e.estado, sobra: pior.e.sobra, maxSem: pior.e.maxSem, cap: cap === Infinity ? null : cap, pior: a.itens.length > 1 ? pior.v.rotulo : null };
  });
}

/** Resumo da campanha simulada: maior % pra todos e quem tirar pra usar o % escolhido. */
// Anúncio sem espaço nem sem campanha (cap < 0: o cupom da live não cabe nem com
// o preço cheio) fica de fora do "cabe pra todos" — é assunto de preço.
export function resumoDaCampanha(linhas, pct) {
  const dentro = linhas.filter((l) => l.cap != null);
  const semEspaco = dentro.filter((l) => l.cap < 0);
  const comEspaco = dentro.filter((l) => l.cap >= 0);
  const capTodos = comEspaco.length ? Math.min(...comEspaco.map((l) => l.cap)) : null;
  const tirar = dentro.filter((l) => l.cap < pct);
  return { capTodos, tirar, semEspaco, n: comEspaco.length };
}

/**
 * Avisos pro Início: campanha de preço vigente com anúncio sem espaço pra live
 * (Atenção) ou abaixo do mínimo/prejuízo (Resolver se prejuízo).
 */
export function avisosCampanhas({ campanhas = [], linhas = [], canal, hoje }) {
  const out = [];
  for (const c of campanhas) {
    const t = tipoDaCampanha(c.tipo);
    if (!campanhaVigente(c, hoje) || t.camada !== "preco" || t.live) continue;
    const ruins = linhas.filter((l) => (c.itens || []).includes(l.id) && l.estado !== "ok" && l.estado !== "sem-dado");
    if (!ruins.length) continue;
    const prej = ruins.some((l) => l.estado === "prejuizo");
    const semLive = ruins.filter((l) => l.estado === "come-live").length;
    out.push({
      id: `campanha|${c.id}`,
      grupo: prej ? "resolver" : "rotina",
      ordem: 2,
      tom: prej ? "bad" : "warn",
      titulo: `Campanha ${c.nome || t.t} (${canal?.nome || "TikTok"}): ${ruins.length} produto${ruins.length > 1 ? "s" : ""} ${prej ? "no prejuízo" : semLive === ruins.length ? "sem espaço pro cupom da live" : "abaixo do mínimo ou sem espaço pra live"}`,
      texto: `${ruins.slice(0, 3).map((l) => `${l.nome} (sobra ${l.sobra ?? 0}%)`).join(" · ")}${ruins.length > 3 ? "…" : ""} — baixe o % da campanha ou tire esses produtos dela`,
      ir: { aba: "promocoes", pedido: { sub: "campanhas" } },
      rotulo: "Ver campanhas",
    });
  }
  return out;
}

export function novaCampanha(canalId, base = null) {
  const id = `c${Date.now().toString(36)}`;
  if (base) return { ...base, id, encerrada: false, nome: `${base.nome || ""} (cópia)`.trim() };
  return { id, canalId, tipo: "produto", nome: "", pct: 10, valor: "", minimo: "", itens: [], todos: false, inicio: "", fim: "", encerrada: false };
}
