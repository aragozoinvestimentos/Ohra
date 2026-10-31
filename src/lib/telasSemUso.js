// Telas que você não abriu (01/11/2026, pedido do Gustavo: revisar o que não se
// usa — ele SEMPRE valida, tela por tela, "concordo" / "não concordo"). PURA.
// O uso vem da captura do consultor (consultor_registros tipo 'uso', chave
// 'AAAA-MM-DD|<aba>'), por loja. A lista de telas vem do menu (definirTelas,
// chamado pelo App — sem importar o App aqui).
let TELAS = [];
export const definirTelas = (lista) => {
  TELAS = lista;
};
export const telasDoApp = () => TELAS;
export const DIAS_SEM_USO = 30;

const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

/** usos = [{ chave: 'AAAA-MM-DD|aba', dados: { n } }] → telas sem abrir em N dias. */
export function telasSemUso({ telas = [], usos = [], hoje, dias: n = DIAS_SEM_USO }) {
  const ultima = new Map();
  let inicio = null;
  for (const u of usos) {
    const [d, aba] = String(u.chave || "").split("|");
    if (!d || !aba) continue;
    if (!inicio || d < inicio) inicio = d;
    if (!ultima.has(aba) || d > ultima.get(aba)) ultima.set(aba, d);
  }
  const temDados = inicio ? dias(inicio, hoje) : 0;
  const lista = telas
    .filter((t) => !t.semRevisao)
    .map((t) => {
      const u = ultima.get(t.tab) || null;
      const sem = u ? dias(u, hoje) : null;
      return { ...t, ultima: u, diasSem: sem, semUso: u ? sem >= n : temDados >= n };
    })
    .filter((t) => t.semUso || !t.ultima)
    .sort((a, b) => (b.diasSem ?? 9999) - (a.diasSem ?? 9999));
  return { lista, inicio, completo: temDados >= n, faltam: Math.max(0, n - temDados) };
}
