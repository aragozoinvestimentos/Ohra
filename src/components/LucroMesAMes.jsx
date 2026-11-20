import { useMemo } from "react";
import { BRL } from "../lib/format.js";
import { cascataDoPeriodo } from "../lib/resumoLoja.js";
import { rotuloMes, somarMeses } from "../lib/fluxoCaixa.js";

// Dinheiro → 2 · Estou ganhando? → Mês a mês (20/11/2026; antes ficava no Resumo do
// Dinheiro). Mesma conta do "Do faturamento ao lucro" (cascataDoPeriodo), um mês por
// linha, do 1º mês com pedido até hoje.
export default function LucroMesAMes({ pedidos, linhasAds, lancamentos, hoje }) {
  const meses = useMemo(() => {
    const primeiro = pedidos.reduce((m, p) => (p.valido && (!m || String(p.data) < m) ? String(p.data).slice(0, 10) : m), null);
    if (!primeiro) return [];
    const out = [];
    for (let m = primeiro.slice(0, 7); m <= hoje.slice(0, 7) && out.length < 24; m = somarMeses(m, 1)) {
      const [a, mm] = m.split("-").map(Number);
      const fim = `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, "0")}`;
      const c = cascataDoPeriodo({ pedidos, linhasAds, lancamentos, de: `${m}-01`, ate: fim < hoje ? fim : hoje }).total;
      out.push({ mes: m, parcial: fim >= hoje, c });
    }
    return out;
  }, [pedidos, linhasAds, lancamentos, hoje]);
  const soma = (k) => meses.reduce((t, x) => t + (x.c[k] || 0), 0);
  return (
    <>
      {meses.length > 0 && (
        <div className="panel">
          <h3 className="section-title h3-split">
            <span>Lucro mês a mês</span>
            <span className="faint">mesma conta da tabela acima · contas fixas = recorrentes + parcelas</span>
          </h3>
          <div className="table-wrap">
            <table className="dr-meses">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Faturado</th>
                  <th className="num">Plataformas e impostos</th>
                  <th className="num">Custo</th>
                  <th className="num">Ads</th>
                  <th className="num">Contas fixas</th>
                  <th className="num">Sobrou pra você</th>
                </tr>
              </thead>
              <tbody>
                {meses.map(({ mes, parcial, c }) => (
                  <tr key={mes}>
                    <td>
                      {rotuloMes(mes)}
                      {parcial && <span className="dr-parcial">parcial</span>}
                    </td>
                    <td className="num">{BRL(c.pago)}</td>
                    <td className="num faint">− {BRL(c.taxas + c.imposto)}</td>
                    <td className="num faint">− {BRL(c.custo)}</td>
                    <td className="num faint">− {BRL(c.ads)}</td>
                    <td className="num faint">− {BRL(c.fixas || 0)}</td>
                    <td className={`num dr-sobrou${(c.liquido || 0) < 0 ? " neg" : ""}`}>{BRL(c.liquido || 0)}</td>
                  </tr>
                ))}
                {meses.length > 1 && (
                  <tr className="dr-tot">
                    <td>Total</td>
                    <td className="num">{BRL(soma("pago"))}</td>
                    <td className="num">− {BRL(soma("taxas") + soma("imposto"))}</td>
                    <td className="num">− {BRL(soma("custo"))}</td>
                    <td className="num">− {BRL(soma("ads"))}</td>
                    <td className="num">− {BRL(soma("fixas"))}</td>
                    <td className={`num dr-sobrou${soma("liquido") < 0 ? " neg" : ""}`}>{BRL(soma("liquido"))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
