// O que a Sede mostra vem do Início (que já calcula os avisos e "como a loja
// está"): aqui só guarda, como marcas.js e urgentes.js. Não grava nada.
let dados = { pendencias: [], kpis: null, pronto: false };
let assinatura = "";
const ouvintes = new Set();

export function publicarSede({ pendencias, kpis }) {
  const leves = (pendencias || []).filter((p) => !p.tarefa).map((p) => ({ id: p.id, grupo: p.grupo, titulo: typeof p.titulo === "string" ? p.titulo : "", texto: typeof p.texto === "string" ? p.texto : "", ir: p.ir ? { aba: p.ir.aba, pedido: p.ir.pedido } : null, rotulo: typeof p.rotulo === "string" ? p.rotulo : null }));
  const s = JSON.stringify([leves, kpis]);
  if (s === assinatura) return;
  assinatura = s;
  dados = { pendencias: leves, kpis, pronto: true };
  ouvintes.forEach((f) => f());
}
export const lerSede = () => dados;
export function assinarSede(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
