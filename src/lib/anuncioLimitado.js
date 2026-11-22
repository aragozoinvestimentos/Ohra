// Anúncio limitado pela plataforma (22/11/2026, pedido do Gustavo — Kit de Natal:
// devoluções "pelo tamanho" → a Shopee tirou visibilidade; o Ads ficou ligado sem
// gastar e o Otimizar mandou voltar o preço, culpando o preço).
//
// Conta ÚNICA, PURA. Marcação guardada em preferencias_loja `anuncios:limitados`:
//   { "<itemId>|<canalId>": { desde, motivo, obs, em, fim?, conferido? },
//     _nao: { "<itemId>|<canalId>": { em, desde } } }   ← "Não, é outra coisa"
// Enquanto marcado: o app NÃO decide preço nem Ads desse anúncio (fica em espera)
// e os avisos dele saem do Início — fica um aviso só.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export const MOTIVOS_LIMITE = [
  { id: "devolucoes", nome: "Devoluções" },
  { id: "denuncia", nome: "Denúncia ou infração" },
  { id: "outro", nome: "Outro motivo" },
];
export const nomeMotivo = (id) => MOTIVOS_LIMITE.find((m) => m.id === id)?.nome || "Outro motivo";

export const REGRAS_LIMITE = {
  gastoAntes: 0.8, // antes gastava ≥ 80% do orçamento por dia
  gastoDepois: 0.3, // …e passou a gastar < 30%
  diasDepois: 2, // por pelo menos 2 dias
  impressoesQueda: 0.5, // ou as impressões por dia caíram pela metade
  devolucoesDias: 14,
  conferirDias: 7, // pergunta "ainda limitado?" a cada 7 dias
  naoDias: 14, // "Não, é outra coisa": não pergunta de novo por 14 dias
  normalGasto: 0.6, // marcado + voltou a gastar ≥ 60% = "parece que voltou"
};

export const chaveLimite = (itemId, canalId) => `${itemId}|${canalId}`;

function diasEntre(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);
}
function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A marcação ativa (desde ≤ hoje e sem fim) ou null. */
export function limiteAtivo(cfg, chave, hoje) {
  const x = cfg?.[chave];
  if (!x?.desde || x.fim) return null;
  if (hoje && x.desde > hoje) return null;
  return x;
}

/**
 * Gasto do Ads por dia pelos envios do CSV (parcial.historico + parcial).
 * → [{ de, ate, dias, porDia }] entre envios consecutivos (troca de base = recomeça).
 */
export function gastoPorTrecho(periodo) {
  const par = periodo?.parcial;
  const pts = [...(Array.isArray(par?.historico) ? par.historico : []), ...(par?.ate ? [par] : [])]
    .filter((h) => h?.ate)
    .map((h) => ({ ate: String(h.ate).slice(0, 10), g: num(h.gasto) }))
    .sort((a, b) => a.ate.localeCompare(b.ate))
    .filter((p, i, arr) => i === arr.findIndex((q) => q.ate === p.ate));
  if (periodo?.inicio) pts.unshift({ ate: somarDias(String(periodo.inicio).slice(0, 10), -1), g: 0 });
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.g < a.g - 0.01) continue; // troca de base: não dá pra medir esse trecho
    const dias = diasEntre(a.ate, b.ate);
    if (dias <= 0) continue;
    out.push({ de: somarDias(a.ate, 1), ate: b.ate, dias, porDia: (b.g - a.g) / dias });
  }
  return out;
}

/**
 * Sinais de que a plataforma limitou o anúncio. Só desconfia — quem confirma é você.
 * periodo = o período de Ads LIGADO (não pausado); orcamento = orçamento/dia atual;
 * funis = [{ de, ate, impressoes }] dos Desempenhos guardados; devolucoes = nº de
 * pedidos devolvidos do anúncio nos últimos 14 dias.
 * → null ou { desde, ads: { antes, depois, dias } | null, impressoes: { antes, depois } | null, devolucoes, texto }
 */
export function suspeitaLimitado({ periodo = null, orcamento = 0, funis = [], devolucoes = 0, hoje, regras = REGRAS_LIMITE } = {}) {
  let ads = null;
  let desde = null;
  const orc = num(orcamento);
  if (periodo && orc > 0) {
    const tr = gastoPorTrecho(periodo).filter((t) => t.ate < hoje);
    // Fim da série: os trechos fracos seguidos (< 30% do orçamento).
    let fracos = [];
    for (let i = tr.length - 1; i >= 0; i--) {
      if (tr[i].porDia < orc * regras.gastoDepois) fracos.unshift(tr[i]);
      else break;
    }
    const diasFracos = fracos.reduce((s, t) => s + t.dias, 0);
    const antes = tr.slice(0, tr.length - fracos.length);
    const diasAntes = antes.slice(-7).reduce((s, t) => s + t.dias, 0);
    const gAntes = antes.slice(-7).reduce((s, t) => s + t.porDia * t.dias, 0);
    if (diasFracos >= regras.diasDepois && diasAntes >= 2 && gAntes / diasAntes >= orc * regras.gastoAntes) {
      const gDep = fracos.reduce((s, t) => s + t.porDia * t.dias, 0) / diasFracos;
      ads = { antes: gAntes / diasAntes / orc, depois: gDep / orc, dias: diasFracos };
      desde = fracos[0].de;
    }
  }
  let impressoes = null;
  const fs = [...(funis || [])].filter((f) => f?.de && f?.ate && num(f.impressoes) >= 0).sort((a, b) => a.ate.localeCompare(b.ate) || a.de.localeCompare(b.de));
  if (fs.length >= 2) {
    const n = fs[fs.length - 1];
    const p = [...fs].reverse().find((f) => f.ate < n.ate && f.de < n.de);
    if (p) {
      const pd = num(p.impressoes) / Math.max(1, diasEntre(p.de, p.ate) + 1);
      const nd = num(n.impressoes) / Math.max(1, diasEntre(n.de, n.ate) + 1);
      if (pd >= 20 && nd < pd * regras.impressoesQueda) {
        impressoes = { antes: pd, depois: nd, de: n.de, ate: n.ate };
        if (!desde) desde = p.ate < n.de ? n.de : somarDias(p.ate, 1);
      }
    }
  }
  if (!ads && !impressoes) return null;
  const partes = [];
  if (ads) partes.push(`o Ads quase não gasta desde ${dm(desde)} (${Math.round(ads.depois * 100)}% do orçamento por dia; antes ${Math.round(ads.antes * 100)}%)`);
  if (impressoes) partes.push(`as impressões caíram ${Math.round((1 - impressoes.depois / impressoes.antes) * 100)}% (${Math.round(impressoes.antes)} → ${Math.round(impressoes.depois)} por dia)`);
  if (devolucoes > 0) partes.push(`${devolucoes} devoluç${devolucoes === 1 ? "ão" : "ões"} nos últimos ${regras.devolucoesDias} dias`);
  return { desde, ads, impressoes, devolucoes, texto: partes.length > 2 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes.join(" e ") };
}

/**
 * Estado do anúncio: marcado (com "conferir" a cada 7 dias e "parece que voltou"),
 * suspeita (perguntar) ou nada.
 * → { ativo, suspeita, conferir, voltou } | null
 */
export function estadoLimitado({ cfg = {}, chave, hoje, suspeita = null, gastoHoje = null, regras = REGRAS_LIMITE }) {
  const ativo = limiteAtivo(cfg, chave, hoje);
  if (ativo) {
    const ref = ativo.conferido || ativo.desde;
    const conferir = diasEntre(ref, hoje) >= regras.conferirDias;
    // Voltou: com o Ads ligado o último trecho medido gastou ≥ 60% do orçamento, depois da marcação.
    const voltou = !!gastoHoje && gastoHoje.ate > ativo.desde && gastoHoje.uso >= regras.normalGasto;
    return { ativo, suspeita: null, conferir, voltou };
  }
  if (!suspeita) return null;
  const nao = cfg?._nao?.[chave];
  if (nao?.em && diasEntre(String(nao.em).slice(0, 10), hoje) < regras.naoDias) return null;
  // Marcação encerrada depois do início da suspeita: já foi resolvido.
  const x = cfg?.[chave];
  if (x?.fim && suspeita.desde && x.fim >= suspeita.desde) return null;
  return { ativo: null, suspeita, conferir: false, voltou: false };
}

/** Situação do Ads enquanto o anúncio está limitado (sobrepõe a decisão de lib/ads.js). */
export function avDoLimitado(av, lim) {
  if (!lim?.ativo || !av) return av;
  return {
    ...av,
    chave: "limitado",
    estado: "decisao",
    titulo: `Anúncio limitado pela plataforma desde ${dm(lim.ativo.desde)}`,
    texto: `O Ads não gasta porque a plataforma limitou o anúncio, não porque a meta está alta — não mexa no orçamento nem na meta enquanto isso. Sem a marcação o app diria: "${av.titulo}".`,
    limitado: lim.ativo,
    original: av,
  };
}

/** Estado do Otimizar preço enquanto limitado: em espera. */
export function otimizarDoLimitado(estado, lim) {
  if (!lim?.ativo || !estado) return estado;
  return { ...estado, acao: null, novo: null, chave: "limitado", tipo: "info", titulo: "Em espera: anúncio limitado pela plataforma", texto: `desde ${dm(lim.ativo.desde)} — as vendas caíram pela visibilidade, não pelo preço; nenhuma mudança de preço é sugerida enquanto isso` };
}

/** Sugestão da Rampa enquanto limitado: decisões de subir/voltar/revisar ficam em espera. */
const SUGESTOES_EM_ESPERA = new Set(["subir", "voltar", "sem-venda", "revisar", "descer", "atrasado", "acima-voltar", "testar-acima", "otimizar"]);
export function estDoLimitado(est, ativo) {
  if (!ativo || !est) return est;
  const s = est.sugestao;
  if (!s || !SUGESTOES_EM_ESPERA.has(s.chave)) return { ...est, limitado: ativo };
  return { ...est, limitado: ativo, sugestao: { chave: "segurar", tom: "neu", rotulo: `Limitado pela plataforma desde ${dm(ativo.desde)}`, emEspera: s.chave } };
}
