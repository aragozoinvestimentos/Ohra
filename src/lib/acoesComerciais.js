// Histórico de AÇÕES COMERCIAIS + antes × depois (schema v64, 24/10/2026).
// Ações do app NÃO são copiadas: são lidas de onde já estão (ajustes do Ads,
// subida/descida de degrau da Rampa, último preço salvo). A tabela
// acoes_comerciais guarda só as ações MANUAIS (o que foi mudado direto no
// marketplace) e a CONCLUSÃO de qualquer ação (origem 'app' + chave).
// Antes × depois: 7 dias antes × 7 dias depois do dia da ação (o próprio dia
// fica de fora — a mudança costuma ser à noite); amostra pequena → 14 dias;
// ainda pequena ou variação pequena → "inconclusivo". O app NUNCA marca
// "funcionou" sozinho: mostra a comparação e a leitura; quem conclui é o Gustavo.
import { adsNaJanela } from "./ads.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const TIPOS_ACAO = [
  { k: "ads-aumento", rot: "Aumentei o orçamento de Ads" },
  { k: "ads-reducao", rot: "Reduzi o orçamento de Ads" },
  { k: "ads-meta", rot: "Mudei a meta de ROAS" },
  { k: "ads-pausa", rot: "Pausei / encerrei o Ads" },
  { k: "imagem", rot: "Troquei a imagem principal" },
  { k: "titulo", rot: "Mudei o título" },
  { k: "descricao", rot: "Ajustei a descrição" },
  { k: "preco", rot: "Mudei o preço" },
  { k: "promocao", rot: "Criei / mudei promoção" },
  { k: "cupom", rot: "Criei / mudei cupom" },
  { k: "variacao", rot: "Adicionei variação" },
  { k: "kit", rot: "Criei kit" },
  { k: "afiliado", rot: "Mudei a comissão de afiliado" },
  { k: "outro", rot: "Outra ação" },
];
export const rotuloTipo = (k) => TIPOS_ACAO.find((t) => t.k === k)?.rot || k;
export const CONCLUSOES = [
  { k: "funcionou", rot: "Funcionou", tipo: "oportunidade" },
  { k: "nao-funcionou", rot: "Não funcionou", tipo: "resolver" },
  { k: "inconclusivo", rot: "Inconclusivo", tipo: "info" },
  { k: "aguardando", rot: "Aguardando dados", tipo: "atencao" },
];

export const JANELA = 7;
export const JANELA_MAX = 14;
export const MIN_VENDAS = 6; // vendas (antes + depois) pra comparar com alguma confiança
export const VARIACAO_RELEVANTE = 0.2; // ±20% no lucro depois do Ads

/**
 * Ações de um anúncio (alvo = { itemTipo, itemId, canalId }) ou de todos (alvo null).
 * periodos = ads_periodos; rampas = [...rampas, ...rampasGrupo, ...rampasKit];
 * registros = rampa_registros gravados; precos = precos_canal; manuais = acoes_comerciais.
 * → [{ chave, origem, tipo, rotulo, data, antes, depois, obs, itemTipo, itemId, canalId, id?, conclusao? }]
 */
export function listarAcoes({ alvo = null, periodos = [], rampas = [], registros = [], precos = [], manuais = [] }) {
  const out = [];
  const bate = (tipo, id, canal) => !alvo || (tipo === alvo.itemTipo && id === alvo.itemId && canal === alvo.canalId);
  // Ads (períodos e ajustes)
  for (const p of periodos || []) {
    if (!bate(p.item_tipo, p.item_id, p.canal_id)) continue;
    const base = { origem: "app", itemTipo: p.item_tipo, itemId: p.item_id, canalId: p.canal_id };
    out.push({ ...base, chave: `ads|${p.id}|inicio`, tipo: "ads-aumento", rotulo: `Liguei o Ads${p.tipo === "auto" ? " (lance automático)" : ""}`, data: String(p.inicio).slice(0, 10), antes: "sem Ads", depois: p.orcamento_diario ? `${brl(p.orcamento_diario)}/dia${p.meta_roas ? ` · meta ${p.meta_roas}` : ""}` : "" });
    let orc = num(p.orcamento_diario);
    let meta = p.meta_roas;
    for (const [i, a] of (Array.isArray(p.ajustes) ? p.ajustes : []).entries()) {
      if (!a?.data) continue;
      const d = String(a.data).slice(0, 10);
      if (a.tipo === "pausa") out.push({ ...base, chave: `ads|${p.id}|aj${i}`, tipo: "ads-pausa", rotulo: "Pausei o Ads pra revisar", data: d, antes: "ligado", depois: "pausado" });
      else if (a.tipo === "volta") out.push({ ...base, chave: `ads|${p.id}|aj${i}`, tipo: "ads-aumento", rotulo: "Despausei o Ads", data: d, antes: "pausado", depois: "ligado" });
      else if (a.tipo === "revisei") out.push({ ...base, chave: `ads|${p.id}|aj${i}`, tipo: "outro", rotulo: "Revisei o anúncio (Ads sem venda)", data: d, antes: "", depois: "" });
      else {
        const no = a.orcamento != null ? num(a.orcamento) : orc;
        const nm = a.meta != null && a.meta !== "" ? a.meta : meta;
        if (no !== orc) out.push({ ...base, chave: `ads|${p.id}|aj${i}`, tipo: no > orc ? "ads-aumento" : "ads-reducao", rotulo: no > orc ? "Aumentei o orçamento de Ads" : "Reduzi o orçamento de Ads", data: d, antes: `${brl(orc)}/dia`, depois: `${brl(no)}/dia`, obs: a.motivo || "" });
        else if (String(nm) !== String(meta)) out.push({ ...base, chave: `ads|${p.id}|aj${i}`, tipo: "ads-meta", rotulo: "Mudei a meta de ROAS", data: d, antes: meta != null ? String(meta) : "automático", depois: String(nm), obs: a.motivo || "" });
        orc = no;
        meta = nm;
      }
    }
    if (p.motivo_fim && p.fim) out.push({ ...base, chave: `ads|${p.id}|fim`, tipo: "ads-pausa", rotulo: "Encerrei o Ads", data: String(p.fim).slice(0, 10), antes: "ligado", depois: "sem Ads", obs: p.motivo_fim });
  }
  // Rampa (subida/descida de degrau)
  const porId = new Map((rampas || []).map((r) => [r.id, r]));
  for (const g of registros || []) {
    if (g.auto || (g.tipo !== "subida" && g.tipo !== "descida")) continue;
    const r = porId.get(g.rampa_id);
    if (!r) continue;
    const [tipo, id] = r.grupo_id ? ["grupo", r.grupo_id] : r.kit_id ? ["kit", r.kit_id] : ["produto", r.produto_id];
    if (!bate(tipo, id, r.canal_id)) continue;
    const pctG = tipo === "grupo";
    const v = (x) => (x == null ? "" : pctG ? `${String(x).replace(".", ",")}% do salvo` : brl(x));
    out.push({ origem: "app", itemTipo: tipo, itemId: id, canalId: r.canal_id, chave: `rampa|${g.id}`, tipo: "preco", rotulo: g.tipo === "subida" ? "Subi o degrau da rampa" : "Desci o degrau da rampa", data: String(g.data).slice(0, 10), antes: "", depois: v(g.preco), obs: g.observacao || "" });
  }
  // Último preço salvo (precos_canal só guarda o atual)
  for (const p of precos || []) {
    if (!p.atualizado_em || !bate(p.item_tipo, p.item_id, p.canal_id)) continue;
    const d = new Date(p.atualizado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    out.push({ origem: "app", itemTipo: p.item_tipo, itemId: p.item_id, canalId: p.canal_id, chave: `preco|${p.item_tipo}|${p.item_id}|${p.canal_id}|${d}`, tipo: "preco", rotulo: "Salvei o preço (alvo)", data: d, antes: "", depois: brl(p.preco) });
  }
  // Conclusões das ações do app + ações manuais
  const conc = new Map((manuais || []).filter((m) => m.origem === "app" && m.chave).map((m) => [m.chave, m]));
  for (const a of out) {
    const m = conc.get(a.chave);
    if (m) Object.assign(a, { id: m.id, conclusao: m.conclusao, conclusaoEm: m.conclusao_em });
  }
  for (const m of manuais || []) {
    if (m.origem !== "manual" || !bate(m.item_tipo, m.item_id, m.canal_id)) continue;
    out.push({ origem: "manual", id: m.id, chave: `manual|${m.id}`, itemTipo: m.item_tipo, itemId: m.item_id, canalId: m.canal_id, tipo: m.tipo, rotulo: rotuloTipo(m.tipo), data: String(m.data).slice(0, 10), antes: m.valor_antes || "", depois: m.valor_depois || "", obs: m.observacao || "", conclusao: m.conclusao, conclusaoEm: m.conclusao_em });
  }
  return out.sort((a, b) => b.data.localeCompare(a.data));
}

/**
 * Antes × depois de uma ação. vendasEm(de, ate) → { unidades, faturamento, lucro };
 * periodosAds = períodos de Ads do anúncio. → { status: aguardando|pequena|ok, dias, antes, depois, leitura, faltam }
 */
export function antesDepois({ data, hoje, vendasEm, periodosAds = [] }) {
  const medir = (n) => {
    const a = { de: somarDias(data, -n), ate: somarDias(data, -1) };
    const d = { de: somarDias(data, 1), ate: somarDias(data, n) };
    const va = vendasEm(a.de, a.ate);
    const vd = vendasEm(d.de, d.ate);
    const aa = adsNaJanela(periodosAds, [], a.de, a.ate);
    const ad = adsNaJanela(periodosAds, [], d.de, d.ate);
    const lado = (v, ads, j) => ({ ...j, unidades: v.unidades, faturamento: v.faturamento, lucro: v.lucro, ads: ads.gasto, depoisAds: v.lucro - ads.gasto, roas: ads.gasto > 0 ? v.faturamento / ads.gasto : null });
    return { dias: n, antes: lado(va, aa, a), depois: lado(vd, ad, d) };
  };
  const ultimoDia = somarDias(data, JANELA);
  if (ultimoDia >= hoje) {
    const faltam = Math.round((new Date(`${ultimoDia}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 864e5) + 1;
    return { status: "aguardando", faltam, leitura: `Aguardando dados: faltam ${faltam} dia${faltam === 1 ? "" : "s"} pra fechar os 7 dias depois.` };
  }
  let m = medir(JANELA);
  const poucas = (x) => x.antes.unidades + x.depois.unidades < MIN_VENDAS;
  if (poucas(m) && somarDias(data, JANELA_MAX) < hoje) m = medir(JANELA_MAX);
  if (poucas(m))
    return { status: "pequena", ...m, leitura: `Amostra pequena (${m.antes.unidades + m.depois.unidades} vendas em ${m.dias * 2} dias) — não dá pra concluir; acompanhe mais.` };
  const base = m.antes.depoisAds;
  const varL = base !== 0 ? (m.depois.depoisAds - base) / Math.abs(base) : null;
  const varV = m.antes.unidades ? (m.depois.unidades - m.antes.unidades) / m.antes.unidades : null;
  const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;
  let leitura;
  if (varL == null) leitura = "Sem base de lucro antes pra comparar.";
  else if (Math.abs(varL) < VARIACAO_RELEVANTE) leitura = `Variação pequena no lucro depois do Ads (${pct(varL)}) — provavelmente inconclusivo.`;
  else leitura = `O lucro depois do Ads ${varL > 0 ? "subiu" : "caiu"} ${pct(varL)}${varV != null ? ` e as vendas ${pct(varV)}` : ""} no período seguinte — associação no tempo, não prova que foi a ação (campanha, data, concorrente e estoque também mudam).`;
  return { status: "ok", ...m, varLucro: varL, varVendas: varV, leitura };
}

/** Outras ações no mesmo anúncio a menos de 7 dias (não dá pra separar o efeito). */
export function acoesPerto(acao, todas) {
  return (todas || []).filter((x) => x.chave !== acao.chave && Math.abs((new Date(`${x.data}T12:00:00`) - new Date(`${acao.data}T12:00:00`)) / 864e5) < JANELA);
}
