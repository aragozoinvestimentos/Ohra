import { useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";

const sinal = (v) => `${v >= 0 ? "+" : "−"}${BRL(Math.abs(v))}`;

// Painel "Impacto da mudança" (ver lib/impactoCusto.js). Só aparece quando a
// diferença passa de R$ 0,05; resumo sempre aberto, lista recolhida.
export default function ImpactoCusto({ impacto, titulo = "Impacto da mudança" }) {
  const [aberto, setAberto] = useState(false);
  if (!impacto || !impacto.relevante) return null;
  const { dCusto, linhas } = impacto;
  const melhora = dCusto < 0;
  const somaDif = linhas.length ? linhas.reduce((s, l) => s + l.diferenca, 0) / linhas.length : null;
  return (
    <div className={`impacto-custo ${impacto.algumProblema ? "ruim" : melhora ? "bom" : "pior"}`}>
      <div className="impacto-topo">
        <b>{titulo}</b>
        <span>
          Custo {impacto.custoPecaAtual != null && impacto.custoPecaNovo != null && Math.abs(impacto.custoPecaNovo - impacto.custoPecaAtual) >= 0.005 ? "por peça " : "total "}
          {impacto.custoPecaAtual != null && Math.abs(impacto.custoPecaNovo - impacto.custoPecaAtual) >= 0.005 ? (
            <>
              {BRL(impacto.custoPecaAtual)} → <b>{BRL(impacto.custoPecaNovo)}</b> ({sinal(impacto.custoPecaNovo - impacto.custoPecaAtual)})
            </>
          ) : (
            <>
              {BRL(impacto.custoTotalAtual)} → <b>{BRL(impacto.custoTotalNovo)}</b> ({sinal(dCusto)})
            </>
          )}
          {linhas.length > 0 ? (
            <>
              {" "}· lucro <b className={somaDif >= 0 ? "pos" : "neg"}>{sinal(somaDif)}/venda</b> em média · afeta {impacto.itensAfetados} item(ns) em {impacto.canaisAfetados} canal(is)
            </>
          ) : (
            " · nenhum preço salvo pra comparar ainda"
          )}
        </span>
        {linhas.length > 0 && (
          <button type="button" className={`variacoes-toggle${aberto ? " aberto" : ""}`} onClick={() => setAberto((v) => !v)}>
            <span className="seta">▸</span> {aberto ? "esconder" : "ver itens"}
          </button>
        )}
      </div>
      {impacto.algumProblema && <div className="impacto-alerta">Algum item passa a dar prejuízo ou fica abaixo do mínimo aceitável no preço salvo — veja em vermelho.</div>}
      {aberto && linhas.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item afetado</th>
                <th>Canal</th>
                <th className="num">Preço salvo</th>
                <th className="num">Lucro hoje</th>
                <th className="num">Com a mudança</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className={l.prejuizo || l.abaixoMinimo ? "linha-ruim" : ""}>
                  <td>{l.nome}</td>
                  <td><CanalTag canal={l.canal} /></td>
                  <td className="num">{BRL(l.preco)}</td>
                  <td className="num">{BRL(l.lucroHoje)}</td>
                  <td className="num">
                    {BRL(l.lucroNovo)} <span className="muted-cel">· {PCT(l.margemNova)}</span>
                    {l.abaixoMinimo && !l.prejuizo && <div className="sub-num">abaixo do mínimo</div>}
                  </td>
                  <td className={`num ${l.diferenca >= 0 ? "pos" : "neg"}`}>
                    <b>{sinal(l.diferenca)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
