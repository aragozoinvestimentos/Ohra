// GMV Max da Loja — arquivo próprio da Shopee ("Dados do GMV MAX da Loja",
// Marketing → Shopee Ads → GMV Max da Loja → Exportar). Conta ÚNICA:
// - o arquivo traz a linha total "GMV Max da Loja" (ID "-") e uma linha por
//   produto que a campanha da loja divulgou (só informação — NUNCA vira
//   período de Ads do produto);
// - cada arquivo é uma JANELA (o período escolhido na exportação). As janelas
//   importadas se SOMAM pra formar o acumulado do período da loja; a mesma
//   janela enviada de novo substitui (não duplica); janela que cobre outra
//   menor a substitui; repetiu só parte dos dias = entra só a diferença
//   (trechoNovo/recortarJanelaGmv, estimada);
// - dias sem janela entre o início do período e a última janela = FURO
//   (aviso pra exportar exatamente esses dias).

const somar = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** Janela guardada a partir do relatório lido (interpretarGmvLoja). */
export function janelaDoRelatorio(r) {
  if (!r?.periodo?.de || !r?.periodo?.ate) return null;
  return { de: r.periodo.de, ate: r.periodo.ate, ...r.loja, porItem: r.lojaPorItem || [] };
}

const diasDe = (de, ate) => (ate >= de ? Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 86400000) + 1 : 0);
const sobreposto = (a, de, ate) => diasDe(a.de > de ? a.de : de, a.ate < ate ? a.ate : ate);

/**
 * Período exportado que REPETE dias já enviados (22/10/2026, Gustavo: "não
 * deixa subir quando repete — quero só a diferença"). A Shopee manda o total
 * do período, não o dia a dia: os dias novos = o total do arquivo novo MENOS o
 * que as janelas antigas tinham nos dias repetidos (cada uma pela média por dia
 * dela). → null (não repete / mesma janela / engole as antigas) |
 * { erro } | { de, ate, sub: [{ j, frac }], diasNovos, diasNova }.
 */
export function trechoNovo(janelas, nova) {
  const sobre = (janelas || []).filter((j) => j.de <= nova.ate && nova.de <= j.ate);
  if (!sobre.length || sobre.some((j) => j.de === nova.de && j.ate === nova.ate)) return null;
  const parcial = sobre.filter((j) => !(j.de >= nova.de && j.ate <= nova.ate));
  if (!parcial.length) return null;
  if (parcial.some((j) => j.de <= nova.de && j.ate >= nova.ate))
    return { erro: `Os dias ${dm(nova.de)} a ${dm(nova.ate)} já foram enviados antes — não há dia novo nesse arquivo. Nada foi importado.` };
  let de = nova.de;
  let ate = nova.ate;
  for (const j of parcial) {
    if (j.de <= nova.de) de = somar(j.ate, 1) > de ? somar(j.ate, 1) : de;
    else ate = somar(j.de, -1) < ate ? somar(j.de, -1) : ate;
  }
  if (de > ate) return { erro: `O arquivo de ${dm(nova.de)} a ${dm(nova.ate)} só repete dias já enviados. Nada foi importado.` };
  const sub = sobre
    .map((j) => ({ j, frac: (sobreposto(j, nova.de, nova.ate) - sobreposto(j, de, ate)) / Math.max(1, diasDe(j.de, j.ate)) }))
    .filter((x) => x.frac > 0);
  return { de, ate, sub, diasNovos: diasDe(de, ate), diasNova: diasDe(nova.de, nova.ate) };
}
/** novo − Σ frac × antigo, entre 0 e o novo. */
export function diferenca(novo, antigos) {
  const n = Number(novo) || 0;
  const v = n - antigos.reduce((t, [frac, x]) => t + frac * (Number(x) || 0), 0);
  return Math.max(0, Math.min(n, v));
}
/** GMV Max da Loja: só os dias novos da janela (pela diferença). */
export function recortarJanelaGmv(nova, tr) {
  const campos = ["gasto", "cliques", "vendas", "receita", "impressoes"];
  const out = { ...nova, de: tr.de, ate: tr.ate, estimado: true };
  for (const k of campos) if (nova[k] != null) out[k] = (k === "gasto" || k === "receita" ? r2 : (x) => Math.round(x))(diferenca(nova[k], tr.sub.map(({ j, frac }) => [frac, j[k]])));
  out.porItem = (nova.porItem || []).map((p) => {
    const q = { ...p };
    for (const k of campos) if (p[k] != null) q[k] = (k === "gasto" || k === "receita" ? r2 : (x) => Math.round(x * 100) / 100)(diferenca(p[k], tr.sub.map(({ j, frac }) => [frac, (j.porItem || []).find((x) => x.id === p.id)?.[k]])));
    return q;
  });
  return out;
}

/**
 * Junta uma janela nova às já importadas.
 * → { janelas, info } ou { erro }.
 */
export function juntarJanela(janelas, nova) {
  const lista = [...(janelas || [])];
  const iguais = lista.findIndex((j) => j.de === nova.de && j.ate === nova.ate);
  if (iguais >= 0) {
    lista[iguais] = nova;
    return { janelas: ordenar(lista), info: `${dm(nova.de)} a ${dm(nova.ate)} já tinha sido enviado — substituído (não somou de novo)` };
  }
  const cruza = lista.filter((j) => j.de <= nova.ate && nova.de <= j.ate);
  const dentro = cruza.filter((j) => j.de >= nova.de && j.ate <= nova.ate);
  const contem = cruza.find((j) => j.de <= nova.de && j.ate >= nova.ate);
  if (contem) return { erro: `Os dias ${dm(nova.de)} a ${dm(nova.ate)} já estão dentro do envio de ${dm(contem.de)} a ${dm(contem.ate)} — nada foi importado (somaria 2 vezes).` };
  const parcial = cruza.filter((j) => !dentro.includes(j));
  if (parcial.length) {
    const j = parcial[0];
    const sug = j.de < nova.de ? `a partir de ${dm(somar(j.ate, 1))}` : `até ${dm(somar(j.de, -1))}`;
    return { erro: `O período ${dm(nova.de)} a ${dm(nova.ate)} cruza com o já enviado de ${dm(j.de)} a ${dm(j.ate)} — somaria esses dias 2 vezes. Exporte ${sug}, ou um período que cubra os dois inteiros. Nada foi importado.` };
  }
  const resto = lista.filter((j) => !dentro.includes(j));
  return { janelas: ordenar([...resto, nova]), info: dentro.length ? `substituiu ${dentro.length} envio${dentro.length === 1 ? "" : "s"} menor${dentro.length === 1 ? "" : "es"} dentro desse período` : "" };
}
const ordenar = (l) => l.sort((a, b) => a.de.localeCompare(b.de));

/** Janelas que valem pro período (a partir do início dele; até o fim, se houver). */
export function janelasDoPeriodo(janelas, periodo) {
  if (!periodo) return [];
  return (janelas || []).filter((j) => j.ate >= periodo.inicio && (!periodo.fim || j.de <= periodo.fim));
}

/** Furos: dias sem janela entre o início do período e a última janela. */
export function furosDasJanelas(janelas, inicio) {
  const l = ordenar([...(janelas || [])]);
  if (!l.length) return [];
  const furos = [];
  let cursor = inicio && inicio < l[0].de ? inicio : l[0].de;
  for (const j of l) {
    if (j.de > cursor) furos.push({ de: cursor, ate: somar(j.de, -1) });
    const prox = somar(j.ate, 1);
    if (prox > cursor) cursor = prox;
  }
  return furos;
}
export const textoFuro = (f) => (f.de === f.ate ? `falta o dia ${dm(f.de)}` : `faltam os dias ${dm(f.de)} a ${dm(f.ate)}`);

/** Acumulado do período (soma das janelas) + histórico por fim de janela (pra interpolar). */
export function acumuladoDasJanelas(janelas) {
  const l = ordenar([...(janelas || [])]);
  if (!l.length) return null;
  const ac = { gasto: 0, cliques: 0, vendas: 0, receita: 0 };
  const historico = [];
  for (const j of l) {
    ac.gasto = r2(ac.gasto + (j.gasto || 0));
    ac.cliques += Math.round(j.cliques || 0);
    ac.vendas += Math.round(j.vendas || 0);
    ac.receita = r2(ac.receita + (j.receita || 0));
    historico.push({ ate: j.ate, ...ac });
  }
  const ult = historico.pop();
  return { ...ult, historico, de: l[0].de };
}

/**
 * Por produto, somando as janelas (desde `desde`). `ligar(itemId)` → { linha do
 * app (Ads do produto), nome } ou null. Avisos:
 * - "sem-venda": a campanha da loja gastou nele com ≥ `cliquesSemVenda` cliques e 0 vendas;
 * - "ads-proprio": ≥ `vendasMin` vendas nos últimos 14 dias e retorno ≥ 1,2×
 *   (ROAS ÷ equilíbrio do produto) — vale um Ads próprio (meta = ROAS dele na loja).
 */
// 19/10/2026 (Gustavo): na GMV Max da Loja quem escolhe onde gastar é a
// Shopee (meta alta, produtos secundários) — cliques sem venda NÃO geram
// aviso; só um produto que sozinho passou de R$ 15 sem vender nada (o mesmo
// limite do "Ads no prejuízo").
export const GMV_REGRAS = { gastoSemVenda: 15, vendasMin: 5, diasOportunidade: 14, retornoMin: 1.2 };
export function produtosDaGmv(janelas, { desde = null, hoje, ligar = () => null, regras = GMV_REGRAS } = {}) {
  const m = new Map();
  const corte14 = hoje ? somar(hoje, -regras.diasOportunidade) : null;
  for (const j of janelas || []) {
    if (desde && j.ate < desde) continue;
    const recente = !corte14 || j.de >= corte14;
    for (const p of j.porItem || []) {
      const a = m.get(p.id) || { id: p.id, nome: p.nome, gasto: 0, cliques: 0, impressoes: 0, vendas: 0, receita: 0, vendas14: 0, gasto14: 0, receita14: 0 };
      a.gasto = r2(a.gasto + (p.gasto || 0));
      a.cliques += p.cliques || 0;
      a.impressoes += p.impressoes || 0;
      a.vendas += p.vendas || 0;
      a.receita = r2(a.receita + (p.receita || 0));
      if (recente) {
        a.vendas14 += p.vendas || 0;
        a.gasto14 = r2(a.gasto14 + (p.gasto || 0));
        a.receita14 = r2(a.receita14 + (p.receita || 0));
      }
      m.set(p.id, a);
    }
  }
  return [...m.values()]
    .map((a) => {
      const lig = ligar(a.id);
      const roas = a.gasto > 0 ? a.receita / a.gasto : null;
      const roas14 = a.gasto14 > 0 ? a.receita14 / a.gasto14 : null;
      const eq = lig?.equilibrio || null;
      const retorno14 = roas14 != null && eq ? roas14 / eq : null;
      let aviso = null;
      if (a.vendas === 0 && a.gasto >= regras.gastoSemVenda)
        aviso = { tipo: "sem-venda", estado: "atencao", titulo: `a campanha da loja já gastou R$ ${a.gasto.toFixed(2).replace(".", ",")} nele sem vender`, texto: `${a.cliques} cliques e nenhuma venda — confira capa, título e preço do anúncio; se continuar, tire esse produto da GMV Max da Loja na Shopee.` };
      else if (!lig?.temAdsProprio && a.vendas14 >= regras.vendasMin && retorno14 != null && retorno14 >= regras.retornoMin)
        aviso = { tipo: "ads-proprio", estado: "oportunidade", titulo: "vende bem na campanha da loja — vale um Ads próprio?", texto: `${a.vendas14} vendas em ${regras.diasOportunidade} dias, ROAS ${roas14.toFixed(1).replace(".", ",")} (retorno ${retorno14.toFixed(1).replace(".", ",")}×). Comece um Ads próprio com meta ${roas14.toFixed(1).replace(".", ",")}.`, meta: Math.round(roas14 * 10) / 10 };
      return { ...a, roas, roas14, retorno14, ligado: lig, aviso };
    })
    .sort((x, y) => y.gasto - x.gasto);
}
