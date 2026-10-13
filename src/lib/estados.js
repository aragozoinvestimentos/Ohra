// Cores com regra ÚNICA (out/2026) — cinco estados, sempre com o mesmo
// significado e sempre com ícone ou palavra junto (nunca cor sozinha). O que
// está OK fica SEM cor. Nenhuma regra nova aqui: só traduz o que alertaDe /
// statusPrecoSalvo / estadoRampa / afiliados / inicio já decidiram.
export const ESTADOS = ["resolver", "atencao", "oportunidade", "decisao", "info"];

export const ROTULO_ESTADO = {
  resolver: "Resolver",
  atencao: "Atenção",
  oportunidade: "Oportunidade",
  decisao: "Decisão sua",
  info: "Informação",
};

export const ICONE_ESTADO = { resolver: "!", atencao: "⚠", oportunidade: "↑", decisao: "◆", info: null };

export const DESC_ESTADO = {
  resolver: "prejuízo, conta vencida, teste com cliques sem venda",
  atencao: "abaixo do mínimo, semana pendente, anúncio pra atualizar, alvo mudou, frete grátis, revisar anúncio",
  oportunidade: "dá pra agir e ganhar: subir degrau, ativar afiliado, mandar amostra, portão ok, ✓ feito",
  decisao: "você escolheu: em rampa, crescimento até dd/mm, atração, manter assim",
  info: "só informação: não anunciado, sem dados, coletando, não vale oferecer",
};

// Prioridade da bolinha de saúde (a pior ganha). Oportunidade/info não viram bolinha.
const PESO = { resolver: 3, atencao: 2, decisao: 1 };

// Junta vários estados de uma linha → { tipo, motivo } do pior (ou null = ok).
export function piorEstado(lista) {
  let pior = null;
  const motivos = [];
  for (const e of lista) {
    if (!e || !PESO[e.tipo]) continue;
    if (e.motivo && !motivos.includes(e.motivo)) motivos.push(e.motivo);
    if (!pior || PESO[e.tipo] > PESO[pior]) pior = e.tipo;
  }
  return pior ? { tipo: pior, motivo: motivos.join(" · ") } : null;
}

// alertaPreco/alertaDe → estado. Prejuízo é sempre "resolver" (mesmo quando
// a estratégia explica — aí só fica discreto); abaixo do mínimo silenciado
// pela estratégia = decisão sua; frete grátis = atenção.
export function estadoDoAlerta(al, { rotuloEstrategia = null } = {}) {
  if (!al) return null;
  if (al.tipo === "prejuizo") return { tipo: "resolver", motivo: al.discreto && rotuloEstrategia ? `prejuízo · ${rotuloEstrategia}` : "prejuízo" };
  if (al.tipo === "abaixo-minimo") return { tipo: "atencao", motivo: "abaixo do mínimo" };
  if (al.frete) return { tipo: "atencao", motivo: al.frete.curto || "abaixo do frete grátis" };
  if (al.silenciado && rotuloEstrategia) return { tipo: "decisao", motivo: rotuloEstrategia };
  return null;
}

// statusPrecoSalvo (escada.js) → estado: ✓ ok = sem cor; "dá pra cobrar mais"
// = oportunidade; abaixo do piso / escada invertida = atenção; caro = info.
export function estadoDoStatusSalvo(st) {
  if (!st) return null;
  const motivo = String(st.texto || "").replace(/^[^\wÀ-ú]+\s*/, "");
  if (st.tom === "bad" || st.tom === "warn") return { tipo: "atencao", motivo };
  if (st.tom === "acc") return { tipo: "oportunidade", motivo };
  if (st.tom === "neu") return { tipo: "info", motivo };
  return null;
}

// Tom antigo das libs (bad/warn/good/acc/neu) → estado. "good" vira
// oportunidade só quando quem chama diz que é uma ação (subir, ativar…);
// senão é OK = sem cor.
export function estadoDoTom(tom, { goodEhAcao = false } = {}) {
  if (tom === "bad") return "resolver";
  if (tom === "warn") return "atencao";
  if (tom === "acc") return "decisao";
  if (tom === "neu") return "info";
  if (tom === "good") return goodEhAcao ? "oportunidade" : null;
  return null;
}

// Sugestão da linha da Rampa (estadoRampa().sugestao) → estado. Só traduz:
// subir/testar acima/acima aprovado = oportunidade; revisar/voltar = atenção
// (revisar por teste com cliques sem venda = resolver); segurar depois de
// semana ruim = atenção, senão informação; testando acima = decisão sua;
// no alvo = OK (sem cor).
export function estadoSugestaoRampa(e) {
  const s = e?.sugestao;
  if (!s) return null;
  if (s.chave === "subir" || s.chave === "testar-acima" || s.chave === "acima-aprovado") return "oportunidade";
  if (s.chave === "revisar") return e.anuncio?.motivo === "teste" ? "resolver" : "atencao";
  if (s.chave === "voltar" || s.chave === "acima-voltar" || s.chave === "descer" || s.chave === "atrasado") return "atencao";
  if (s.chave === "segurar") return s.tom === "warn" && e.lucroCheck?.status === "sinaliza" ? "atencao" : "info";
  if (s.chave === "acima-testando") return "decisao";
  return null;
}

// Bolinha de saúde da linha da Rampa: todas as linhas estão em rampa (decisão
// sua), então a bolinha só aparece pro que pede ação — resolver/atenção — e
// pro teste acima do alvo (decisão sua em andamento).
export function saudeRampa(e, pendente) {
  const sug = estadoSugestaoRampa(e);
  return piorEstado([
    e?.lucroAtual != null && e.lucroAtual < 0 ? { tipo: "resolver", motivo: "prejuízo no degrau atual" } : null,
    sug === "resolver" || sug === "atencao" || sug === "decisao" ? { tipo: sug, motivo: e.sugestao.rotulo } : null,
    pendente ? { tipo: "atencao", motivo: `semana pendente há ${pendente.dias} dias` } : null,
    e?.alvoMudou ? { tipo: "atencao", motivo: "alvo mudou" } : null,
  ]);
}

// Sugestão dos Afiliados (afiliados.js → sugestoesAfiliado) → estado, pela chave.
export function estadoSugestaoAfiliado(sg) {
  const k = String(sg?.chave || "").split("|")[0];
  if (k === "acima" || k === "alta" || k === "descer") return "atencao";
  if (k === "divulgou") return sg.tom === "good" ? "oportunidade" : "atencao";
  if (k === "pode" || k === "pode-mais" || k === "amostra" || k === "subir") return "oportunidade";
  return "info";
}

// Situação da linha de comissão (afiliados.js) → estado. "acima da máxima"
// vira resolver só quando o lucro com afiliado é prejuízo (alertaCom).
export function estadoSituacaoAfiliado(l) {
  switch (l?.situacao) {
    case "acima":
      return l.alertaCom?.tipo === "prejuizo" && !l.alertaCom?.discreto ? "resolver" : "atencao";
    case "alta":
      return "atencao";
    case "pode":
      return "oportunidade";
    case "rampa":
    case "atracao":
      return "decisao";
    case "ok":
      return null;
    default:
      return "info";
  }
}
