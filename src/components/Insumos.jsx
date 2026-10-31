import { useSubAba } from "../lib/subAbas.js";
import Materiais from "./Materiais.jsx";
import Embalagens from "./Embalagens.jsx";

// Produção → Insumos (remap 21/10/2026): Materiais e Embalagens saíram de
// Produtos — são o que se compra pra produzir. Sub-aba no cabeçalho (ohra:insumos-sub).
export default function Insumos({ onToast }) {
  const [sub] = useSubAba("ohra:insumos-sub", "materiais", ["materiais", "embalagens"]);
  return sub === "embalagens" ? <Embalagens onToast={onToast} /> : <Materiais onToast={onToast} />;
}
