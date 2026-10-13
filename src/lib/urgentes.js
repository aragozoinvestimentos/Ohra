// Contagem de urgentes (grupo Resolver do Início) pra bolinha vermelha do
// menu e da barra do celular. Quem calcula é o Início (que SÓ LÊ as outras
// abas); aqui só guarda o número. Fica na sessão pra sobreviver a recarregar
// a página em outra aba antes de o Início montar de novo.
let n = (() => {
  try {
    return Number(sessionStorage.getItem("ohra:urgentes")) || 0;
  } catch {
    return 0;
  }
})();
const ouvintes = new Set();
export function publicarUrgentes(v) {
  if (v === n) return;
  n = v;
  try {
    sessionStorage.setItem("ohra:urgentes", String(v));
  } catch {
    // sem sessionStorage — só não lembra
  }
  ouvintes.forEach((f) => f());
}
export const lerUrgentes = () => n;
export function assinarUrgentes(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
