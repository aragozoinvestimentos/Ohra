// Equipe da Sede (etapa C, 28/10/2026 — combinado com o Gustavo pela prévia):
// estrelas, níveis, promoções, ranking, destaque da semana e a pauta da reunião.
// PURO: lê as decisões do consultor (consultor_registros, tipo 'consultoria' —
// `dados.de` = quem teve a ideia/propôs; sem `de` = o Gerente Geral) e os níveis
// aprovados (preferencias_loja `sede:equipe`). Gravação só pelo usePreferencia.
//
// Estrelas (só contam com a SUA aprovação): ★ +1 ideia/proposta aprovada · ★ +3 aprovada
// e deu certo (o aviso sumiu — resultadosParaGravar) · ★ 0 aprovada e não deu certo = "tentada".

const SIM = new Set(["quero", "aprovada", "levada", "resolvida"]);
const FORA = /^(relatorio|backup)/; // arquivos que o consultor entrega não são ideia de ninguém

export const NIVEIS = ["Estagiário", "Analista", "Analista sênior", "Especialista", "Gerente"];
/** O que pede cada nível (total acumulado — as estrelas não zeram na promoção). */
export const REQUISITOS = { 1: { estrelas: 5, deram: 2 }, 2: { estrelas: 15, deram: 4 }, 3: { estrelas: 30, deram: 8 }, 4: { estrelas: 50, deram: 12 } };
/** Nível de partida pelo cargo: Zé estagiário, analistas, gerentes. CEOs e Gerente Geral ficam fora da escada. */
export const NIVEL_INICIAL = { ze: 0, lia: 1, kai: 1, rafa: 1, nina: 1, leo: 1, ivo: 1, duda: 1, rui: 1, bia: 4, celia: 4, teo: 4 };
export const FORA_DA_ESCADA = new Set(["ceo1", "ceo2", "consultor"]);

const historicoDe = (r) => (Array.isArray(r.dados?.historico) && r.dados.historico.length ? r.dados.historico : r.status ? [{ status: r.status, data: String(r.atualizado_em || r.criado_em || "").slice(0, 10) }] : []);
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Quem levou o crédito de uma decisão do consultor (null = não conta). */
export function autorDoRegistro(r) {
  if (r?.tipo !== "consultoria" || FORA.test(String(r.chave || ""))) return null;
  return r.dados?.de || "consultor";
}

/**
 * Estrelas por pessoa: { id: { estrelas, ideias, aprovadas, deram, tentadas, pontos: [{ data, pts, titulo, motivo }] } }.
 */
export function estrelasDaEquipe(registros) {
  const out = {};
  for (const r of registros || []) {
    const id = autorDoRegistro(r);
    if (!id) continue;
    const x = (out[id] ||= { estrelas: 0, ideias: 0, aprovadas: 0, deram: 0, tentadas: 0, pontos: [] });
    x.ideias++;
    const sim = historicoDe(r).find((h) => SIM.has(h.status));
    if (!sim) continue;
    const titulo = r.dados?.titulo || r.chave;
    x.aprovadas++;
    x.estrelas += 1;
    x.pontos.push({ data: sim.data, pts: 1, titulo, motivo: "aprovada" });
    const res = Array.isArray(r.dados?.resultados) ? r.dados.resultados : [];
    const deu = res.find((s) => s.status === "resolveu");
    if (deu) {
      x.deram++;
      x.estrelas += 3;
      x.pontos.push({ data: deu.em, pts: 3, titulo, motivo: "deu certo" });
    } else if (res.some((s) => s.status === "continuou")) x.tentadas++;
  }
  return out;
}

/** Nível de hoje: o aprovado por você (sede:equipe.niveis) ou o de partida pelo cargo. */
export const nivelDe = (id, equipe) => (Number.isInteger(equipe?.niveis?.[id]) ? equipe.niveis[id] : NIVEL_INICIAL[id] ?? 1);
export const nomeDoNivel = (n) => NIVEIS[Math.max(0, Math.min(NIVEIS.length - 1, n))];

/** Próximo nível: { nivel, nome, faltaEstrelas, faltaDeram, pronto } ou null (já é Gerente / fora da escada). */
export function proximoNivel(id, est, equipe) {
  if (FORA_DA_ESCADA.has(id)) return null;
  const n = nivelDe(id, equipe);
  const req = REQUISITOS[n + 1];
  if (!req) return null;
  const e = est?.[id] || { estrelas: 0, deram: 0 };
  const faltaEstrelas = Math.max(0, req.estrelas - e.estrelas), faltaDeram = Math.max(0, req.deram - e.deram);
  return { nivel: n + 1, nome: nomeDoNivel(n + 1), req, faltaEstrelas, faltaDeram, pronto: !faltaEstrelas && !faltaDeram };
}
/** Quem está pronto pra promoção (você aprova; "Depois" esconde por 14 dias). */
export function prontosPraPromocao(ids, est, equipe, hoje) {
  return ids
    .map((id) => ({ id, prox: proximoNivel(id, est, equipe) }))
    .filter((x) => x.prox?.pronto && !((equipe?.depois?.[x.id] || "") > hoje))
    .map((x) => ({ id: x.id, de: nomeDoNivel(nivelDe(x.id, equipe)), para: x.prox.nome, nivel: x.prox.nivel, est: est[x.id] }));
}
/** Aprovar promoção → novo valor de `sede:equipe` (quem grava é o usePreferencia). */
export function promover(equipe, id, nivel, hoje) {
  const e = equipe || {};
  return { ...e, niveis: { ...(e.niveis || {}), [id]: nivel }, promocoes: [...(e.promocoes || []), { id, nivel, data: hoje }].slice(-50) };
}
export function adiarPromocao(equipe, id, hoje) {
  const e = equipe || {};
  return { ...e, depois: { ...(e.depois || {}), [id]: somarDias(hoje, 14) } };
}

/** Ranking de um período (pelas datas das estrelas): [{ id, pts, aprovadas, deram }], só quem pontuou. */
export function rankingDoPeriodo(est, de, ate) {
  return Object.entries(est || {})
    .map(([id, x]) => {
      const p = x.pontos.filter((q) => q.data >= de && q.data <= ate);
      return { id, pts: p.reduce((s, q) => s + q.pts, 0), aprovadas: p.filter((q) => q.motivo === "aprovada").length, deram: p.filter((q) => q.motivo === "deu certo").length };
    })
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts || b.deram - a.deram);
}
/** Semana fechada que passou (segunda a domingo). */
export function semanaPassada(hoje) {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay() || 7;
  const segunda = somarDias(hoje, -(dow - 1) - 7);
  return { de: segunda, ate: somarDias(segunda, 6) };
}
/** Destaque da semana: quem mais pontuou na semana que passou (ou null). */
export function destaqueDaSemana(est, hoje) {
  const { de, ate } = semanaPassada(hoje);
  return rankingDoPeriodo(est, de, ate)[0] || null;
}

// ---------- pauta da reunião ----------
const GERENTES = [
  { id: "bia", sala: "financeiro", ok: "Contas em dia por aqui ✓" },
  { id: "celia", sala: "comercial", ok: "Anúncios e preços sem pendência ✓" },
  { id: "teo", sala: "operacao", ok: "Produção e expedição em dia ✓" },
];
const PESO = { resolver: 3, rotina: 2, oportunidade: 1 };
/** Opinião de cada gerente: o aviso que mais pesa no setor dele (mesmos avisos do Início). */
export function opinioesDosGerentes(porSala, notas = {}) {
  return GERENTES.map((g) => {
    const l = [...(porSala?.[g.sala] || [])].sort((a, b) => (PESO[b.grupo] || 2) - (PESO[a.grupo] || 2));
    const top = l[0];
    let texto = g.ok;
    if (top) {
      const t = String(top.titulo || "").replace(/\s+/g, " ").slice(0, 90);
      texto = top.grupo === "resolver" ? `Antes de tudo: ${t}` : top.grupo === "oportunidade" ? `Dá pra ganhar mais: ${t}` : `Precisa de atenção: ${t}`;
      if (l.length > 1) texto += ` (+${l.length - 1} no setor)`;
    }
    return { id: g.id, sala: g.sala, texto, grupo: top?.grupo || null, nota: notas[g.sala] ?? null };
  });
}
