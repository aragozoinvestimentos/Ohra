// "O que digitar no canal" de um produto em rampa (aba Crescimento) — conta
// ÚNICA, usada pela própria Rampa, pela 4º Anunciar e pela 3º Ficha do
// anúncio: riscado FIXO no alvo e só a promo muda conforme o degrau;
// variações pela escada no degrau; kits de produtos diferentes pelo
// sugestaoKit com as peças em rampa no preço do degrau.
import { descontoDoItem, escadaDoProduto, sugestaoKit, lucroNoPreco } from "./escada.js";

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

// Preços salvos com os produtos em rampa trocados pelo degrau atual (pros
// kits de produtos diferentes usarem o "vendendo agora" de cada peça).
export function precosComRampa(precos, rampas) {
  const mapa = new Map((rampas || []).map((r) => [`${r.produto_id}|${r.canal_id}`, degrauAtual(r)]));
  return precos.map((p) => (p.item_tipo === "produto" && mapa.get(`${p.item_id}|${p.canal_id}`) > 0 ? { ...p, preco: mapa.get(`${p.item_id}|${p.canal_id}`) } : p));
}

/**
 * Linhas do "O que digitar no canal" pra um produto em rampa num canal.
 * preco = degrau atual; alvo = preço salvo (ou o último degrau).
 * → { linhas: [{ id ("avulso" | "v:…" | "k:…"), itemId, nome, original, promo, clientePaga, real, lucro, kit?, naoCompensa? }], desconto }
 */
export function anuncioDaRampa({ produtoId, canal, preco, alvo, cfg, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto }) {
  const desc = descontoDoItem(`p:${produtoId}`, canal, { itens, produtos, kits }).desconto;
  const out = [];
  const itemPai = itens.find((i) => i.id === `p:${produtoId}`);
  const av = anuncioFixo(preco, alvo, desc);
  if (av) out.push({ id: "avulso", itemId: `p:${produtoId}`, nome: "Avulso (1 un.)", ...av, lucro: itemPai ? lucroNoPreco(canal, preco, num(itemPai.custoTotal), num(itemPai.peso), cfg) : null });
  const noDegrau = escadaDoProduto({ produtoId, canal, itens, precos: precosRampa, concorrentes, cfg, p1Override: preco, emRampa: true });
  const noAlvo = escadaDoProduto({ produtoId, canal, itens, precos, concorrentes, cfg, p1Override: alvo });
  for (const l of noDegrau?.escada?.linhas || []) {
    if (l.base || !l.cadastrada) continue;
    const la = noAlvo?.escada?.linhas.find((x) => x.n === l.n);
    const alvoV = l.salvo ?? la?.sugerido ?? l.sugerido;
    const a = anuncioFixo(Math.min(l.sugerido, alvoV), alvoV, desc);
    if (a) out.push({ id: l.itemId, itemId: l.itemId, nome: l.nome || `Kit ${l.n}`, ...a, lucro: lucroNoPreco(canal, a.real, l.custo, l.peso, cfg), naoCompensa: l.naoCompensa });
  }
  const cfgKit = cfgDoProduto(null);
  for (const k of itens.filter((i) => i.tipo === "Kit" && (i.componentes || []).some((c) => c.produtoId === produtoId))) {
    const sg = sugestaoKit({ canal, kitItem: k, itens, precos: precosRampa, cfg: cfgKit });
    if (!sg) continue;
    const salvoK = precos.find((p) => p.item_tipo === "kit" && p.item_id === k.id.slice(2) && p.canal_id === canal.id);
    const alvoK = salvoK ? num(salvoK.preco) : sugestaoKit({ canal, kitItem: k, itens, precos, cfg: cfgKit })?.sugerido ?? sg.sugerido;
    const dk = descontoDoItem(k.id, canal, { itens, produtos, kits }).desconto;
    const a = anuncioFixo(Math.min(sg.sugerido, alvoK), alvoK, dk);
    if (a) out.push({ id: k.id, itemId: k.id, nome: k.nome, ...a, lucro: lucroNoPreco(canal, a.real, sg.custo, sg.peso, cfgKit), kit: true, naoCompensa: sg.naoCompensa });
  }
  return { linhas: out, desconto: desc };
}

/**
 * Mapa "itemId|canalId" → linha do anúncio da Rampa, só pros produtos em
 * rampa vendendo num preço DIFERENTE do salvo (abaixo do alvo ou testando
 * acima) — e as variações/kits que dependem deles. No alvo (ou rampa
 * encerrada) o item volta a seguir o preço salvo normalmente.
 */
export function mapaAnuncioRampa({ rampas, canais, itens, produtos, kits, precos, concorrentes, cfgDoProduto }) {
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
    const res = anuncioDaRampa({ produtoId: r.produto_id, canal, preco, alvo, cfg: cfgDoProduto(r.produto_id), itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto });
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
