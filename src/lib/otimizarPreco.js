// Preço dinâmico → fase "Otimizar preço" (18/11/2026, aprovado pelo Gustavo pela
// prévia). Conta ÚNICA, PURA. É a "escada do Ads" no preço: sobe enquanto o
// LUCRO DO DIA (o que sobrou depois do Ads, por dia) deixa; desce quando cai.
// Sem teto — o resultado é o freio. Decide pela AMOSTRA, não pelo calendário.
//
// Guardado em rampas_preco.checklist.otimizar (sem SQL):
//   { ligado, desde, base (preço/pct quando ligou), passos: [{ data, tipo
//     subir|voltar|manter, de, para, passo }], precoBom, bloqueadoAte,
//     confirmadoAte, desligadoEm }
// Unidade do preço: produto/kit = R$; anúncio com vários itens = % do preço salvo.
//
// Régua (depois de cada subida; antes = 14 dias antes da mudança, 7 na
// temporada; o dia da mudança fica fora):
//   emergência (prejuízo depois do Ads ou vendas caíram > 50%) ... voltar já (≥ 3º dia)
//   lucro do dia ≥ 100% e vendas caíram < 10% ................... subir +8%
//   lucro do dia ≥ 100% .......................................... subir +5%
//   lucro do dia 85–100% (meio) .................................. espera até 14 dias ou 40 vendas →
//        ≥ 90% com vendas caindo ≥ 10% = "trabalha menos e ganha quase igual"; senão manter
//   lucro do dia < 85% ........................................... voltar um degrau
// Resultado claro decide com 7 dias E 15 vendas pagas; produto lento sem 15
// vendas em 21 dias = "manter: pouca venda pra saber".
// Temporada: o "depois" é corrigido pelo crescimento dos outros produtos de
// época da loja (controle); sem controle, só sobe se as vendas não caíram.

export const REGRAS_OTIMIZAR = {
  passo: 0.05,
  passoForte: 0.08,
  leituraDias: 7,
  minVendas: 15,
  meioDias: 14,
  meioVendas: 40,
  maxDias: 21,
  emergenciaDias: 3,
  antesDias: 14,
  antesSazonal: 7,
  sobe: 1.0,
  menosTrabalho: 0.9,
  volta: 0.85,
  procuraForte: 0.9, // vendas ≥ 90% do antes = procura forte
  bloqueioDias: 30, // depois de voltar/manter: não sugere subir por 30 dias
  confirmarCada: 0.2, // a cada +20% acumulado, pede confirmação
  adsEspera: 7, // Ads mudou há menos de 7 dias = o preço espera
  campanhaDias: 7, // campanha da plataforma em ≤ 7 dias = não sobe
  ritmoEstavel: 0.85, // ao ligar: últimos 7 dias ≥ 85% dos 7 antes
  controleMin: 10, // unidades mínimas do controle (temporada)
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cent = (v) => Math.round(v * 100) / 100;
export const somarDias = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const BRL = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pctTxt = (r) => `${Math.round(r * 100)}%`;

// Finais ,49/,99 (os da Rampa) pra produto/kit; % inteiro pro anúncio com vários itens.
const finalAbaixo = (v) => cent(Math.floor((v + 0.01 + 1e-9) * 2) / 2 - 0.01);
const finalAcima = (v) => cent(Math.ceil((v + 0.01 - 1e-9) * 2) / 2 - 0.01);

/** Próximo preço com o passo (+5%/+8%). grupo = unidade em %. */
export function proximoPreco(atual, passo, grupo = false) {
  const a = num(atual);
  if (!(a > 0)) return null;
  if (grupo) return Math.max(Math.round(a * (1 + passo)), Math.round(a) + 1);
  let v = finalAbaixo(a * (1 + passo));
  if (v <= a + 0.004) v = finalAcima(a + 0.02);
  return v;
}

/** Texto de um preço na unidade da linha. */
export const precoTxt = (v, grupo) => (v == null ? "—" : grupo ? `${String(Math.round(num(v) * 10) / 10).replace(".", ",")}% do preço salvo` : BRL(v));

function porDia(t, n) {
  const d = Math.max(1, n);
  const un = num(t?.un);
  return {
    dias: n,
    vendas: un,
    vendasDia: un / d,
    lucroDia: num(t?.lucro) / d,
    adsDia: num(t?.ads) / d,
    sobrouDia: (num(t?.lucro) - num(t?.ads)) / d,
    lucroVenda: un > 0 ? num(t?.lucro) / un : null,
    adsDesconhecido: !!t?.adsDesconhecido,
  };
}

/** Estado do Otimizar preço guardado (checklist.otimizar), com defaults. */
export function lerOtimizar(checklist) {
  const o = checklist?.otimizar;
  if (!o || typeof o !== "object") return null;
  return { ligado: !!o.ligado, desde: o.desde || null, base: o.base ?? null, passos: Array.isArray(o.passos) ? o.passos : [], precoBom: o.precoBom ?? null, bloqueadoAte: o.bloqueadoAte || null, confirmadoAte: o.confirmadoAte ?? null, desligadoEm: o.desligadoEm || null };
}

/** Degrau do Otimizar (quantas subidas líquidas acima da base). */
export function degrauOtimizar(ot, atual) {
  if (!ot) return 0;
  const vals = [...new Set([num(ot.base), ...ot.passos.map((p) => num(p.para))].filter((v) => v > 0))].sort((a, b) => a - b);
  const i = vals.findIndex((v) => Math.abs(v - num(atual)) < 0.005);
  return i < 0 ? 0 : i;
}

/**
 * Leitura ao LIGAR (e enquanto não há subida em medição): olha os pedidos dos
 * últimos 14 dias (+ 60/30 dias de informação) e diz se dá pra subir hoje.
 * → { pode, passo, novo, motivos: [{ ok, texto, bloqueia? }], bloqueio: {texto, ate}|null, info }
 */
export function decisaoInicial({ atual, grupo = false, medir, hoje, ultimoDia, sazonal = false, notaOk = true, nota = null, ruins7 = 0, adsMudouEm = null, campanha = null, espacoRiscado = null, capacidadeUso = null, regras = REGRAS_OTIMIZAR }) {
  const fim = ultimoDia && ultimoDia < somarDias(hoje, -1) ? ultimoDia : somarDias(hoje, -1);
  const v14 = medir ? num(medir(somarDias(fim, -13), fim).un) : 0;
  const u7 = medir ? num(medir(somarDias(fim, -6), fim).un) : 0;
  const a7 = medir ? num(medir(somarDias(fim, -13), somarDias(fim, -7)).un) : 0;
  const ritmo = a7 > 0 ? u7 / a7 : u7 > 0 ? 1.5 : null;
  const nHist = sazonal ? 30 : 60;
  const hist = medir ? porDia(medir(somarDias(fim, -(nHist - 1)), fim), nHist) : null;
  const motivos = [];
  let bloqueio = null;
  const okVendas = v14 >= regras.minVendas;
  motivos.push({ ok: okVendas, bloqueia: !okVendas, texto: okVendas ? `${v14} vendas pagas nos últimos 14 dias` : `Só ${v14} vendas pagas nos últimos 14 dias (precisa de ${regras.minVendas} pra medir o efeito do preço)` });
  const okRitmo = ritmo != null && ritmo >= regras.ritmoEstavel;
  if (okVendas) motivos.push({ ok: okRitmo, bloqueia: !okRitmo, texto: okRitmo ? `Ritmo estável ou subindo (7 dias: ${u7} × ${a7} nos 7 antes)` : `Vendas caindo (7 dias: ${u7} × ${a7} nos 7 antes) — subir agora misturaria os efeitos` });
  const okNota = notaOk !== false && !(num(ruins7) > 0);
  motivos.push({ ok: okNota, bloqueia: !okNota, texto: okNota ? (nota ? `Nota ${String(nota).replace(".", ",")}, nenhuma 1–2★ nos últimos 7 dias` : "Nenhuma avaliação ruim recente") : "Avaliação ruim recente — resolva o produto/entrega antes de subir o preço" });
  if (adsMudouEm && dias(adsMudouEm, hoje) < regras.adsEspera) {
    const ate = somarDias(adsMudouEm, regras.adsEspera);
    bloqueio = { texto: `O Ads mudou em ${dm(adsMudouEm)}. Suba o preço a partir de ${dm(ate)} (uma mudança por vez).`, ate };
    motivos.push({ ok: false, bloqueia: true, texto: `Ads mudou em ${dm(adsMudouEm)} — o preço espera até ${dm(ate)}` });
  } else motivos.push({ ok: true, texto: adsMudouEm ? `Ads sem mudança desde ${dm(adsMudouEm)}` : "Sem mudança de Ads recente" });
  if (campanha && campanha.dias >= 0 && campanha.dias <= regras.campanhaDias) {
    const ate = somarDias(campanha.data, 1);
    bloqueio = bloqueio || { texto: `Campanha ${campanha.nome} em ${campanha.dias} dia${campanha.dias === 1 ? "" : "s"}: a plataforma pede o menor preço de 30 dias — suba depois dela (${dm(ate)}).`, ate };
    motivos.push({ ok: false, bloqueia: true, texto: `Campanha ${campanha.nome} em ${campanha.dias} dia${campanha.dias === 1 ? "" : "s"}` });
  } else motivos.push({ ok: true, texto: "Nenhuma campanha da plataforma nos próximos 7 dias" });
  if (capacidadeUso != null) motivos.push({ ok: true, info: true, texto: `Usa ${Math.round(capacidadeUso * 100)}% da capacidade da sua farm${capacidadeUso >= 0.8 ? " — subir o preço também alivia a produção" : ""}` });
  if (espacoRiscado != null) {
    const ok = espacoRiscado > regras.passo;
    motivos.push({ ok, bloqueia: !ok, info: ok, texto: ok ? `Espaço até o preço cheio (riscado): +${Math.round(espacoRiscado * 100)}%` : "Já está no preço cheio do anúncio (promo 0%) — subir mais só com anúncio novo" });
  }
  const pode = motivos.every((m) => !m.bloqueia);
  const passo = regras.passo;
  const novo = proximoPreco(atual, passo, grupo);
  return { pode, passo, novo, motivos, bloqueio, v14, ritmo, hist, fim };
}

/**
 * Estado do Otimizar num anúncio ligado. ot = lerOtimizar(checklist).
 * atual/alvo na unidade da linha. medir(de, ate) → { un, lucro, ads, adsDesconhecido }.
 * controle(de, ate) → unidades dos outros produtos de época (temporada) ou null.
 * → { chave, tipo, titulo, texto, acao, novo, passo, decideEm, med?, inicial?, degrau, base, acumulado }
 * chave: espera-alvo | aguardar | nao-agora | pronto | medindo | voltar-ja | subir |
 *        voltar | manter | menos-trabalho | pouca-venda | confirmar | parado
 */
export function estadoOtimizar({ ot, atual, alvo, grupo = false, hoje, ultimoDia, medir, controle = null, sazonal = false, notaOk = true, nota = null, ruins7 = 0, adsMudouEm = null, campanha = null, espacoRiscado = null, capacidadeUso = null, regras = REGRAS_OTIMIZAR }) {
  if (!ot?.ligado) return null;
  const a = num(atual);
  const base = num(ot.base) > 0 ? num(ot.base) : num(alvo) || a;
  const acumulado = base > 0 ? a / base - 1 : 0;
  const comum = { base, acumulado, degrau: degrauOtimizar(ot, a), atual: a, grupo };
  const pt = (v) => precoTxt(v, grupo);
  if (num(alvo) > 0 && a < num(alvo) - 0.004)
    return { ...comum, chave: "espera-alvo", tipo: "info", titulo: "Otimizar preço começa quando chegar no alvo", texto: `Agora ${pt(a)}, alvo ${pt(alvo)}. A rampa leva até o alvo; daí em diante, o Otimizar decide pelo lucro do dia.` };
  const ult = ot.passos[ot.passos.length - 1] || null;
  const medindo = ult && ult.tipo === "subir" && Math.abs(num(ult.para) - a) < 0.005;
  if (!medindo) {
    if (ot.bloqueadoAte && ot.bloqueadoAte > hoje)
      return { ...comum, chave: "parado", tipo: "info", titulo: `Preço bom: ${pt(ot.precoBom ?? a)}`, texto: `${ult?.tipo === "voltar" ? "O degrau de cima lucrou menos" : "O resultado ficou parecido com o de antes"} — o app volta a analisar em ${dm(ot.bloqueadoAte)}.`, decideEm: ot.bloqueadoAte };
    const ini = decisaoInicial({ atual: a, grupo, medir, hoje, ultimoDia, sazonal, notaOk, nota, ruins7, adsMudouEm, campanha, espacoRiscado, capacidadeUso, regras });
    if (ini.pode) return { ...comum, chave: "pronto", tipo: "oportunidade", titulo: `Pronto pra subir +${Math.round(ini.passo * 100)}%: ${pt(ini.novo)}`, texto: `${ini.v14} vendas pagas em 14 dias, ritmo estável. Dá pra subir e medir.`, acao: "subir", novo: ini.novo, passo: ini.passo, inicial: ini };
    if (ini.bloqueio) return { ...comum, chave: "aguardar", tipo: "info", titulo: "Espere pra subir", texto: ini.bloqueio.texto, decideEm: ini.bloqueio.ate, inicial: ini };
    return { ...comum, chave: "nao-agora", tipo: "info", titulo: "Ainda não dá pra subir", texto: ini.motivos.filter((m) => m.bloqueia).map((m) => m.texto).join(" · "), inicial: ini };
  }
  // ---- Medindo a subida ----
  const d = String(ult.data).slice(0, 10);
  const ontem = somarDias(hoje, -1);
  const fimDados = ultimoDia && ultimoDia < ontem ? ultimoDia : ontem;
  const nAntes = sazonal ? regras.antesSazonal : regras.antesDias;
  const ant = ot.passos.length > 1 ? ot.passos[ot.passos.length - 2] : null;
  let antesDe = somarDias(d, -nAntes);
  if (ant?.data && String(ant.data).slice(0, 10) >= antesDe) antesDe = somarDias(String(ant.data).slice(0, 10), 1);
  const antesAte = somarDias(d, -1);
  const nA = Math.max(1, dias(antesDe, antesAte) + 1);
  const depoisDe = somarDias(d, 1);
  const n = Math.max(0, dias(depoisDe, fimDados) + 1);
  const antes = porDia(medir ? medir(antesDe, antesAte) : null, nA);
  const leituraEm = somarDias(d, regras.leituraDias);
  const confirmaEm = somarDias(d, regras.meioDias);
  if (n < 1)
    return { ...comum, chave: "medindo", tipo: "decisao", titulo: `Medindo ${pt(a)} — começa amanhã`, texto: `O preço subiu em ${dm(d)}. A medição começa no dia seguinte; não mexa no Ads até a decisão.`, decideEm: leituraEm, med: { antes, depois: null, dias: 0, vendas: 0, antesDe, antesAte, depoisDe, de: ult.de, para: ult.para, data: d } };
  const depois = porDia(medir ? medir(depoisDe, fimDados) : null, n);
  // Temporada: corrige pelo crescimento dos outros produtos de época.
  let fator = null;
  if (sazonal && controle) {
    const cA = num(controle(antesDe, antesAte)) / nA;
    const cD = num(controle(depoisDe, fimDados)) / Math.max(1, n);
    if (cA * nA >= regras.controleMin && cA > 0) fator = cD / cA;
  }
  const f = fator && fator > 0 ? fator : 1;
  const vr = antes.vendasDia > 0 ? depois.vendasDia / antes.vendasDia / f : null;
  const sobrouCorr = depois.sobrouDia / f;
  const r = antes.sobrouDia > 0 ? sobrouCorr / antes.sobrouDia : sobrouCorr > antes.sobrouDia ? 1.5 : null;
  const v = depois.vendas;
  const med = { antes, depois, dias: n, vendas: v, razao: r, razaoBruta: antes.sobrouDia > 0 ? depois.sobrouDia / antes.sobrouDia : null, vendasRazao: vr, fator, antesDe, antesAte, depoisDe, depoisAte: fimDados, de: ult.de, para: ult.para, data: d, leituraEm, confirmaEm };
  const linha = `Sobrou ${BRL(depois.sobrouDia)}/dia × ${BRL(antes.sobrouDia)}/dia antes${r != null ? ` (${pctTxt(r)}${fator ? " corrigido pela temporada" : ""})` : ""} · vendas ${depois.vendasDia.toFixed(1).replace(".", ",")}/dia × ${antes.vendasDia.toFixed(1).replace(".", ",")}/dia.`;
  const voltar = { acao: "voltar", novo: num(ult.de) };
  // Emergência (a partir do 3º dia).
  if (n >= regras.emergenciaDias && ((depois.sobrouDia < 0 && antes.sobrouDia >= 0) || (antes.vendasDia > 0 && vr != null && vr < 0.5)))
    return { ...comum, ...voltar, med, chave: "voltar-ja", tipo: "resolver", titulo: `Voltar já pra ${pt(ult.de)}`, texto: `${depois.sobrouDia < 0 ? "Depois da subida o anúncio está no prejuízo." : "As vendas caíram mais da metade."} ${linha}` };
  if (v < regras.minVendas && n >= regras.maxDias)
    return { ...comum, med, chave: "pouca-venda", tipo: "decisao", acao: "manter", titulo: `Manter ${pt(a)}: pouca venda pra saber`, texto: `${v} vendas em ${n} dias no preço novo — não dá pra separar o efeito do preço do acaso. ${linha}` };
  if (n < regras.leituraDias || v < regras.minVendas) {
    const falta = [n < regras.leituraDias ? `dia ${n} de ${regras.leituraDias}` : null, v < regras.minVendas ? `${v} de ${regras.minVendas} vendas` : null].filter(Boolean).join(" · ");
    return { ...comum, med, chave: "medindo", tipo: "decisao", titulo: `Medindo ${pt(a)} · ${falta}`, texto: `Parcial: ${linha} Decide com ${regras.leituraDias} dias e ${regras.minVendas} vendas pagas. Não mexa no Ads até lá.`, decideEm: n < regras.leituraDias ? leituraEm : null };
  }
  if (r != null && r >= regras.sobe) {
    const forte = vr != null && vr >= regras.procuraForte;
    if (sazonal && !forte) return { ...comum, med, chave: "manter", tipo: "decisao", acao: "manter", titulo: `Manter ${pt(a)}`, texto: `Lucrou mais, mas na temporada as vendas caíram em relação aos outros produtos de época. ${linha}` };
    const passo = forte ? regras.passoForte : regras.passo;
    const novo = proximoPreco(a, passo, grupo);
    const limite = num(ot.confirmadoAte) > 0 ? num(ot.confirmadoAte) : base * (1 + regras.confirmarCada);
    const acimaRiscado = espacoRiscado != null && novo / a - 1 > espacoRiscado + 0.001;
    const extra = acimaRiscado ? " Atenção: passa do preço cheio do anúncio (a promo vai a 0% e o cliente paga o riscado)." : "";
    if (novo > limite + 0.004)
      return { ...comum, med, chave: "confirmar", tipo: "oportunidade", acao: "confirmar", novo, passo, titulo: `Já subiu ${Math.round(acumulado * 100)}% desde que ligou — continuar pra ${pt(novo)}?`, texto: `${linha} A cada +${Math.round(regras.confirmarCada * 100)}% o app pede a sua confirmação.${extra}` };
    return { ...comum, med, chave: "subir", tipo: "oportunidade", acao: "subir", novo, passo, titulo: `${forte ? "Procura forte: " : ""}subir +${Math.round(passo * 100)}% pra ${pt(novo)}`, texto: `${linha}${extra}` };
  }
  if (r != null && r < regras.volta) return { ...comum, ...voltar, med, chave: "voltar", tipo: "atencao", titulo: `Voltar um degrau: ${pt(ult.de)}`, texto: `O lucro do dia caiu pra ${pctTxt(r)} do de antes. ${linha}` };
  // Meio (85–100%): espera 14 dias ou 40 vendas.
  if (n < regras.meioDias && v < regras.meioVendas && n < regras.maxDias)
    return { ...comum, med, chave: "medindo", tipo: "decisao", titulo: `Resultado no meio — confirmando até ${dm(confirmaEm)}`, texto: `${linha} Com poucas vendas, uma diferença pequena pode ser sorte: o app espera ${regras.meioDias} dias ou ${regras.meioVendas} vendas.`, decideEm: confirmaEm, meio: true };
  if (r != null && r >= regras.menosTrabalho && vr != null && vr < regras.procuraForte)
    return { ...comum, med, chave: "menos-trabalho", tipo: "oportunidade", acao: "manter", titulo: `Trabalha menos e ganha quase igual a ${pt(a)}`, texto: `Vendeu ${Math.round((1 - vr) * 100)}% menos e sobrou quase o mesmo: menos peças pra produzir e enviar. ${linha} Você decide: manter aqui ou voltar.`, novoVoltar: num(ult.de) };
  return { ...comum, med, chave: "manter", tipo: "decisao", acao: "manter", titulo: `Manter ${pt(a)}: deve ser o preço bom`, texto: `${linha} Subir mais provavelmente não compensa; voltar também não.`, novoVoltar: num(ult.de) };
}

/** Onde o anúncio está na régua (pra marcar "● você está aqui"). */
export function linhaDaRegua(e) {
  if (!e?.med?.depois) return null;
  return { "voltar-ja": "emergencia", subir: e.passo === REGRAS_OTIMIZAR.passoForte ? "forte" : "sobe", confirmar: "sobe", "menos-trabalho": "menos", manter: "meio", "pouca-venda": "meio", voltar: "volta" }[e.chave] || (e.med.razao == null ? null : e.med.razao >= 1 ? "sobe" : e.med.razao < 0.85 ? "volta" : e.med.razao >= 0.9 ? "menos" : "meio");
}

export const REGUA_OTIMIZAR = [
  { k: "emergencia", quando: "Prejuízo depois do Ads, ou vendas caíram mais da metade", faz: "↓ Voltar já", tipo: "resolver", decide: "a partir do 3º dia" },
  { k: "forte", quando: "Lucro do dia ≥ 100% e vendas caíram menos de 10% (procura forte)", faz: "↑ Subir +8%", tipo: "oportunidade", decide: "7 dias + 15 vendas" },
  { k: "sobe", quando: "Lucro do dia ≥ 100%", faz: "↑ Subir +5%", tipo: "oportunidade", decide: "7 dias + 15 vendas" },
  { k: "menos", quando: "90–100%, vendendo bem menos", faz: "Manter: trabalha menos e ganha quase igual (você decide)", tipo: "decisao", decide: "até 14 dias ou 40 vendas" },
  { k: "meio", quando: "85–100%", faz: "Manter: deve ser o preço bom", tipo: "info", decide: "até 14 dias ou 40 vendas" },
  { k: "volta", quando: "Abaixo de 85%", faz: "↓ Voltar um degrau", tipo: "atencao", decide: "7 dias + 15 vendas" },
];

/** Novo estado do Otimizar depois de uma ação (puro — quem grava é otimizarAcoes.js). */
export function otimizarDepois(ot, { tipo, de, para, hoje, passo = null, regras = REGRAS_OTIMIZAR }) {
  const o = { ...(ot || {}), ligado: true, passos: [...(ot?.passos || [])] };
  if (tipo === "subir") {
    o.passos.push({ data: hoje, tipo, de, para, passo });
    o.bloqueadoAte = null;
    o.precoBom = null;
  } else if (tipo === "voltar") {
    o.passos.push({ data: hoje, tipo, de, para });
    o.precoBom = para;
    o.bloqueadoAte = somarDias(hoje, regras.bloqueioDias);
  } else if (tipo === "manter") {
    o.passos.push({ data: hoje, tipo, de, para: de });
    o.precoBom = de;
    o.bloqueadoAte = somarDias(hoje, regras.bloqueioDias);
  }
  return o;
}

/** Nome da fase do Preço dinâmico pra uma linha da rampa (lista e Painel). */
export function faseDoPrecoDinamico(est, ot) {
  const z = est?.sazonal?.fase;
  if (z === "entressafra") return "Entressafra";
  if (ot?.ligado && est && (est.noAlvo || est.acimaAtivo)) return "Otimizar preço";
  if (est && !est.noAlvo && !est.acimaAtivo) return z === "subindo" || z === "pico" ? "Temporada" : "Lançamento";
  return "No alvo";
}

/**
 * Prévia de um passo do Otimizar por item do anúncio (18/11/2026): junta as
 * linhas do "O que digitar" no preço de AGORA e no preço NOVO pelo itemId.
 * antes/depois = [{ itemId, nome, real, original, promo, clientePaga, lucro, riscadoFixo?, acimaDoRiscado? }]
 * → [{ itemId, nome, de, para, pct, original, fixo, promoDe, promoPara, pagaDe, pagaPara, lucroDe, lucroPara, acimaDoRiscado }]
 */
export function previaDoPasso(antes = [], depois = []) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return depois
    .map((d) => {
      const a = antes.find((x) => x.itemId === d.itemId);
      if (!a) return null;
      const de = n(a.real);
      const para = n(d.real);
      return {
        itemId: d.itemId,
        nome: d.nome,
        de,
        para,
        pct: de > 0 && para != null ? para / de - 1 : null,
        original: n(d.original),
        fixo: !!d.riscadoFixo,
        promoDe: n(a.promo),
        promoPara: n(d.promo),
        pagaDe: n(a.clientePaga),
        pagaPara: n(d.clientePaga),
        lucroDe: n(a.lucro),
        lucroPara: n(d.lucro),
        acimaDoRiscado: !!d.acimaDoRiscado,
      };
    })
    .filter(Boolean);
}
