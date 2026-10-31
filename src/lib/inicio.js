// Início — SÓ LÊ. Nenhuma regra de decisão nova: cada pendência vem da aba que
// decide (alertaDe/estrategia.js, estadoRampa/diagnosticoAnuncio/alvo mudou,
// linhasAnunciar, sugestoesAfiliado, pareceAtracaoDe,
// resumoCaixa) e só é agrupada/ordenada aqui. O botão leva pra aba que decide.

import { pendenciasDeTarefas } from "./tarefas.js";
import { estadoSugestaoAfiliado } from "./estados.js";
import { andamentoAtrasado, periodoLigado } from "./ads.js";
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

// ---- Quanto vale cada aviso em R$ (prévia aprovada em 24/10/2026: o topo do
// Início mostra "as 3 coisas que mais valem dinheiro hoje"). Estimativa simples,
// por semana; aviso sem valor conhecido usa um peso pelo grupo (VALOR_GRUPO).
export const VALOR_GRUPO = { resolver: 30, oportunidade: 8, rotina: 5 };
function valorAds(l, hoje) {
  const orc = (l.periodos || []).filter((p) => periodoLigado(p, hoje)).reduce((t, p) => t + Number(p.orcamento_diario || 0), 0);
  const semana = orc * 7;
  const av = l.av || {};
  const ret = av.numeros?.retorno != null ? Number(av.numeros.retorno) : null;
  // aumentar: o lucro a mais com +20% no orçamento
  if (av.chave === "aumentar") return ret > 1 ? semana * 0.2 * (ret - 1) : null;
  if (!(semana > 0)) return null;
  // sem venda nenhuma = o gasto inteiro está indo embora; com retorno conhecido = o que se perde
  if (ret != null && isFinite(ret)) return semana * Math.max(0, 1 - ret) || null;
  return semana;
}
function valorSubir(est) {
  if (!est?.lucroEm || !(est.lucroSemana > 0)) return null;
  const novo = est.sugestao?.saltos === 2 ? est.degraus?.[est.i + 2] : est.proximo;
  const a = est.lucroEm(est.preco);
  const b = novo ? est.lucroEm(novo) : null;
  return a > 0 && b > a ? est.lucroSemana * (b / a - 1) : null;
}
/** Nota de um aviso pra ordenar "o que mais vale": o valor em R$ ou o peso do grupo. */
export const notaDoAviso = (p) => (p.grupo === "resolver" ? Math.max(p.valor || 0, VALOR_GRUPO.resolver) : p.valor > 0 ? p.valor : VALOR_GRUPO[p.grupo] ?? 3);

export function montarPendencias({
  precosAlerta = [], // [{ item, canal, al }] anunciados com al.tipo prejuizo | abaixo-minimo (alertaDe)
  caixa = null, // resumoCaixa (fluxoCaixa.js)
  rampas = [], // linhas do Crescimento ({ r, produto, canal, est })
  anunciosAtualizar = [], // [{ item, canal, x }] linhasAnunciar: mudou e já marcado feito antes
  promosAcima = [], // [{ item, canal, x }] desconto acima do que a plataforma aceita (limitePromo.js)
  afSugestoes = [], // sugestoesAfiliado: só as dos parceiros ("amostra|…", "divulgou|…")
  afLoja = [], // comissão da loja (comissaoLoja.js → avisosComissaoLoja), já no formato de pendência
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
  campanhasAvisos = [], // campanhas do TikTok sem espaço pro cupom da live (campanhas.js → avisosCampanhas), já no formato de pendência
  cupomRuins = [], // [{ item, canal, lucro, estado }] cupom ativo da loja deixando anúncio no prejuízo/abaixo (cupomLoja.js)
  diagnosticos = [], // [{ l (montarAnuncios), d (lib/diagnostico.js) }] — só atenção/oportunidade
  vendasSemana = () => 0, // (itemId, canalId) → unidades por semana (pedidos de 4 semanas) — pro valor em R$ do aviso
  revisarME = false, // regime mudou de MEI pra Simples e ainda não foi revisado
  estoque = [], // useEstoque().linhas (revenda, v66) — repor / zerado / negativo
  limiteMei = null, // lib/revenda.js limiteMei() — só com regime MEI
  hoje = "",
}) {
  const out = [];
  const add = (p) => out.push(p);

  // ---- Revenda (v66): estoque a repor / negativo e o limite do MEI ----
  for (const l of estoque) {
    const t = l.sit?.tipo;
    if (!["repor", "zerado", "negativo"].includes(t)) continue;
    add({
      id: `estoque|${l.produto.id}`,
      grupo: "rotina",
      ordem: 3,
      tom: "warn",
      titulo: `${l.produto.nome}: ${t === "negativo" ? "estoque negativo" : t === "zerado" ? "estoque acabou" : l.fabricado ? "imprimir pro estoque" : "repor o estoque"}`,
      texto: l.sit.texto,
      valor: t === "negativo" ? 0 : Math.round((l.est.porDia || 0) * 7 * (Number(l.produto.custo_producao) || 0) * 0.5),
      ir: { aba: "estoque", pedido: { sub: t === "negativo" ? "inventario" : "estoque" } },
      rotulo: t === "negativo" ? "Conferir (inventário)" : "Ver estoque",
    });
  }
  // produtos de revenda criados pela nota com cadastro incompleto (SKU, peso, preço, NCM)
  const incompletos = estoque.filter((l) => l.faltas?.length);
  if (incompletos.length)
    add({
      id: "revenda|completar",
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `Completar o cadastro de ${incompletos.length} ${incompletos.length === 1 ? "produto" : "produtos"} de revenda`,
      texto: incompletos.slice(0, 3).map((l) => `${l.produto.nome} (falta ${l.faltas.join(", ")})`).join(" · ") + (incompletos.length > 3 ? ` · +${incompletos.length - 3}` : ""),
      ir: { aba: "estoque", pedido: { sub: "estoque" } },
      rotulo: "Ver a lista",
    });
  if (revisarME)
    add({
      id: "me|revisar",
      grupo: "rotina",
      ordem: 3,
      tom: "warn",
      titulo: "Virou ME: revisar os impostos da loja",
      texto: "anexos, imposto dos marketplaces, conta fixa do DAS MEI e faturamento de 12 meses — lista na aba Fiscal",
      ir: { aba: "fiscal", pedido: null },
      rotulo: "Ver a lista",
    });
  if (limiteMei?.atencao)
    add({
      id: "mei|limite",
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `Limite do MEI: ${Math.round(limiteMei.pct * 100)}% do ano já faturado`,
      texto: limiteMei.passaEm ? `no ritmo atual passa do limite por volta de ${limiteMei.passaEm.slice(8, 10)}/${limiteMei.passaEm.slice(5, 7)} — converse com o contador sobre virar ME` : "acompanhe o faturamento até o fim do ano",
      ir: { aba: "regras", pedido: null },
      rotulo: "Ver impostos da loja",
    });

  // ---- Diagnóstico comercial (24/10/2026): um aviso por diagnóstico que pede ação ----
  for (const { l, d } of diagnosticos)
    add({
      id: `diag|${d.chave}|${l.chave}`,
      grupo: d.estado === "oportunidade" ? "oportunidade" : "rotina",
      ordem: 3,
      tom: d.estado === "oportunidade" ? "good" : "warn",
      titulo: `${l.nome}: ${d.titulo.charAt(0).toLowerCase()}${d.titulo.slice(1)}`,
      texto: `${l.canal.nome} · ${d.evidencia.filter(Boolean)[0] || ""} — ${d.acao}`,
      ir: { aba: "anuncio", pedido: { itemId: l.itemId, canalId: l.canal.id, aba: "resumo" } },
      rotulo: "Ver diagnóstico",
    });

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
  for (const r of revisoes) {
    const { item, canal, motivos } = r;
    add({
      id: `revisar|${item.id}|${canal.id}`,
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `${item.nome}: vale revisar o preço?`,
      texto: `${canal.nome} · ${motivos.map((m) => m.texto).join(" · ")}`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
      revisado: r,
    });
  }

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
      valor: Math.abs(Number(al.agora?.lucro ?? al.linha?.lucro) || 0) * vendasSemana(item.id, canal.id) || null,
      id: `prejuizo|${item.id}|${canal.id}`,
      grupo: "resolver",
      ordem: 1,
      tom: "bad",
      titulo: `${item.nome}: dando prejuízo`,
      texto: `${canal.nome} · cada venda no preço salvo perde dinheiro${al.discreto ? " (explicado pela estratégia)" : ""}`,
      ir: { aba: "historico", pedido: { busca: item.nome } },
      rotulo: "Ver em Produtos precificados",
    });
  for (const { item, canal, al } of precosAlerta.filter((a) => a.al?.tipo === "abaixo-minimo"))
    add({
      valor: al.minimo != null && al.linha?.preco != null ? Math.max(0, Number(al.minimo) - Number(al.linha.preco)) * vendasSemana(item.id, canal.id) || null : null,
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
      valor: pagar + receber,
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
    // produto parado SEM gastar nada não é aviso (prévia aprovada em 24/10/2026): vai pro
    // relatório Produtos parados; com Ads ligado é dinheiro saindo → continua aqui
    if (sg.chave === "sem-venda" && !l.ctx?.adsAtivo) continue;
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
      add({ id: `gmv-furo|${f.de}|${f.ate}`, grupo: "rotina", ordem: 3, tom: "warn", titulo: `GMV Max da Loja: ${f.de === f.ate ? `falta o dia ${dmI(f.de)}` : `faltam os dias ${dmI(f.de)} a ${dmI(f.ate)}`}`, texto: "exporte esse período na Shopee e envie em Importar dados → GMV Max da Loja (soma sem duplicar)", ir: { aba: "importar" }, rotulo: "Abrir a importação" });
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
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|dia3`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: ${av.semVenda?.dias || 3} dias pagando Ads sem venda`, texto: `${l.canal.nome} · pause e arrume o anúncio antes de gastar mais`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    if (av.chave === "ads-prejuizo") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|prejuizo`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: Ads no prejuízo`, texto: `${l.canal.nome} · ${av.titulo.replace(/^Ads no prejuízo — /, "")} · pause e arrume o anúncio`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    // Queda com o Ads ligado (17/10/2026).
    if (av.chave === "parou-ads" || av.chave === "queda-ads") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|${av.chave}`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · ${av.chave === "parou-ads" ? "confira anúncio, estoque e preço — pause até descobrir" : "reduza o orçamento ou suba a meta"}`, ir: irL, rotulo: "Ver o que fazer" });
      continue;
    }
    if (av.chave === "queda-ads-sinal") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|queda-sinal`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.split(" — ")[0]}`, texto: `${l.canal.nome} · avalie a causa, sem mexer ainda — o app pede pra agir se seguir assim até ${av.decideEm ? `${av.decideEm.slice(8, 10)}/${av.decideEm.slice(5, 7)}` : "o 7º dia"}`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "despausar") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|despausar`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: já revisou? Despause o Ads`, texto: `${l.canal.nome} · pausado desde ${av.pausado?.desde ? `${av.pausado.desde.slice(8, 10)}/${av.pausado.desde.slice(5, 7)}` : "—"}`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "pausa-longa") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|pausa-longa`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: Ads pausado há ${av.pausado?.desde ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${av.pausado.desde}T12:00:00`)) / 86400000) : 21} dias`, texto: `${l.canal.nome} · a Shopee começa a perder o aprendizado — despause ou encerre o período`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "dia3-noite") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|dia3-noite`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.item.nome}: dia 3 do Ads sem venda — confira hoje à noite`, texto: `${l.canal.nome} · se até umas 22h não vender, pause e revise o anúncio`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "conferir-dia3") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|conferir`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()} do Ads`, texto: `${l.canal.nome} · pra saber se já vendeu (sem venda em 3 dias = parar e arrumar o anúncio)`, ir: { aba: "importar" }, rotulo: "Abrir importação" });
      continue;
    }
    if (av.chave === "virar-meta") {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|virar-meta`, grupo: av.estado === "oportunidade" ? "oportunidade" : "rotina", ordem: 1, tom: av.estado === "oportunidade" ? "good" : "warn", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · fim dos 7 dias no lance automático`, ir: irL, rotulo: "Ver" });
      continue;
    }
    if (["loja-abaixo", "loja-nao-gasta"].includes(av.chave) || (av.loja && av.chave === "aguardando")) {
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|${av.chave}`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `Campanha da loja: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · GMV Max da Loja`, ir: irL, rotulo: "Abrir Ads" });
      continue;
    }
    if (av.chave === "pausar-revisar")
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}`, grupo: "resolver", ordem: 4, tom: "bad", titulo: `${l.item.nome}: Ads com cliques sem venda`, texto: `${l.canal.nome} · ${av.titulo}`, ir: irL, rotulo: "Abrir Ads" });
    else if (["pausar", "reduzir", "inviavel-ativo", "subir-meta", "arrumar-anuncio"].includes(av.chave))
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · Ads abaixo ${av.sazonal && av.minimo !== av.empate ? "do mínimo da temporada" : "do ROAS de equilíbrio"} (${(av.minimo ?? av.empate) ? (av.minimo ?? av.empate).toFixed(1).replace(".", ",") : "—"})`, ir: irL, rotulo: "Abrir Ads" });
    else if (av.chave === "segurar-producao")
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|producao`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: segurar o Ads`, texto: `${l.canal.nome} · as vendas subiram e a produção não acompanha`, ir: irL, rotulo: "Abrir Ads" });
    else if (["pausar-corte", "atualizar-andamento"].includes(av.chave))
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|${av.chave}`, grupo: "rotina", ordem: 1, tom: "warn", titulo: `${l.item.nome}: ${av.titulo.toLowerCase()}`, texto: `${l.canal.nome} · ${av.chave === "pausar-corte" ? "último dia de entrega passou" : "fase Alavancar decide a cada 3–4 dias"}`, ir: irL, rotulo: "Abrir Ads" });
    else if (["aumentar", "meta-alta"].includes(av.chave))
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}`, grupo: "oportunidade", ordem: 1, tom: "good", titulo: `${l.item.nome}: ${av.titulo}`, texto: `${l.canal.nome} · ${av.chave === "aumentar" ? `retorno ${av.numeros?.retorno != null ? av.numeros.retorno.toFixed(1).replace(".", ",") : "—"}× o equilíbrio` : "a Shopee gastou pouco do orçamento"} · mude entre 22h e meia-noite`, ir: irL, rotulo: "Abrir Ads" });
    if (av.avisoMeta)
      add({ valor: valorAds(l, hoje), id: `ads|${l.chave}|meta-alta-inicio`, grupo: "rotina", ordem: 2, tom: "warn", titulo: `${l.item.nome}: meta de ROAS alta pra começar`, texto: `${l.canal.nome} · meta ${av.avisoMeta.meta.toFixed(1).replace(".", ",")} — comece com ${av.avisoMeta.sugerida.toFixed(1).replace(".", ",")}`, ir: irL, rotulo: "Abrir Ads" });
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
        texto: "CSV do Shopee Ads (do início de cada período até ontem) em Atualizar dados — as decisões do Ads e as semanas usam ele",
        ir: { aba: "importar" },
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
        ir: { aba: "importar" },
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
      ir: { aba: "importar" },
      rotulo: "Abrir a central",
    });
  }

  // Cupons ativos da loja (22/10/2026): anúncio que fica no prejuízo/abaixo do mínimo com o cupom.
  if (cupomRuins?.length) {
    const prej = cupomRuins.filter((x) => x.estado === "prejuizo");
    add({
      id: "cupom|loja",
      grupo: "rotina",
      ordem: 2,
      tom: "warn",
      titulo: `Cupom da loja: ${cupomRuins.length} anúncio${cupomRuins.length > 1 ? "s" : ""} ${prej.length ? "no prejuízo" : "abaixo do mínimo"} com o cupom`,
      texto: `${cupomRuins.slice(0, 2).map((x) => `${x.item.nome} (${x.canal.nome}): lucro ${brl(x.lucro)} numa compra de 1 un.`).join(" · ")}${cupomRuins.length > 2 ? "…" : ""} — suba o pedido mínimo do cupom ou tire esses itens dele`,
      ir: { aba: "promocoes", pedido: { sub: "cupom" } },
      rotulo: "Ver cupom da loja",
    });
  }

  // Vínculo de SKU (22/10/2026): venda ligada ao item só pelo começo do SKU (lib/vinculoSku.js).
  if (importacoes?.peloComeco?.length) {
    const ls = importacoes.peloComeco;
    add({
      id: "analise|sku-comeco",
      grupo: "rotina",
      ordem: 2,
      tom: "warn",
      titulo: `Conferir o SKU de ${ls.length} venda${ls.length > 1 ? "s" : ""} — ligada${ls.length > 1 ? "s" : ""} só pelo começo do SKU`,
      texto: `${ls.slice(0, 2).map((g) => `${g.sku} → ${g.item.nome}`).join(" · ")}${ls.length > 2 ? "…" : ""} · se for opção de anúncio com vários itens, cadastre a Cor/sufixo na Ficha`,
      ir: { aba: "importar" },
      rotulo: "Ver em Atualizar dados",
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
  // Um aviso por anúncio a atualizar (24/10/2026 — Início por produto: cada um
  // entra no cartão do produto dele).
  for (const a of anunciosAtualizar)
    add({
      id: `anunciar|${a.item.id}|${a.canal.id}`,
      grupo: "rotina",
      ordem: 4,
      tom: "warn",
      titulo: `${a.item.nome}: atualizar o anúncio`,
      texto: `${a.canal.nome} · ${a.x?.oQueMudou || "o preço de agora mudou"}`,
      ir: { aba: "publicar" },
      rotulo: "Abrir Anunciar",
    });
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
      valor: valorSubir(l.est),
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
  for (const p of afLoja) add(p);
  for (const p of campanhasAvisos) add(p);
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

// ---- Início por PRODUTO (24/10/2026, aprovado pela prévia inicio-novo-v1) ----
// Avisos de rotina dos arquivos (importar pedidos/desempenho, CSV do Ads,
// avaliações, SKU) saem do Pra fazer e vão pro bloco "Seus dados".
const IDS_DADOS = ["analise|importar", "analise|avaliacoes", "ads|andamento", "analise|sku-comeco"];
export const ehAvisoDeDados = (p) => !p.tarefa && (IDS_DADOS.includes(p.id) || String(p.id).startsWith("gmv-furo|"));

/** Nome do produto do aviso ("<Nome>: …"; variação "X — Kit 2" e "(kit …)" viram X) e o canal (começo do texto). */
export function produtoDoAviso(p, nomesCanais) {
  if (!p || p.tarefa) return null;
  const m = /^(?:Anúncio:\s)?(.+?):\s/.exec(p.titulo || "");
  if (!m) return null;
  const nome = m[1].replace(/\s+[—–-]\s+.*$/, "").replace(/\s*\((kit|variação)[^)]*\)\s*$/i, "").trim();
  if (!nome || /^(GMV Max da Loja|Campanha da loja|Cupom da loja)$/i.test(nome)) return null;
  const c = String(p.texto || "").split(" · ")[0].trim();
  return { nome, canal: nomesCanais.includes(c) ? c : null, anuncio: /^Anúncio:\s/.test(p.titulo || "") };
}

/** Avisos → { produtos: [{ id, nome, grupo, tom, itens, canais }], loja: [avisos] } — produto no grupo do aviso mais grave. */
export function agruparPorProduto(avisos, nomesCanais, ehProduto = () => true) {
  const porNome = new Map();
  const loja = [];
  for (const p of avisos) {
    const k = produtoDoAviso(p, nomesCanais);
    if (!k || !ehProduto(k.nome)) {
      loja.push(p);
      continue;
    }
    // um cartão por ANÚNCIO = item × canal (prévia aprovada em 24/10/2026)
    const chave = `${k.nome.toLowerCase()}|${k.canal || ""}`;
    let g = porNome.get(chave);
    if (!g) porNome.set(chave, (g = { produto: true, id: `produto|${chave}`, nome: k.nome, anuncio: k.anuncio, canal: k.canal || null, itens: [], canais: [] }));
    g.itens.push({ ...p, _canal: k.canal });
    if (k.canal && !g.canais.includes(k.canal)) g.canais.push(k.canal);
  }
  const produtos = [...porNome.values()].map((g) => {
    g.itens.sort((a, b) => (ORDEM_GRUPO[a.grupo] ?? 3) - (ORDEM_GRUPO[b.grupo] ?? 3) || (a.ordem ?? 9) - (b.ordem ?? 9));
    g.grupo = g.itens[0].grupo;
    g.tom = g.itens[0].tom;
    return g;
  });
  produtos.sort((a, b) => (ORDEM_GRUPO[a.grupo] ?? 3) - (ORDEM_GRUPO[b.grupo] ?? 3) || b.itens.length - a.itens.length);
  return { produtos, loja };
}

/** Situação das importações (bloco "Seus dados"): [{ chave, rotulo, texto, estado: ok|atencao|info }]. */
export function situacaoDados({ importacoes, avaliacoesPend = [], temAdsLigado = false, hoje, erp = "Olist" }) {
  if (!importacoes?.disponivel) return [];
  const dias = (rel) => {
    const u = [...(importacoes.lista || [])].filter((i) => i.ok && (typeof rel === "string" ? i.relatorio === rel : rel(i.relatorio))).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))[0];
    if (!u?.criado_em) return null;
    const d = new Date(u.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    return Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${d}T12:00:00`)) / 86400000);
  };
  const quando = (d) => (d == null ? "nunca enviado" : d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`);
  const out = [];
  const dp = dias((r) => String(r).startsWith("pedidos:"));
  if (erp) out.push({ chave: "pedidos", rotulo: `Pedidos (${erp})`, texto: quando(dp), estado: dp == null || dp > 7 ? "atencao" : "ok" });
  if ((importacoes.plataformas || []).some((p) => p.id === "shopee")) {
    const dd = dias("shopee:desempenho");
    out.push({ chave: "desempenho", rotulo: "Desempenho Shopee", texto: quando(dd), estado: dd == null || dd > 7 ? "atencao" : "ok" });
    const da = dias("shopee:ads");
    if (temAdsLigado || da != null) out.push({ chave: "ads", rotulo: "Ads (CSV)", texto: quando(da), estado: temAdsLigado && (da == null || da > 3) ? "atencao" : "ok" });
  }
  const n = avaliacoesPend.length;
  out.push({ chave: "avaliacoes", rotulo: "Avaliações", texto: n ? `${n} anúncio${n > 1 ? "s venderam" : " vendeu"} sem conferir` : "em dia", estado: n ? "atencao" : "ok" });
  return out;
}
