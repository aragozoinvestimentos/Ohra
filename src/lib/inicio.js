// Início — SÓ LÊ. Nenhuma regra de decisão nova: cada pendência vem da aba que
// decide (alertaDe/estrategia.js, estadoRampa/diagnosticoAnuncio/alvo mudou,
// linhasAnunciar, sugestoesAfiliado, pareceAtracaoDe,
// resumoCaixa) e só é agrupada/ordenada aqui. O botão leva pra aba que decide.

import { pendenciasDeTarefas } from "./tarefas.js";
import { estadoSugestaoAfiliado } from "./estados.js";
import { andamentoAtrasado } from "./ads.js";
import { precisaRecarregar } from "./saldoAds.js";

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
import { textoPrazo } from "./manutencao.js";
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export const GRUPOS_PENDENCIA = [
  // Grupos seguem a regra única de cores: Resolver = só vermelho (prejuízo,
  // conta vencida, teste com cliques sem venda, tarefa vencida); Atenção e
  // rotina = âmbar + neutros; Oportunidades = verde.
  { chave: "resolver", titulo: "Resolver" },
  { chave: "rotina", titulo: "Atenção e rotina" },
  { chave: "oportunidade", titulo: "Oportunidades" },
];

// → [{ id, grupo, ordem, tom, titulo, texto, ir: { aba, pedido }, rotulo }]
// Áreas do filtro do "Pra fazer" (pela aba pra onde o aviso leva). Os
// urgentes (grupo Resolver) aparecem SEMPRE, com qualquer filtro.
export const AREAS_PENDENCIA = [
  { chave: "preco", rotulo: "Preço e anúncio" },
  { chave: "crescimento", rotulo: "Crescimento" },
  { chave: "ads", rotulo: "Ads" },
  { chave: "afiliados", rotulo: "Afiliados" },
  { chave: "dinheiro", rotulo: "Dinheiro" },
  { chave: "producao", rotulo: "Produção" },
  { chave: "tarefas", rotulo: "Minhas tarefas" },
  { chave: "outros", rotulo: "Outros" },
];
const ABAS_PRECO = ["historico", "publicar", "avulso", "canal", "quantidade", "ficha", "lancamento", "comparativo", "cadastros"];
export function areaPendencia(p) {
  if (p.tarefa) return "tarefas";
  const aba = p.ir?.aba;
  if (aba === "crescimento") return p.ir.pedido?.sub === "ads" ? "ads" : p.ir.pedido?.sub === "afiliados" ? "afiliados" : "crescimento";
  if (aba === "promocoes") return "crescimento";
  if (ABAS_PRECO.includes(aba)) return "preco";
  if (aba === "caixa" || aba === "metas" || aba === "analise") return "dinheiro";
  if (["farm", "registro", "otimizacao", "producao"].includes(aba)) return "producao";
  return "outros";
}

export function montarPendencias({
  precosAlerta = [], // [{ item, canal, al }] anunciados com al.tipo prejuizo | abaixo-minimo (alertaDe)
  caixa = null, // resumoCaixa (fluxoCaixa.js)
  rampas = [], // linhas do Crescimento ({ r, produto, canal, est })
  anunciosAtualizar = [], // [{ item, canal, x }] linhasAnunciar: mudou e já marcado feito antes
  promosAcima = [], // [{ item, canal, x }] desconto acima do que a plataforma aceita (limitePromo.js)
  afSugestoes = [], // sugestoesAfiliado: "pode|…" e "amostra|…"
  atracao = [], // [{ item, canal }] pareceAtracaoDe
  tarefas = [], // tarefas manuais (schema v42)
  ads = null, // useCrescimento().linhasAds (lib/ads.js) — só períodos ligados + teto da loja
  farm = null, // { alteracoes (farm_alteracoes não revisadas), desgaste (avisosDesgaste) } — Minha farm (v47)
  campanha = null, // próxima campanha da plataforma (calendario.js → proximaCampanha)
  temporadas = [], // [{ produto, info }] lembrete da temporada (calendario.js → infoSazonal().lembrete)
  revisoes = [], // [{ item, canal, motivos }] venda direta: preço velho ou custo subiu (revisarPreco.js)
  adsSazonal = [], // [{ chave, item, canal, aviso }] fases do Ads sazonal (ads.js → avisoAdsSazonal)
  importacoes = null, // { disponivel, lista, plataformas: [{ id, nome }] } — central da aba Análise (v55)
  saldoDeAds = null, // saldoAds (lib/saldoAds.js): recargas − gasto dos CSVs
  hoje = "",
}) {
  const out = [];
  const add = (p) => out.push(p);

  // ---- Minha farm: UM item pro custo que subiu (vermelho se algo ficou abaixo do mínimo) ----
  const altFarm = (farm?.alteracoes || []).filter((a) => !a.revisado);
  if (altFarm.length) {
    const prods = new Map();
    for (const a of altFarm) for (const x of Array.isArray(a.produtos) ? a.produtos : []) prods.set(`${x.id}|${x.canal_id}`, x);
    const lista = [...prods.values()];
    const grave = lista.some((x) => x.motivo === "prejuízo" || x.motivo === "abaixo do mínimo");
    const nItens = new Set(lista.map((x) => x.id)).size;
    add({
      id: "farm|custo",
      grupo: grave ? "resolver" : "rotina",
      ordem: 0,
      tom: grave ? "bad" : "warn",
      titulo: `Custo da farm subiu — ${plural(nItens, "produto", "produtos")} pra reajustar`,
      texto: grave ? "algum ficou abaixo do mínimo — ajuste pelo desconto da promoção" : "o lucro caiu bastante — confira e ajuste pela promoção se precisar",
      ir: { aba: "farm", pedido: { alteracoes: true } },
      rotulo: "Ver produtos",
    });
  }

  // ---- Venda direta (Orgânico): vale revisar o preço? (tempo ou custo) ----
  for (const { item, canal, motivos } of revisoes)
    add({
      id: `revisar|${item.id}|${canal.id}`,
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `${item.nome}: vale revisar o preço?`,
      texto: `${canal.nome} · ${motivos.map((m) => m.texto).join(" · ")}`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
    });

  // ---- Ads sazonal: virada de fase (Aquecer/Ajustar/Alavancar/Corte) e andamento ----
  for (const x of adsSazonal)
    add({
      id: `ads-saz|${x.chave}|${x.aviso.id}`,
      grupo: x.aviso.grupo || "rotina",
      ordem: 2,
      tom: x.aviso.grupo === "oportunidade" ? "good" : "warn",
      titulo: `${x.item.nome}: ${x.aviso.titulo}`,
      texto: `${x.canal.nome} · ${x.aviso.texto}`,
      ir: { aba: "crescimento", pedido: { sub: "ads" } },
      rotulo: "Ver em Ads",
    });

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

  // Rampa: voltar (lucro caiu), descer na entressafra e atrasado no cronograma
  // sazonal — decididos em lib/rampa.js (estadoRampa().sugestao).
  for (const l of rampas) {
    const sg = l.est.sugestao;
    if (!sg || !["voltar", "descer", "atrasado", "sem-venda"].includes(sg.chave)) continue;
    const textos = {
      voltar: [`${l.produto.nome}: voltar degrau`, `${l.canal.nome} · o preço novo derrubou o lucro por 2 semanas`],
      "sem-venda": [`${l.produto.nome}: ${l.est.semVenda?.dias || 7} dias sem venda`, `${l.canal.nome} · confira se o anúncio aparece na busca, o preço e a foto de capa`],
      descer: [`${l.produto.nome}: descer o preço (entressafra)`, `${l.canal.nome} · ${brl(l.est.preco)} → ${brl(sg.preco)} — a temporada passou`],
      atrasado: [`${l.produto.nome}: atrasado no cronograma`, `${l.canal.nome} · ${l.est.sazonal?.nome || "temporada"}: no alvo até ${String(l.est.sazonal?.limite || "").slice(8, 10)}/${String(l.est.sazonal?.limite || "").slice(5, 7)}`],
    }[sg.chave];
    add({ id: `rampa-${sg.chave}|${l.r.id}`, grupo: "rotina", ordem: 1, tom: "warn", titulo: textos[0], texto: textos[1], ir: { aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } }, rotulo: "Abrir no Crescimento" });
  }
  // Mais avisos da Rampa (todos decididos em lib/rampa.js; aqui só lê).
  const irRampa = (l) => ({ aba: "crescimento", pedido: { sub: "rampa", rampaId: l.r.id } });
  for (const l of rampas) {
    const e = l.est;
    const c = e.lucroCheck;
    if (e.sugestao?.chave === "segurar" && c?.status === "sinaliza" && c.ultima)
      add({
        id: `lucro-menos|${l.r.id}`,
        grupo: "rotina",
        ordem: 2,
        tom: "warn",
        titulo: `${l.produto.nome}: ${c.ultima.ruim ? "semana abaixo depois de subir" : `lucrando ${Math.round((1 - c.ultima.pct) * 100)}% menos que antes`}`,
        texto: `${l.canal.nome} · ${brl(c.de)} → ${brl(c.para)} — veja o “Vale a pena?”`,
        ir: irRampa(l),
        rotulo: "Abrir no Crescimento",
      });
    if (e.alertaNota)
      add({ id: `nota|${l.r.id}`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.produto.nome}: nota ${String(e.nota).replace(".", ",")}`, texto: `${l.canal.nome} · abaixo do alerta — revise o produto/entrega antes de subir o preço`, ir: irRampa(l), rotulo: "Abrir no Crescimento" });
    if (e.teste?.status === "recomendado")
      add({ id: `teste-rec|${l.r.id}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `${l.produto.nome}: teste de lançamento recomendado`, texto: `${l.canal.nome} · poucas vendas no orgânico — Ads com orçamento fechado (${brl(e.teste.orcSugerido)}) ou pular`, ir: irRampa(l), rotulo: "Abrir no Crescimento" });
    const sk = e.sugestao?.chave;
    if (sk === "testar-acima")
      add({ id: `acima|${l.r.id}`, grupo: "oportunidade", ordem: 2, tom: "good", titulo: `${l.produto.nome}: dá pra testar acima do alvo`, texto: `${l.canal.nome} · ${brl(e.alvo)} → ${brl(e.acima?.prox)} (teste controlado)`, ir: irRampa(l), rotulo: "Abrir no Crescimento" });
    if (sk === "acima-aprovado")
      add({ id: `acima-ok|${l.r.id}`, grupo: "oportunidade", ordem: 1, tom: "good", titulo: `${l.produto.nome}: teste acima do alvo aprovado`, texto: `${l.canal.nome} · lucrou mais a ${brl(e.preco)} — atualize o preço salvo`, ir: irRampa(l), rotulo: "Abrir no Crescimento" });
    if (sk === "acima-voltar")
      add({ id: `acima-volta|${l.r.id}`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.produto.nome}: voltar ao alvo`, texto: `${l.canal.nome} · o teste a ${brl(e.preco)} lucrou menos que no alvo (${brl(e.alvo)})`, ir: irRampa(l), rotulo: "Abrir no Crescimento" });
  }
  // Campanha da plataforma chegando (7 dias): conferir preços de campanha.
  if (campanha && campanha.dias >= 0 && campanha.dias <= 7)
    add({
      id: `campanha|${campanha.chave}|${campanha.data}`,
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `Campanha ${campanha.nome} ${campanha.dias === 0 ? "hoje" : `em ${campanha.dias} dia${campanha.dias === 1 ? "" : "s"}`}`,
      texto: "a plataforma costuma pedir preço abaixo do menor dos últimos 30 dias — confira em Promoções",
      ir: { aba: "promocoes" },
      rotulo: "Abrir Promoções",
    });

  // Temporada chegando (60 dias antes da data): revisar anúncio e estoque.
  for (const { produto, info } of temporadas) {
    const lb = info.lembrete;
    const dias = lb.evento && hoje ? Math.round((new Date(`${lb.evento}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 86400000) : null;
    add({
      id: `temporada|${produto.id}|${lb.chave}|${lb.evento}`,
      grupo: "rotina",
      ordem: 3,
      tom: "warn",
      titulo: `${produto.nome}: ${lb.nome} em ${dias} dias`,
      texto: info.tipo === "epoca" ? `temporada começando — no alvo até ${lb.limite.slice(8, 10)}/${lb.limite.slice(5, 7)}; revise anúncio e estoque` : "pico de vendas chegando — revise anúncio e estoque",
      ir: { aba: "crescimento", pedido: { sub: "rampa" } },
      rotulo: "Abrir no Crescimento",
    });
  }

  // ---- Ads (decisão em lib/ads.js; aqui só lê) ----
  const irAds = { aba: "crescimento", pedido: { sub: "ads" } };
  // GMV Max da Loja — arquivo próprio (gmvLoja.js decide; aqui só lê).
  const gmv = ads?.lojaLinha?.gmv;
  if (gmv) {
    const irLoja = { aba: "crescimento", pedido: { sub: "ads", adsChave: ads.lojaLinha.chave } };
    const dmI = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    for (const f of gmv.furos || [])
      add({ id: `gmv-furo|${f.de}|${f.ate}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `GMV Max da Loja: ${f.de === f.ate ? `falta o dia ${dmI(f.de)}` : `faltam os dias ${dmI(f.de)} a ${dmI(f.ate)}`}`, texto: "exporte esse período na Shopee e envie em Importar dados → GMV Max da Loja (soma sem duplicar)", ir: { aba: "analise", pedido: { sub: "importar" } }, rotulo: "Abrir a importação" });
    for (const p of (gmv.produtos || []).filter((x) => x.aviso)) {
      const nome = p.ligado?.nome || p.nome.slice(0, 40).trim();
      add({ id: `gmv|${p.id}|${p.aviso.tipo}`, grupo: p.aviso.estado === "oportunidade" ? "oportunidade" : "rotina", ordem: 3, tom: p.aviso.estado === "oportunidade" ? "good" : "warn", titulo: `${nome}: ${p.aviso.titulo}`, texto: `Shopee · GMV Max da Loja · ${p.aviso.texto}`, ir: irLoja, rotulo: "Ver no Ads" });
    }
  }
  for (const l of [...(ads?.lojaLinha ? [ads.lojaLinha] : []), ...(ads?.linhas || [])]) {
    const av = l.av;
    if (!av.ativo) continue;
    const irL = { aba: "crescimento", pedido: { sub: "ads", adsChave: l.chave } };
    // Método do Luan (16/10/2026): dia 3 sem venda, pausado, conferir, virar meta, campanha da loja.
    if (av.chave === "sem-venda-dia3") {
      add({ id: `ads|${l.chave}|dia3`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: ${av.semVenda?.dias || 3} dias pagando Ads sem venda`, texto: `${l.canal.nome} · pause e arrume o anúncio antes de gastar mais`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    if (av.chave === "ads-prejuizo") {
      add({ id: `ads|${l.chave}|prejuizo`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: Ads no prejuízo`, texto: `${l.canal.nome} · ${av.titulo.replace(/^Ads no prejuízo — /, "")} · pause e arrume o anúncio`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    // Queda com o Ads ligado (17/10/2026).
    if (av.chave === "parou-ads" || av.chave === "queda-ads") {
      add({ id: `ads|${l.chave}|${av.chave}`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · ${av.chave === "parou-ads" ? "confira anúncio, estoque e preço — pause até descobrir" : "reduza o orçamento ou suba a meta"}`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    if (av.chave === "queda-ads-sinal") {
      add({ id: `ads|${l.chave}|queda-sinal`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.split(" — ")[0]}`, texto: `${l.canal.nome} · avalie a causa, sem mexer ainda — o app pede pra agir se seguir assim até ${av.decideEm ? `${av.decideEm.slice(8, 10)}/${av.decideEm.slice(5, 7)}` : "o 7º dia"}`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "despausar") {
      add({ id: `ads|${l.chave}|despausar`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: já revisou? Despause o Ads`, texto: `${l.canal.nome} · pausado desde ${av.pausado?.desde ? `${av.pausado.desde.slice(8, 10)}/${av.pausado.desde.slice(5, 7)}` : "—"}`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "pausa-longa") {
      add({ id: `ads|${l.chave}|pausa-longa`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: Ads pausado há ${av.pausado?.desde ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${av.pausado.desde}T12:00:00`)) / 86400000) : 21} dias`, texto: `${l.canal.nome} · a Shopee começa a perder o aprendizado — despause ou encerre o período`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "conferir-dia3") {
      add({ id: `ads|${l.chave}|conferir`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()} do Ads`, texto: `${l.canal.nome} · pra saber se já vendeu (sem venda em 3 dias = parar e arrumar o anúncio)`, ir: { aba: "analise", pedido: { sub: "importar" } }, rotulo: "Abrir importação" });
      continue;
    }
    if (av.chave === "virar-meta") {
      add({ id: `ads|${l.chave}|virar-meta`, grupo: av.estado === "oportunidade" ? "oportunidade" : "rotina", ordem: 1, tom: av.estado === "oportunidade" ? "good" : "warn", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · fim dos 7 dias no lance automático`, ir: irL, rotulo: "Ver" });
      continue;
    }
    if (["loja-abaixo", "loja-nao-gasta"].includes(av.chave) || (av.loja && av.chave === "aguardando")) {
      add({ id: `ads|${l.chave}|${av.chave}`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `Campanha da loja: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · GMV Max da Loja`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "pausar-revisar")
      add({ id: `ads|${l.chave}`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: Ads com cliques sem venda`, texto: `${l.canal.nome} · ${av.titulo}`, ir: irL, rotulo: "Abrir Ads" });
    else if (["pausar", "reduzir", "inviavel-ativo", "subir-meta", "arrumar-anuncio"].includes(av.chave))
      add({ id: `ads|${l.chave}`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · Ads abaixo ${av.sazonal && av.minimo !== av.empate ? "do mínimo da temporada" : "do ROAS de equilíbrio"} (${(av.minimo ?? av.empate) ? (av.minimo ?? av.empate).toFixed(1).replace(".", ",") : "—"})`, ir: irL, rotulo: "Abrir Ads" });
    else if (av.chave === "segurar-producao")
      add({ id: `ads|${l.chave}|producao`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: segurar o Ads`, texto: `${l.canal.nome} · as vendas subiram e a produção não acompanha`, ir: irL, rotulo: "Abrir Ads" });
    else if (["pausar-corte", "atualizar-andamento"].includes(av.chave))
      add({ id: `ads|${l.chave}|${av.chave}`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · ${av.chave === "pausar-corte" ? "último dia de entrega passou" : "fase Alavancar decide a cada 3–4 dias"}`, ir: irL, rotulo: "Abrir Ads" });
    else if (["aumentar", "meta-alta"].includes(av.chave))
      add({ id: `ads|${l.chave}`, grupo: "oportunidade", ordem: 1, tom: "good", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · ${av.chave === "aumentar" ? `retorno ${av.numeros?.retorno != null ? av.numeros.retorno.toFixed(1).replace(".", ",") : "—"}× o equilíbrio` : "a Shopee gastou pouco do orçamento"}`, ir: irL, rotulo: "Abrir Ads" });
    if (av.avisoMeta)
      add({ id: `ads|${l.chave}|meta-alta-inicio`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: meta de ROAS alta pra começar`, texto: `${l.canal.nome} · meta ${av.avisoMeta.meta.toFixed(1).replace(".", ",")} — comece com ${av.avisoMeta.sugerida.toFixed(1).replace(".", ",")}`, ir: irL, rotulo: "Abrir Ads" });
  }
  // Saldo de Ads na Shopee acabando (17/10/2026): menos de 5 dias no ritmo atual.
  if (precisaRecarregar(saldoDeAds))
    add({
      id: "ads|recarregar",
      grupo: "rotina",
      ordem: 2,
      tom: "warn",
      titulo: `Recarregar o Ads — saldo ≈ R$ ${saldoDeAds.saldo.toFixed(2).replace(".", ",")}`,
      texto: `Dá pra ~${Math.max(0, Math.floor(saldoDeAds.dias))} dia${Math.floor(saldoDeAds.dias) === 1 ? "" : "s"} no ritmo de R$ ${saldoDeAds.gastoDia.toFixed(2).replace(".", ",")}/dia · depois de depositar na Shopee, lance a recarga no Fluxo de Caixa`,
      ir: { aba: "caixa" },
      rotulo: "Abrir o caixa",
    });
  // Andamento do Ads (plano 14/10/2026): UM aviso quando o envio mais antigo
  // entre os itens com Ads ligado tem mais de 3 dias.
  {
    const per = [...(ads?.lojaLinha ? [ads.lojaLinha] : []), ...(ads?.linhas || [])].filter((l) => l.av.ativo).map((l) => ({ ...l.av.ativo, _nome: l.item.nome }));
    const atr = andamentoAtrasado(per, hoje);
    if (atr)
      add({
        id: "ads|andamento",
        grupo: "rotina",
        ordem: 2,
        tom: "warn",
        titulo: `Atualizar o andamento do Ads — ${atr.semEnvio ? `${atr.periodo._nome} sem envio há ${atr.dias} dias` : `último envio há ${atr.dias} dias`}`,
        texto: "CSV do Shopee Ads (do início de cada período até ontem) em Análise → Importar dados — as decisões do Ads e as semanas usam ele",
        ir: { aba: "analise", pedido: { sub: "importar" } },
        rotulo: "Abrir a central",
      });
  }
  // Central de importação (aba Análise, v55): pedidos da Olist há mais de 7
  // dias por plataforma que já foi importada (Shopee: também nunca enviada) e
  // o Desempenho da Shopee há mais de 7 dias. UM aviso, em Atenção e rotina.
  if (importacoes?.disponivel) {
    const dias = (rel) => {
      const u = [...(importacoes.lista || [])].filter((i) => i.ok && i.relatorio === rel).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))[0];
      if (!u?.criado_em) return null;
      const d = new Date(u.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      return Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${d}T12:00:00`)) / 86400000);
    };
    const atrasados = [];
    for (const p of importacoes.plataformas || []) {
      const d = dias(`pedidos:${p.id}`);
      if (d == null ? p.id === "shopee" : d > 7) atrasados.push(d == null ? `${p.nome}: nunca enviado` : `${p.nome}: há ${d} dias`);
    }
    const dd = (importacoes.plataformas || []).some((p) => p.id === "shopee") ? dias("shopee:desempenho") : null;
    if (dd != null && dd > 7) atrasados.push(`Desempenho da Shopee: há ${dd} dias`);
    if (atrasados.length)
      add({
        id: "analise|importar",
        grupo: "rotina",
        ordem: 2,
        tom: "warn",
        titulo: "Importar os pedidos da semana",
        texto: `${atrasados.join(" · ")} — vendas, caixa e curva ABC usam os pedidos`,
        ir: { aba: "analise", pedido: { sub: "importar" } },
        rotulo: "Abrir a central",
      });
  }

  // Avaliações (v58): anúncio que vendeu há mais de 7 dias sem atualizar (bloco Avaliações da central).
  if (importacoes?.avaliacoes?.length) {
    const n = importacoes.avaliacoes.length;
    add({
      id: "analise|avaliacoes",
      grupo: "rotina",
      ordem: 2,
      tom: "warn",
      titulo: `Atualizar as avaliações — ${n} anúncio${n > 1 ? "s venderam" : " vendeu"} sem conferir`,
      texto: `${importacoes.avaliacoes.slice(0, 3).map((v) => v.canal.nome).filter((x, i, a) => a.indexOf(x) === i).join(", ")} · os portões da Rampa (avaliações, nota, 1–2★) usam o bloco Avaliações`,
      ir: { aba: "analise", pedido: { sub: "importar" } },
      rotulo: "Abrir a central",
    });
  }

  if (ads?.teto?.acimaTeto)
    add({ id: "ads|teto", grupo: "rotina", ordem: 2, tom: "warn", titulo: "Ads acima do teto da loja", texto: `${brl(ads.teto.gasto)} em 30 dias · teto ${brl(ads.teto.teto)} (fase ${ads.teto.fase})`, ir: irAds, rotulo: "Abrir Ads" });

  // ---- Rotina ----
  for (const m of farm?.manutencao || [])
    add({
      id: `farm-manut|${m.imp.id}`,
      grupo: "rotina",
      ordem: 1,
      tom: "warn",
      titulo: `${m.imp.nome}: manutenção ${textoPrazo(m.faltam)}`,
      texto: `${plural(m.itens.length, "item", "itens")}: ${m.itens.slice(0, 3).map((x) => x.nome.split(/[:(]/)[0].trim().toLowerCase()).join(", ")}${m.itens.length > 3 ? "…" : ""}`,
      ir: { aba: "farm", pedido: { manutencao: m.imp.id } },
      rotulo: "Abrir lista",
    });
  for (const w of farm?.desgaste || [])
    add({
      id: `farm-desgaste|${w.imp.id}|${w.tipo}`,
      grupo: "rotina",
      ordem: 2,
      tom: "warn",
      titulo: w.tipo === "fim" ? `${w.imp.nome}: chegou na vida útil` : `${w.imp.nome}: avaliar venda/troca`,
      texto: w.texto,
      ir: { aba: "farm" },
      rotulo: "Abrir Minha farm",
      ciente: { impressoraId: w.imp.id, campo: w.tipo === "fim" ? "aviso_fim_visto" : "aviso_desgaste_visto" },
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
  for (const a of promosAcima)
    add({
      id: `promo-limite|${a.item.id}|${a.canal.id}`,
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `${a.item.nome}: desconto de ${a.x.promo}% no ${a.canal.nome}`,
      texto: `${a.canal.nome} · ${a.x.limitePromo.texto}`,
      ir: { aba: "publicar" },
      rotulo: "Abrir Anunciar",
    });
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
  for (const s of afSugestoes) {
    const est = estadoSugestaoAfiliado(s);
    add({
      id: `af|${s.chave}`,
      grupo: est === "atencao" ? "rotina" : "oportunidade",
      ordem: s.chave.startsWith("pode|") ? 2 : 3,
      tom: est === "atencao" ? "warn" : est === "oportunidade" ? "good" : "neu",
      titulo: s.titulo,
      texto: s.texto,
      ir: { aba: "crescimento", pedido: { sub: "afiliados" } },
      rotulo: "Abrir Afiliados",
    });
  }
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
export function statusInicio({ caixa, rampas = [], afAtivo = false, precosAlerta = [], anunciosAtualizar = [], anunciados = 0, taxa = null, taxaRef = 0.125, lucroSemana = null }) {
  const dinheiro = !caixa || !caixa.temLancamentos
    ? { tom: "neu", frase: "Sem lançamentos no Fluxo de Caixa" }
    : caixa.atrasados.some((l) => l.tipo === "saida") || (caixa.menor && caixa.menor.saldoFinal < 0)
      ? { tom: "bad", frase: caixa.menor && caixa.menor.saldoFinal < 0 ? `Saldo fica negativo (${brl(caixa.menor.saldoFinal)})` : `Conta atrasada · saldo ${brl(caixa.saldoHoje)}` }
      : caixa.atrasados.length || !caixa.temSaldoInicial
        ? { tom: "warn", frase: !caixa.temSaldoInicial ? `Falta o saldo inicial · saldo ${brl(caixa.saldoHoje)}` : `A receber atrasado · saldo ${brl(caixa.saldoHoje)}` }
        : { tom: "good", frase: `Saldo ${brl(caixa.saldoHoje)} · menor em 3 meses ${brl(caixa.menor?.saldoFinal)}` };

  const revisar = rampas.filter((l) => l.est.anuncio || ["voltar", "descer", "atrasado", "sem-venda"].includes(l.est.sugestao?.chave));
  const vendas = !rampas.length && !afAtivo
    ? { tom: "neu", frase: "Nenhum produto em rampa nem afiliado" }
    : revisar.length
      ? { tom: revisar.some((l) => l.est.anuncio?.motivo === "teste") ? "bad" : "warn", frase: `${plural(revisar.length, "produto pede", "produtos pedem")} ${revisar.every((l) => !l.est.anuncio) ? "ajuste de preço" : "revisão"}` }
      : rampas.some((l) => l.est.sugestao?.chave === "segurar" && l.est.sugestao.tom === "warn")
        ? { tom: "warn", frase: "Rampa segurando" }
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

// Início agrupado por ANÚNCIO (16/10/2026, pedido do Gustavo): os avisos do
// mesmo produto (com as variações dele) no mesmo canal viram UM card — pelo
// título "<Nome>: …" e o canal no começo do texto ("Shopee · …"). Só junta
// quando há 2+ avisos; caixa, farm, importação e tarefas ficam soltos (não
// têm canal no texto). O card fica no grupo do aviso mais grave.
const ORDEM_GRUPO = { resolver: 0, rotina: 1, oportunidade: 2 };
export function chaveAnuncioDe(p, nomesCanais) {
  if (!p || p.tarefa) return null;
  const m = /^(?:Anúncio:\s)?(.+?):\s/.exec(p.titulo || "");
  if (!m) return null;
  const canal = String(p.texto || "").split(" · ")[0].trim();
  if (!nomesCanais.includes(canal)) return null;
  const nome = m[1].replace(/\s+[—–-]\s+.*$/, "").replace(/\s*\((kit|variação)[^)]*\)\s*$/i, "").trim();
  if (!nome) return null;
  return { chave: `${nome.toLowerCase()}|${canal}`, nome, canal };
}
export function agruparPorAnuncio(avisos, nomesCanais) {
  const porChave = new Map();
  const ordem = [];
  for (const p of avisos) {
    const k = chaveAnuncioDe(p, nomesCanais);
    if (!k) {
      ordem.push({ p });
      continue;
    }
    let g = porChave.get(k.chave);
    if (!g) {
      g = { anuncio: true, id: `anuncio|${k.chave}`, nome: k.nome, canal: k.canal, itens: [] };
      porChave.set(k.chave, g);
      ordem.push({ g });
    }
    g.itens.push(p);
  }
  return ordem.map((x) => {
    if (x.p) return x.p;
    const g = x.g;
    if (g.itens.length === 1) return g.itens[0];
    g.itens.sort((a, b) => (ORDEM_GRUPO[a.grupo] ?? 3) - (ORDEM_GRUPO[b.grupo] ?? 3));
    g.grupo = g.itens[0].grupo;
    g.tom = g.itens[0].tom;
    return g;
  });
}
