// Datas do app SEMPRE no fuso de São Paulo/Brasília (America/Sao_Paulo),
// independente do fuso do aparelho — o "hoje" bate com o calendário do
// Gustavo e com o painel da Shopee. Timestamps do banco (criado_em,
// atualizado_em) são UTC: pra virar data, use dataSP (antes, um .slice(0, 10)
// num timestamp depois das 21h já caía no dia seguinte).
export const FUSO = "America/Sao_Paulo";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

// Data (YYYY-MM-DD) em São Paulo de um Date ou timestamp.
export function dataSP(valor = new Date()) {
  if (valor == null || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d)) return String(valor).slice(0, 10);
  return fmt.format(d);
}

export const hojeSP = () => dataSP(new Date());
