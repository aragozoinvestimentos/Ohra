// Navegação entre abas sem passar props por todo lado: qualquer tela chama
// irParaAba("historico", { custoMudou: true, busca: "Chaveiro" }); o App troca
// de aba e a tela de destino lê o pedido com pegarPedido(aba) (ao montar) ou
// ouvindo o evento (se já estava montada).
let pendentes = {};

export function irParaAba(aba, pedido = null) {
  if (pedido) pendentes[aba] = pedido;
  window.dispatchEvent(new CustomEvent("ohra:ir-para", { detail: { aba, pedido } }));
}

export function pegarPedido(aba) {
  const p = pendentes[aba] || null;
  delete pendentes[aba];
  return p;
}
