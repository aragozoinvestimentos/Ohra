import { useCallback, useSyncExternalStore } from "react";

// Sub-aba lembrada, compartilhada entre a tela e a barra de sub-abas do
// cabeçalho (menu de 7 itens, out/2026): as sub-abas de Cadastros,
// Crescimento e Fluxo de Caixa aparecem no cabeçalho do App, então a tela e o
// App leem/gravam a MESMA sub-aba por aqui (mesma chave do localStorage de antes).

const valores = {};
const ouvintes = new Set();

function ler(chave, padrao) {
  if (!(chave in valores)) {
    try {
      const v = localStorage.getItem(chave);
      valores[chave] = v != null ? v : padrao;
    } catch {
      valores[chave] = padrao;
    }
  }
  return valores[chave] ?? padrao;
}

export function trocarSubAba(chave, valor) {
  valores[chave] = valor;
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // sem localStorage — só não lembra
  }
  ouvintes.forEach((f) => f());
}

function assinar(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** [sub, trocar] — `validos` limita aos valores conhecidos (cai no padrão). */
export function useSubAba(chave, padrao, validos = null) {
  const bruto = useSyncExternalStore(assinar, () => ler(chave, padrao), () => padrao);
  const valor = validos && !validos.includes(bruto) ? padrao : bruto;
  const trocar = useCallback((v) => trocarSubAba(chave, v), [chave]);
  return [valor, trocar];
}
