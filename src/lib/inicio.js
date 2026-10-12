// Início — SÓ LÊ. Nenhuma regra de decisão nova: cada pendência vem da aba que
// decide (alertaDe/estrategia.js, estadoRampa/diagnosticoAnuncio/alvo mudou,
// semanaPendente, linhasAnunciar, sugestoesAfiliado, pareceAtracaoDe,
// resumoCaixa) e só é agrupada/ordenada aqui. O botão leva pra aba que decide.

import { pendenciasDeTarefas } from "./tarefas.js";

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export const GRUPOS_PENDENCIA = [
  // Grupos seguem a regra única de cores: Resolver = só vermelho (prejuízo,
  // conta vencida, teste com cliques sem venda, tarefa vencida); Atenção e
  // rotina = âmbar + neutros; Oportunidades = verde.
  { chave: "resolver", titulo: "Resolver" },
  { chave: "rotina", titulo: "Atenção e rotina" },
  { chave: "oportunidade", titulo: "Oportunidades" },
];

// → [{ id, grupo, ordem, tom, titulo, texto, ir: { aba, pedido }, rotulo, semana? }]
export function montarPendencias({
  precosAlerta = [], // [{ item, canal, al }] anunciados com al.tipo prejuizo | abaixo-minimo (alertaDe)
  caixa = null, // resumoCaixa (fluxoCaixa.js)
  rampas = [], // linhas do Crescimento ({ r, produto, canal, est })
  semana = [], // semanasPendentes().pendentes
  anunciosAtualizar = [], // [{ item, canal, x }] linhasAnunciar: mudou e já marcado feito antes
  afSugestoes = [], // sugestoesAfiliado: "pode|…" e "amostra|…"
  atracao = [], // [{ item, canal }] pareceAtracaoDe
  tarefas = [], // tarefas manuais (schema v42)
  ads = null, // useCrescimento().linhasAds (lib/ads.js) — só períodos ligados + teto da loja
  hoje = "",
}) {
  const out = [];
  const add = (p) => out.push(p);

  // ---- Resolver ----
  for (const { item, canal, al } of precosAlerta.filter((a) => a.al?.tipo === "prejuizo"))
    add({
      id: `prejuizo|${item.id}|${canal.id}`,
      grupo: "resolver",
      ordem: 1,
      tom: "bad",
      titulo: `${item.nome}: dando prejuízo`,
      texto: `${canal.nome} · cada venda no preço salvo perde dinheiro${al.discreto ? " (explicado pela estratégia)" : ""}`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
    });
  for (const { item, canal } of precosAlerta.filter((a) => a.al?.tipo === "abaixo-minimo"))
    add({
      id: `minimo|${item.id}|${canal.id}`,
      grupo: "rotina",
      ordem: 0,
      tom: "warn",
      titulo: `${item.nome}: abaixo do mínimo`,
      texto: `${canal.nome} · se é de propósito, marque a estratégia lá e o aviso some`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
    });
  if (caixa?.atrasados?.length) {
    const pagar = caixa.atrasados.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);
    const receber = caixa.atrasados.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
    add({
      id: "caixa|atrasados",
      grupo: pagar > 0 ? "resolver" : "rotina",
      ordem: 3,
      tom: pagar > 0 ? "bad" : "warn",
      titulo: `${plural(caixa.atrasados.length, "conta atrasada", "contas atrasadas")}`,
      texto: [pagar > 0 ? `a pagar ${brl(pagar)}` : null, receber > 0 ? `a receber ${brl(receber)}` : null].filter(Boolean).join(" · ") + ` · desde ${diaMes(caixa.atrasados[0].data_prevista)}`,
      ir: { aba: "caixa" },
      rotulo: "Abrir Fluxo de Caixa",
    });
  }
  for (const l of rampas) {
    const a = l.est.anuncio;
    if (!a) continue;
    const teste = a.motivo === "teste";
    add({
      id: `anuncio|${l.r.id}`,
      grupo: teste ? "resolver" : "rotina",
      ordem: teste ? 4 : 0,
      tom: teste ? "bad" : "warn",
      titulo: `${l.produto.nome}: ${teste ? "teste com cliques sem venda" : "revisar anúncio"}`,
      texto: `${l.canal.nome} · ${a.titulo} — começar por: ${String(a.porOnde || "").toLowerCase()}`,
      ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } },
      rotulo: "Abrir no Crescimento",
    });
  }

  // ---- Ads (decisão em lib/ads.js; aqui só lê) ----
  const irAds = { aba: "crescimento", pedido: { sub: "ads" } };
  for (const l of ads?.linhas || []) {
    const av = l.av;
    if (!av.ativo) continue;
    if (av.chave === "pausar-revisar")
      add({ id: `ads|${l.chave}`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: Ads com cliques sem venda`, texto: `${l.canal.nome} · ${av.titulo}`, ir: irAds, rotulo: "Abrir Ads" });
    else if (["pausar", "reduzir", "inviavel-ativo"].includes(av.chave))
      add({ id: `ads|${l.chave}`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · Ads abaixo do empate (ROAS ${av.empate ? av.empate.toFixed(1).replace(".", ",") : "—"})`, ir: irAds, rotulo: "Abrir Ads" });
    else if (["aumentar", "meta-alta"].includes(av.chave))
      add({ id: `ads|${l.chave}`, grupo: "oportunidade", ordem: 1, tom: "good", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · ${av.chave === "aumentar" ? "ROAS acima da meta" : "a Shopee gastou pouco do orçamento"}`, ir: irAds, rotulo: "Abrir Ads" });
  }
  if (ads?.loja?.acimaTeto)
    add({ id: "ads|teto", grupo: "rotina", ordem: 2, tom: "warn", titulo: "Ads acima do teto da loja", texto: `${Math.round(ads.loja.pct * 100)}% do faturamento da semana em Ads`, ir: irAds, rotulo: "Abrir Ads" });

  // ---- Rotina ----
  for (const x of semana)
    add({
      id: `semana|${x.chave}`,
      grupo: "rotina",
      ordem: 1,
      tom: "warn",
      titulo: `${x.nome}: semana pendente`,
      texto: `${x.canal.nome} · ${x.tipo === "rampa" ? "em rampa" : "afiliado/Ads"} · sem registro desde ${diaMes(x.ultimo)} (${x.dias} dias)`,
      ir: { aba: "crescimento", pedido: { registrar: true } },
      rotulo: "Registrar agora",
      semana: x.chave,
    });
  for (const l of rampas) {
    const t = l.est.teste;
    if (t?.status === "andamento" && t.diasRestantes <= 2)
      add({
        id: `teste-acabando|${l.r.id}`,
        grupo: "rotina",
        ordem: 2,
        tom: "warn",
        titulo: `${l.produto.nome}: teste de lançamento acabando`,
        texto: `${l.canal.nome} · ${t.diasRestantes === 0 ? "acaba hoje" : `faltam ${plural(t.diasRestantes, "dia", "dias")}`} — registre o Ads e confira o resultado`,
        ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } },
        rotulo: "Abrir no Crescimento",
      });
    else if (t?.status === "concluido" && !t.salvoConcluido)
      add({
        id: `teste-acabou|${l.r.id}`,
        grupo: "rotina",
        ordem: 2,
        tom: "warn",
        titulo: `${l.produto.nome}: teste de lançamento acabou`,
        texto: `${l.canal.nome} · ${t.resultado?.titulo || "veja o resultado"} — conclua e desligue o Ads`,
        ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } },
        rotulo: "Abrir no Crescimento",
      });
  }
  if (caixa?.proximos?.length) {
    const pagar = caixa.proximos.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);
    const receber = caixa.proximos.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
    add({
      id: "caixa|proximos",
      grupo: "rotina",
      ordem: 3,
      tom: "neu",
      titulo: `${plural(caixa.proximos.length, "conta", "contas")} nos próximos 7 dias`,
      texto: [pagar > 0 ? `a pagar ${brl(pagar)}` : null, receber > 0 ? `a receber ${brl(receber)}` : null].filter(Boolean).join(" · ") + ` · a 1ª em ${diaMes(caixa.proximos[0].data_prevista)}`,
      ir: { aba: "caixa" },
      rotulo: "Abrir Fluxo de Caixa",
    });
  }
  if (anunciosAtualizar.length) {
    const nomes = [...new Set(anunciosAtualizar.map((a) => a.item.nome))];
    add({
      id: "anunciar|atualizar",
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `${plural(anunciosAtualizar.length, "anúncio a atualizar", "anúncios a atualizar")}`,
      texto: `${nomes.slice(0, 3).join(", ")}${nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ""} · só a promo muda`,
      ir: { aba: "publicar" },
      rotulo: "Abrir Anunciar",
    });
  }
  for (const l of rampas.filter((x) => x.est.alvoMudou))
    add({
      id: `alvo|${l.r.id}`,
      grupo: "rotina",
      ordem: 5,
      tom: "warn",
      titulo: `${l.produto.nome}: alvo mudou`,
      texto: `${l.canal.nome} · ${brl(l.est.alvoMudou.de)} → ${brl(l.est.alvoMudou.para)} — ajuste os degraus ou mantenha`,
      ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } },
      rotulo: "Abrir no Crescimento",
    });

  // ---- Oportunidades ----
  for (const l of rampas.filter((x) => x.est.sugestao?.chave === "subir"))
    add({
      id: `subir|${l.r.id}`,
      grupo: "oportunidade",
      ordem: 1,
      tom: "good",
      titulo: `${l.produto.nome}: pronto pra ${l.est.sugestao.saltos === 2 ? "subir 2 degraus" : "subir degrau"}`,
      texto: `${l.canal.nome} · ${brl(l.est.preco)} → ${brl(l.est.sugestao.saltos === 2 ? l.est.degraus[l.est.i + 2] : l.est.proximo)}`,
      ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } },
      rotulo: "Abrir no Crescimento",
    });
  for (const s of afSugestoes)
    add({
      id: `af|${s.chave}`,
      grupo: "oportunidade",
      ordem: s.chave.startsWith("pode|") ? 2 : 3,
      tom: "good",
      titulo: s.titulo,
      texto: s.texto,
      ir: { aba: "crescimento", pedido: { sub: "afiliados" } },
      rotulo: "Abrir Afiliados",
    });
  for (const { item, canal } of atracao)
    add({
      id: `atracao|${item.id}|${canal.id}`,
      grupo: "oportunidade",
      ordem: 4,
      tom: "neu",
      titulo: `${item.nome}: parece atração — marcar?`,
      texto: `${canal.nome} · abaixo do mínimo, mas o kit 2 compensa`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
    });

  // Tarefas manuais (schema v42) entram nos mesmos grupos, ordenadas por data.
  for (const p of pendenciasDeTarefas(tarefas, hoje)) add(p);

  const g = Object.fromEntries(GRUPOS_PENDENCIA.map((x, i) => [x.chave, i]));
  const porData = (a, b) => (a.data || "9999").localeCompare(b.data || "9999");
  return out.sort((a, b) => g[a.grupo] - g[b.grupo] || a.ordem - b.ordem || (a.tarefa && b.tarefa ? porData(a, b) : 0) || a.titulo.localeCompare(b.titulo));
}

// Faixa de status — só resume o que as pendências/números já dizem.
export function statusInicio({ caixa, rampas = [], semana = [], afAtivo = false, precosAlerta = [], anunciosAtualizar = [], anunciados = 0, taxa = null, taxaRef = 0.125, lucroSemana = null }) {
  const dinheiro = !caixa || !caixa.temLancamentos
    ? { tom: "neu", frase: "Sem lançamentos no Fluxo de Caixa" }
    : caixa.atrasados.some((l) => l.tipo === "saida") || (caixa.menor && caixa.menor.saldoFinal < 0)
      ? { tom: "bad", frase: caixa.menor && caixa.menor.saldoFinal < 0 ? `Saldo fica negativo (${brl(caixa.menor.saldoFinal)})` : `Conta atrasada · saldo ${brl(caixa.saldoHoje)}` }
      : caixa.atrasados.length || !caixa.temSaldoInicial
        ? { tom: "warn", frase: !caixa.temSaldoInicial ? `Falta o saldo inicial · saldo ${brl(caixa.saldoHoje)}` : `A receber atrasado · saldo ${brl(caixa.saldoHoje)}` }
        : { tom: "good", frase: `Saldo ${brl(caixa.saldoHoje)} · menor em 3 meses ${brl(caixa.menor?.saldoFinal)}` };

  const revisar = rampas.filter((l) => l.est.anuncio || l.est.sugestao?.chave === "voltar");
  const vendas = !rampas.length && !afAtivo
    ? { tom: "neu", frase: "Nenhum produto em rampa nem afiliado" }
    : revisar.length
      ? { tom: revisar.some((l) => l.est.anuncio?.motivo === "teste") ? "bad" : "warn", frase: `${plural(revisar.length, "produto pede", "produtos pedem")} revisão` }
      : semana.length || rampas.some((l) => l.est.sugestao?.chave === "segurar")
        ? { tom: "warn", frase: semana.length ? `${plural(semana.length, "semana pendente", "semanas pendentes")}` : "Rampa segurando" }
        : { tom: "good", frase: lucroSemana != null ? `Lucro da semana ${brl(lucroSemana)}` : `${plural(rampas.length, "produto", "produtos")} em rampa` };

  const prejuizo = precosAlerta.filter((a) => a.al?.tipo === "prejuizo" && !a.al.discreto);
  const catalogo = !anunciados
    ? { tom: "neu", frase: "Nenhum anúncio marcado como feito" }
    : prejuizo.length
      ? { tom: "bad", frase: `${plural(prejuizo.length, "anúncio com prejuízo", "anúncios com prejuízo")}` }
      : precosAlerta.length || anunciosAtualizar.length
        ? { tom: "warn", frase: [precosAlerta.length ? plural(precosAlerta.length, "abaixo do mínimo", "abaixo do mínimo") : null, anunciosAtualizar.length ? plural(anunciosAtualizar.length, "a atualizar", "a atualizar") : null].filter(Boolean).join(" · ") }
        : { tom: "good", frase: `${plural(anunciados, "anúncio em dia", "anúncios em dia")}` };

  const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  // Produção: só compara com a referência da própria aba (12,5%) — sem juízo novo.
  const producao = !taxa || !taxa.total
    ? { tom: "neu", frase: "Sem impressões registradas" }
    : taxa.taxa > taxaRef + 0.0005
      ? { tom: "warn", frase: `Falha ${pct(taxa.taxa)} (acima da referência de ${pct(taxaRef)})` }
      : { tom: "good", frase: `Falha ${pct(taxa.taxa)} · ${plural(taxa.total, "impressão", "impressões")}` };

  return { dinheiro, vendas, catalogo, producao };
}
