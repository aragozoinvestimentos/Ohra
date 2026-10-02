// Rampa de preço (aba Crescimento, schema v33) — lógica pura.
//
// Ideia combinada com o Gustavo (out/2026): o produto entra na plataforma
// perto do 0 a 0 pra ganhar vendas/avaliações no orgânico e sobe em degraus
// pequenos (até ~5%, finais ,49/,99) até o PREÇO ALVO = o preço salvo em
// Produtos precificados, que NÃO muda (a rampa é uma camada à parte).
// Sobe só quando passa em todos os portões (avaliações, vendas, nota, dias no
// degrau, sem avaliação ruim recente); depois de subir, confere se o lucro
// da semana não caiu e se as vendas ficaram ≥ 60% — 1 semana ruim = segurar,
// 2 seguidas = sugerir voltar um degrau.
import { lucroNoPreco, precoParaLucro, precoParaMargem } from "./escada.js";

export const REGRAS_PADRAO = {
  avaliacoes: 10, // avaliações novas por degrau
  vendas: 30, // vendas por degrau
  nota: 4.7, // nota mínima pra subir
  dias: 7, // dias mínimos no degrau
  pisoVendas: 0.6, // depois de subir: vendas/semana ≥ 60% da semana antes
  passo: 0.05, // tamanho máximo do degrau
  lucroEntrada: 0.5, // R$ de lucro no 1º degrau (0 a 0 + isso)
  notaAlerta: 4.5, // abaixo disso: alerta pra revisar o produto
  roasInviavel: 8, // ROAS mínimo acima disso = Ads inviável no degrau
  revisarDias: 14, // dias no lançamento com < metade das vendas → revisar anúncio
};

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;

export function regrasDaLoja(configEscada) {
  return { ...REGRAS_PADRAO, ...(configEscada?.crescimento || {}) };
}

// Finais ,49 / ,99: o maior ≤ v e o menor ≥ v.
export const finalAbaixo = (v) => cent(Math.floor((v + 0.01 + 1e-9) * 2) / 2 - 0.01);
export const finalAcima = (v) => cent(Math.ceil((v + 0.01 - 1e-9) * 2) / 2 - 0.01);

// Ponto de equilíbrio (lucro zero) no canal, com custo/peso ao vivo.
export function zeroAZero(canal, custo, peso, cfg) {
  const p = precoParaMargem(canal, 0, custo, peso, cfg);
  return p != null ? Math.ceil(p * 100 - 1e-6) / 100 : null;
}

// Degraus sugeridos: do 1º (0 a 0 + lucroEntrada, final ,49/,99) até o alvo,
// cada um no máximo `passo` acima do anterior (arredondado pros finais).
export function sugerirDegraus({ canal, custo, peso, cfg, alvo, regras = REGRAS_PADRAO }) {
  const a = cent(num(alvo));
  if (!(a > 0)) return [];
  const pe = precoParaLucro(canal, num(regras.lucroEntrada), custo, peso, cfg);
  let p = pe != null ? finalAcima(pe) : a;
  if (p >= a) return [a];
  const out = [p];
  for (let i = 0; i < 40; i++) {
    let prox = finalAbaixo(p * (1 + num(regras.passo) || 0.05));
    if (prox <= p) prox = finalAcima(p + 0.02);
    if (prox >= a - 0.2) break; // o alvo vem logo em seguida
    out.push(prox);
    p = prox;
  }
  out.push(a);
  return out;
}

// Normaliza a lista digitada: números > 0, ordem crescente, sem repetidos.
export function normalizarDegraus(lista) {
  const vals = [...new Set((lista || []).map((v) => cent(num(v))).filter((v) => v > 0))].sort((x, y) => x - y);
  return vals;
}

export function faseDe(rampa) {
  const n = (rampa?.degraus || []).length;
  const i = rampa?.degrau_atual ?? 0;
  if (!n) return { chave: "lancamento", rotulo: "Lançamento" };
  if (i >= n - 1) return { chave: "alvo", rotulo: "No alvo" };
  if (i === 0) return { chave: "lancamento", rotulo: "Lançamento" };
  return { chave: "tracao", rotulo: "Tração" };
}

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// Estado completo de uma rampa (portões, check da subida, Ads, sugestão).
// ctx = { canal, custo, peso, cfg } do produto (ao vivo); registros = da rampa.
export function estadoRampa(rampa, registros, regras, ctx, hoje) {
  const degraus = (rampa.degraus || []).map(num);
  const i = Math.max(0, Math.min(degraus.length - 1, rampa.degrau_atual ?? 0));
  const preco = degraus[i] ?? null;
  const alvo = degraus[degraus.length - 1] ?? null;
  const proximo = i < degraus.length - 1 ? degraus[i + 1] : null;
  const lucroEm = (p) => (p > 0 && ctx.canal ? lucroNoPreco(ctx.canal, p, ctx.custo, ctx.peso, ctx.cfg) : null);
  const regs = (registros || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
  const semanas = regs.filter((r) => r.tipo === "semana");
  const ultimaSemana = semanas[semanas.length - 1] || null;
  const comAval = [...regs].reverse().find((r) => r.avaliacoes != null);
  const avaliacoesTotal = comAval ? num(comAval.avaliacoes) : num(rampa.base_avaliacoes);
  const comNota = [...regs].reverse().find((r) => r.nota != null && r.nota !== "");
  const nota = comNota ? num(comNota.nota) : null;
  const desde = rampa.desde || hoje;
  const vendasDesde = semanas.filter((s) => s.data >= desde).reduce((s, r) => s + num(r.vendas), 0);
  const vendasTotal = num(rampa.vendas_iniciais) + semanas.reduce((s, r) => s + num(r.vendas), 0);
  const avaliacoesDesde = Math.max(0, avaliacoesTotal - num(rampa.base_avaliacoes));
  const dias = Math.max(0, diasEntre(desde, hoje));
  const corte7 = menosDias(hoje, 7);
  const ruins7 = regs.filter((r) => r.data > corte7).reduce((s, r) => s + num(r.avaliacoes_ruins), 0);
  const noAlvo = i >= degraus.length - 1;

  const portoes = [
    { chave: "avaliacoes", rotulo: "Avaliações desde o último degrau", ok: avaliacoesDesde >= regras.avaliacoes, valor: `+${avaliacoesDesde} de +${regras.avaliacoes}`, falta: Math.max(0, regras.avaliacoes - avaliacoesDesde), curto: "avaliações" },
    { chave: "vendas", rotulo: "Vendas desde o último degrau", ok: vendasDesde >= regras.vendas, valor: `+${vendasDesde} de +${regras.vendas}`, falta: Math.max(0, regras.vendas - vendasDesde), curto: "vendas" },
    { chave: "nota", rotulo: `Nota ≥ ${String(regras.nota).replace(".", ",")}`, ok: nota != null && nota >= regras.nota, valor: nota != null ? String(nota).replace(".", ",") : "—", curto: "nota" },
    { chave: "dias", rotulo: `Tempo no degrau ≥ ${regras.dias} dias`, ok: dias >= regras.dias, valor: `${dias} dia${dias === 1 ? "" : "s"}`, falta: Math.max(0, regras.dias - dias), curto: "dias" },
    { chave: "ruins", rotulo: "Nenhuma avaliação 1–2★ nos últimos 7 dias", ok: ruins7 === 0, valor: String(ruins7), curto: "sem 1–2★" },
  ];
  const portoesOk = portoes.every((p) => p.ok);

  // Check depois da última mudança de degrau (subida): compara cada semana
  // registrada depois dela com a última semana antes dela.
  const ultimaSubida = [...regs].reverse().find((r) => r.tipo === "subida" || r.tipo === "descida");
  let check = null;
  if (ultimaSubida && ultimaSubida.tipo === "subida") {
    const antes = [...semanas].reverse().find((s) => s.data < ultimaSubida.data || (s.data === ultimaSubida.data && String(s.criado_em || "") < String(ultimaSubida.criado_em || "")));
    const depois = semanas.filter((s) => s.data > ultimaSubida.data || (s.data === ultimaSubida.data && String(s.criado_em || "") > String(ultimaSubida.criado_em || "")));
    if (antes && depois.length) {
      const lucroSem = (s) => num(s.vendas) * (lucroEm(num(s.preco) || preco) ?? 0);
      const lAntes = lucroSem(antes);
      const avaliar = depois.map((s) => {
        const lucroOk = lucroSem(s) >= lAntes - 0.005;
        const vendasOk = num(s.vendas) >= regras.pisoVendas * num(antes.vendas);
        return { s, lucro: lucroSem(s), lucroOk, vendasOk, ok: lucroOk && vendasOk };
      });
      let falhasSeguidas = 0;
      for (let k = avaliar.length - 1; k >= 0 && !avaliar[k].ok; k--) falhasSeguidas++;
      const ult = avaliar[avaliar.length - 1];
      check = {
        de: num(antes.preco),
        para: num(ultimaSubida.preco),
        lucroAntes: lAntes,
        lucroDepois: ult.lucro,
        vendasAntes: num(antes.vendas),
        vendasDepois: num(ult.s.vendas),
        lucroOk: ult.lucroOk,
        vendasOk: ult.vendasOk,
        falhasSeguidas,
      };
    } else if (antes) check = { de: num(antes.preco), para: num(ultimaSubida.preco), pendente: true };
  }

  // Ads: última semana com gasto.
  const lucroAtual = lucroEm(preco);
  const roasMin = lucroAtual > 0 ? preco / lucroAtual : null;
  const semanasAds = semanas.filter((s) => num(s.ads_gasto) > 0);
  const roasDe = (s) => (num(s.ads_gasto) > 0 ? (num(s.ads_vendas) * (num(s.preco) || preco)) / num(s.ads_gasto) : null);
  const organicoDe = (s) => (num(s.vendas) > 0 ? Math.max(0, num(s.vendas) - num(s.ads_vendas)) / num(s.vendas) : null);
  const ultAds = semanasAds[semanasAds.length - 1] || null;
  const roas = ultAds ? roasDe(ultAds) : null;
  const organico = ultimaSemana ? organicoDe(ultimaSemana) : null;
  const organicoAntes = semanas.length > 1 ? organicoDe(semanas[semanas.length - 2]) : null;
  const ultimas2Ads = semanasAds.slice(-2);
  const abaixo2 = ultimas2Ads.length === 2 && roasMin != null && ultimas2Ads.every((s) => (roasDe(s) ?? 0) < roasMin);
  const muitoAbaixo2 = ultimas2Ads.length === 2 && roasMin != null && ultimas2Ads.every((s) => (roasDe(s) ?? 0) < 0.8 * roasMin);
  let ads;
  if (roasMin == null || roasMin > regras.roasInviavel)
    ads = { chave: "inviavel", tom: "bad", titulo: "Ads inviável neste degrau", texto: roasMin == null ? "Sem lucro neste preço: cada venda paga dá prejuízo. Cresça no orgânico." : `Com lucro de ${moeda(lucroAtual)} por venda, cada R$ 1 de Ads precisa trazer ${moeda(roasMin)} de venda só pra empatar. Cresça no orgânico.` };
  else if (muitoAbaixo2) ads = { chave: "pausar", tom: "bad", titulo: "Pausar Ads", texto: "ROAS abaixo de 80% do mínimo por 2 semanas: o Ads está dando prejuízo." };
  else if (abaixo2) ads = { chave: "reduzir", tom: "warn", titulo: "Reduzir Ads em 25%", texto: "ROAS abaixo do mínimo por 2 semanas." };
  else if (organico != null && organico >= 0.6 && organicoAntes != null && organico >= organicoAntes - 0.05 && semanasAds.length)
    ads = { chave: "reduzir-aos-poucos", tom: "good", titulo: "Reduzir aos poucos", texto: `${Math.round(organico * 100)}% das vendas já são orgânicas: o anúncio anda sozinho. Corte 20–30% do orçamento por semana.` };
  else if (roas != null && roas >= 1.5 * roasMin && organico != null && organicoAntes != null && organico >= organicoAntes)
    ads = { chave: "aumentar", tom: "good", titulo: "Pode aumentar ~20%", texto: "ROAS bem acima do mínimo e o orgânico subindo." };
  else if (roas != null && roas >= roasMin) ads = { chave: "manter", tom: "neu", titulo: "Manter", texto: "ROAS acima do mínimo." };
  else if (roas != null) ads = { chave: "atencao", tom: "warn", titulo: "Atenção", texto: "ROAS abaixo do mínimo nesta semana — se repetir na próxima, reduza 25%." };
  else ads = { chave: "sem", tom: "neu", titulo: "Ads viável a partir deste degrau", texto: `ROAS mínimo para empatar: ${roasMin.toFixed(1).replace(".", ",")}. Se ligar, registre gasto e vendas via Ads na semana.` };
  // A partir de qual degrau o Ads fica viável
  let viavelEm = null;
  for (let k = i; k < degraus.length; k++) {
    const l = lucroEm(degraus[k]);
    if (l > 0 && degraus[k] / l <= regras.roasInviavel) {
      viavelEm = { preco: degraus[k], roasMin: degraus[k] / l };
      break;
    }
  }

  // Revisar anúncio
  // (com Ads inviável o problema é a margem do degrau, não a conversão)
  const revisarPorAds = abaixo2 && roasMin != null && roasMin <= regras.roasInviavel;
  const revisarPorLancamento = i === 0 && dias >= regras.revisarDias && vendasDesde < regras.vendas / 2;
  const revisar = revisarPorAds || revisarPorLancamento;
  const alertaNota = nota != null && nota < regras.notaAlerta;

  let sugestao;
  if (noAlvo) sugestao = { chave: "alvo", tom: "good", rotulo: "No alvo" };
  else if (check && !check.pendente && check.falhasSeguidas >= 2) sugestao = { chave: "voltar", tom: "bad", rotulo: "Voltar degrau" };
  else if (revisar) sugestao = { chave: "revisar", tom: "bad", rotulo: "Revisar anúncio" };
  else if (check && !check.pendente && check.falhasSeguidas === 1) sugestao = { chave: "segurar", tom: "warn", rotulo: "Segurar" };
  else if (portoesOk && !alertaNota) sugestao = { chave: "subir", tom: "good", rotulo: "Subir degrau" };
  else sugestao = { chave: "segurar", tom: "warn", rotulo: "Segurar" };

  const lucroSemana = ultimaSemana && ultimaSemana.data > corte7 ? num(ultimaSemana.vendas) * (lucroEm(num(ultimaSemana.preco) || preco) ?? 0) : null;
  const lucroSemanaAds = lucroSemana != null ? lucroSemana - num(ultimaSemana.ads_gasto) : null;
  const lucroSemanaAlvo = ultimaSemana && ultimaSemana.data > corte7 ? num(ultimaSemana.vendas) * (lucroEm(alvo) ?? 0) : null;

  return {
    degraus, i, preco, alvo, proximo, fase: faseDe(rampa),
    lucroAtual, lucroAlvo: lucroEm(alvo), lucroProximo: lucroEm(proximo), lucroEm,
    zero: ctx.canal ? zeroAZero(ctx.canal, ctx.custo, ctx.peso, ctx.cfg) : null,
    avaliacoesTotal, nota, vendasDesde, vendasTotal, avaliacoesDesde, dias, ruins7,
    portoes, portoesOk, check, roasMin, roas, organico, organicoAntes, ads, viavelEm, ultAds,
    revisar, revisarPorAds, revisarPorLancamento, alertaNota, sugestao, ultimaSemana,
    lucroSemana, lucroSemanaAds, lucroSemanaAlvo, semanas, registros: regs,
  };
}

function moeda(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Itens do checklist "Revisar anúncio".
export const CHECKLIST_ANUNCIO = [
  ["foto", "Foto principal limpa", "Fundo claro, produto grande ocupando a foto, sem texto poluído"],
  ["uso", "Foto de uso/ambiente", "Instalado/em uso, mostrando o tamanho real"],
  ["medidas", "Foto com medidas", "Altura × largura (e quanto aguenta, se for o caso)"],
  ["video", "Vídeo curto (até 15 s)", "Instalando ou em uso — a Shopee destaca anúncios com vídeo"],
  ["titulo", "Título com palavras de busca", "Tipo + uso + material + diferencial"],
  ["descricao", "Primeiras linhas da descrição", "Benefício e o que vem na embalagem antes do detalhe técnico"],
  ["variacoes", "Variações com foto própria", "Cada cor/opção com a sua foto"],
  ["kit", "Kit visível no mesmo anúncio", "“Leve 2/3” puxa o ticket e a conversão"],
  ["concorrente", "Comparar com o concorrente", "Preço, frete, prazo e avaliações dos 3 primeiros da busca"],
  ["avaliacao", "Pedir avaliação com foto", "Cartão no pacote — as primeiras avaliações com foto pesam muito"],
];
