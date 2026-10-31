// Consultor da Sede (24/10/2026): perguntas básicas respondidas com os números
// que o app já calcula (sem IA), consultorias com o PORQUÊ (inclusive
// "expansão do ambiente" quando um setor fica cheio) e o pacote "Levar pro
// Claude". Só LÊ — gravações em consultorAcoes.js.
import { adsNoPeriodo, somaPedidos } from "./resumoLoja.js";
import { adsNaJanela } from "./ads.js";
import { infoSazonal, quandoVendeDe } from "./calendario.js";
import { BRL } from "./format.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
export const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Nome das telas (aba do App) pro resumo de uso.
export const ROTULOS_ABA = {
  inicio: "Início", sede: "Sede", importar: "Atualizar dados", cadastros: "Produtos", produto: "Página do produto", producao: "Simular custo",
  anuncios: "Anúncios", anuncio: "Painel do anúncio", historico: "Preços salvos", canal: "Passos do preço", crescimento: "Vender mais (Rampa/Ads/Afiliados)",
  promocoes: "Promoções e cupons", orcamento: "Orçamento e atacado", live: "Live", resumoMes: "Resumo do mês", caixa: "Dinheiro (Caixa)", metas: "Metas",
  ranking: "Ranking", diagnostico: "Análise → Diagnóstico", analise: "Análise", compararPeriodos: "Comparar períodos", carrinhos: "Carrinhos abandonados",
  registroImpressoes: "Registro de impressões", otimizacao: "Otimização", farm: "Minha farm", insumos: "Insumos", estoque: "Estoque e compras", config: "Configuração", tutorial: "Tutorial",
};

// ---------- período pelo texto ----------
export function periodoDoTexto(t, hoje) {
  const mes = hoje.slice(0, 7);
  if (/\bontem\b/.test(t)) return { de: somarDias(hoje, -1), ate: somarDias(hoje, -1), nome: "ontem" };
  if (/\bhoje\b/.test(t)) return { de: hoje, ate: hoje, nome: "hoje" };
  if (/mes passado|ultimo mes|mes anterior/.test(t)) {
    const [a, m] = mes.split("-").map(Number);
    const d = new Date(a, m - 2, 1);
    const ma = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const fim = new Date(a, m - 1, 0).getDate();
    return { de: `${ma}-01`, ate: `${ma}-${String(fim).padStart(2, "0")}`, nome: "no mês passado" };
  }
  if (/semana|7 dias|sete dias/.test(t)) return { de: somarDias(hoje, -6), ate: hoje, nome: "nos últimos 7 dias" };
  if (/30 dias|trinta dias/.test(t)) return { de: somarDias(hoje, -29), ate: hoje, nome: "nos últimos 30 dias" };
  return { de: `${mes}-01`, ate: hoje, nome: "neste mês" };
}

// produto "pai" de uma linha de pedido (variação conta no produto)
function paiDaLinha(p) {
  const it = p.item;
  if (!it) return null;
  if (it.id.startsWith("v:") && it.produtoId) return `p:${it.produtoId}`;
  return it.id;
}
function porProduto(pedidos, de, ate, nomeDe) {
  const m = new Map();
  for (const p of pedidos || []) {
    if (!p.valido) continue;
    const d = String(p.data).slice(0, 10);
    if (d < de || d > ate) continue;
    const k = paiDaLinha(p);
    if (!k) continue;
    const g = m.get(k) || { chave: k, nome: nomeDe(k) || p.item?.nome || p.sku, unidades: 0, vendas: 0, lucro: 0 };
    g.unidades += num(p.q);
    g.vendas += num(p.pago);
    g.lucro += num(p.lucro);
    m.set(k, g);
  }
  return [...m.values()];
}

// item citado no texto (nome inteiro, ou as palavras grandes do nome)
function itemDoTexto(t, itens) {
  let melhor = null;
  for (const it of itens) {
    const n = normalizar(it.nome);
    if (!n) continue;
    let pontos = 0;
    if (t.includes(n)) pontos = 100 + n.length;
    else {
      const ps = n.split(" ").filter((w) => w.length >= 4);
      const achou = ps.filter((w) => t.includes(w)).length;
      if (ps.length && achou >= Math.min(2, ps.length)) pontos = achou * 10 + (achou === ps.length ? 5 : 0);
    }
    if (pontos > (melhor?.pontos || 0)) melhor = { it, pontos };
  }
  return melhor?.it || null;
}

/**
 * Pergunta básica → resposta com os números do app.
 * ctx = { pedidos, linhasAds, hoje, kpis, pendencias, produtos, kits }
 * → { entendeu, texto, numeros } (numeros = o que vai junto se for pro Claude)
 */
export function responderPergunta(pergunta, ctx) {
  const t = normalizar(pergunta);
  const { pedidos, linhasAds, hoje, kpis, pendencias = [], produtos = [], kits = [] } = ctx;
  const per = periodoDoTexto(t, hoje);
  const nomeDe = (k) => (k.startsWith("p:") ? produtos.find((p) => p.id === k.slice(2))?.nome : kits.find((x) => x.id === k.slice(2))?.nome);
  const naoSei = { entendeu: false, texto: "Essa é melhor perguntar pro Claude. Guardei a pergunta pra você levar em \"Levar pro Claude\".", numeros: null };
  if (!t) return naoSei;
  // pergunta de análise ("por que…", "vale a pena…", "o que acha…") é pro Claude
  if (/^(por que|porque|pq|vale a pena|devo|o que (voce )?acha|como (melhorar|aumentar|faco pra))/.test(t)) return naoSei;
  const temPedidos = (pedidos || []).some((p) => p.valido);

  // 0) revenda: estoque / repor / limite do MEI (v66)
  if (/estoque|repor|mercadoria/.test(t)) {
    const e = kpis?.estoque;
    if (!e) return { entendeu: true, texto: "Ainda não há produto com estoque — a revenda começa na 1ª nota de compra importada e o fabricado quando você marca “tenho estoque pronto” em Estoque e compras.", numeros: null };
    const rep = e.repor.length ? ` Pra repor/imprimir: ${e.repor.map((r) => `${r.nome} (${r.texto})`).join("; ")}.` : " Nada pra repor agora.";
    const env = e.aEnviar > 0 ? ` ${e.aEnviar} un. pagas ainda não enviadas (saem do estoque quando o pedido virar Enviado).` : "";
    return { entendeu: true, texto: `Estoque: ${e.itens} ${e.itens === 1 ? "produto" : "produtos"}, ${BRL(e.valor)} na prateleira pelo custo.${rep}${env}`, numeros: { estoque: e.valor } };
  }
  if (/afiliad|comiss[aã]o/.test(t)) {
    const a = kpis?.afiliados;
    const i = kpis?.afiliadosInfo;
    const pc = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
    if (!i) return { entendeu: true, texto: "Afiliados: sem Shopee cadastrada ou sem produto com preço salvo. A comissão sugerida e o simulador ficam em Vender mais → Afiliados.", numeros: null };
    // "suporta X%" / "aguenta X%" → lista os anúncios que aguentam esse % com metade do lucro.
    const m = t.match(/(\d{1,2})\s*%/);
    if (m) {
      const p = Number(m[1]);
      const sim = i.linhas.filter((l) => !l.desligado && l.max >= p);
      const nao = i.linhas.filter((l) => !l.desligado && l.max < p);
      return { entendeu: true, texto: `Com ${p}% de comissão, ${sim.length} de ${i.linhas.length} anúncios da ${i.canal} deixam pelo menos metade do lucro com você${sim.length ? `: ${sim.slice(0, 6).map((l) => l.nome).join(", ")}${sim.length > 6 ? "…" : ""}` : ""}.${nao.length ? ` Não aguentam: ${nao.slice(0, 5).map((l) => `${l.nome} (máx. ${l.max}%)`).join(", ")}${nao.length > 5 ? "…" : ""}.` : ""}`, numeros: null };
    }
    const prod = i.linhas.find((l) => t.includes(l.nome.toLowerCase()));
    if (prod?.desligado) return { entendeu: true, texto: `${prod.nome}: afiliado DESLIGADO (você tirou da campanha). Se ligar de novo, o máximo seguro é ${prod.max ? `${prod.max}%` : "— (não aguenta afiliado)"}.`, numeros: null };
    if (prod) return { entendeu: true, texto: `${prod.nome}: comissão máxima segura ${prod.max ? `${prod.max}%` : "— não aguenta afiliado"} (o afiliado fica com no máximo metade do lucro, preço de agora e cupom).${prod.propria ? ` Hoje com ${pc(prod.propria)} só neste anúncio.` : ""}`, numeros: null };
    const partes = [
      `Na ${i.canal}: comissão da loja ${i.comissao ? pc(i.comissao) : "não registrada"}, sugerida ${i.sugerida ? `${i.sugerida}%` : "—"}, teto ${i.teto ? `${i.teto}%` : "—"} (mínimo da Shopee ${pc(i.minimo)}).`,
      i.resultado?.temDados ? `Últimos 30 dias: ${i.resultado.vendas} vendas via afiliado, comissão ${BRL(i.resultado.comissao)}, lucro depois ${BRL(i.resultado.depois)}.` : "Ainda sem venda por afiliado registrada.",
      i.amostras > 0 ? `Investido em amostras: ${BRL(i.amostras)}.` : "",
      a?.length ? `Pra fazer: ${a.join(" · ")}.` : "Nada pra fazer agora.",
    ];
    return { entendeu: true, texto: partes.filter(Boolean).join(" "), numeros: null };
  }
  if (/\bmei\b|limite de faturamento/.test(t)) {
    const l = kpis?.limiteMei;
    if (!l) return { entendeu: true, texto: "O regime da loja não está como MEI — escolha em Configuração → Regras → Impostos da loja.", numeros: null };
    return { entendeu: true, texto: `Faturado no ano: ${BRL(l.faturado)} de ${BRL(l.limite)} (${Math.round(l.pct * 100)}%). No ritmo dos últimos 90 dias o ano fecha em ~${BRL(l.projecao)}${l.passaEm ? ` — passa do limite por volta de ${l.passaEm.slice(8, 10)}/${l.passaEm.slice(5, 7)}` : ""}.`, numeros: { faturado: l.faturado } };
  }

  // 1) um produto ou kit citado pelo nome
  const itens = [...produtos.map((p) => ({ id: `p:${p.id}`, nome: p.nome })), ...kits.map((k) => ({ id: `k:${k.id}`, nome: k.nome }))];
  const it = itemDoTexto(t, itens);
  if (it && !/(caixa|meta|pagar|contas)/.test(t)) {
    const g = porProduto(pedidos, per.de, per.ate, nomeDe).find((x) => x.chave === it.id);
    const n = normalizar(it.nome);
    const avisos = pendencias.filter((p) => normalizar(p.titulo).startsWith(n));
    const linhas = [
      g ? `${it.nome} ${per.nome}: ${g.unidades} un. vendidas · ${BRL(g.vendas)} em vendas · lucro ${BRL(g.lucro)} (antes do Ads).` : `${it.nome} não teve venda ${per.nome} nos pedidos importados.`,
      avisos.length ? `Avisos dele agora: ${avisos.slice(0, 3).map((a) => a.titulo).join(" · ")}` : "Nenhum aviso dele no Início agora.",
    ];
    return { entendeu: true, texto: linhas.join("\n"), numeros: { item: it.nome, periodo: per, venda: g || null, avisos: avisos.map((a) => a.titulo) } };
  }

  // 2) contas a pagar
  if (/pagar|contas|vence|boleto/.test(t)) {
    const l = kpis?.aPagar;
    if (!l) return { entendeu: true, texto: "Não achei lançamentos no Caixa (Dinheiro → Caixa).", numeros: null };
    if (!l.length) return { entendeu: true, texto: "Nada pra pagar nos próximos 7 dias e nada atrasado. ✓", numeros: { aPagar: [] } };
    const total = l.reduce((s, x) => s + x.valor, 0);
    const atras = l.filter((x) => x.data < hoje);
    return {
      entendeu: true,
      texto: `${l.length} conta${l.length === 1 ? "" : "s"} · ${BRL(total)}${atras.length ? ` (${atras.length} atrasada${atras.length === 1 ? "" : "s"})` : ""}:\n${l.slice(0, 6).map((x) => `${dm(x.data)} · ${x.descricao} · ${BRL(x.valor)}`).join("\n")}`,
      numeros: { aPagar: l },
    };
  }
  // 3) caixa
  if (/caixa|saldo|dinheiro em conta|quanto tenho/.test(t)) {
    if (kpis?.caixa == null) return { entendeu: true, texto: "Ainda não há lançamentos no Caixa (Dinheiro → Caixa).", numeros: null };
    return { entendeu: true, texto: `O caixa da loja hoje: ${BRL(kpis.caixa)}.`, numeros: { caixa: kpis.caixa } };
  }
  // 4) meta
  if (/\bmeta\b/.test(t)) {
    if (!kpis?.meta) return { entendeu: true, texto: "Não há meta cadastrada pra este mês (Dinheiro → Metas).", numeros: null };
    const falta = Math.max(0, kpis.meta - num(kpis.vendas));
    return {
      entendeu: true,
      texto: `Meta do mês: ${BRL(kpis.meta)}. Vendido até hoje: ${BRL(kpis.vendas)} (${pct(num(kpis.vendas) / kpis.meta)}). ${falta > 0 ? `Faltam ${BRL(falta)}.` : "Meta batida! 🎉"}${kpis.ritmo ? ` No ritmo atual o mês fecha em ~${BRL(kpis.ritmo)}.` : ""}`,
      numeros: { meta: kpis.meta, vendas: kpis.vendas, ritmo: kpis.ritmo },
    };
  }
  // 5) Ads
  if (/\bads\b|anuncio pago|gastei|gasto/.test(t) && !/lucro/.test(t)) {
    const g = adsNoPeriodo(linhasAds, per.de, per.ate);
    return { entendeu: true, texto: `Ads ${per.nome}: ${BRL(g)} gastos (todas as campanhas, pelos CSVs importados).`, numeros: { ads: g, periodo: per } };
  }
  if (!temPedidos && /vend|lucro|fatur|pedido|produto/.test(t)) return { entendeu: true, texto: "Ainda não há pedidos importados (Atualizar dados → Pedidos da Olist).", numeros: null };
  // 6) mais vende / mais lucra
  const maisLucro = /(mais lucr|da mais lucro|mais rentavel|lucra mais)/.test(t);
  if (maisLucro || /(mais vend|campeao|top|melhor produto)/.test(t)) {
    const l = porProduto(pedidos, per.de, per.ate, nomeDe).sort((a, b) => (maisLucro ? b.lucro - a.lucro : b.unidades - a.unidades)).slice(0, 3);
    if (!l.length) return { entendeu: true, texto: `Nenhuma venda ${per.nome}.`, numeros: null };
    return {
      entendeu: true,
      texto: `${maisLucro ? "Quem mais deu lucro" : "Quem mais vendeu"} ${per.nome}:\n${l.map((g, i) => `${i + 1}º ${g.nome} — ${g.unidades} un. · lucro ${BRL(g.lucro)}`).join("\n")}`,
      numeros: { ranking: l, periodo: per },
    };
  }
  // 7) lucro
  if (/lucro|lucrei|ganhei|sobrou/.test(t)) {
    const s = somaPedidos(pedidos, per.de, per.ate);
    const ads = adsNoPeriodo(linhasAds, per.de, per.ate);
    return {
      entendeu: true,
      texto: `Lucro ${per.nome}: ${BRL(s.lucro)} antes do Ads · ${BRL(s.lucro - ads)} depois do Ads (${BRL(ads)} de Ads). Com o custo e as taxas de hoje; as contas fixas não entram (veja Análise → Diagnóstico).`,
      numeros: { ...s, ads, periodo: per },
    };
  }
  // 8) vendas
  if (/vend|fatur|pedido/.test(t)) {
    const s = somaPedidos(pedidos, per.de, per.ate);
    return { entendeu: true, texto: `${per.nome[0].toUpperCase()}${per.nome.slice(1)}: ${s.pedidos} pedidos · ${s.unidades} un. · ${BRL(s.vendas)} em vendas (o que o cliente pagou).`, numeros: { ...s, periodo: per } };
  }
  // 9) o que fazer
  if (/fazer|aviso|pendent|urgente|prioridade|resolver/.test(t)) {
    const av = pendencias.filter((p) => !p.tarefa);
    if (!av.length) return { entendeu: true, texto: "Nada pendente no Início agora. ✓", numeros: null };
    const urg = av.filter((p) => p.grupo === "resolver");
    const top = (urg.length ? urg : av).slice(0, 4);
    return { entendeu: true, texto: `${av.length} aviso${av.length === 1 ? "" : "s"} no Início (${urg.length} urgente${urg.length === 1 ? "" : "s"}). Comece por:\n${top.map((p) => `• ${p.titulo}`).join("\n")}`, numeros: { avisos: av.length, urgentes: urg.length } };
  }
  return naoSei;
}

// Exemplos que aparecem embaixo do campo.
export const EXEMPLOS_PERGUNTA = ["quanto vendi essa semana?", "qual meu lucro do mês?", "qual produto mais vende?", "quanto gastei de Ads?", "quanto falta pra meta?", "o que tenho pra pagar?", "o que fazer primeiro?"];

// ---------- consultorias ----------
// Cada uma diz o que viu, por que agora, o que a análise responderia e o ganho.
const REGRAS = {
  quedaMinAntes: 6, // un. nos 14 dias antes
  quedaPct: 0.6, // atual ≤ 60% do antes
  concentracao: 0.5, // um produto ≥ 50% do lucro de 30 dias
  concentracaoMinLucro: 100,
  adsPesado: 0.4, // Ads ≥ 40% do lucro antes do Ads (30 dias)
  adsMin: 50,
  avisosMuitos: 10,
  producaoCheia: 0.8, // horas de impressão pedidas ≥ 80% das horas da farm
  expedicaoPedidosDia: 8,
  expedicaoCrescimento: 1.5,
  minPorPedido: 5, // embalar + etiqueta + postar, estimado
  lancarAntes: 45, // produto novo: lançar até N dias antes da data da época
};

export function sugerirConsultorias(ctx) {
  const { pedidos, linhasAds, hoje, pendencias = [], produtos = [], kits = [], kitProdutos = [], impressoras = [], farmConfig = null, cal = null } = ctx;
  const out = [];
  const nomeDe = (k) => (k.startsWith("p:") ? produtos.find((p) => p.id === k.slice(2))?.nome : kits.find((x) => x.id === k.slice(2))?.nome);
  const d14 = somarDias(hoje, -13), d28 = somarDias(hoje, -27), d30 = somarDias(hoje, -29);

  // 1) vendas de um produto caindo
  const atual = new Map(porProduto(pedidos, d14, hoje, nomeDe).map((g) => [g.chave, g]));
  for (const ant of porProduto(pedidos, d28, somarDias(d14, -1), nomeDe)) {
    if (ant.unidades < REGRAS.quedaMinAntes) continue;
    const at = atual.get(ant.chave) || { unidades: 0, lucro: 0 };
    if (at.unidades > ant.unidades * REGRAS.quedaPct) continue;
    const queda = 1 - at.unidades / ant.unidades;
    // Queda que veio do Ads pausado/reduzido (26/10/2026, Chaveiro Ore e
    // Confie): as vendas via Ads que sumiram explicam ≥ metade da queda →
    // é esperado, não vira proposta de análise (o Ads e o relatório de Ads
    // já mostram se ele se pagava).
    const doItem = (linhasAds?.linhas || []).filter((l) => `${l.tipo === "kit" ? "k" : "p"}:${l.id}` === ant.chave);
    const viaAds = (de, ate) => doItem.reduce((s, l) => s + num(adsNaJanela(l.periodos || [], l.semanas || [], de, ate)?.vendas), 0);
    const perdaAds = viaAds(d28, somarDias(d14, -1)) - viaAds(d14, hoje);
    if (perdaAds > 0 && perdaAds >= (ant.unidades - at.unidades) / 2) continue;
    out.push({
      chave: `queda|${ant.chave}`,
      sala: "comercial",
      tipo: "analise",
      titulo: `Vendas do ${ant.nome} caíram ${pct(queda)}`,
      viu: `Vendeu ${at.unidades} un. nos últimos 14 dias contra ${ant.unidades} nos 14 dias antes.`,
      porque: "São duas semanas seguidas abaixo — quanto antes achar a causa, menos venda se perde.",
      responderia: "Se a causa é preço, anúncio (foto/título), Ads, concorrente, avaliação ou só a época.",
      ganho: ant.lucro > at.lucro ? `Voltar ao ritmo de antes ≈ ${BRL((ant.lucro - at.lucro) / 2)} de lucro por semana.` : "Recuperar o volume de antes.",
    });
  }
  // 2) loja dependendo de um produto só
  const g30 = porProduto(pedidos, d30, hoje, nomeDe);
  const lucro30 = g30.reduce((s, g) => s + Math.max(0, g.lucro), 0);
  const top = g30.sort((a, b) => b.lucro - a.lucro)[0];
  if (top && lucro30 >= REGRAS.concentracaoMinLucro && top.lucro / lucro30 >= REGRAS.concentracao) {
    out.push({
      chave: `concentracao|${top.chave}`,
      sala: "diretoria",
      tipo: "analise",
      titulo: `A loja depende muito do ${top.nome}`,
      viu: `Ele fez ${pct(top.lucro / lucro30)} do lucro dos últimos 30 dias (${BRL(top.lucro)} de ${BRL(lucro30)}).`,
      porque: "Se ele cair (concorrente, avaliação ruim, fim da época), a loja inteira sente junto.",
      responderia: "Quais produtos têm potencial pra dividir esse peso e o que fazer pra puxar eles.",
      ganho: "Menos risco — não é ganho direto, é proteção.",
    });
  }
  // 2b) o nº 1 é de ÉPOCA → começar a lançar um produto de ano todo (26/10/2026,
  // validado com o Gustavo: uma regra só — ≥ 50% do lucro de 30 dias e "só na
  // época de…"; o lucro dele cai com data marcada). Prazo = 45 dias antes da data.
  if (top && lucro30 >= REGRAS.concentracaoMinLucro && top.lucro / lucro30 >= REGRAS.concentracao) {
    const pecas = top.chave.startsWith("k:") ? kitProdutos.filter((kp) => kp.kit_id === top.chave.slice(2)).map((kp) => produtos.find((p) => p.id === kp.produto_id)) : [produtos.find((p) => p.id === top.chave.slice(2))];
    const epoca = pecas.map((p) => quandoVendeDe(p)).find((q) => q?.tipo === "epoca");
    const inf = epoca ? infoSazonal(epoca, cal, hoje) : null;
    if (inf && inf.fase !== "entressafra" && inf.fase !== "aguardando") {
      const prazo = somarDias(inf.evento, -REGRAS.lancarAntes);
      out.push({
        chave: `lancar|${top.chave}|${inf.evento.slice(0, 4)}`,
        sala: "diretoria",
        tipo: "analise",
        titulo: `Comece a lançar um produto novo — o ${top.nome} é de época`,
        viu: `Ele fez ${pct(top.lucro / lucro30)} do lucro dos últimos 30 dias e só vende até ${inf.nome} (${dm(inf.evento)}).`,
        porque: `Depois de ${inf.nome} esse lucro cai com data marcada. Pra o produto novo já estar vendendo, o ideal é lançar até ${dm(prazo)}${prazo < hoje ? " — já passou, então quanto antes melhor" : ""}.`,
        responderia: "Qual produto de ano todo lançar. Pistas: margem igual ou acima da desejada, bom lucro por hora de impressora, algo que já converte bem com pouco tráfego (Análise → Diagnóstico) ou que aparece em “comprados juntos”.",
        ganho: "Manter o lucro da loja depois da época, em vez de cair junto.",
      });
    }
  }
  // 3) Ads comendo o lucro
  const s30 = somaPedidos(pedidos, d30, hoje);
  const ads30 = adsNoPeriodo(linhasAds, d30, hoje);
  if (ads30 >= REGRAS.adsMin && s30.lucro > 0 && ads30 / s30.lucro >= REGRAS.adsPesado) {
    out.push({
      chave: `ads-pesado|${hoje.slice(0, 7)}`,
      sala: "comercial",
      tipo: "analise",
      titulo: `O Ads está levando ${pct(ads30 / s30.lucro)} do lucro`,
      viu: `Nos últimos 30 dias o Ads custou ${BRL(ads30)} pra ${BRL(s30.lucro)} de lucro antes do Ads.`,
      porque: "Acima de 40%, o Ads fica com a maior parte do que sobra das vendas.",
      responderia: "Quais anúncios pagam o próprio Ads e quais só gastam.",
      ganho: `Cortar o que não se paga pode devolver parte desses ${BRL(ads30)} por mês.`,
    });
  }
  // 4) avisos acumulados
  const av = pendencias.filter((p) => !p.tarefa);
  if (av.length >= REGRAS.avisosMuitos) {
    const urg = av.filter((p) => p.grupo === "resolver").length;
    out.push({
      chave: `avisos|${hoje.slice(0, 7)}`,
      sala: "diretoria",
      tipo: "analise",
      titulo: `${av.length} avisos abertos no Início`,
      viu: `${av.length} avisos (${urg} urgente${urg === 1 ? "" : "s"}) esperando decisão.`,
      porque: "Com tanto aviso junto fica difícil saber por onde começar, e o importante se perde.",
      responderia: "A ordem do que fazer primeiro e o que pode esperar ou ser ignorado.",
      ganho: "Menos tempo decidindo e nada urgente esquecido.",
    });
  }
  // 5) EXPANSÃO — produção perto do limite (horas de impressão pedidas × horas da farm)
  const ativas = (impressoras || []).filter((i) => i.ativa !== false).length;
  const horasDia = num(farmConfig?.horas_dia_operacao) || 8;
  if (ativas > 0) {
    const pecas = new Map();
    for (const p of pedidos || []) {
      if (!p.valido || !p.item) continue;
      const d = String(p.data).slice(0, 10);
      if (d < d14 || d > hoje) continue;
      const it = p.item;
      if (it.id.startsWith("k:")) for (const c of it.componentes || []) pecas.set(c.produtoId, (pecas.get(c.produtoId) || 0) + num(c.quantidade) * num(p.q));
      else {
        const pid = it.id.startsWith("p:") ? it.id.slice(2) : it.produtoId;
        if (pid) pecas.set(pid, (pecas.get(pid) || 0) + num(it.pecas || it.quantidade || 1) * num(p.q));
      }
    }
    let minutos = 0;
    for (const [pid, n] of pecas) {
      const pr = produtos.find((x) => x.id === pid);
      if (!pr || pr.producao_detalhe?.sem3d) continue;
      const min = num(pr.tempo_impressao_horas) > 0 ? num(pr.tempo_impressao_horas) * 60 : num(pr.producao_detalhe?.tempo);
      minutos += (min / Math.max(1, num(pr.pecas_por_impressao) || 1)) * n;
    }
    const pedidasDia = minutos / 60 / 14;
    const capDia = ativas * horasDia;
    const uso = capDia > 0 ? pedidasDia / capDia : 0;
    if (uso >= REGRAS.producaoCheia) {
      out.push({
        chave: `expansao-producao|${hoje.slice(0, 7)}`,
        sala: "producao",
        tipo: "expansao",
        cheia: true,
        titulo: uso >= 1 ? "Produção acima da capacidade — hora de expandir?" : "Produção perto do limite — vale expandir?",
        viu: `Nos últimos 14 dias as vendas pediram ~${pedidasDia.toFixed(1).replace(".", ",")} h de impressão por dia; a farm tem ${capDia} h (${ativas} impressora${ativas === 1 ? "" : "s"} × ${horasDia} h) — ${pct(uso)} ocupada.`,
        porque: "Acima de 80%, qualquer falha de impressão ou pico de venda (campanha, Natal) já atrasa pedido — e atraso derruba a avaliação.",
        responderia: "Se vale mais uma impressora, mais horas por dia ou deixar prontos os mais vendidos — e em quantos meses a impressora nova se paga.",
        ganho: "Não perder venda nem avaliação por atraso de envio.",
      });
    }
  }
  // 6) EXPANSÃO — expedição crescendo rápido (pedidos/dia)
  const ped14 = somaPedidos(pedidos, d14, hoje).pedidos / 14;
  const pedAnt = somaPedidos(pedidos, d28, somarDias(d14, -1)).pedidos / 14;
  if (ped14 >= REGRAS.expedicaoPedidosDia && (pedAnt === 0 || ped14 >= pedAnt * REGRAS.expedicaoCrescimento)) {
    const horas = (ped14 * REGRAS.minPorPedido) / 60;
    out.push({
      chave: `expansao-expedicao|${hoje.slice(0, 7)}`,
      sala: "estoque",
      tipo: "expansao",
      cheia: true,
      titulo: "Expedição ficando apertada — organizar o espaço?",
      viu: `${ped14.toFixed(1).replace(".", ",")} pedidos por dia nas últimas 2 semanas${pedAnt ? ` (antes ${pedAnt.toFixed(1).replace(".", ",")})` : ""}.`,
      porque: `Só embalar e postar já toma ~${horas.toFixed(1).replace(".", ",")} h por dia (estimando ${REGRAS.minPorPedido} min por pedido) — o espaço e o material precisam acompanhar.`,
      responderia: "Como organizar a bancada de embalagem, quanto ter de caixa/etiqueta em estoque e se vale ajuda nos dias de pico.",
      ganho: "Postar no prazo e não deixar pedido parado.",
    });
  }
  return out;
}

// Decisão gravada → a sugestão aparece? (agora-nao: 14 dias — ou mais, se ele
// sempre adia esse assunto (`espera`, de consultorAprende.js); levada/resolvida: 30 dias; nunca: não volta)
export function consultoriaVisivel(sug, registro, hoje, espera = 14) {
  if (!registro) return true;
  const st = registro.status;
  if (st === "nunca" || st === "quero") return false;
  const desde = String(registro.atualizado_em || registro.criado_em || "").slice(0, 10);
  const dias = desde ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86400000) : 999;
  if (st === "agora-nao") return dias >= espera;
  if (st === "aprovada") return dias >= 7;
  if (st === "levada" || st === "resolvida") return dias >= 30;
  return true;
}

// ---------- pacote "Levar pro Claude" ----------
// O "o que vi" fica GRAVADO no dia em que ele aprovou (26/10/2026, Gustavo:
// "esses números são de quando sugeriu ou se atualizam?") — o pacote mostra a
// data deles e, embaixo, o mesmo assunto com os números de HOJE (`atuais` =
// sugestões calculadas agora; sumiu = o problema não aparece mais).
const quandoAprovou = (r) => {
  const h = (Array.isArray(r.dados?.historico) ? r.dados.historico : []).filter((x) => x.status === "quero" || x.status === "aprovada");
  return h.length ? h[h.length - 1].data : String(r.atualizado_em || r.criado_em || "").slice(0, 10);
};
export function montarPacote({ nomeLoja, hoje, perguntas, consultorias, erros, uso, kpis, aprendizado = [], opinioes = [], atuais = null }) {
  const l = [];
  l.push(`# Consultor da Sede — ${nomeLoja} — ${dm(hoje)}/${hoje.slice(0, 4)}`);
  if (kpis) l.push(`Mês até hoje: vendas ${BRL(kpis.vendas || 0)} · lucro depois do Ads ${BRL(kpis.depoisAds || 0)}${kpis.liquido != null ? ` · sobrou pra você (depois das contas fixas) ${BRL(kpis.liquido)}` : ""} · caixa ${kpis.caixa != null ? BRL(kpis.caixa) : "—"}${kpis.meta ? ` · meta ${BRL(kpis.meta)}` : ""}`);
  if (perguntas.length) {
    l.push("", "## Perguntas que eu não soube responder");
    for (const p of perguntas) {
      l.push(`- (${dm(String(p.criado_em).slice(0, 10))}, na tela ${ROTULOS_ABA[p.dados?.tela] || p.dados?.tela || "?"}) ${p.dados?.texto}`);
      if (p.dados?.numeros) l.push(`  números do momento: ${JSON.stringify(p.dados.numeros, (k, x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x))}`);
    }
  }
  if (opinioes.length) {
    l.push("", "## Respostas minhas pra você validar (não viraram regra)");
    for (const o of opinioes) l.push(`- (${dm(String(o.criado_em).slice(0, 10))}) pergunta: ${o.dados?.texto}`, `  minha resposta: ${o.dados?.opiniao}`);
  }
  if (consultorias.length) {
    l.push("", "## Consultorias, propostas e ideias aprovadas");
    for (const c of consultorias) {
      const em = quandoAprovou(c);
      l.push(`- ${c.dados?.titulo}${c.dados?.credito ? ` (💡 ${c.dados.credito})` : ""}`, `  o que vi${em ? ` (números de ${dm(em)}, quando aprovou)` : ""}: ${c.dados?.viu}`);
      if (atuais) {
        const agora = atuais.find((x) => x.chave === c.chave);
        // Ideias guardam o "o que vi" em `porque` (29/10/2026: saía "— undefined").
        const viuAgora = agora ? agora.viu ?? agora.porque : null;
        if (agora && viuAgora && viuAgora !== c.dados?.viu) l.push(`  hoje (${dm(hoje)}): ${viuAgora}`);
        else if (agora) l.push(`  hoje (${dm(hoje)}): continua igual`);
        else if (!agora && !/\|\d{4}-\d{2}$/.test(c.chave)) l.push(`  hoje (${dm(hoje)}): não aparece mais — ${String(c.chave).startsWith("lancar|") ? "o nº 1 ficou abaixo de 50% do lucro (não quer dizer que um produto novo foi lançado)" : "o que gerou essa sugestão sumiu"}`);
      }
      l.push(`  por que agora: ${c.dados?.porque}`, `  o que a análise deve responder: ${c.dados?.responderia}`);
    }
  }
  if (erros.length) {
    l.push("", "## Erros do app (últimos 14 dias)");
    for (const e of erros) l.push(`- ${e.dados?.vezes || 1}× · tela ${ROTULOS_ABA[e.dados?.tela] || e.dados?.tela || "?"} · último ${String(e.dados?.ultima || e.atualizado_em || "").slice(0, 16).replace("T", " ")} · ${e.dados?.msg}`);
  }
  if (uso.length) {
    l.push("", "## Uso das telas (últimos 30 dias)");
    l.push(uso.slice(0, 15).map((u) => `${u.rotulo} ${u.n}×`).join(" · "));
  }
  if (aprendizado.length) l.push("", "## O que o consultor aprendeu (suas decisões e resultados)", ...aprendizado);
  if (!perguntas.length && !consultorias.length && !erros.length) l.push("", "(nada novo — só o resumo de uso)");
  return l.join("\n");
}

// Uso por tela somado (registros tipo 'uso', chave 'AAAA-MM-DD|tela').
export function resumoUso(registros, de) {
  const m = new Map();
  for (const r of registros || []) {
    if (r.tipo !== "uso") continue;
    const [d, tela] = String(r.chave).split("|");
    if (de && d < de) continue;
    m.set(tela, (m.get(tela) || 0) + num(r.dados?.n));
  }
  return [...m.entries()].map(([tela, n]) => ({ tela, rotulo: ROTULOS_ABA[tela] || tela, n })).sort((a, b) => b.n - a.n);
}

// Senha do nível app (comparada pelo hash; é uma trava contra curiosos, não segurança forte).
export const HASH_SENHA_APP = "4561b3d5989562a601c13f5a488b001797b8baf776431c9c7c1cb1a3e62ff4f2";
export async function conferirSenhaApp(senha) {
  if (!globalThis.crypto?.subtle) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(senha || "").trim()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === HASH_SENHA_APP;
}

// ---------- propostas da equipe (os setores conversam entre si) ----------
// Cada aviso do Início vira uma conversa entre quem cuida do assunto e quem
// precisa saber, com uma PROPOSTA de solução que o Gustavo aprova ou não.
// fala/resposta são curtas (balão na Sede); `proposta` é o texto completo.
export const CONVERSAS = [
  { prefixo: "caixa|atrasados", de: "bia", para: "ceo1", fala: "Tem conta atrasada!", resposta: "Vejo isso hoje", proposta: "Pagar (ou confirmar que já pagou) as contas atrasadas no Caixa — multa e juros correm todo dia." },
  { prefixo: "caixa|proximos", de: "bia", para: "ceo2", fala: "Contas da semana chegando", resposta: "Já separo", proposta: "Conferir se o caixa cobre as contas dos próximos 7 dias." },
  { prefixo: "analise|importar", de: "ze", para: "celia", fala: "Tem pedido novo na Olist!", resposta: "Importa que eu analiso", proposta: "Importar os pedidos da Olist — sem eles vendas, lucro e rampa ficam desatualizados." },
  { prefixo: "analise|avaliacoes", de: "ze", para: "nina", fala: "Chegaram avaliações?", resposta: "Vou conferir", proposta: "Atualizar as avaliações dos anúncios que venderam — a rampa usa a nota pra decidir." },
  { prefixo: "ads|andamento", de: "leo", para: "celia", fala: "O CSV do Ads atrasou", resposta: "Sem ele não meço o ROAS", proposta: "Enviar o CSV do Shopee Ads (atalho “Ontem”) pra medir o retorno de hoje." },
  { prefixo: "ads|recarregar", de: "leo", para: "bia", fala: "Saldo de Ads acabando", resposta: "Separo a recarga", proposta: "Recarregar o Ads na Shopee e lançar como recarga no Caixa." },
  { prefixo: "ads|teto", de: "bia", para: "leo", fala: "Ads passou do teto", resposta: "Vou rever as campanhas", proposta: "Rever as campanhas que menos retornam até voltar pro teto do mês." },
  { prefixo: "farm-manut|", de: "teo", para: "bia", fala: "Impressora pede manutenção", resposta: "A reserva cobre", proposta: "Fazer a manutenção da lista (Minha farm) — parar a impressora ~1 h evita falha de impressão." },
  { prefixo: "farm|custo", de: "teo", para: "rafa", fala: "O custo da farm subiu", resposta: "Reviso os preços", proposta: "Revisar os produtos que ficaram abaixo do mínimo com o custo novo (ajustar pela promo)." },
  { prefixo: "prejuizo|", de: "rafa", para: "ceo1", fala: "Produto dando prejuízo!", resposta: "Me mostra o preço", proposta: "Rever o preço desse produto em Produtos precificados — cada venda hoje perde dinheiro." },
  { prefixo: "anunciar|", de: "rafa", para: "nina", fala: "Preço mudou no anúncio", resposta: "Já digito a promo", proposta: "Atualizar a promo do anúncio no marketplace (o preço original fica fixo)." },
  { prefixo: "subir|", de: "nina", para: "rafa", fala: "Pronto pra subir degrau!", resposta: "Confere o lucro novo", proposta: "Subir o degrau da rampa — os portões já foram cumpridos." },
  { prefixo: "revisar|", de: "nina", para: "celia", fala: "Anúncio precisa de revisão", resposta: "Te mando o funil", proposta: "Revisar o anúncio começando pelo item que o funil apontou." },
];

export function propostasDaEquipe({ pendencias = [], pedidos = [], hoje, produtos = [], kits = [], impressoras = [] }) {
  const out = [];
  const vistos = new Set();
  for (const p of pendencias) {
    if (p.tarefa) continue;
    const c = CONVERSAS.find((x) => String(p.id).startsWith(x.prefixo));
    if (!c || vistos.has(c.prefixo)) continue; // uma conversa por assunto
    vistos.add(c.prefixo);
    out.push({ chave: `proposta|${p.id}`, de: c.de, para: c.para, fala: c.fala, resposta: c.resposta, titulo: p.titulo, proposta: c.proposta, ir: p.ir || null, rotulo: p.rotulo || "Abrir", urgente: p.grupo === "resolver" });
  }
  // Comercial → Produção: um produto vendendo bem acima do normal
  const nomeDe = (k) => (k.startsWith("p:") ? produtos.find((x) => x.id === k.slice(2))?.nome : kits.find((x) => x.id === k.slice(2))?.nome);
  const d7 = somarDias(hoje, -6);
  const sem = new Map(porProduto(pedidos, d7, hoje, nomeDe).map((g) => [g.chave, g]));
  const antes = new Map(porProduto(pedidos, somarDias(hoje, -27), somarDias(d7, -1), nomeDe).map((g) => [g.chave, g]));
  let acel = null;
  for (const [k, g] of sem) {
    const mediaSemana = (antes.get(k)?.unidades || 0) / 3;
    if (g.unidades >= 4 && g.unidades >= mediaSemana * 2 && (!acel || g.unidades > acel.g.unidades)) acel = { g, mediaSemana };
  }
  if (acel && (impressoras || []).length) {
    const porDia = acel.g.unidades / 7;
    const prontos = Math.max(2, Math.ceil(porDia * 3));
    out.unshift({
      chave: `proposta|acelerando|${acel.g.chave}`,
      de: "nina",
      para: "teo",
      fala: `${String(acel.g.nome).split(" ").slice(0, 2).join(" ")} vendendo muito!`,
      resposta: `Deixo ${prontos} prontos`,
      titulo: `${acel.g.nome}: ${acel.g.unidades} un. em 7 dias (antes ~${Math.round(acel.mediaSemana)}/semana)`,
      proposta: `Deixar ~${prontos} prontos (3 dias de venda no ritmo de agora) pra não atrasar envio.`,
      ir: { aba: "analise", pedido: { sub: "xyz" } },
      rotulo: "Ver estoque sugerido",
    });
  }
  return out.slice(0, 6);
}
