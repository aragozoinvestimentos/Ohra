// "Surtiu efeito?" (01/11/2026, aprovado pelo Gustavo) — conta ÚNICA do antes ×
// depois de uma mudança no anúncio (degrau da rampa, ajuste do Ads, ligar o Ads,
// crescer de propósito). Compara, POR DIA, o que sobrou depois do Ads (lucro
// bruto dos pedidos pagos − Ads) nos dias antes × depois da mudança. O dia da
// mudança fica fora (mudança costuma ser à noite).
//
// Prazo (decisão do Gustavo): leitura no 7º dia.
//   ≥ 110% do que sobrava ............ "melhorou" — fecha no 7º
//   < 75% ou prejuízo ................. "piorou"/"prejuizo" — fecha no 7º
//   90–110% / 75–90% (mediano) ........ espera 14 dias pra confirmar
//   < 7 vendas pagas nos 7 dias ........ espera 14 (amostra pequena)
// Produto em temporada: tudo fecha no 7º e o "antes" é de 7 dias (a temporada
// subindo infla o depois). As faixas são as mesmas da Rampa (lucroFica 90% /
// lucroVolta 75%) — as regras conversam.

export const REGRAS_EFEITO = {
  leituraDias: 7,
  confirmarDias: 14,
  antesDias: 14,
  antesDiasSazonal: 7,
  melhorou: 1.1,
  fica: 0.9,
  volta: 0.75,
  minVendas7: 7,
  mostrarDias: 7, // o veredito fica na tela por 7 dias depois de sair
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const somar = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const moeda = (v) => `R$ ${num(v).toFixed(2).replace(".", ",")}`;
const pct = (r) => `${Math.round(r * 100)}%`;

// Números de uma janela (soma) → por dia.
function porDia(t, n) {
  const d = Math.max(1, n);
  const un = num(t.un);
  const lucro = num(t.lucro);
  const ads = num(t.ads);
  return {
    dias: n,
    vendas: un,
    vendasDia: un / d,
    preco: un > 0 ? num(t.pago) / un : null,
    lucroDia: lucro / d,
    adsDia: ads / d,
    sobrouDia: (lucro - ads) / d,
    adsDesconhecido: !!t.adsDesconhecido,
  };
}

// mudanca = { data, tipo: 'preco'|'ads'|'crescer', texto }
// medir(de, ate) → { un, pago, lucro, ads, adsDesconhecido }
// ultimoDia = último dia coberto pelos pedidos importados (≤ ontem)
export function efeitoDaMudanca({ mudanca, hoje, ultimoDia, medir, sazonal = false, regras = REGRAS_EFEITO }) {
  if (!mudanca?.data || !medir) return null;
  const d = mudanca.data;
  const ontem = somar(hoje, -1);
  const fimDados = ultimoDia && ultimoDia < ontem ? ultimoDia : ontem;
  const nAntes = sazonal ? regras.antesDiasSazonal : regras.antesDias;
  const antesDe = somar(d, -nAntes);
  const antesAte = somar(d, -1);
  const depoisDe = somar(d, 1);
  const maxDepois = somar(d, regras.confirmarDias);
  const depoisAte = fimDados < maxDepois ? fimDados : maxDepois;
  const nDepois = Math.max(0, dias(depoisDe, depoisAte) + 1);
  const antes = porDia(medir(antesDe, antesAte), nAntes);
  const base = { mudanca, sazonal, antes, antesDe, antesAte, depoisDe, leituraEm: somar(d, regras.leituraDias), confirmaEm: somar(d, regras.confirmarDias) };
  if (nDepois < 1) return { ...base, estado: "coletando", diasDepois: 0, titulo: `${rotuloMudanca(mudanca)} — coletando`, texto: `Resultado a partir de ${dm(base.leituraEm)} (7 dias depois). Importe os pedidos todo dia.` };
  const depois = porDia(medir(depoisDe, depoisAte), nDepois);
  const r = razao(antes.sobrouDia, depois.sobrouDia);
  const comum = { ...base, depois, depoisAte, diasDepois: nDepois, razao: r };
  if (nDepois < regras.leituraDias)
    return { ...comum, estado: "coletando", titulo: `${rotuloMudanca(mudanca)} — dia ${nDepois} de ${regras.leituraDias}`, texto: `Parcial: sobrou ${moeda(depois.sobrouDia)}/dia depois × ${moeda(antes.sobrouDia)}/dia antes. Leitura em ${dm(base.leituraEm)} — não mude outra coisa no anúncio até lá.` };
  const vendas7 = depois.vendasDia * 7;
  const final = nDepois >= regras.confirmarDias || sazonal;
  const prejuizo = depois.sobrouDia < 0 && (antes.sobrouDia >= 0 || depois.sobrouDia < antes.sobrouDia);
  let veredito;
  if (prejuizo) veredito = "prejuizo";
  else if (r != null && r < regras.volta) veredito = "piorou";
  else if (r == null && depois.sobrouDia > antes.sobrouDia) veredito = "melhorou";
  else if (r != null && r >= regras.melhorou) veredito = "melhorou";
  else if (r != null && r >= regras.fica) veredito = depois.vendasDia < antes.vendasDia * 0.9 ? "menos-trabalho" : "igual";
  else if (r != null) veredito = "um-pouco-menos";
  else veredito = "igual";
  const decisivo = veredito === "prejuizo" || veredito === "piorou" || veredito === "melhorou";
  const amostraPequena = vendas7 < regras.minVendas7 && !sazonal;
  const fecha = final || veredito === "prejuizo" || (decisivo && !amostraPequena);
  const t = textos(veredito, { antes, depois, r, mudanca, nDepois });
  if (!fecha)
    return {
      ...comum,
      estado: "confirmando",
      veredito,
      titulo: `${rotuloMudanca(mudanca)} — ${t.curto}, confirmando`,
      texto: `${t.texto} ${amostraPequena ? `Poucas vendas pagas (${Math.round(vendas7)} em 7 dias): ` : "Resultado parecido com antes: "}confirma em ${dm(base.confirmaEm)} (14 dias). Até lá, não mude outra coisa no anúncio.`,
    };
  return { ...comum, estado: "final", veredito, titulo: `${rotuloMudanca(mudanca)}: ${t.curto}`, texto: t.texto, acao: t.acao, grupo: t.grupo, fechouEm: depoisAte };
}

function razao(antes, depois) {
  if (!(antes > 0)) return null;
  return depois / antes;
}

export function rotuloMudanca(m) {
  if (!m) return "";
  const base = m.tipo === "preco" ? "Preço mudou" : m.tipo === "crescer" ? "Crescer de propósito" : "Ads mudou";
  return `${base} em ${dm(m.data)}`;
}

function textos(v, { antes, depois, r, mudanca }) {
  const linha = `Sobrou ${moeda(depois.sobrouDia)}/dia depois × ${moeda(antes.sobrouDia)}/dia antes${r != null ? ` (${pct(r)})` : ""} · vendas ${depois.vendasDia.toFixed(1).replace(".", ",")}/dia × ${antes.vendasDia.toFixed(1).replace(".", ",")}/dia · Ads ${moeda(depois.adsDia)}/dia × ${moeda(antes.adsDia)}/dia${depois.preco != null && antes.preco != null ? ` · preço médio ${moeda(depois.preco)} × ${moeda(antes.preco)}` : ""}.`;
  const voltar = mudanca?.tipo === "preco" ? "volte ao preço de antes" : mudanca?.tipo === "ads" ? "volte o Ads ao que era (orçamento/meta de antes)" : "desligue o crescer de propósito";
  switch (v) {
    case "melhorou":
      return { curto: "surtiu efeito — melhorou", texto: `${linha} Continue assim; dá pra pensar no próximo passo.`, grupo: "oportunidade" };
    case "menos-trabalho":
      return { curto: "surtiu efeito — trabalha menos e ganha igual", texto: `${linha} Vendeu menos e sobrou o mesmo: menos peças pra produzir e enviar pelo mesmo resultado. Continue assim.`, grupo: "oportunidade" };
    case "igual":
      return { curto: "manteve o resultado", texto: `${linha} Ficou no mesmo nível — pode manter.`, grupo: "info" };
    case "um-pouco-menos":
      return { curto: "ganhando um pouco menos", texto: `${linha} Sobra um pouco menos que antes — acompanhe; se cair mais, ${voltar}.`, grupo: "atencao" };
    case "piorou":
      return { curto: "piorou", texto: `${linha} Caiu bastante. ${voltar[0].toUpperCase()}${voltar.slice(1)} ou tente outra coisa (foto, título, preço).`, acao: voltar, grupo: "atencao" };
    case "prejuizo":
      return { curto: "no prejuízo", texto: `${linha} Depois da mudança o anúncio está dando prejuízo: ${voltar} já.`, acao: voltar, grupo: "resolver" };
    default:
      return { curto: "", texto: linha, grupo: "info" };
  }
}

// O app ainda deve esperar antes de sugerir outra mudança? (uma mudança por vez)
export function esperaDoEfeito(ef) {
  if (!ef) return null;
  if (ef.estado === "coletando") return { ate: ef.leituraEm, motivo: ef.titulo };
  if (ef.estado === "confirmando") return { ate: ef.confirmaEm, motivo: ef.titulo };
  return null;
}

// Mostrar o veredito final por mais N dias depois de sair (Início, Painel).
export function efeitoVisivel(ef, hoje, regras = REGRAS_EFEITO) {
  if (!ef) return false;
  if (ef.estado !== "final") return true;
  return dias(ef.fechouEm || hoje, hoje) <= regras.mostrarDias;
}
