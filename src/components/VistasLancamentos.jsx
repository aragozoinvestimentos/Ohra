import { trocarSubAba } from "../lib/subAbas.js";

// Dinheiro → 3 · Lançamentos e contas (20/11/2026): os lançamentos do dia a dia e as
// contas a pagar (fixas e parcelas) lado a lado. Mesmas sub-abas de antes (caixa/contas).
export default function VistasLancamentos({ atual }) {
  const ir = (k) => k !== atual && trocarSubAba("ohra:caixa:sub", k);
  return (
    <div className="subabas" role="group" aria-label="Lançamentos e contas">
      {[["caixa", "Lançamentos"], ["contas", "Contas a pagar"]].map(([k, rot]) => (
        <button key={k} type="button" className={`btn${atual === k ? " primary" : ""}`} aria-pressed={atual === k} onClick={() => ir(k)}>
          {rot}
        </button>
      ))}
    </div>
  );
}
