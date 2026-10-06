// Estratégia do preço por item × canal (schema v37) — UM lugar decide.
//
// Ordem de força quando as regras discordam:
//   1) prejuízo (lucro < 0) sempre aparece (discreto se a estratégia explica);
//   2) a estratégia escolhida pelo Gustavo ("Manter assim": crescimento /
//      atração / normal, gravada em precos_canal.estrategia*);
//   3) rampa ativa (produto abaixo do alvo, ou kit/variação que leva ele) =
//      crescimento automático;
//   4) regras gerais (mínimo aceitável, comissão máxima…).
// As telas NÃO calculam alerta por conta própria: chamam estrategiaEfetiva +
// alertaPreco.
import { hojeSP } from "./datas.js";
import { avisoFreteGratis } from "./freteGratis.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

export const ESTRATEGIAS = {
  normal: "Normal",
  crescimento: "Crescimento",
  atracao: "Atração",
};
export const PRAZO_CRESCIMENTO_DIAS = 30;
// Lucro ao vivo pode cair até isso abaixo do lucro do dia da decisão sem
// vencer a estratégia (centavos de taxa/custo não contam).
export const FOLGA_LUCRO_REF = 0.05;

// "Hoje" no fuso de São Paulo (lib/datas.js).
export function hojeLocal() {
  return hojeSP();
}

export function somarDiasIso(iso, dias) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Colunas a gravar junto de QUALQUER preço novo em precos_canal: preço novo =
// decisão nova, a estratégia anterior não vale mais.
export const ESTRATEGIA_ZERADA = {
  estrategia: null,
  estrategia_ate: null,
  estrategia_lucro_ref: null,
  estrategia_motivo: null,
  estrategia_em: null,
};

const ehErroColunaEstrategia = (error) => !!error && /estrategia/i.test(error.message || "");

// Grava um preço novo zerando a estratégia. Se o schema v37 ainda não rodou
// (coluna não existe), grava de novo sem essas colunas — salvar nunca quebra.
// `gravar(extra)` recebe os campos extras e devolve a promise do supabase.
export async function gravarPrecoNovo(gravar) {
  const r = await gravar(ESTRATEGIA_ZERADA);
  if (ehErroColunaEstrategia(r?.error)) return gravar({});
  return r;
}

// Decisão gravada numa linha de precos_canal (sem rampa). Vence se passou o
// prazo ou se o lucro ao vivo caiu mais de R$0,05 abaixo do lucro do dia da
// decisão. Devolve null se não há decisão.
export function estrategiaGravada(linha, lucroAoVivo, hoje = hojeLocal()) {
  const chave = linha?.estrategia;
  if (!chave || !ESTRATEGIAS[chave]) return null;
  const ate = linha.estrategia_ate || null;
  let motivoVencida = null;
  if (ate && ate < hoje) motivoVencida = "prazo";
  else if (chave !== "normal" && linha.estrategia_lucro_ref != null && lucroAoVivo != null && num(lucroAoVivo) < num(linha.estrategia_lucro_ref) - FOLGA_LUCRO_REF)
    motivoVencida = "lucro";
  return {
    chave,
    ate,
    motivo: linha.estrategia_motivo || null,
    lucroRef: linha.estrategia_lucro_ref != null ? num(linha.estrategia_lucro_ref) : null,
    vencida: !!motivoVencida,
    motivoVencida,
  };
}

// Produtos em rampa ABAIXO do alvo (degrau atual < preço salvo) por canal:
// Set de "produtoId|canalId".
export function produtosEmRampa(rampas, precos) {
  const out = new Set();
  for (const r of rampas || []) {
    const degraus = (r.degraus || []).map(num);
    const atual = degraus[Math.max(0, Math.min(degraus.length - 1, r.degrau_atual ?? 0))];
    const salvo = (precos || []).find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
    const alvo = salvo ? num(salvo.preco) : degraus[degraus.length - 1];
    if (atual > 0 && alvo > 0 && atual < alvo - 0.004) out.add(`${r.produto_id}|${r.canal_id}`);
  }
  return out;
}

const tipoDoId = (id) => ({ p: "produto", v: "variacao", k: "kit" })[String(id)[0]] || "produto";

/**
 * Estratégia efetiva de um item (catálogo: "p:", "v:", "k:") num canal.
 * opts: { precos (linhas de precos_canal), rampas (rampas_preco cruas) ou
 *         emRampa (Set já calculado), lucroAoVivo (lucro de hoje no preço
 *         salvo), hoje, sugerirAtracao }
 * → { chave, origem: 'escolhida'|'rampa'|'kit-em-rampa'|'padrao', ate,
 *     vencida, motivoVencida, anterior, sugerirAtracao, linha }
 */
export function estrategiaEfetiva(item, canal, { precos = [], rampas = [], emRampa = null, lucroAoVivo = null, hoje = hojeLocal(), sugerirAtracao = false } = {}) {
  if (!item || !canal) return { chave: "normal", origem: "padrao" };
  const set = emRampa || produtosEmRampa(rampas, precos);
  const tipo = tipoDoId(item.id);
  const idCru = item.id.slice(2);
  const cid = canal.id;
  if (tipo === "produto" && set.has(`${idCru}|${cid}`)) return { chave: "crescimento", origem: "rampa" };
  if (tipo === "variacao" && item.produtoId && set.has(`${item.produtoId}|${cid}`)) return { chave: "crescimento", origem: "rampa" };
  if (tipo === "kit" && (item.componentes || []).some((c) => set.has(`${c.produtoId}|${cid}`))) return { chave: "crescimento", origem: "kit-em-rampa" };
  const linha = precos.find((p) => p.item_tipo === tipo && p.item_id === idCru && p.canal_id === cid) || null;
  const g = estrategiaGravada(linha, lucroAoVivo ?? linha?.lucro ?? null, hoje);
  if (g && !g.vencida) return { chave: g.chave, origem: "escolhida", ate: g.ate, motivo: g.motivo, linha };
  if (g && g.vencida)
    return { chave: "normal", origem: "padrao", vencida: true, motivoVencida: g.motivoVencida, anterior: g.chave, ate: g.ate, linha, sugerirAtracao };
  return { chave: "normal", origem: "padrao", linha, sugerirAtracao };
}

/**
 * Alerta ÚNICO do preço salvo (todas as telas usam esta função).
 * { lucro, preco, minimo (preço mínimo aceitável no canal) ou lucroMinimo, estrategia }
 * → { tipo: 'prejuizo'|'abaixo-minimo'|'frete-gratis'|null, discreto, silenciado, frete }
 */
// lucroMinimo (opcional) = piso em R$ de lucro no lugar do preço mínimo —
// pra quando o preço é o mesmo e o lucro muda (comissão de afiliado).
//
// Frete grátis (schema v38): com `canal`, o valor que o cliente paga
// (`valorCliente`, padrão = preço) abaixo do pedido mínimo do canal gera o
// aviso `frete` ({ min, valor, texto, curto }) — nível atenção, não é
// prejuízo e NÃO depende da estratégia. Vem SEMPRE no campo `frete`; `tipo`
// só vira 'frete-gratis' quando não há prejuízo nem abaixo do mínimo.
export function alertaPreco({ lucro, preco, minimo, lucroMinimo = null, estrategia, canal = null, valorCliente = null }) {
  const especial = estrategia && estrategia.chave !== "normal";
  const frete = canal ? avisoFreteGratis(canal, valorCliente ?? preco) : null;
  const comFrete = (r) => ({ ...r, frete, ...(r.tipo == null && frete ? { tipo: "frete-gratis" } : {}) });
  if (lucro != null && num(lucro) < 0) return comFrete({ tipo: "prejuizo", discreto: !!especial });
  const abaixo =
    (minimo != null && num(preco) > 0 && num(preco) < num(minimo) - 0.004) ||
    (lucroMinimo != null && lucro != null && num(lucro) < num(lucroMinimo) - 0.004);
  if (abaixo) {
    if (especial) return comFrete({ tipo: null, discreto: false, silenciado: true });
    return comFrete({ tipo: "abaixo-minimo", discreto: false });
  }
  return comFrete({ tipo: null, discreto: false });
}

const diaMes = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Etiqueta discreta da célula ("crescimento até 15/11", "atração", "em rampa").
export function rotuloEstrategia(e) {
  if (!e) return null;
  if (e.origem === "rampa") return "em rampa";
  if (e.origem === "kit-em-rampa") return "peça em rampa";
  if (e.vencida) return `${ESTRATEGIAS[e.anterior]?.toLowerCase() || "estratégia"} venceu${e.motivoVencida === "lucro" ? " (lucro caiu)" : ""}`;
  if (e.origem === "escolhida" && e.chave === "crescimento") return e.ate ? `crescimento até ${diaMes(e.ate)}` : "crescimento";
  if (e.origem === "escolhida" && e.chave === "atracao") return "atração";
  return null;
}
