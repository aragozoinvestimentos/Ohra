import { trocarSubAba } from "../lib/subAbas.js";
import { irParaAba } from "../lib/navegar.js";

// Dinheiro → Resultado (28/10/2026, aprovado pela prévia): Resumo do mês, Vendas do mês
// e Payoff viraram 3 vistas de UMA sub-aba. As telas e as contas são as mesmas; aqui
// só fica o seletor que leva de uma pra outra.
const VISTAS = [
  { k: "mes", rot: "Do mês" },
  { k: "vendas", rot: "Por produto" },
  { k: "payoff", rot: "Seu dinheiro de volta" },
];
export default function VistasResultado({ atual }) {
  const ir = (k) => {
    if (k === atual) return;
    if (k === "mes") return irParaAba("resumoMes");
    trocarSubAba("ohra:caixa:sub", k);
    irParaAba("caixa");
  };
  return (
    <div className="subabas" role="group" aria-label="Vista do resultado">
      {VISTAS.map((v) => (
        <button key={v.k} type="button" className={`btn${atual === v.k ? " primary" : ""}`} aria-pressed={atual === v.k} onClick={() => ir(v.k)}>
          {v.rot}
        </button>
      ))}
    </div>
  );
}
