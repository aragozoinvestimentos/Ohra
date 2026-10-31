import { useSubAba } from "../lib/subAbas.js";
import Materiais from "./Materiais.jsx";
import Embalagens from "./Embalagens.jsx";
import SaldoFilamento from "./SaldoFilamento.jsx";

// Produção → Insumos (remap 21/10/2026): Materiais e Embalagens saíram de
// Produtos — são o que se compra pra produzir. Sub-aba no cabeçalho (ohra:insumos-sub).
// Saldo de filamento (01/11/2026, v73): contagem por cor + compras − impressões.
export default function Insumos({ onToast }) {
  const [sub] = useSubAba("ohra:insumos-sub", "materiais", ["materiais", "embalagens", "saldo"]);
  if (sub === "saldo") return <SaldoFilamento onToast={onToast} />;
  return sub === "embalagens" ? <Embalagens onToast={onToast} /> : <Materiais onToast={onToast} />;
}
