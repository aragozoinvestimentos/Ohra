// Sempre converte pra número antes de checar/format — null, undefined, string
// vazia etc. viram "—" em vez de derrubar a tela (null.toLocaleString explode).
export const BRL = (v) => {
  const num = Number(v);
  return isFinite(num) && v != null && v !== "" ? num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

export const PCT = (v) => {
  const num = Number(v);
  return isFinite(num) && v != null && v !== "" ? (num * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";
};
