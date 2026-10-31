// Atualizar dados → Últimas importações (31/10/2026). Conta PURA da lista de
// envios (tabela `importacoes`): tipo e marketplace de cada envio, os registros
// "filhos" (o arquivo de pedidos da Olist/ERP grava um marcador por plataforma)
// e se o envio pode ser excluído. Regra: só o envio MAIS NOVO de cada tipo sai
// (do mais novo pro mais antigo) — os de Ads/GMV/desempenho são acumulados e um
// pedido que entrou num arquivo pode ter vindo de novo no seguinte.

export const TIPOS_IMPORTACAO = [
  { v: "pedidos", t: "Pedidos" },
  { v: "desempenho", t: "Desempenho (funil)" },
  { v: "ads", t: "Ads dos produtos" },
  { v: "gmv", t: "GMV Max da Loja" },
  { v: "extrato", t: "Extrato da carteira" },
];
export const PLATAFORMAS_IMPORTACAO = [
  { v: "shopee", t: "Shopee", tipo: "shopee" },
  { v: "tiktok", t: "TikTok", tipo: "tiktok" },
  { v: "ml", t: "Mercado Livre", tipo: "ml" },
  { v: "shein", t: "Shein", tipo: "shein" },
];
const FILHO_SEGUNDOS = 120;

/** "pedidos:olist" → { tipo: "pedidos", plataforma: null (todas) }; "shopee:ads" → { ads, shopee }. */
export function infoRelatorio(rel) {
  const [a, b] = String(rel || "").split(":");
  if (a === "pedidos") return { tipo: "pedidos", plataforma: b === "olist" ? null : b, arquivoTodo: b === "olist" };
  return { tipo: b || a, plataforma: a };
}
export const rotuloTipo = (v) => TIPOS_IMPORTACAO.find((t) => t.v === v)?.t || v;
export const rotuloPlataforma = (v) => PLATAFORMAS_IMPORTACAO.find((p) => p.v === v)?.t || v;
const seg = (iso) => new Date(iso).getTime() / 1000;

/**
 * Envios da loja, do mais novo pro mais antigo. Os marcadores `pedidos:<plat>`
 * gravados junto do arquivo de pedidos (dados.pai, ou o mesmo arquivo em até 2
 * min — envios de antes) viram `filhos` dele. Cada entrada:
 * { imp, tipo, plataformas[], filhos[], grupo (chave da regra do mais novo), maisNovo }
 */
export function listaImportacoes(importacoes = []) {
  const ord = [...importacoes].sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  const paisOlist = ord.filter((i) => i.relatorio === "pedidos:olist");
  const filhoDe = new Map();
  for (const i of ord) {
    const inf = infoRelatorio(i.relatorio);
    if (inf.tipo !== "pedidos" || inf.arquivoTodo) continue;
    const pai = i.dados?.pai ? paisOlist.find((p) => p.id === i.dados.pai) : paisOlist.find((p) => p.arquivo === i.arquivo && Math.abs(seg(p.criado_em) - seg(i.criado_em)) <= FILHO_SEGUNDOS);
    if (pai) filhoDe.set(i.id, pai.id);
  }
  const lista = [];
  for (const i of ord) {
    if (filhoDe.has(i.id)) continue;
    const inf = infoRelatorio(i.relatorio);
    const filhos = ord.filter((f) => filhoDe.get(f.id) === i.id);
    const plataformas = inf.arquivoTodo ? filhos.filter((f) => !/nenhum pedido/.test(f.resumo || "")).map((f) => infoRelatorio(f.relatorio).plataforma) : inf.plataforma ? [inf.plataforma] : [];
    lista.push({ imp: i, tipo: inf.tipo, arquivoTodo: !!inf.arquivoTodo, plataformas, filhos, grupo: inf.tipo === "pedidos" ? "pedidos" : i.relatorio });
  }
  const vistos = new Set();
  for (const e of lista) {
    e.maisNovo = e.imp.ok !== false && !vistos.has(e.grupo);
    if (e.imp.ok !== false) vistos.add(e.grupo);
  }
  return lista;
}

/** Pode excluir? Só o mais novo do tipo (ou um envio que deu erro). */
export function podeExcluir(entrada, lista) {
  if (entrada.imp.ok === false || entrada.maisNovo) return { pode: true };
  const novo = lista.find((e) => e.grupo === entrada.grupo && e.maisNovo);
  return { pode: false, motivo: `Exclua antes o envio mais novo de ${rotuloTipo(entrada.tipo).toLowerCase()}${novo ? ` (${novo.imp.criado_em ? new Date(novo.imp.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""})` : ""} — dá pra desfazer só do mais novo pro mais antigo.` };
}

/** O envio anterior do mesmo grupo (o que volta a valer depois de excluir). */
export function envioAnterior(entrada, lista) {
  return lista.find((e) => e !== entrada && e.grupo === entrada.grupo && e.imp.ok !== false && String(e.imp.criado_em) < String(entrada.imp.criado_em)) || null;
}

const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

/**
 * O que acontece ao excluir (texto da confirmação). pedidos = pedidos da loja
 * (com importacao_id), pra contar quantos itens entraram com este envio.
 */
export function efeitoDaExclusao(entrada, lista, pedidos = []) {
  const ant = envioAnterior(entrada, lista);
  const id = entrada.imp.id;
  if (entrada.imp.ok === false) return ["Este envio deu erro e não gravou nada — sai só o registro."];
  if (entrada.tipo === "pedidos") {
    const novos = pedidos.filter((p) => p.importacao_id === id);
    const nPed = new Set(novos.map((p) => p.pedido)).size;
    return [
      novos.length
        ? `Saem ${nPed} pedido${nPed === 1 ? "" : "s"} (${novos.length} ite${novos.length === 1 ? "m" : "ns"}) que entraram com este arquivo, e o Fluxo de Caixa é refeito.`
        : entrada.imp.dados?.controle
          ? "Este arquivo não trouxe pedido novo (só atualizou os que já existiam) — sai só o registro do envio."
          : "Este envio é de antes do controle por arquivo (SQL v71): os pedidos dele ficam. Pra corrigir, reenvie o arquivo certo — ele substitui pedido por pedido.",
      "Pedidos que já existiam e foram atualizados por este arquivo não voltam ao que eram — reenvie o arquivo certo se precisar.",
      ant ? `A data “pedidos em dia até” volta pro envio anterior (até ${dm(ant.imp.periodo_ate)}).` : "Era o único envio de pedidos.",
    ];
  }
  if (entrada.tipo === "extrato")
    return [
      entrada.imp.dados?.controle
        ? "Saem as transações que entraram com este extrato e os saques que ele criou no Caixa."
        : "Este envio é de antes do controle por arquivo (SQL v71): as transações ficam — sai só o registro.",
    ];
  if (entrada.tipo === "desempenho") return [ant ? `O funil volta a usar o envio anterior (${dm(ant.imp.periodo_de)} a ${dm(ant.imp.periodo_ate)}).` : "Era o único Desempenho enviado: o funil fica sem dados até o próximo envio."];
  if (entrada.tipo === "ads" || entrada.tipo === "gmv")
    return [
      ant
        ? `O ${entrada.tipo === "gmv" ? "andamento da GMV Max da Loja" : "andamento do Ads"} volta ao envio anterior (somado até ${dm(ant.imp.periodo_ate)}) e é regravado nos períodos ligados.`
        : `Era o único envio: o andamento já gravado nos períodos de Ads fica como está — se estiver errado, use o ✎ corrigir o gasto em Vender mais → Ads.`,
    ];
  return ["Sai o registro do envio."];
}

/**
 * Arquivo de outra loja? Muitos itens com SKU e quase nenhum ligado ao
 * catálogo desta loja. → { total, ligados } quando parece, senão null.
 */
export function pareceOutraLoja(linhas = [], { minimo = 10, fracao = 0.3 } = {}) {
  const comSku = linhas.filter((l) => l.sku);
  if (comSku.length < minimo) return null;
  const ligados = comSku.filter((l) => l.it).length;
  return ligados / comSku.length < fracao ? { total: comSku.length, ligados } : null;
}
