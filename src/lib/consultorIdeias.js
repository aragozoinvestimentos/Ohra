// Ideias da equipe da Sede (24/10/2026, pedido do Gustavo: "dê a mesma
// autonomia pros funcionários darem ideias; centralize no consultor e dê o
// crédito a quem teve a ideia"). SEM IA: cada funcionário olha a área dele nos
// dados e propõe algo que NÃO é aviso do Início (aviso = problema; ideia =
// oportunidade). O consultor junta, tira repetida/recusada, ordena e mostra
// no máximo IDEIAS_MAX por vez — sempre com o porquê e "como saber se deu certo".
import { compradosJuntos } from "./pedidos.js";

const num = (v) => Number(v) || 0;
export const IDEIAS_MAX = 3;
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const noPeriodo = (pedidos, de, ate) => (pedidos || []).filter((p) => p.valido && String(p.data).slice(0, 10) >= de && String(p.data).slice(0, 10) <= ate);
const paiDe = (it) => (it?.id?.startsWith("v:") && it.produtoId ? `p:${it.produtoId}` : it?.id);

/** ctx = { pedidos (linhas enriquecidas), linhasAds, hoje, kits, kitProdutos, nomes } → [ideia] */
export function ideiasDaEquipe(ctx) {
  const { pedidos = [], linhasAds = null, hoje, kits = [], kitProdutos = [] } = ctx;
  const out = [];
  const conferir = (dias) => `confira em ${dm(somarDias(hoje, dias))}`;

  // Célia (Análise): comprados juntos sem kit → montar kit
  const p90 = noPeriodo(pedidos, somarDias(hoje, -89), hoje);
  const itensDasLinhas = new Map();
  for (const p of p90) if (p.item) itensDasLinhas.set(p.item.id, p.item);
  const itensKits = kits.map((k) => ({ id: `k:${k.id}`, nome: k.nome, componentes: kitProdutos.filter((kp) => kp.kit_id === k.id).map((kp) => ({ produtoId: kp.produto_id, quantidade: kp.quantidade })) }));
  const juntos = compradosJuntos(p90, { itens: [...itensDasLinhas.values(), ...itensKits] }).filter((c) => !c.mesmoProduto && !c.kitExiste);
  const j = juntos[0];
  if (j)
    out.push({
      chave: `ideia|kit-juntos|${[j.a, j.b].sort().join("+")}`,
      de: "celia",
      titulo: `Montar um kit ${j.nomeA} + ${j.nomeB}`,
      ideia: `Criar o kit com os dois e anunciar com um pequeno desconto — o cliente já compra junto.`,
      porque: `${j.juntos} de ${j.pedidosA} pedidos com ${j.nomeA} levaram ${j.nomeB} (${pct(j.parte)}) nos últimos 90 dias, e ainda não existe kit com os dois.`,
      comoSaber: `Vendas do kit nas 2 semanas depois de anunciar e se o ticket médio subiu — ${conferir(21)}.`,
      ir: { aba: "analise", pedido: { sub: "abc" } },
      rotulo: "Ver comprados juntos",
    });

  // Nina (Anúncios): a variação que mais vende vira a capa / 1ª opção
  const p30 = noPeriodo(pedidos, somarDias(hoje, -29), hoje);
  const porPai = new Map();
  for (const p of p30) {
    if (!p.item) continue;
    const pai = paiDe(p.item);
    const g = porPai.get(pai) || { total: 0, porItem: new Map(), nomes: new Map() };
    g.total += 1;
    g.porItem.set(p.item.id, (g.porItem.get(p.item.id) || 0) + 1);
    g.nomes.set(p.item.id, p.item.nome);
    porPai.set(pai, g);
  }
  let melhorVar = null;
  for (const [pai, g] of porPai) {
    if (g.total < 6) continue;
    for (const [id, n] of g.porItem)
      if (id.startsWith("v:") && n / g.total >= 0.5 && (!melhorVar || n > melhorVar.n)) melhorVar = { pai, id, n, total: g.total, nome: g.nomes.get(id) };
  }
  if (melhorVar)
    out.push({
      chave: `ideia|capa-variacao|${melhorVar.id}`,
      de: "nina",
      titulo: `${melhorVar.nome}: usar como 1ª opção e foto de capa`,
      ideia: `Colocar ${melhorVar.nome} como a 1ª opção do anúncio e na foto de capa — é o que o cliente mais escolhe.`,
      porque: `${melhorVar.n} de ${melhorVar.total} pedidos do produto nos últimos 30 dias foram dessa opção (${pct(melhorVar.n / melhorVar.total)}).`,
      comoSaber: `Taxa de cliques (CTR) e vendas do anúncio nos 14 dias seguintes — ${conferir(14)}.`,
      ir: { aba: "anuncios" },
      rotulo: "Abrir Anúncios",
    });

  // Duda (Estoque & Expedição): o dia que mais vende → deixar pronto na véspera
  const p56 = noPeriodo(pedidos, somarDias(hoje, -55), hoje);
  const pedidosUnicos = new Map();
  for (const p of p56) if (!pedidosUnicos.has(p.pedido)) pedidosUnicos.set(p.pedido, String(p.data).slice(0, 10));
  if (pedidosUnicos.size >= 20) {
    const cont = Array(7).fill(0);
    for (const d of pedidosUnicos.values()) cont[new Date(`${d}T12:00:00`).getDay()]++;
    const max = Math.max(...cont);
    const dia = cont.indexOf(max);
    if (max / pedidosUnicos.size >= 0.25)
      out.push({
        chave: `ideia|dia-forte|${dia}`,
        de: "duda",
        titulo: `${DIAS_SEMANA[dia][0].toUpperCase()}${DIAS_SEMANA[dia].slice(1)} é o dia que mais vende`,
        ideia: `Deixar peças e embalagens prontas na véspera (${DIAS_SEMANA[(dia + 6) % 7]}) pra despachar no mesmo dia.`,
        porque: `${max} de ${pedidosUnicos.size} pedidos das últimas 8 semanas (${pct(max / pedidosUnicos.size)}) caíram na ${DIAS_SEMANA[dia]}.`,
        comoSaber: `Pedidos enviados no prazo nas próximas 4 semanas — ${conferir(28)}.`,
        ir: { aba: "analise", pedido: { sub: "evolucao" } },
        rotulo: "Ver dia que mais vende",
      });
  }

  // Leo (Ads): vende bem no orgânico e o Ads diz que pode impulsionar
  const p14 = noPeriodo(pedidos, somarDias(hoje, -13), hoje);
  const un14 = new Map();
  for (const p of p14) {
    const pai = paiDe(p.item);
    if (pai) un14.set(pai, (un14.get(pai) || 0) + num(p.q));
  }
  const pode = (linhasAds?.linhas || [])
    .filter((l) => l.av?.situacao === "pode" && !l.semAds && l.item?.id)
    .map((l) => ({ l, un: un14.get(l.item.id) || 0 }))
    .filter((x) => x.un >= 4)
    .sort((a, b) => b.un - a.un)[0];
  if (pode)
    out.push({
      chave: `ideia|ads-organico|${pode.l.chave}`,
      de: "leo",
      titulo: `${pode.l.item.nome}: testar Ads com R$ 10/dia`,
      ideia: `Ligar um período de Ads pequeno (R$ 10/dia, lance automático, 7 dias sem mexer).`,
      porque: `Vendeu ${pode.un} un. em 14 dias só no orgânico — o anúncio já converte, o Ads pode trazer mais gente.`,
      comoSaber: `ROAS do período acima do equilíbrio no 7º dia — ${conferir(7)}.`,
      ir: { aba: "crescimento", pedido: { sub: "ads", adsChave: pode.l.chave } },
      rotulo: "Abrir no Ads",
    });

  return out;
}
