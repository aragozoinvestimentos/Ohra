import { ML_CATEGORY_PCT } from "./calc.js";

// Lucratividade e categoria/tipo de anúncio (ML) usados só pra achar o
// preço/lucro de referência de cada item (Ranking, tela de descanso,
// recálculo ao vivo dos preços salvos) — fixos de propósito, pra todas as
// telas darem o mesmo número. Quem quiser simular outra meta usa
// Precificação por Canal ou Comparativo.
export const LUCRATIVIDADE_PADRAO = 20;
export const ML_CATEGORIA_PADRAO = Object.keys(ML_CATEGORY_PCT)[0];
export const ML_TIPO_ANUNCIO_PADRAO = "classico";
