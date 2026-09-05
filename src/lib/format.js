export const BRL = (v) =>
  isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

export const PCT = (v) =>
  isFinite(v) ? (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";
