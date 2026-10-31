// Partes prontas de produto impresso em VÁRIAS MESAS (31/10/2026, pedido do Gustavo:
// "imprimi só o leão e não subiu pro estoque"). Uma mesa sozinha não é um conjunto
// vendável — então cada impressão de UMA mesa com sucesso vira "partes prontas"
// dessa mesa, e quando todas as mesas têm partes suficientes pra fechar conjuntos o
// app pergunta se põe no estoque de prontos.
//   Partes impressas = soma de quantidade_lote dos registros_impressao com sucesso
//   do produto cujo nome termina em " — mesa <nome da mesa>" (é como o Registro grava).
//   Descontar (preferencias_loja `producao:partes-mesas` = { produtoId: { mesa: n } })
//   = partes já usadas (conjuntos fechados) ou acertadas à mão. PURO.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const sufixoMesa = (nomeMesa) => ` — mesa ${nomeMesa}`;

/** { [nome da mesa]: partes impressas com sucesso } */
export function partesImpressas(registros = [], produtoId, mesas = []) {
  const out = {};
  for (const m of mesas) out[m.nome] = 0;
  for (const r of registros) {
    if (r.status !== "sucesso" || r.produto_id !== produtoId) continue;
    const nome = String(r.produto_nome || "");
    const m = mesas.find((x) => nome.endsWith(sufixoMesa(x.nome)));
    if (m) out[m.nome] += Math.max(0, num(r.quantidade_lote));
  }
  return out;
}

/** Partes prontas por mesa + quantos conjuntos fecham + o que falta pro próximo. */
export function partesProntas({ registros = [], produtoId, mesas = [], descontar = {}, extra = null }) {
  const impressas = partesImpressas(registros, produtoId, mesas);
  if (extra) impressas[extra.mesa] = (impressas[extra.mesa] || 0) + Math.max(0, num(extra.quantidade));
  const linhas = mesas.map((m) => {
    const leva = Math.max(0, num(m.leva));
    const prontas = Math.max(0, Math.round((impressas[m.nome] || 0) - num(descontar?.[m.nome])));
    return { nome: m.nome, leva, impressas: impressas[m.nome] || 0, prontas };
  });
  const usadas = linhas.filter((l) => l.leva > 0);
  const conjuntos = usadas.length ? Math.min(...usadas.map((l) => Math.floor(l.prontas / l.leva))) : 0;
  // o que falta pro próximo conjunto (depois dos que já fecham)
  const faltam = usadas
    .map((l) => ({ nome: l.nome, falta: l.leva * (conjuntos + 1) - l.prontas }))
    .filter((x) => x.falta > 0);
  const temAlguma = linhas.some((l) => l.prontas > 0);
  return { linhas, conjuntos, faltam, temAlguma };
}

/** Novo `descontar` depois de usar `n` conjuntos (as partes de cada mesa saem). */
export function usarConjuntos(descontar = {}, mesas = [], n) {
  const out = { ...(descontar || {}) };
  const q = Math.max(0, Math.floor(num(n)));
  for (const m of mesas) out[m.nome] = num(out[m.nome]) + Math.max(0, num(m.leva)) * q;
  return out;
}

/** Acertar à mão: `reais` = { mesa: partes que existem de verdade } → novo `descontar`. */
export function acertarPartes(registros = [], produtoId, mesas = [], reais = {}) {
  const impressas = partesImpressas(registros, produtoId, mesas);
  const out = {};
  for (const m of mesas) out[m.nome] = (impressas[m.nome] || 0) - Math.max(0, Math.round(num(reais[m.nome])));
  return out;
}

export function textoPartes(r) {
  if (!r?.linhas?.length) return "";
  return r.linhas.map((l) => `${l.nome} ${l.prontas}${l.leva !== 1 ? ` (leva ${l.leva})` : ""}`).join(" · ");
}
