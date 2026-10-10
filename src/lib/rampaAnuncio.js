// "O que digitar no canal" de um produto em rampa (aba Crescimento) — conta
// ÚNICA, usada pela própria Rampa, pela 4º Anunciar e pela 3º Ficha do
// anúncio: riscado FIXO no alvo e só a promo muda conforme o degrau;
// variações pela escada no degrau; kits de produtos diferentes pelo
// sugestaoKit com as peças em rampa no preço do degrau.
import { descontoDoItem, escadaDoProduto, sugestaoKit, lucroNoPreco, precoMinimoAceitavel, calcularAnuncio, r90, r90up } from "./escada.js";
import { itemTipoDoId } from "./variacoes.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const centavoAcima = (x) => Math.ceil(x * 100 - 1e-6) / 100;

export function degrauAtual(rampa) {
  const d = (rampa?.degraus || []).map(num);
  return d[Math.max(0, Math.min(d.length - 1, rampa?.degrau_atual ?? 0))] ?? null;
}

// Riscado FIXO (do alvo) e promo do degrau: o cliente vê o mesmo "de R$ X" o
// tempo todo, só o desconto diminui conforme o preço sobe.
export function anuncioFixo(real, alvo, desconto) {
  if (!(real > 0)) return null;
  if (!(desconto > 0.005) || !(alvo > 0)) return { original: real, promo: 0, clientePaga: real, real };
  const original = centavoAcima(Math.max(alvo, real) / (1 - desconto));
  const promo = Math.max(0, Math.floor((1 - real / original) * 100 + 1e-9));
  return { original, promo, clientePaga: cent(original * (1 - promo / 100)), real };
}

// ---- Riscado (preço original) FIXO depois de anunciado (out/2026) ----
// Nunca mexer no preço cheio do marketplace (pode ser visto como manipulação):
// depois que o item é marcado "feito" na Anunciar num canal, o preco_original
// gravado em publicacoes_canal é o riscado daquele item × canal — com ou sem
// rampa. Preço novo = só promo nova. Recalcular só por ação explícita.
export function riscadoFixoDe(itemId, canalId, publicacoes) {
  if (!itemId || !canalId) return null;
  const tipo = itemTipoDoId(itemId);
  const pub = (publicacoes || []).find((x) => x.item_tipo === tipo && x.item_id === itemId.slice(2) && x.canal_id === canalId);
  return pub && num(pub.preco_original) > 0 ? num(pub.preco_original) : null;
}

// Preço real sobre um riscado já anunciado: só a promo muda (% inteiro pra
// baixo; cliente paga o real ou centavos a mais). Real acima do riscado →
// promo 0, cliente paga o riscado e `acimaDoRiscado` (NÃO troca sozinho).
export function anuncioNoRiscado(real, riscado) {
  const r = num(real);
  const o = num(riscado);
  if (!(r > 0) || !(o > 0)) return null;
  if (r > o + 0.004) return { original: o, promo: 0, clientePaga: o, real: r, riscadoFixo: true, acimaDoRiscado: true };
  const promo = Math.max(0, Math.floor((1 - r / o) * 100 + 1e-9));
  return { original: o, promo, clientePaga: cent(o * (1 - promo / 100)), real: r, riscadoFixo: true };
}

/**
 * Conta ÚNICA do anúncio de um item num canal (Anunciar, Ficha, Rampa,
 * Promoções, "Preço de cadastro", cliente paga hoje):
 * - já anunciado (publicacoes_canal) → riscado fixo, só a promo muda;
 * - não anunciado em rampa (alvo) → riscado do alvo (anuncioFixo);
 * - não anunciado → sugestão normal (real ÷ (1 − desconto)).
 * `riscadoSugerido` = o que seria o riscado recalculado (pro aviso/botão).
 */
export function anuncioDoItem({ itemId, canal, real, alvo = null, desconto, publicacoes }) {
  if (!(num(real) > 0)) return null;
  const fixo = riscadoFixoDe(itemId, canal?.id, publicacoes);
  const sugerido = num(alvo) > 0 ? anuncioFixo(real, alvo, desconto) : calcularAnuncio(real, desconto);
  if (fixo) {
    const a = anuncioNoRiscado(real, fixo);
    return a ? { ...a, desconto, riscadoSugerido: sugerido?.original ?? null } : sugerido;
  }
  return sugerido ? { ...sugerido, riscadoFixo: false, riscadoSugerido: sugerido.original } : null;
}

// Preços salvos com os produtos em rampa trocados pelo degrau atual (pros
// kits de produtos diferentes usarem o "vendendo agora" de cada peça).
export function precosComRampa(precos, rampas) {
  const mapa = new Map((rampas || []).map((r) => [`${r.produto_id}|${r.canal_id}`, degrauAtual(r)]));
  return precos.map((p) => (p.item_tipo === "produto" && mapa.get(`${p.item_id}|${p.canal_id}`) > 0 ? { ...p, preco: mapa.get(`${p.item_id}|${p.canal_id}`) } : p));
}

/**
 * Preço de um kit/variação enquanto peça(s) dele estão em rampa:
 *   teto  = r90(separado agora × (1 − vantagemMin))  — a economia mínima vs
 *           comprar as peças separadas no preço de hoje;
 *   preço = min(alvo do kit, teto); abaixo do piso (mínimo aceitável do kit)
 *           → piso (,90 pra cima) e `naoCompensa` (economia fica menor).
 * → { preco, teto, economia, naoCompensa, limitado (teto < alvo) }
 */
export function precoKitNaRampa({ alvo, separado, vantagemMin, piso }) {
  const a = num(alvo);
  const sep = num(separado);
  const teto = sep > 0 ? cent(r90(sep * (1 - num(vantagemMin)))) : a;
  let preco = a > 0 ? Math.min(a, teto) : teto;
  let naoCompensa = false;
  if (num(piso) > 0 && preco < num(piso) - 0.004) {
    preco = cent(r90up(num(piso)));
    naoCompensa = true;
  }
  preco = cent(preco);
  return { preco, teto, economia: sep > 0 ? 1 - preco / sep : null, naoCompensa, limitado: a > 0 && teto < a - 0.004 };
}

/**
 * Linhas do "O que digitar no canal" pra um produto em rampa num canal.
 * preco = degrau atual; alvo = preço salvo (ou o último degrau).
 * → { linhas: [{ id ("avulso" | "v:…" | "k:…"), itemId, nome, original, promo, clientePaga, real, lucro,
 *      kit?, n?, separado?, economia?, lucroSeparado?, naoCompensa?, limitado? }], desconto }
 */
export function anuncioDaRampa({ produtoId, canal, preco, alvo, cfg, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoes = [] }) {
  const desc = descontoDoItem(`p:${produtoId}`, canal, { itens, produtos, kits }).desconto;
  const out = [];
  const itemPai = itens.find((i) => i.id === `p:${produtoId}`);
  const av = anuncioDoItem({ itemId: `p:${produtoId}`, canal, real: preco, alvo, desconto: desc, publicacoes });
  if (av) out.push({ id: "avulso", itemId: `p:${produtoId}`, nome: "Avulso (1 un.)", ...av, lucro: itemPai ? lucroNoPreco(canal, preco, num(itemPai.custoTotal), num(itemPai.peso), cfg) : null });
  // Variações de quantidade e kits de produtos diferentes: o MAIOR preço que
  // ainda dá a economia mínima (vantagemMin da escada) vs comprar as peças
  // separadas no preço de AGORA, sem passar do alvo do kit; piso = mínimo
  // aceitável do kit (precoKitNaRampa). O preço salvo do kit não muda.
  const noAlvo = escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg, p1Override: alvo });
  const lucroAvulsoAgora = itemPai ? lucroNoPreco(canal, preco, num(itemPai.custoTotal), num(itemPai.peso), cfg) : null;
  for (const l of noAlvo?.escada?.linhas || []) {
    if (l.base || !l.cadastrada) continue;
    const alvoV = l.salvo ?? l.sugerido;
    const k = precoKitNaRampa({ alvo: alvoV, separado: l.n * preco, vantagemMin: cfg.vantagemMin, piso: precoMinimoAceitavel(canal, l.custo, l.peso, cfg) });
    const a = anuncioDoItem({ itemId: l.itemId, canal, real: k.preco, alvo: alvoV, desconto: desc, publicacoes });
    if (a)
      out.push({
        id: l.itemId,
        itemId: l.itemId,
        nome: l.nome || `Kit ${l.n}`,
        ...a,
        lucro: lucroNoPreco(canal, a.real, l.custo, l.peso, cfg),
        n: l.n,
        separado: l.n * preco,
        economia: k.economia,
        lucroSeparado: lucroAvulsoAgora != null ? l.n * lucroAvulsoAgora : null,
        naoCompensa: k.naoCompensa,
        limitado: k.limitado,
      });
  }
  const cfgKit = cfgDoProduto(null);
  for (const kt of itens.filter((i) => i.tipo === "Kit" && (i.componentes || []).some((c) => c.produtoId === produtoId))) {
    const sg = sugestaoKit({ canal, kitItem: kt, itens, precos: precosRampa, cfg: cfgKit });
    if (!sg) continue;
    const salvoK = precos.find((p) => p.item_tipo === "kit" && p.item_id === kt.id.slice(2) && p.canal_id === canal.id);
    const alvoK = salvoK ? num(salvoK.preco) : sugestaoKit({ canal, kitItem: kt, itens, precos, cfg: cfgKit })?.sugerido ?? sg.sugerido;
    const k = precoKitNaRampa({ alvo: alvoK, separado: sg.separado, vantagemMin: cfgKit.vantagemMin, piso: precoMinimoAceitavel(canal, sg.custo, sg.peso, cfgKit) });
    const dk = descontoDoItem(kt.id, canal, { itens, produtos, kits }).desconto;
    const a = anuncioDoItem({ itemId: kt.id, canal, real: k.preco, alvo: alvoK, desconto: dk, publicacoes });
    if (a)
      out.push({
        id: kt.id,
        itemId: kt.id,
        nome: kt.nome,
        ...a,
        lucro: lucroNoPreco(canal, a.real, sg.custo, sg.peso, cfgKit),
        kit: true,
        n: (kt.componentes || []).reduce((t, c) => t + num(c.quantidade || 1), 0),
        separado: sg.separado,
        economia: k.economia,
        lucroSeparado: sg.lucroSeparado ?? null,
        naoCompensa: k.naoCompensa,
        limitado: k.limitado,
      });
  }
  return { linhas: out, desconto: desc, riscadoFixo: riscadoFixoDe(`p:${produtoId}`, canal.id, publicacoes) };
}

/**
 * Mapa "itemId|canalId" → linha do anúncio da Rampa, só pros produtos em
 * rampa vendendo num preço DIFERENTE do salvo (abaixo do alvo ou testando
 * acima) — e as variações/kits que dependem deles. No alvo (ou rampa
 * encerrada) o item volta a seguir o preço salvo normalmente.
 */
export function mapaAnuncioRampa({ rampas, canais, itens, produtos, kits, precos, concorrentes, cfgDoProduto, publicacoes = [] }) {
  const out = new Map();
  if (!rampas?.length) return out;
  const precosRampa = precosComRampa(precos, rampas);
  for (const r of rampas) {
    const canal = canais.find((c) => c.id === r.canal_id);
    if (!canal) continue;
    const preco = degrauAtual(r);
    const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
    const alvo = salvo ? num(salvo.preco) : num((r.degraus || [])[(r.degraus || []).length - 1]);
    if (!(preco > 0) || !(alvo > 0) || Math.abs(preco - alvo) < 0.005) continue;
    const res = anuncioDaRampa({ produtoId: r.produto_id, canal, preco, alvo, cfg: cfgDoProduto(r.produto_id), itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto, publicacoes });
    for (const l of res.linhas) {
      const chave = `${l.itemId}|${canal.id}`;
      if (!out.has(chave)) out.set(chave, { ...l, acima: preco > alvo, degrau: preco, alvo });
    }
  }
  return out;
}

// O que mudou entre o que foi marcado como feito e o que digitar agora
// ("promo 30% → 25%", "preço original R$X → R$Y").
export function descricaoMudanca(salvo, novo) {
  if (!salvo || !novo) return null;
  const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const partes = [];
  if (Math.abs(num(salvo.preco_original) - num(novo.original)) >= 0.005) partes.push(`preço original ${brl(salvo.preco_original)} → ${brl(novo.original)}`);
  if (num(salvo.promo) !== num(novo.promo)) partes.push(`promo ${num(salvo.promo)}% → ${num(novo.promo)}%`);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * Quanto o cliente PAGA HOJE por um item num canal (regra ÚNICA do aviso de
 * frete grátis — Ajuste out/2026). Item em rampa (ou variação/kit afetado) →
 * cliente_paga da Rampa (mapaAnuncioRampa: riscado fixo + promo do degrau
 * atual); fora de rampa → cliente_paga do anúncio no preço salvo
 * (calcularAnuncio com o desconto do item). Nunca o alvo/riscado.
 * → { valor, origem: 'rampa' | 'salvo' } ou null (sem preço salvo).
 */
export function valorClientePagaHoje(itemId, canal, { mapaRampa, precos, itens, produtos, kits, publicacoes = [] }) {
  if (!itemId || !canal) return null;
  const ra = mapaRampa?.get(`${itemId}|${canal.id}`);
  if (ra) return { valor: ra.clientePaga, origem: "rampa" };
  const tipo = itemTipoDoId(itemId);
  const s = (precos || []).find((p) => p.item_tipo === tipo && p.item_id === itemId.slice(2) && p.canal_id === canal.id);
  if (!s || !(num(s.preco) > 0)) return null;
  const { desconto } = descontoDoItem(itemId, canal, { itens, produtos, kits });
  const an = anuncioDoItem({ itemId, canal, real: num(s.preco), desconto, publicacoes });
  return { valor: an ? an.clientePaga : num(s.preco), origem: "salvo" };
}
