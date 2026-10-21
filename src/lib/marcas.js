// Marcas de notificação do menu e das sub-abas do topo (out/2026): vermelha =
// resolver, âmbar = atenção, verde forte = oportunidade (ex.: pronto pra subir).
// Quem calcula é o Início, a partir dos MESMOS avisos do "Pra fazer" (os
// adiados por 30 dias não contam); aqui só guarda. Fica na sessão, como as
// urgentes (src/lib/urgentes.js).
const CHAVE = "ohra:marcas";
let mapa = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE) || "{}") || {};
  } catch {
    return {};
  }
})();
const ouvintes = new Set();

// Aba + sub-aba de destino de um aviso do Início → chave "aba" ou "aba:sub".
const SUB_PADRAO = { crescimento: "rampa", caixa: "caixa", analise: "abc" };
export function chaveDoDestino(ir) {
  if (!ir?.aba) return null;
  if (ir.aba === "publicar") return "canal:publicar";
  const padrao = SUB_PADRAO[ir.aba];
  return padrao ? `${ir.aba}:${ir.pedido?.sub || padrao}` : ir.aba;
}

/** pendencias = avisos do Início (com grupo resolver | rotina | oportunidade e ir). */
export function contarMarcas(pendencias) {
  const m = {};
  for (const p of pendencias || []) {
    if (p.tarefa) continue;
    const k = chaveDoDestino(p.ir);
    if (!k) continue;
    const c = m[k] || (m[k] = { r: 0, a: 0, o: 0 });
    if (p.grupo === "resolver") c.r++;
    else if (p.grupo === "oportunidade") c.o++;
    else c.a++;
  }
  return m;
}

export function publicarMarcas(novo) {
  const s = JSON.stringify(novo);
  if (s === JSON.stringify(mapa)) return;
  mapa = novo;
  try {
    sessionStorage.setItem(CHAVE, s);
  } catch {
    // sem sessionStorage — só não lembra
  }
  ouvintes.forEach((f) => f());
}
export const lerMarcas = () => mapa;
export function assinarMarcas(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** Soma das marcas das chaves que passam no filtro (menu = todas as abas do item). */
export function somarMarcas(m, filtro) {
  const t = { r: 0, a: 0, o: 0 };
  for (const [k, c] of Object.entries(m || {}))
    if (filtro(k)) {
      t.r += c.r;
      t.a += c.a;
      t.o += c.o;
    }
  return t;
}
