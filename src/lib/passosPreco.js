// Passos da Precificação por Canal (1º Avulso → 2º Por quantidade → 3º Ficha
// → 4º Lançamento → 5º Anunciar): seleção compartilhada pro rodapé "Próximo"
// levar produto e canal de um passo pro outro, e pro Lançamento usar o que
// está escolhido na Ficha. Estado só na sessão (nada é gravado).
import { useSyncExternalStore } from "react";

export const PASSOS = [
  { key: "avulso", label: "Avulso", ordem: "1º" },
  { key: "quantidade", label: "Por quantidade", ordem: "2º" },
  { key: "ficha", label: "Ficha do anúncio", ordem: "3º" },
  { key: "lancamento", label: "Lançamento", ordem: "4º" },
  { key: "publicar", label: "Anunciar", ordem: "5º" },
];

let estado = { atual: { itemId: null, canalId: null }, porPasso: {}, pedido: null };
let seq = 0;
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((f) => f());

// Cada passo publica o que está escolhido nele (itemId "p:/k:/v:", canalId).
export function publicarSelecao(passo, itemId, canalId) {
  const ant = estado.porPasso[passo];
  if (ant && ant.itemId === itemId && ant.canalId === canalId) return;
  estado = { ...estado, atual: { itemId, canalId }, porPasso: { ...estado.porPasso, [passo]: { itemId, canalId } } };
  avisar();
}

// "Próximo →": leva a seleção pro passo `para`.
export function pedirPasso(para, itemId, canalId) {
  estado = { ...estado, pedido: { para, itemId, canalId, seq: ++seq } };
  avisar();
}

export function useSelecaoPasso() {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => estado
  );
}
