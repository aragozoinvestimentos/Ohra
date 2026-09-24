import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// Coloca os botões principais de uma aba (Salvar, Limpar, Novo…) no
// cabeçalho fixo do topo, em vez de dentro dos cartões. O App.jsx renderiza
// um "slot" por aba (#acoes-<aba>) e só mostra o da aba ativa — então cada
// tela pode montar seus botões sem se preocupar se está visível ou não.
// useSyncExternalStore relê o slot depois de montar (no primeiro render ele
// ainda não existe no DOM) e re-renderiza sozinho quando ele aparece.
const semInscricao = () => () => {};

export default function TopbarAcoes({ aba, children }) {
  const alvo = useSyncExternalStore(
    semInscricao,
    () => document.getElementById(`acoes-${aba}`),
    () => null
  );
  return alvo ? createPortal(children, alvo) : null;
}
