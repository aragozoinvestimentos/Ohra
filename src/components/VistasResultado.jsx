import { trocarSubAba } from "../lib/subAbas.js";
import { irParaAba } from "../lib/navegar.js";

// Dinheiro → 2 · Estou ganhando? (20/11/2026, prévia "Dinheiro em 3 abas"): o lucro num
// lugar só. Do mês (ResumoMes), Por produto (Vendas do mês), Seu dinheiro de volta
// (Payoff) e os atalhos pra Metas, Ranking e Fiscal. As telas e as contas são as mesmas;
// aqui só fica o seletor que leva de uma pra outra.
const VISTAS = [
  { k: "mes", rot: "Do mês" },
  { k: "vendas", rot: "Por produto" },
  { k: "payoff", rot: "Seu dinheiro de volta" },
  { k: "metas", rot: "Metas", aba: "metas" },
  { k: "ranking", rot: "Ranking", aba: "ranking" },
  { k: "fiscal", rot: "Impostos (Fiscal)", aba: "fiscal" },
];
export default function VistasResultado({ atual }) {
  const ir = (v) => {
    if (v.k === atual) return;
    if (v.k === "mes") return irParaAba("resumoMes");
    if (v.aba) return irParaAba(v.aba);
    trocarSubAba("ohra:caixa:sub", v.k);
    irParaAba("caixa");
  };
  return (
    <div className="subabas" role="group" aria-label="Estou ganhando?">
      {VISTAS.map((v) => (
        <button key={v.k} type="button" className={`btn${atual === v.k ? " primary" : ""}`} aria-pressed={atual === v.k} onClick={() => ir(v)}>
          {v.rot}
        </button>
      ))}
    </div>
  );
}
