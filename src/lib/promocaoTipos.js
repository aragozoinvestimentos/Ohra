// Lista dos tipos de promoção — compartilhada entre o simulador
// (PromocaoSimulador.jsx) e a lista de promoções salvas (PromocoesSalvas.jsx),
// que usa o "label" pra mostrar o tipo de cada linha salva. Fica num arquivo
// à parte (em vez de exportado direto do componente) só pra não disparar o
// aviso de fast-refresh do react (only-export-components).
export const TIPOS = [
  { key: "desconto", label: "Desconto direto" },
  { key: "progressivo", label: "Progressivo por quantidade" },
  { key: "combo", label: "Combo (leve mais, pague menos)" },
  { key: "combinada", label: "Venda combinada" },
  { key: "frete", label: "Frete grátis" },
  { key: "brinde", label: "Brinde / order bump" },
  { key: "liquidacao", label: "Liquidação com piso de margem" },
];
