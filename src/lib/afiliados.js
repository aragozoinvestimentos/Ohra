// Crescimento → Afiliados (schema v35). Lógica pura: comissão máxima por item
// (maior % que ainda deixa o lucro mínimo da loja), comissão em vigor
// (padrão do canal ou própria do item), números da semana, vendas por origem,
// retorno de amostra e sugestões. Nada aqui grava no banco.
import { lucroNoPreco } from "./escada.js";
import { itemTipoDoId } from "./variacoes.js";
import { estrategiaEfetiva } from "./estrategia.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;

export const STATUS_PARCEIRO = [
  { chave: "convidado", rotulo: "convidado" },
  { chave: "amostra", rotulo: "amostra enviada" },
  { chave: "divulgou", rotulo: "divulgou" },
  { chave: "ativo", rotulo: "ativo" },
  { chave: "parado", rotulo: "parado" },
];
export const DIAS_SEM_DIVULGAR = 15; // amostra enviada há mais que isso sem post = parado
export const DIAS_TESTE_COMISSAO = 30; // comissão ativa há 30 dias com poucas vendas → subir
export const POUCAS_VENDAS_30D = 3;

export function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}
export function somarDias(iso, d) {
  const x = new Date(`${iso}T12:00:00`);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}
// Segunda-feira da semana da data (ISO).
export function semanaDe(iso) {
  const x = new Date(`${iso}T12:00:00`);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x.toISOString().slice(0, 10);
}

// Lucro mínimo aceitável em R$ num preço: o maior entre margem mínima × preço e o lucro mínimo em R$.
export function lucroMinimoNoPreco(preco, cfg) {
  return Math.max(num(cfg?.margemMin) * preco, num(cfg?.lucroMinimo));
}

// Maior comissão (fração, % inteiro pra baixo) que ainda deixa o lucro mínimo.
export function comissaoMaxima(preco, lucro, cfg) {
  if (!(preco > 0) || lucro == null) return 0;
  const folga = lucro - lucroMinimoNoPreco(preco, cfg);
  if (folga <= 0) return 0;
  return Math.floor((folga / preco) * 100 + 1e-9) / 100;
}

// Fração das vendas via afiliado que é venda NOVA (o resto o cliente já ia
// comprar de qualquer jeito, e a comissão só tira do lucro). Com 50%, a
// comissão compensa enquanto for ≤ metade do lucro ÷ preço.
export const FRACAO_VENDA_NOVA = 0.5;

// Comissão "ideal": a que ainda deixa a SUA margem desejada inteira — o
// afiliado só fica com o que sobra acima dela (prioridade é o seu lucro).
export function comissaoIdeal(preco, lucro, cfg) {
  if (!(preco > 0) || lucro == null) return 0;
  const folga = lucro - num(cfg?.margemDesejada) * preco;
  if (folga <= 0) return 0;
  return Math.floor((folga / preco) * 100 + 1e-9) / 100;
}

// Comissão recomendada = a menor entre a ideal (sua margem desejada), o teto
// de venda nova (FRACAO_VENDA_NOVA × lucro ÷ preço) e a máxima (lucro
// mínimo). null = sem espaço acima da sua margem: não ativar afiliado.
export function comissaoRecomendada(preco, lucro, cfg) {
  if (!(preco > 0) || lucro == null || lucro <= 0) return null;
  const tetoNova = Math.floor(((FRACAO_VENDA_NOVA * lucro) / preco) * 100 + 1e-9) / 100;
  const c = Math.min(comissaoIdeal(preco, lucro, cfg), tetoNova, comissaoMaxima(preco, lucro, cfg));
  return c >= 0.01 ? c : null;
}

const mesmoItem = (c, tipo, id, canalId) => c.item_tipo === tipo && c.item_id === id && c.canal_id === canalId;

export function padraoDoCanal(config, canalId) {
  const row = (config || []).find((c) => c.canal_id === canalId && !c.item_tipo);
  return { row: row || null, comissao: row && row.ativo && num(row.comissao) > 0 ? num(row.comissao) : null };
}

// Comissão em vigor de um item num canal. Item precisa estar ativado (linha
// própria com ativo); comissão própria ou, vazia, a padrão do canal.
export function comissaoDoItem(config, tipo, id, canalId) {
  const pad = padraoDoCanal(config, canalId);
  const row = (config || []).find((c) => mesmoItem(c, tipo, id, canalId)) || null;
  if (!row || !row.ativo) return { ativo: false, comissao: null, fonte: null, padrao: pad.comissao, row };
  const propria = row.comissao != null && row.comissao !== "" ? num(row.comissao) : null;
  const c = propria ?? pad.comissao;
  if (!(c > 0)) return { ativo: false, comissao: null, fonte: null, padrao: pad.comissao, row, semPadrao: true };
  return { ativo: true, comissao: c, fonte: propria != null ? "propria" : "padrao", padrao: pad.comissao, row };
}

const PREFIXO = { produto: "p", variacao: "v", kit: "k" };
export const idPrefixado = (tipo, id) => `${PREFIXO[tipo] || "p"}:${id}`;

// Uma linha por item (produto, variação, kit) × canal com preço salvo.
// `linhasRampa` = linhas da aba Rampa (r, est): produto em rampa abaixo do
// alvo usa o preço do degrau e fica "em rampa: não usar ainda".
// Estratégia do preço (estrategia.js) manda: crescimento (escolhido, rampa ou
// kit com peça em rampa) = "não usar ainda"; atração = mostra os números mas
// não sugere ativar.
export function linhasComissao({ itens, canais, precos, cfgDoProduto, config, linhasRampa = [] }) {
  const out = [];
  const emRampaSet = new Set(linhasRampa.filter((l) => !["alvo", "acima"].includes(l.est.fase.chave)).map((l) => `${l.r.produto_id}|${l.r.canal_id}`));
  for (const it of itens) {
    const tipo = itemTipoDoId(it.id);
    const id = it.id.slice(2);
    const produtoId = tipo === "produto" ? id : it.produtoId || null;
    const cfg = cfgDoProduto(produtoId);
    for (const canal of canais) {
      const salvo = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id);
      if (!salvo || !(num(salvo.preco) > 0)) continue;
      const rampa = tipo === "produto" ? linhasRampa.find((l) => l.r.produto_id === id && l.r.canal_id === canal.id) : null;
      const emRampa = !!rampa && !["alvo", "acima"].includes(rampa.est.fase.chave);
      const estrategia = estrategiaEfetiva(it, canal, { precos, emRampa: emRampaSet });
      const naoUsar = estrategia.chave === "crescimento";
      const preco = rampa ? num(rampa.est.preco) : num(salvo.preco);
      const lucroEm = (p) => lucroNoPreco(canal, p, it.custoTotal, it.peso, cfg);
      const lucro = lucroEm(preco);
      const max = comissaoMaxima(preco, lucro, cfg);
      const recomendada = comissaoRecomendada(preco, lucro, cfg);
      const conf = comissaoDoItem(config, tipo, id, canal.id);
      const lucroCom = conf.ativo && lucro != null ? lucro - conf.comissao * preco : null;
      // acima = passa da máxima (prejuízo pro mínimo); alta = cabe na máxima
      // mas come a sua margem desejada; apertado = há folga até o mínimo,
      // mas nada acima da sua margem (não vale ativar).
      let situacao;
      if (naoUsar) situacao = "rampa";
      else if (conf.ativo && conf.comissao > max + 1e-9) situacao = "acima";
      else if (estrategia.chave === "atracao" && !conf.ativo) situacao = "atracao";
      else if (conf.ativo) situacao = recomendada != null && conf.comissao <= recomendada + 1e-9 ? "ok" : "alta";
      else if (recomendada != null) situacao = "pode";
      else if (max >= 0.01) situacao = "apertado";
      else situacao = "sem";
      out.push({
        chave: `${tipo}|${id}|${canal.id}`,
        item: it,
        tipo,
        id,
        produtoId,
        canal,
        cfg,
        preco,
        lucro,
        lucroEm,
        max,
        recomendada,
        conf,
        lucroCom,
        situacao,
        rampa,
        emRampa,
        estrategia,
        naoUsar,
        lucroMin: lucroMinimoNoPreco(preco, cfg),
      });
    }
  }
  const ordem = { acima: 0, alta: 1, ok: 2, pode: 3, rampa: 4, atracao: 5, apertado: 6, sem: 7 };
  return out.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.item.nome.localeCompare(b.item.nome) || a.canal.nome.localeCompare(b.canal.nome));
}

// Custo de uma amostra: peças (custo de produção + embalagem, ao vivo) × qtd + frete informado.
export function custoAmostra(parceiro, itens) {
  if (!parceiro?.amostra_item_id) return null;
  const it = itens.find((i) => i.id === idPrefixado(parceiro.amostra_item_tipo, parceiro.amostra_item_id));
  if (!it) return null;
  const pecas = it.tipo === "Kit" ? num(it.custoTotal) : num(it.custoProducao) + num(it.embalagem);
  const qtd = Math.max(1, num(parceiro.amostra_qtd) || 1);
  return { item: it, pecas: cent(pecas * qtd), frete: num(parceiro.amostra_frete), total: cent(pecas * qtd + num(parceiro.amostra_frete)) };
}

// Status que vale na tela: amostra enviada há mais de DIAS_SEM_DIVULGAR dias sem post = parado (só na tela).
// registros = afiliado_registros: se já há venda registrada no nome do
// parceiro, ele divulgou (mesmo que o status não tenha sido marcado) — nunca
// aparece como "parado".
export function statusEfetivo(p, hoje, registros = []) {
  if (p.status === "amostra") {
    const d = diasEntre(p.amostra_data || p.status_desde, hoje);
    const vendeu = registros.filter((g) => g.parceiro_id === p.id).reduce((s, g) => s + num(g.vendas), 0);
    if (vendeu > 0) return { chave: "amostra", dias: d, vendeu };
    if (d != null && d > DIAS_SEM_DIVULGAR) return { chave: "parado", auto: true, dias: d };
    return { chave: "amostra", dias: d };
  }
  return { chave: p.status, dias: diasEntre(p.status_desde, hoje) };
}

// Lucro de um registro (vendas via afiliado × lucro no preço − comissão).
function lucroDoRegistro(g, linha) {
  if (!linha) return { receita: 0, lucro: -num(g.comissao) };
  const preco = num(g.preco) || linha.preco;
  const l = linha.lucroEm(preco) ?? 0;
  return { receita: num(g.vendas) * preco, lucro: num(g.vendas) * l - num(g.comissao) };
}

// Por parceiro: vendas, comissão paga, lucro gerado e retorno da amostra.
export function resumoParceiro(p, { registros, mapaLinhas, itens }) {
  const regs = registros.filter((g) => g.parceiro_id === p.id);
  const vendas = regs.reduce((s, g) => s + num(g.vendas), 0);
  const comissao = regs.reduce((s, g) => s + num(g.comissao), 0);
  const lucro = regs.reduce((s, g) => s + lucroDoRegistro(g, mapaLinhas.get(`${g.item_tipo}|${g.item_id}|${g.canal_id}`)).lucro, 0);
  const amostra = custoAmostra(p, itens);
  const retorno = amostra && amostra.total > 0 && vendas > 0 ? lucro / amostra.total : null;
  return { vendas, comissao, lucro, amostra, retorno };
}

// Números da semana (últimos 7 dias, mesmo corte da rampa).
export function resumoSemana({ afRegistros, rampaRegistros, rampas, mapaLinhas, linhasRampa, hoje }) {
  const corte = somarDias(hoje, -7);
  const af = afRegistros.filter((g) => g.data > corte);
  const vendasAf = af.reduce((s, g) => s + num(g.vendas), 0);
  const comissao = af.reduce((s, g) => s + num(g.comissao), 0);
  let receitaAf = 0;
  let lucroAf = 0;
  for (const g of af) {
    const r = lucroDoRegistro(g, mapaLinhas.get(`${g.item_tipo}|${g.item_id}|${g.canal_id}`));
    receitaAf += r.receita;
    lucroAf += r.lucro;
  }
  // total vendido na semana: rampas (último registro de semana de cada uma) + itens fora de rampa
  const rampaSem = rampaRegistros.filter((g) => g.tipo === "semana" && g.data > corte && rampas.some((r) => r.id === g.rampa_id));
  const total = rampaSem.reduce((s, g) => s + num(g.vendas), 0) + af.reduce((s, g) => s + num(g.vendas_total), 0);
  // Ads da semana (pra comparar o custo)
  let adsGasto = 0;
  let adsVendas = 0;
  let adsReceita = 0;
  for (const g of rampaSem) {
    adsGasto += num(g.ads_gasto);
    adsVendas += num(g.ads_vendas);
    adsReceita += num(g.ads_vendas) * num(g.preco);
  }
  for (const g of af) {
    if (g.vendas_total == null) continue;
    adsGasto += num(g.ads_gasto);
    adsVendas += num(g.ads_vendas);
    adsReceita += num(g.ads_vendas) * (num(g.preco) || mapaLinhas.get(`${g.item_tipo}|${g.item_id}|${g.canal_id}`)?.preco || 0);
  }
  // comissão dos produtos em rampa (pra tirar do "Lucro da semana" da rampa)
  const comissaoRampa = af
    .filter((g) => g.item_tipo === "produto" && linhasRampa.some((l) => l.r.produto_id === g.item_id && l.r.canal_id === g.canal_id))
    .reduce((s, g) => s + num(g.comissao), 0);
  return { vendasAf, comissao, receitaAf, lucroAf, total, adsGasto, adsVendas, adsReceita, comissaoRampa, temRegistro: af.length > 0 };
}

// Vendas por origem (orgânico / Ads / afiliado) por semana (segunda-feira), últimas `n` semanas.
export function vendasPorOrigem({ afRegistros, rampaRegistros, rampas, hoje, n = 6 }) {
  const fim = semanaDe(hoje);
  const semanas = Array.from({ length: n }, (_, k) => somarDias(fim, -7 * (n - 1 - k)));
  const mapa = new Map(semanas.map((s) => [s, { semana: s, total: 0, ads: 0, afiliado: 0, comissao: 0, adsGasto: 0 }]));
  for (const g of rampaRegistros) {
    if (g.tipo !== "semana" || !rampas.some((r) => r.id === g.rampa_id)) continue;
    const m = mapa.get(semanaDe(g.data));
    if (!m) continue;
    m.total += num(g.vendas);
    m.ads += num(g.ads_vendas);
    m.adsGasto += num(g.ads_gasto);
  }
  for (const g of afRegistros) {
    const m = mapa.get(semanaDe(g.data));
    if (!m) continue;
    m.afiliado += num(g.vendas);
    m.comissao += num(g.comissao);
    if (g.vendas_total != null) {
      m.total += num(g.vendas_total);
      m.ads += num(g.ads_vendas);
      m.adsGasto += num(g.ads_gasto);
    }
  }
  return semanas.map((s) => {
    const m = mapa.get(s);
    const total = Math.max(m.total, m.ads + m.afiliado);
    return { ...m, total, organico: Math.max(0, total - m.ads - m.afiliado) };
  });
}

// Sugestões com ação. `regras` = regras da rampa (avaliações/nota pra amostra).
export function sugestoesAfiliado({ linhas, parceiros, afRegistros, regras, itens, hoje }) {
  const out = [];
  const pctTxt = (c) => `${Math.round(c * 100)}%`;
  // 1) comissão acima da máxima
  for (const l of linhas.filter((x) => x.situacao === "acima")) {
    const pct = Math.round(l.conf.comissao * 100);
    const alvo = l.recomendada ?? (l.max >= 0.01 ? l.max : null);
    out.push({
      chave: `acima|${l.chave}`,
      tom: "bad",
      icone: "!",
      titulo: `${l.item.nome}: comissão acima da máxima`,
      texto: alvo
        ? `${pct}% deixa ${fmt(l.lucroCom)} de lucro, abaixo do mínimo (${fmt(l.lucroMin)}). Use ${pctTxt(alvo)} só neste item${l.recomendada ? " (recomendado)" : ""} ou tire ele da campanha.`
        : `${pct}% deixa ${fmt(l.lucroCom)} de lucro e não sobra margem pra comissão neste preço. Tire o item da campanha.`,
      acao: alvo ? { tipo: "usar", linha: l, comissao: alvo, rotulo: `Usar ${pctTxt(alvo)}` } : { tipo: "desativar", linha: l, rotulo: "Tirar da campanha" },
    });
  }
  // 1b) comissão dentro da máxima, mas comendo a sua margem desejada
  for (const l of linhas.filter((x) => x.situacao === "alta")) {
    out.push({
      chave: `alta|${l.chave}`,
      tom: "warn",
      icone: "%",
      titulo: `${l.item.nome}: ${pctTxt(l.conf.comissao)} come a sua margem (${l.canal.nome})`,
      texto: l.recomendada
        ? `Cabe no mínimo, mas tira da sua margem desejada. Recomendado: ${pctTxt(l.recomendada)} (afiliado ganha ${fmt(l.recomendada * l.preco)} por venda).`
        : `Cabe no mínimo, mas neste preço não sobra nada acima da sua margem desejada — afiliado só se houver espaço.`,
      acao: l.recomendada
        ? { tipo: "usar", linha: l, comissao: l.recomendada, rotulo: `Usar ${pctTxt(l.recomendada)}` }
        : { tipo: "desativar", linha: l, rotulo: "Tirar da campanha" },
    });
  }
  // 2) item que pode entrar na campanha aberta sem passar do recomendado
  const podem = linhas.filter((l) => l.situacao === "pode" && l.conf.padrao && l.recomendada + 1e-9 >= l.conf.padrao);
  for (const l of podem.slice(0, 3)) {
    const nota = l.rampa?.est.nota;
    out.push({
      chave: `pode|${l.chave}`,
      tom: "good",
      icone: "↑",
      titulo: `${l.item.nome} pode entrar na campanha (${l.canal.nome})`,
      texto: `${l.rampa ? "No alvo" : "Preço salvo"}${nota != null ? `, nota ${String(nota).replace(".", ",")}` : ""}: os ${pctTxt(l.conf.padrao)} da campanha cabem no recomendado (até ${pctTxt(l.recomendada)}) sem tocar na sua margem.`,
      acao: { tipo: "ativar", linha: l, rotulo: "Ativar" },
    });
  }
  if (podem.length > 3)
    out.push({ chave: "pode-mais", tom: "neutro", icone: "↑", titulo: podem.length - 3 === 1 ? "Mais 1 item pode entrar na campanha" : `Mais ${podem.length - 3} itens podem entrar na campanha`, texto: "Veja os marcados “pode ativar” na tabela de comissão." });
  // 3) hora de mandar amostra (rampa no alvo, com avaliações e nota boas, folga
  //    pra comissão e sem amostra desse produto ainda)
  for (const l of linhas.filter((x) => x.rampa && x.tipo === "produto" && !x.emRampa && x.recomendada != null)) {
    const e = l.rampa.est;
    if (!(e.avaliacoesTotal >= regras.avaliacoes && e.nota != null && e.nota >= regras.nota)) continue;
    if (parceiros.some((p) => p.amostra_item_tipo === "produto" && p.amostra_item_id === l.id)) continue;
    if (out.some((s) => s.chave.startsWith(`amostra|produto|${l.id}|`))) continue;
    const ca = custoAmostra({ amostra_item_tipo: "produto", amostra_item_id: l.id, amostra_qtd: 1, amostra_frete: 0 }, itens);
    out.push({
      chave: `amostra|${l.chave}`,
      tom: "neutro",
      icone: "✉",
      titulo: `Hora de mandar amostra do ${l.item.nome}`,
      texto: `${e.avaliacoesTotal} avaliações, nota ${String(e.nota).replace(".", ",")} — o anúncio já converte. A peça custa ~${fmt(ca?.total ?? 0)} + o frete.`,
      acao: { tipo: "amostra", linha: l, rotulo: "Escolher parceiro" },
    });
  }
  // 4) parceiro com amostra e sem divulgar
  for (const p of parceiros.filter((x) => x.status === "amostra")) {
    const st = statusEfetivo(p, hoje, afRegistros);
    if (st.vendeu) {
      out.push({
        chave: `divulgou|${p.id}`,
        tom: "good",
        icone: "✓",
        titulo: `${p.nome} já vendeu ${st.vendeu}`,
        texto: "Tem venda registrada no nome desse parceiro — ele divulgou. Marque pra acompanhar como ativo.",
        acao: { tipo: "divulgou", parceiro: p, rotulo: "Marcar divulgou" },
      });
      continue;
    }
    out.push({
      chave: `divulgou|${p.id}`,
      tom: st.auto ? "bad" : "warn",
      icone: "⏳",
      titulo: `${p.nome} ainda não divulgou`,
      texto: st.auto
        ? `Amostra enviada há ${st.dias} dias sem post — está como parado. Se divulgou, marque; senão, siga pro próximo parceiro.`
        : `Amostra enviada há ${st.dias ?? 0} dia(s). Se passar de ${DIAS_SEM_DIVULGAR} dias sem post, o app marca como parado.`,
      acao: { tipo: "divulgou", parceiro: p, rotulo: "Marcar divulgou" },
    });
  }
  // 5) comissão ativa há 30 dias com poucas vendas → subir até a recomendada
  const corte30 = somarDias(hoje, -DIAS_TESTE_COMISSAO);
  for (const l of linhas.filter((x) => x.situacao === "ok" && x.conf.row)) {
    const desde = String(l.conf.row.atualizado_em || l.conf.row.criado_em || "").slice(0, 10);
    if (!desde || desde > corte30) continue;
    if (l.recomendada == null || l.recomendada < l.conf.comissao + 0.01) continue;
    const v30 = afRegistros.filter((g) => g.item_tipo === l.tipo && g.item_id === l.id && g.canal_id === l.canal.id && g.data > corte30).reduce((s, g) => s + num(g.vendas), 0);
    if (v30 >= POUCAS_VENDAS_30D) continue;
    out.push({
      chave: `subir|${l.chave}`,
      tom: "neutro",
      icone: "%",
      titulo: `${l.item.nome}: ${v30 ? "poucas" : "nenhuma"} venda${v30 === 1 ? "" : "s"} via afiliado em ${DIAS_TESTE_COMISSAO} dias`,
      texto: `Dá pra subir de ${pctTxt(l.conf.comissao)} pra ${pctTxt(l.recomendada)} (recomendado — sua margem continua inteira). Teste por ${DIAS_TESTE_COMISSAO} dias.`,
      acao: { tipo: "usar", linha: l, comissao: l.recomendada, rotulo: `Subir pra ${pctTxt(l.recomendada)}` },
    });
  }
  // 6) afiliado tomando venda do orgânico → descer 2 pontos
  for (const l of linhas.filter((x) => x.conf.ativo && x.conf.comissao >= 0.03)) {
    const sem = semanasDoItem(l, afRegistros);
    if (sem.length < SEMANAS_CANIBAL * 2) continue;
    const rec = sem.slice(-SEMANAS_CANIBAL);
    const ant = sem.slice(-SEMANAS_CANIBAL * 2, -SEMANAS_CANIBAL);
    const tot = (xs) => xs.reduce((s, w) => s + w.total, 0);
    const afRec = rec.reduce((s, w) => s + w.af, 0);
    const totRec = tot(rec);
    if (!(totRec > 0) || afRec < 0.5 * totRec || totRec > tot(ant)) continue;
    const nova = Math.max(0.01, Math.round((l.conf.comissao - 0.02) * 100) / 100);
    out.push({
      chave: `descer|${l.chave}`,
      tom: "warn",
      icone: "↓",
      titulo: `${l.item.nome}: afiliado tomando venda do orgânico (${l.canal.nome})`,
      texto: `Nas últimas ${SEMANAS_CANIBAL} semanas ${afRec} das ${totRec} vendas vieram de afiliado, mas o total não cresceu (${tot(ant)} nas ${SEMANAS_CANIBAL} anteriores) — parte é venda que viria de qualquer jeito. Desça pra ${pctTxt(nova)} e compare de novo.`,
      acao: { tipo: "usar", linha: l, comissao: nova, rotulo: `Descer pra ${pctTxt(nova)}` },
    });
  }
  return out;
}

const SEMANAS_CANIBAL = 3;

// Vendas por semana de um item×canal: total (rampa = registro da semana;
// fora de rampa = vendas_total do registro de afiliado) e quantas via afiliado.
// Só entram semanas com o total informado.
function semanasDoItem(l, afRegistros) {
  const m = new Map();
  const pegar = (data) => {
    const k = semanaDe(data);
    if (!m.has(k)) m.set(k, { semana: k, total: null, af: 0 });
    return m.get(k);
  };
  for (const g of afRegistros) {
    if (g.item_tipo !== l.tipo || g.item_id !== l.id || g.canal_id !== l.canal.id) continue;
    const w = pegar(g.data);
    w.af += num(g.vendas);
    if (!l.rampa && g.vendas_total != null) w.total = (w.total ?? 0) + num(g.vendas_total);
  }
  if (l.rampa)
    for (const r of l.rampa.est.registros || []) {
      if (r.tipo !== "semana" || r.vendas == null) continue;
      const w = pegar(r.data);
      w.total = (w.total ?? 0) + num(r.vendas);
    }
  return [...m.values()].filter((w) => w.total != null).sort((a, b) => (a.semana < b.semana ? -1 : 1));
}

function fmt(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
