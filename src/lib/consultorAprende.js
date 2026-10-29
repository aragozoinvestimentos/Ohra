// O consultor aprende (24/10/2026, pedido do Gustavo: "ele deve sempre
// evoluir"). Sem IA: aprende guardando o que acontece e usando da próxima vez.
//  1) respostas do Claude (e as que o Gustavo ensina) → responde perguntas
//     parecidas sozinho;
//  2) decisões do Gustavo por assunto → traz menos o que ele sempre adia e
//     põe na frente o que ele costuma aprovar;
//  3) resultado do que foi aprovado → o aviso sumiu ou continuou;
//  4) novidades do app → cada mudança que fazemos entra em NOVIDADES_CONSULTOR.
// Tudo puro; gravações em consultorAcoes.js (tabela consultor_registros, v65).
import { CONVERSAS, normalizar } from "./consultor.js";

const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// ---------- 1) respostas aprendidas ----------
const VAZIAS = new Set(
  "que qual quais como com sem pra para por uma uns umas dos das nos nas meu minha meus minhas esse essa isso este esta isto aqui tem ter foi sao ser estou voce voces quando onde ate the and".split(" ")
);
export function palavras(t) {
  return [...new Set(normalizar(t).split(" ").filter((w) => w.length >= 3 && !VAZIAS.has(w)))];
}
// Resposta VALIDADA (do Claude) × OPINIÃO do Gustavo (24/10/2026, pedido dele:
// "a minha resposta não é regra, é levada em consideração; tudo precisa ser
// validado com o Claude"). Opinião = pergunta com dados.opiniao, status
// "a-validar"; vira resposta só quando a validação do Claude é guardada
// (dados.resposta + dados.validada).
export const ehOpiniaoPendente = (r) => r?.tipo === "pergunta" && !!r.dados?.opiniao && !r.dados?.validada;
const ehRespostaValida = (r) => r?.tipo === "pergunta" && !!r.dados?.resposta && !ehOpiniaoPendente(r);
function parecida(pergunta, texto) {
  const a = palavras(pergunta);
  const b = palavras(texto);
  if (!a.length || !b.length) return 0;
  if (normalizar(pergunta) === normalizar(texto)) return 1;
  const comum = a.filter((w) => b.includes(w)).length;
  const score = comum / new Set([...a, ...b]).size;
  return comum >= Math.min(2, b.length) && score >= 0.6 ? score : 0;
}
/** Opinião sua (ainda não validada) sobre uma pergunta parecida — só contexto, nunca a resposta. */
export function opiniaoSobre(pergunta, registros) {
  let melhor = null;
  for (const r of registros || []) {
    if (!ehOpiniaoPendente(r)) continue;
    const sc = parecida(pergunta, r.dados.texto);
    if (sc && (!melhor || sc > melhor.score)) melhor = { registro: r, texto: r.dados.texto, opiniao: r.dados.opiniao, data: String(r.criado_em || "").slice(0, 10), score: sc };
  }
  return melhor;
}

/** Resposta VALIDADA pra uma pergunta parecida (≥ 60% das palavras em comum e ao menos 2). */
export function respostaAprendida(pergunta, registros) {
  const a = palavras(pergunta);
  if (!a.length) return null;
  let melhor = null;
  for (const r of registros || []) {
    if (!ehRespostaValida(r)) continue;
    const b = palavras(r.dados.texto);
    const comum = a.filter((w) => b.includes(w)).length;
    const uniao = new Set([...a, ...b]).size;
    const score = uniao ? comum / uniao : 0;
    const igual = normalizar(pergunta) === normalizar(r.dados.texto);
    if ((igual || (comum >= Math.min(2, b.length) && score >= 0.6)) && (!melhor || score > melhor.score)) {
      melhor = { id: r.id, registro: r, texto: r.dados.texto, resposta: r.dados.resposta, ensinada: !!r.dados.ensinada, data: String(r.atualizado_em || r.criado_em || "").slice(0, 10), score: igual ? 1 : score };
    }
  }
  return melhor;
}
/** Perguntas aprendidas mais usadas — viram atalhos embaixo do campo. */
export function perguntasAprendidas(registros, n = 3) {
  return (registros || [])
    .filter(ehRespostaValida)
    .sort((x, y) => (Number(y.dados?.usos) || 0) - (Number(x.dados?.usos) || 0))
    .slice(0, n)
    .map((r) => r.dados.texto);
}

// ---------- 2) decisões por assunto ----------
const ROTULOS = {
  queda: "vendas de um produto caindo",
  concentracao: "loja dependendo de um produto",
  lancar: "lançar produto novo (o nº 1 é de época)",
  "ads-pesado": "Ads pesando no lucro",
  avisos: "muitos avisos acumulados",
  "expansao-producao": "expansão da produção",
  "expansao-expedicao": "expansão da expedição",
  "proposta:acelerando": "produto vendendo acima do normal",
  "ideia:kit-juntos": "ideia: montar kit do que é comprado junto",
  "ideia:capa-variacao": "ideia: opção mais vendida como capa",
  "ideia:dia-forte": "ideia: deixar pronto na véspera do dia forte",
  "ideia:ads-organico": "ideia: testar Ads no que vende sozinho",
};
/** Assunto de uma consultoria/proposta pela chave (várias chaves → um assunto). */
export function assuntoDe(chave) {
  const c = String(chave || "");
  if (c.startsWith("proposta|acelerando|")) return "proposta:acelerando";
  if (c.startsWith("ideia|")) return `ideia:${c.split("|")[1]}`;
  if (c.startsWith("proposta|")) {
    const id = c.slice(9);
    const conv = CONVERSAS.find((x) => id.startsWith(x.prefixo));
    return `proposta:${conv ? conv.prefixo.replace(/\|$/, "") : id.split("|")[0]}`;
  }
  return c.split("|")[0];
}
export function rotuloAssunto(assunto) {
  if (ROTULOS[assunto]) return ROTULOS[assunto];
  const conv = CONVERSAS.find((x) => `proposta:${x.prefixo.replace(/\|$/, "")}` === assunto);
  return conv ? conv.fala.replace(/!$/, "").toLowerCase() : assunto;
}
const SIM = new Set(["quero", "aprovada", "levada", "resolvida"]);
/** Histórico de decisões de um registro (antes do aprendizado só havia o status atual). */
const historicoDe = (r) => (Array.isArray(r.dados?.historico) && r.dados.historico.length ? r.dados.historico : r.status ? [{ status: r.status, data: String(r.atualizado_em || r.criado_em || "").slice(0, 10) }] : []);

/** { assunto: { sim, depois, nunca, resolveu, continuou, total } } */
export function perfilDecisoes(registros) {
  const p = {};
  for (const r of registros || []) {
    if (r.tipo !== "consultoria") continue;
    const a = assuntoDe(r.chave);
    const x = (p[a] ||= { sim: 0, depois: 0, nunca: 0, resolveu: 0, continuou: 0, total: 0 });
    for (const h of historicoDe(r)) {
      if (SIM.has(h.status)) x.sim++;
      else if (h.status === "agora-nao") x.depois++;
      else if (h.status === "nunca") x.nunca++;
      else continue;
      x.total++;
    }
    for (const res of Array.isArray(r.dados?.resultados) ? r.dados.resultados : []) {
      if (res.status === "resolveu") x.resolveu++;
      else if (res.status === "continuou") x.continuou++;
    }
  }
  return p;
}
/** "Agora não": quanto tempo esperar antes de trazer de novo (o que ele sempre adia volta menos). */
export function esperaAgoraNao(perf) {
  if (!perf || perf.sim > 0) return 14;
  if (perf.depois >= 4) return 45;
  if (perf.depois >= 2) return 28;
  return 14;
}
/** Frase do que o consultor aprendeu sobre esse assunto (null = ainda pouco). */
export function notaDoPerfil(perf) {
  if (!perf) return null;
  const partes = [];
  if (perf.total >= 2) {
    if (perf.sim / perf.total >= 0.6) partes.push(`você costuma aprovar isso (${perf.sim} de ${perf.total})`);
    else if (perf.sim === 0 && perf.depois >= 2) partes.push(`você costuma deixar pra depois (${perf.depois}×) — vou trazer com menos frequência`);
  }
  const res = perf.resolveu + perf.continuou;
  if (res) partes.push(`das ${res} vez${res === 1 ? "" : "es"} que você agiu, ${perf.resolveu} resolve${perf.resolveu === 1 ? "u" : "ram"}`);
  return partes.length ? partes.join(" · ") : null;
}
/** Ordem: urgente primeiro, depois o que ele mais aprova; o que ele sempre adia vai pro fim. */
export function ordenarPeloPerfil(lista, perfil) {
  const nota = (x) => {
    const p = perfil[assuntoDe(x.chave)];
    const base = p ? p.sim - p.depois * 0.5 - p.nunca + (p.resolveu - p.continuou) * 0.5 : 0;
    return (x.urgente ? 100 : 0) + base;
  };
  return lista
    .map((x, i) => ({ x, i, n: nota(x) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((o) => o.x);
}
/** Nova decisão → status + histórico (o histórico é o que ensina). */
export function dadosComDecisao(dadosAntes, status, hoje) {
  const historico = [...(Array.isArray(dadosAntes?.historico) ? dadosAntes.historico : []), { status, data: hoje }].slice(-30);
  const novo = { ...(dadosAntes || {}), historico };
  if (SIM.has(status)) novo.acompanhar = { desde: hoje }; // passa a medir o resultado
  return novo;
}

// ---------- 3) resultado do que foi aprovado ----------
// Aprovou → o app acompanha: se o assunto sumiu dos avisos em até 14 dias,
// "resolveu"; se continua depois de 14 dias, "continuou". Grava uma vez só.
const COM_MES = /\|\d{4}-\d{2}$/;
export function resultadosParaGravar(registros, atuais, hoje) {
  const chaves = new Set(atuais.map((x) => x.chave));
  const assuntos = new Set(atuais.map((x) => assuntoDe(x.chave)));
  const out = [];
  for (const r of registros || []) {
    if (r.tipo !== "consultoria" || !r.dados?.acompanhar?.desde) continue;
    // "Lançar produto novo" some quando o nº 1 cai abaixo de 50% do lucro — isso não
    // quer dizer que um produto novo foi lançado (29/10/2026): não vira "resolveu" sozinho.
    if (String(r.chave).startsWith("lancar|")) continue;
    const desde = r.dados.acompanhar.desde;
    const dias = diasEntre(desde, hoje);
    if (dias < 2) continue;
    const presente = chaves.has(r.chave) || (COM_MES.test(r.chave) && assuntos.has(assuntoDe(r.chave)));
    let status = null;
    if (!presente) status = "resolveu";
    else if (dias >= 14) status = "continuou";
    if (!status) continue;
    const resultados = [...(Array.isArray(r.dados.resultados) ? r.dados.resultados : []), { status, desde, em: hoje, dias }].slice(-20);
    const { acompanhar: _fora, ...resto } = r.dados;
    out.push({ registro: r, dados: { ...resto, resultados } });
  }
  return out;
}
/** Último resultado de um assunto, pra mostrar no cartão quando ele volta. */
export function ultimoResultado(registros, assunto) {
  let u = null;
  for (const r of registros || []) {
    if (r.tipo !== "consultoria" || assuntoDe(r.chave) !== assunto) continue;
    for (const res of r.dados?.resultados || []) if (!u || res.em > u.em) u = res;
  }
  if (!u) return null;
  return u.status === "resolveu"
    ? `da última vez (aprovada em ${dm(u.desde)}) o aviso sumiu em ${u.dias} dia${u.dias === 1 ? "" : "s"}`
    : `da última vez (aprovada em ${dm(u.desde)}) o aviso continuou depois de ${u.dias} dias — talvez precise de outra solução`;
}

// ---------- resumo pro "Levar pro Claude" e pra aba Aprendi ----------
export function resumoAprendizado(registros) {
  const perf = perfilDecisoes(registros);
  const assuntos = Object.entries(perf)
    .filter(([, p]) => p.total || p.resolveu || p.continuou)
    .map(([a, p]) => ({ assunto: a, rotulo: rotuloAssunto(a), ...p, nota: notaDoPerfil(p), espera: esperaAgoraNao(p) }))
    .sort((a, b) => b.total - a.total);
  const respostas = (registros || []).filter(ehRespostaValida);
  const opinioes = (registros || []).filter(ehOpiniaoPendente);
  return { assuntos, respostas: respostas.length, ensinadas: respostas.filter((r) => r.dados.opiniao).length, opinioes: opinioes.length, usos: respostas.reduce((s, r) => s + (Number(r.dados.usos) || 0), 0), placar: placarIdeias(registros) };
}
export function linhasAprendizado(registros) {
  const r = resumoAprendizado(registros);
  const l = [];
  if (r.respostas) l.push(`Respostas validadas: ${r.respostas} (${r.ensinadas} começaram como opinião sua) · usadas ${r.usos}×`);
  if (r.opinioes) l.push(`Opiniões suas ainda sem a validação do Claude guardada: ${r.opinioes} (as que já foram levadas não se repetem aqui — guarde a validação na aba Aprendi)`);
  for (const p of r.placar) l.push(`- 💡 ideias de ${p.de}: ${p.total} · aprovadas ${p.sim} · deram certo ${p.resolveu}`);
  for (const a of r.assuntos.slice(0, 12)) l.push(`- ${a.rotulo}: aprovou ${a.sim} · adiou ${a.depois} · nunca ${a.nunca}${a.resolveu + a.continuou ? ` · resolveu ${a.resolveu}/${a.resolveu + a.continuou}` : ""}`);
  return l;
}

/** Placar das ideias por funcionário (crédito): total, aprovadas, deram certo. */
export function placarIdeias(registros) {
  const m = new Map();
  for (const r of registros || []) {
    if (r.tipo !== "consultoria" || !String(r.chave).startsWith("ideia|") || !r.dados?.de) continue;
    const x = m.get(r.dados.de) || { de: r.dados.de, total: 0, sim: 0, resolveu: 0 };
    x.total++;
    if (historicoDe(r).some((h) => SIM.has(h.status))) x.sim++;
    x.resolveu += (r.dados.resultados || []).filter((res) => res.status === "resolveu").length;
    m.set(r.dados.de, x);
  }
  return [...m.values()].sort((a, b) => b.sim - a.sim || b.total - a.total);
}

// ---------- 4) o que o consultor aprendeu com as mudanças do app ----------
// REGRA (CLAUDE.md): toda tela, ajuste ou regra nova entra aqui e, quando der,
// nas perguntas (responderPergunta), consultorias e conversas da equipe.
export const NOVIDADES_CONSULTOR = [
  { data: "2026-10-29", texto: "Produto de revenda na Página do produto: o passo 2 virou \"Custo de compra\" (média das notas ou o custo digitado) — não pede mais detalhamento de produção nem mostra \"Simular custo\"." },
  { data: "2026-10-29", texto: "No pacote pro Claude: as ideias da equipe mostram o número de hoje (antes saía \"undefined\"), e \"lançar produto novo\" não conta mais como resolvido só porque o nº 1 caiu abaixo de 50% do lucro." },
  { data: "2026-10-29", texto: "Reserva de produção: agora mostro ao lado o caixa da loja hoje e quanto fica livre. Separar na reserva não tira dinheiro da conta — só marca a parte que é pra repor a produção." },
  { data: "2026-10-29", texto: "Afiliados, parte 2: cada anúncio pode ter um % próprio (substitui o da loja, não soma); mostro quanto o afiliado ganha por venda, o máximo seguro de cada anúncio e o mínimo da Shopee (4%). Cada comissão vira um teste de 15 dias: se ninguém se afiliou, sugiro subir 1 ponto — só se ainda deixar metade do lucro. Afiliado nunca me faz sugerir mudar preço, mas prejuízo com afiliado aparece no Início. Pergunte “quais aguentam 5%?” ou “comissão máxima do <produto>”." },
  { data: "2026-10-29", texto: "Ads: o 1º dia que quase não gastou (menos de 30% do orçamento) não conta nos 3 dias, e no 3º dia eu só peço pra conferir à noite — a ordem de pausar e revisar vem com o dia fechado." },
  { data: "2026-10-29", texto: "Afiliados: agora é UMA comissão pra loja inteira (a da Shopee). Eu sugiro o % em que os produtos que mais vendem deixam pelo menos metade do lucro pra você — pelo preço de agora e com o cupom ativo —, mostro o teto e tenho um simulador. Dá pra montar proposta pra um afiliado específico, e o Leo acompanha se o afiliado dá lucro." },
  { data: "2026-10-29", texto: "Estoque: o produto só sai do estoque quando o pedido vira ENVIADO na Olist; pago e ainda não enviado fica em “a enviar” (continua na prateleira). Também controlo o estoque dos fabricados que você marcar “tenho estoque pronto” — cada impressão com sucesso pergunta se vai pro estoque." },
  { data: "2026-10-29", texto: "Dinheiro → Resultado junta o Resumo do mês, as vendas por produto e o Payoff. A tabela do faturamento ao lucro ficou com 8 linhas e o relatório do mês tem 2 folhas: quanto sobrou e por quê, depois canal, os 5 que mais deram lucro e as contas fixas. Devoluções aparecem à parte." },
  { data: "2026-10-29", texto: "Vender mais abre no Hoje: um cartão por anúncio juntando o que a Rampa, o Ads, os Afiliados e o cupom pedem. A Análise filtra por Fabricado ou Revenda, as Regras mostram o valor atual no título e Materiais/Embalagens foram pra Estoque e compras." },
  { data: "2026-10-28", texto: "Nota de compra: o produto novo já sai com SKU sugerido (a referência do fabricante, ex. RR2200), EAN, NCM, CFOP e se tem ICMS-ST/monofásico; antes de criar, mostro o produto parecido que você já tem. O que falta (peso, preço) fica em Estoque → Completar cadastro." },
  { data: "2026-10-28", texto: "Dinheiro → Fiscal: no MEI acompanho o limite do ano; no Simples calculo a alíquota efetiva pelos 12 meses e o DAS do mês separando o que tem ST e monofásico (pagam menos). É estimativa — confira com o contador." },
  { data: "2026-10-28", texto: "Resumo do mês ganhou a tabela “Do faturamento ao lucro”: faturamento cheio, descontos, taxas, impostos, custo, Ads, contas fixas e o lucro líquido — por mês, 3 meses, ano ou desde o início, com PDF e CSV." },
  { data: "2026-10-28", texto: "No cadastro de produto de revenda dá pra calcular o custo por unidade pelo total da compra (ex.: caixa com 24 por R$ 138 = R$ 5,75 cada), como já era em Embalagens e Materiais." },
  { data: "2026-10-28", texto: "Nota de compra também pelo PDF (DANFE), quando não tiver o XML — confira os valores antes de gravar. Preços salvos e Anúncios mostram no topo os avisos que geram a bolinha do menu, com “lembrar em 30 dias”, e o custo mudou tem “✓ visto”. Rampa em “não acompanhar” cala todos os avisos daquele anúncio." },
  { data: "2026-10-28", texto: "Cada setor (Financeiro, Comercial, Operação) tem uma nota da semana de 0 a 10, sempre mostrando de onde vem — contas em dia mas pagas do seu bolso não dão 10. A seta compara com a semana passada (precisa do SQL v68)." },
  { data: "2026-10-28", texto: "A equipe ganha estrelas com o que vocês aprovam (★ +1) e com o que dá certo (★ +3); quem junta o bastante fica pronto pra promoção — sempre aprovada por vocês na Sala de reunião, que também mostra a pauta, a opinião dos gerentes e o ranking do mês." },
  { data: "2026-10-28", texto: "A Sede tem agenda: às 9h faço a reunião do Bom dia na TV com os gerentes (ontem + as 3 coisas que mais valem dinheiro), segunda às 10h a reunião da semana, dia 1 o fechamento com a Bia, café, almoço em turnos, coleta às 16h e festa no último dia do mês. Clique na TV pra ver a ata." },
  { data: "2026-10-27", texto: "Sede nova em perspectiva: Diretoria só com os CEOs, sala própria do Gerente Geral (eu), Reunião, Live, Financeiro (Bia, Lia na Shopee, Kai no TikTok), Comercial, Operação (Téo, Ivo nas impressoras, Duda na expedição, Rui na revenda) e Recepção (Zé, copa e o pallet da coleta). Clique numa sala pra entrar nela." },
  { data: "2026-10-26", texto: "Caixa em carteiras: Conta da loja (banco — vendas físicas e orgânicas caem direto nela) e uma por marketplace. Na Shopee separo Liberado × A liberar × A caminho pelo Extrato do Meu Saldo (Atualizar dados); o saque vira transferência pra Conta da loja e não conta como venda nem gasto." },
  { data: "2026-10-26", texto: "O que vai pro Caixa pelas vendas importadas agora é o repasse de verdade da plataforma (pago − comissão − taxa fixa), conferido com a Minha Renda da Shopee. O imposto % do canal só desconta do lucro. Caixa mostra “A receber das plataformas” e Atualizar dados tem a conferência com a Minha Renda." },
  { data: "2026-10-26", texto: "Relatório de Ads com número real: lucro por venda dos pedidos pagos (com promo e cupom), vendas do CSV nunca acima dos pedidos pagos, “Sobrou depois do Ads”, situação de hoje (ligado/pausado/encerrado) e o que fazer. GMV Max da Loja entra pela média da loja." },
  { data: "2026-10-26", texto: "Queda de vendas que veio do Ads pausado não vira proposta de análise — era venda do Ads (o relatório de Ads mostra se ele se pagava)." },
  { data: "2026-10-26", texto: "Quando o produto nº 1 (≥ 50% do lucro) é de época, proponho começar a lançar um produto de ano todo, com a data limite (45 dias antes da data)." },
  { data: "2026-10-26", texto: "No “Levar pro Claude”, cada proposta aprovada mostra a data dos números (quando você aprovou) e, embaixo, os números de hoje." },
  { data: "2026-10-24", texto: "Revenda: produto comprado pronto. O custo vem da nota de compra (XML) e o estoque começa na 1ª nota — sai sozinho pelos pedidos da Olist. Aviso quando precisa repor." },
  { data: "2026-10-24", texto: "Impostos da loja: no MEI não há imposto por venda; acompanho o limite de faturamento do ano (3D + revenda)." },
  { data: "2026-10-24", texto: "Nasci na Sede: respondo vendas, lucro, Ads, meta, caixa, contas a pagar, produto pelo nome e o que fazer primeiro." },
  { data: "2026-10-24", texto: "Proponho consultorias (queda de vendas, dependência de um produto, Ads pesado, muitos avisos) e expansão da produção/expedição quando lota." },
  { data: "2026-10-24", texto: "A equipe conversa entre os setores e propõe soluções pra você aprovar." },
  { data: "2026-10-24", texto: "“Vale revisar o preço?” do Orgânico compara com o custo DO canal (embalagem do Orgânico) e tem o “✓ revisado, manter o preço”." },
  { data: "2026-10-24", texto: "Pedidos da Olist cobrem até a véspera do dia em que você subiu o arquivo — dia sem venda não aparece como “falta subir”." },
  { data: "2026-10-24", texto: "Entrego o backup de todas as lojas a cada 15 dias: aviso quando vence e você só clica em “Gerar e baixar”." },
  { data: "2026-10-24", texto: "Sua resposta é opinião, não regra: levo pro Claude validar e, até lá, mostro como contexto junto dos números." },
  { data: "2026-10-24", texto: "A equipe dá ideias (com o crédito de quem teve): kit do que é comprado junto, opção mais vendida como capa, dia forte de vendas e Ads no que vende sozinho." },
  { data: "2026-10-24", texto: "Todo dia dou o “Bom dia” com o dia de ontem — mas só depois de conferir se os arquivos de ontem foram enviados." },
  { data: "2026-10-24", texto: "As salas da Sede abrem sozinhas pelo que a loja tem (Produção, Estúdio de Live, Revenda) — e dá pra renomear as salas." },
  { data: "2026-10-24", texto: "Entrego relatórios prontos (Fechamento do mês, Ads do mês, Reunião da semana, Produtos parados) em PDF ou CSV — só no seu clique." },
  { data: "2026-10-24", texto: "O Início agora mostra no topo as 3 coisas que mais valem dinheiro hoje, um cartão por anúncio, e produto parado sem gastar nada saiu dos avisos." },
  { data: "2026-10-24", texto: "Aprendo sozinho: guardo as respostas do Claude (e as que você me ensina), o que você costuma aprovar ou adiar, e se o que foi aprovado resolveu." },
];
