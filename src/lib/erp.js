// Sistema de pedidos (ERP) de cada loja (29/10/2026): a Ohra usa a Olist; outra loja
// pode usar a UpSeller. Guardado em lojas.config_escada.erp (sem SQL); sem escolha = Olist.
export const ERPS = [
  { id: "olist", nome: "Olist", pronto: true },
  { id: "upseller", nome: "UpSeller", pronto: true },
  { id: "nenhum", nome: "Nenhum (só venda física)", pronto: true },
];

export function erpDaLoja(cfgLoja) {
  const id = cfgLoja?.erp;
  return ERPS.find((e) => e.id === id) || ERPS[0];
}
