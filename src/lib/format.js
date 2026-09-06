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

// Preço por unidade de material/embalagem — no máximo 3 casas decimais, pra
// não acumular ruído de arredondamento (nem mostrar dízimas estranhas) em
// preços de itens comprados em pacote, tipo R$0,0395/cm virando R$0,04/cm.
export const arredondarPreco = (v) => Math.round(Number(v) * 1000) / 1000;
