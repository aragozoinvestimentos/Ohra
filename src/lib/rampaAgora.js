// "O que fazer agora" e "O que o app está olhando" da Rampa (out/2026, aprovado
// pela prévia). SÓ LÊ o que lib/rampa.js decidiu (estadoRampa): nenhuma regra
// nova aqui — é a forma de mostrar. Vale pro produto e pro anúncio com vários
// itens (a mesma estadoRampa). Os botões são escolhidos pela tela.
import { CHECKLIST_ANUNCIO } from "./rampa.js";
import { estadoSugestaoRampa } from "./estados.js";

const BRL = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`;
const somar = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const passoDoChecklist = (k) => {
  const c = CHECKLIST_ANUNCIO.find((x) => x[0] === k);
  return c ? { texto: c[1], dica: c[2] } : null;
};

/** Quando o app reavalia: a próxima semana fecha 7 dias depois da última
 * (semanas automáticas, pelos pedidos importados — lib/semanasAuto.js). */
export function proximaConferencia(e, { ultimo = null } = {}) {
  const base = ultimo || e.registros?.filter((r) => ["semana", "inicio", "subida", "descida"].includes(r.tipo)).map((r) => String(r.data).slice(0, 10)).sort().pop();
  return base ? { texto: `Semana fecha em ${dm(somar(base, 7))} (com os pedidos importados)`, data: somar(base, 7) } : { texto: "1ª semana fecha 7 dias depois do início" };
}

/**
 * Uma ação só pra rampa: { tipo (resolver|atencao|oportunidade|decisao|info),
 * rotulo, titulo, porque, passos: [{texto, dica}], acao: chave do botão
 * principal (subir|subir2|voltar|descer|testar-acima|aprovar|voltar-alvo|
 * anuncio|teste|plano|null), botao, depois }.
 * opcoes.grupo = anúncio com vários itens (sem "testar acima").
 */
export function acaoDaRampa(e, { canal = "", grupo = false, checklist = {}, pctDe = null } = {}) {
  const sg = e.sugestao || {};
  const tipo = estadoSugestaoRampa(e) || "info";
  const ROT = { resolver: "Resolver agora", atencao: "Atenção", oportunidade: "Oportunidade — mais lucro", decisao: "Decisão sua em andamento", info: "Nada a fazer agora" };
  const base = (o) => ({ tipo, rotulo: ROT[o.tipo || tipo], passos: [], ...o });
  const promo = { texto: `Trocar a promo na ${canal || "plataforma"}`, dica: grupo ? "Anunciar mostra o ↻ em cada opção (o preço original fica fixo)" : "Anunciar mostra o ↻ com a promo nova (o preço original fica fixo)" };
  // Anúncio com vários itens: os degraus do estado são "preço do anúncio" (ticket) — mostra em % do salvo.
  const paraPreco = (v) => (grupo ? `${String(Math.round((pctDe ? pctDe(v) : v) * 10) / 10).replace(".", ",")}%` : BRL(v));

  if (sg.chave === "subir") {
    const dois = sg.saltos === 2;
    const novo = dois ? e.degraus[e.i + 2] : e.proximo;
    return base({
      tipo: "oportunidade",
      titulo: dois ? `Vendendo muito: subir 2 degraus, pra ${paraPreco(novo)}` : `Pronto pra subir pra ${paraPreco(novo)}`,
      porque:
        (sg.peloRitmo ? "Vendendo rápido no 1º degrau. " : e.portoesOk ? "Todos os portões ✓. " : "") +
        (e.podePerder != null ? `Lucro por venda ${BRL(e.lucroAtual)} → ${BRL(e.lucroEm(novo))}: pode vender até ${Math.floor(e.podePerder * 100)}% menos e ganhar o mesmo.` : "Mais lucro por venda no degrau seguinte."),
      passos: [{ texto: "Subir na Rampa", dica: "o app grava a subida e o novo degrau" }, promo],
      acao: dois ? "subir2" : "subir",
      botao: dois ? `↑↑ Subir 2 (pra ${paraPreco(novo)})` : `↑ Subir pra ${paraPreco(novo)}`,
      depois: "Depois de subir: troque a promo em Anunciar e não mexa no Ads nesta semana.",
    });
  }
  if (sg.chave === "testar-acima" && !grupo)
    return base({
      tipo: "oportunidade",
      titulo: `Dá pra testar acima do alvo: ${BRL(e.acima?.prox)}`,
      porque: `No alvo há semanas estáveis, nota ok. Lucro por venda ${BRL(e.acima?.lucroAgora)} → ${BRL(e.acima?.lucroProx)}${e.acima?.podePerder != null ? ` — dá pra perder até ${Math.floor(e.acima.podePerder * 100)}% das vendas e lucrar o mesmo` : ""}.`,
      passos: [{ texto: "Testar o preço novo por alguns dias", dica: "o preço salvo não muda durante o teste" }, promo],
      acao: "testar-acima",
      botao: `Testar ${BRL(e.acima?.prox)}`,
    });
  if (sg.chave === "acima-aprovado")
    return base({ tipo: "oportunidade", titulo: `Teste aprovado: ${BRL(e.preco)} lucra mais que o alvo`, porque: "Atualize o preço salvo — ele vira o novo alvo.", acao: "aprovar", botao: `Atualizar preço salvo pra ${BRL(e.preco)}` });
  if (sg.chave === "acima-voltar")
    return base({ tipo: "atencao", titulo: "Voltar ao alvo", porque: `O teste a ${BRL(e.preco)} lucrou menos que no alvo (${BRL(e.alvo)}).`, passos: [promo], acao: "voltar-alvo", botao: "Voltar ao alvo" });
  if (sg.chave === "voltar")
    return base({
      tipo: "atencao",
      titulo: "Voltar degrau",
      porque: e.sazonal ? "O ritmo de vendas caiu mais da metade depois de subir." : "O preço novo derrubou o lucro da semana (ou as vendas) por 2 semanas — o degrau anterior rendia mais.",
      passos: [{ texto: "Voltar na Rampa", dica: "depois de voltar, o degrau fica 14 dias parado" }, promo],
      acao: "voltar",
      botao: "↓ Voltar degrau",
    });
  if (sg.chave === "revisar" && e.anuncio) {
    const itens = (e.anuncio.itens || []).map((k) => ({ k, ...passoDoChecklist(k) })).filter((x) => x.texto);
    const falta = itens.filter((x) => !checklist?.[x.k]);
    return base({
      titulo: e.anuncio.titulo,
      porque: e.anuncio.texto,
      passos: (falta.length ? falta : itens).slice(0, 4),
      acao: "anuncio",
      botao: "Abrir o checklist do anúncio",
      depois: "Depois de mexer no anúncio, espere 7 dias antes de tirar conclusões.",
    });
  }
  if (sg.chave === "sem-venda")
    return base({
      tipo: "atencao",
      titulo: `${e.semVenda?.dias || 7} dias sem nenhuma venda`,
      porque: "Ainda é cedo pro diagnóstico completo do anúncio, mas uma semana inteira sem venda já pede uma conferida.",
      passos: [
        { texto: "Conferir se o anúncio está ativo e aparecendo", dica: "busque pelo nome na plataforma" },
        { texto: "Comparar o preço com os 5 primeiros da busca", dica: "preço, frete e prazo" },
        { texto: "Conferir a foto de capa", dica: "é a primeira coisa que o cliente vê" },
      ],
      acao: e.teste?.status === "recomendado" ? "teste" : "anuncio",
      botao: e.teste?.status === "recomendado" ? "Ver o teste de lançamento" : "Abrir o checklist do anúncio",
    });
  if (sg.chave === "descer")
    return base({ tipo: "atencao", titulo: `Descer o preço (entressafra) pra ${paraPreco(sg.preco ?? e.preco)}`, porque: "A temporada passou e o lucro das últimas semanas caiu pra menos da metade.", passos: [promo], acao: "descer", botao: "↓ Descer" });
  if (sg.chave === "atrasado")
    return base({ tipo: "atencao", titulo: "Atrasado no cronograma da temporada", porque: `Chegou a data de subir, mas o ritmo ainda não chegou em 1 pedido por dia${e.sazonal?.limite ? ` — o alvo precisa chegar até ${dm(e.sazonal.limite)}` : ""}.`, acao: "plano", botao: "Ver o cronograma" });
  if (e.alertaNota)
    return base({ tipo: "atencao", titulo: `Nota ${String(e.nota).replace(".", ",")}: revise o produto antes de subir`, porque: "Avaliação ruim costuma ser sobre o produto ou a entrega, não sobre o preço.", acao: "anuncio", botao: "Abrir o anúncio" });
  if (e.teste?.status === "recomendado")
    return base({ tipo: "atencao", titulo: "Teste de lançamento recomendado", porque: "Poucas vendas no orgânico até aqui: um Ads com orçamento fechado compra as primeiras vendas e mostra se o anúncio converte.", acao: "teste", botao: "Ver o teste de lançamento" });
  if (e.lucroCheck?.status === "sinaliza")
    return base({ tipo: "atencao", titulo: "Lucrando menos depois de subir", porque: "Ainda não é pra voltar — veja o “Vale a pena?” e acompanhe mais uma semana.", acao: "plano", botao: "Ver o “Vale a pena?”" });
  if (sg.chave === "acima-testando")
    return base({ tipo: "decisao", titulo: `Testando acima do alvo (${BRL(e.preco)})`, porque: `Registre as semanas normalmente — em ${e.acima?.diasFaltam ?? "alguns"} dia(s) o app compara o lucro com o do alvo.` });
  // Sem ação: diz por quê (o que falta) — assim "nada a fazer" não parece esquecimento.
  const faltam = (e.portoes || []).filter((p) => !p.ok);
  return base({
    tipo: "info",
    titulo: e.noAlvo ? "No alvo — acompanhe" : sg.rotulo === "Fica: lucro mantido" ? "Fica: lucro mantido" : "Coletando dados — deixe o anúncio rodar",
    porque: e.noAlvo
      ? "O preço salvo já é o de agora. Siga registrando as semanas."
      : e.sazonal
        ? sg.rotulo
        : faltam.length
          ? `Pra subir falta: ${faltam.map((p) => (p.falta ? `${p.falta} ${p.curto}` : p.curto)).join(" · ")}. Não mexa no preço nem no anúncio por enquanto.`
          : sg.rotulo,
  });
}

/** Sinais "o que o app está olhando": [{ chave, titulo, texto, estado (ok|ruim|atencao|espera), progresso? }]. */
export function sinaisDaRampa(e) {
  const out = [];
  const f = e.funil;
  if (f) {
    if (f.status === "sem-dados") out.push({ chave: "funil", titulo: "Funil do anúncio", texto: "sem dados — importe o Desempenho na Análise", estado: "espera" });
    else if (f.status === "coletando")
      out.push({ chave: "funil", titulo: "Funil do anúncio", texto: `coletando — faltam ${[f.faltamDias ? `${f.faltamDias} dia${f.faltamDias > 1 ? "s" : ""}` : "", f.faltamSemanas ? `${f.faltamSemanas} semana${f.faltamSemanas > 1 ? "s" : ""} com impressões` : ""].filter(Boolean).join(" e ")}`, estado: "espera" });
    else if (f.diagnostico && f.diagnostico.chave !== "ok")
      out.push({ chave: "funil", titulo: "Funil do anúncio", texto: `${f.diagnostico.titulo}${f.ctr != null ? ` · CTR ${pct(f.ctr)}` : ""}`, estado: "ruim" });
    else out.push({ chave: "funil", titulo: "Funil do anúncio", texto: `ok${f.ctr != null ? ` · CTR ${pct(f.ctr)}` : ""}${f.conversao != null ? ` · conversão ${pct(f.conversao)}` : ""}`, estado: "ok" });
  }
  if (e.sazonal) {
    const z = e.sazonal;
    out.push({ chave: "cronograma", titulo: `Cronograma · ${z.nome}`, texto: z.proximaData ? `próximo degrau em ${dm(z.proximaData)} · alvo até ${dm(z.limite)}` : z.fase === "entressafra" ? "entressafra" : `alvo até ${dm(z.limite)}`, estado: e.sugestao?.chave === "atrasado" ? "atencao" : "espera" });
  } else if (!e.noAlvo) {
    const pv = (e.portoes || []).find((p) => p.chave === "vendas");
    if (pv) out.push({ chave: "vendas", titulo: "Vendas no degrau", texto: `${pv.valor} · ${e.dias} dia${e.dias === 1 ? "" : "s"}`, estado: e.semVenda ? "atencao" : pv.ok ? "ok" : "espera" });
  }
  const c = e.lucroCheck;
  if (c) out.push({ chave: "lucro", titulo: "Lucro da semana", texto: c.status === "fica" ? "mantido depois de subir" : c.status === "voltar" ? "caiu depois de subir" : c.status === "sinaliza" ? "um pouco abaixo depois de subir" : "comparando com o degrau anterior", estado: c.status === "voltar" ? "ruim" : c.status === "sinaliza" ? "atencao" : c.status === "fica" ? "ok" : "espera" });
  else out.push({ chave: "lucro", titulo: "Lucro da semana", texto: e.lucroSemana != null ? `${BRL(e.lucroSemana)} na última semana` : "fecha com os pedidos importados", estado: e.lucroSemana != null ? "ok" : "espera" });
  out.push({ chave: "nota", titulo: "Nota", texto: `${e.nota != null ? `★${String(e.nota).replace(".", ",")}` : "sem nota ainda"}${e.ruins7 ? ` · ${e.ruins7} de 1–2★ em 7 dias` : " · sem 1–2★"}`, estado: e.alertaNota ? "ruim" : e.ruins7 ? "atencao" : e.nota != null ? "ok" : "espera" });
  const t = e.teste;
  if (t && t.status && !["nao-se-aplica"].includes(t.status)) {
    const txt = { observando: `observando o orgânico (dia ${t.dia} de ${t.de})`, recomendado: "recomendado", andamento: "em andamento", concluido: t.resultado?.titulo || "concluído", "ads-ligado": "Ads ligado", "nao-precisa": "não precisa (já vende)", pulado: "pulado" }[t.status];
    if (txt) out.push({ chave: "teste", titulo: "Teste de lançamento", texto: txt, estado: t.status === "recomendado" ? "atencao" : ["andamento", "observando"].includes(t.status) ? "espera" : "ok" });
  }
  return out;
}
