import { useState } from "react";

// useState lembrado no localStorage (preferência de tela por navegador).
// Leitura/escrita protegidas: sem localStorage (aba anônima, bloqueado) vale o padrão.
export function useLembrado(chave, padrao) {
  const [valor, setValor] = useState(() => {
    try {
      const v = localStorage.getItem(chave);
      return v != null ? v : padrao;
    } catch {
      return padrao;
    }
  });
  function set(v) {
    setValor(v);
    try {
      localStorage.setItem(chave, v);
    } catch {
      /* sem localStorage: só nesta sessão */
    }
  }
  return [valor, set];
}
