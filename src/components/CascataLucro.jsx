import { useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { LINHAS_CASCATA, cascataDoPeriodo } from "../lib/resumoLoja.js";
import { baixarCsvRelatorio, imprimirRelatorio } from "../lib/relatorios.js";
import { BRL, PCT } from "../lib/format.js";
import Ajuda from "./Ajuda.jsx";

// Dinheiro → Resumo do mês → "Do faturamento ao lucro" (28/10/2026, aprovado pelo Gustavo):
// a tabela em cascata por período, total + uma coluna por canal, com % do faturamento,
// e o relatório em PDF/CSV. Conta ÚNICA em lib/resumoLoja.js (cascataDoPeriodo).
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
const mesesAtras = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const PERIODOS = [
  { k: "mes", rot: "O mês escolhido" },
  { k: "3m", rot: "Últimos 3 meses" },
  { k: "ano", rot: "Este ano" },
  { k: "tudo", rot: "Desde o início" },
];
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function CascataLucro({ pedidos, linhasAds, mes, hoje }) {
  const { lojas, lojaId } = useLoja();
  const nomeLoja = (lojas || []).find((l) => l.id === lojaId)?.nome || "loja";
  const { lancamentos } = useLancamentosCaixa();
  const [per, setPer] = useState("mes");
  const { de, ate, titulo } = useMemo(() => {
    const ateM = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
    if (per === "3m") return { de: `${mesesAtras(mes, 2)}-01`, ate: ateM, titulo: "Últimos 3 meses" };
    if (per === "ano") return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje, titulo: `Ano de ${hoje.slice(0, 4)}` };
    if (per === "tudo") {
      const datas = (pedidos || []).filter((p) => p.valido).map((p) => String(p.data).slice(0, 10)).sort();
      return { de: datas[0] || `${hoje.slice(0, 7)}-01`, ate: hoje, titulo: "Desde o início" };
    }
    return { de: `${mes}-01`, ate: ateM, titulo: `${NOMES_MES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}` };
  }, [per, mes, hoje, pedidos]);
  const c = useMemo(() => cascataDoPeriodo({ pedidos, linhasAds, lancamentos: lancamentos || [], de, ate }), [pedidos, linhasAds, lancamentos, de, ate]);
  const cols = [{ nome: "Total", x: c.total }, ...(c.canais.length > 1 ? c.canais.map((k) => ({ nome: k.nome, x: k })) : [])];
  const valor = (x, l) => (x[l.k] == null ? "—" : BRL(l.menos && x[l.k] ? -x[l.k] : x[l.k]));
  const perc = (x, l) => (x[l.k] == null || !(x.pago > 0) || l.k === "bruto" ? "" : PCT((l.menos ? -x[l.k] : x[l.k]) / x.pago));

  const relatorio = () => ({
    titulo: `Do faturamento ao lucro — ${titulo}`,
    subtitulo: `${dmy(de)} a ${dmy(ate)} · ${c.total.nPedidos} pedidos importados · custo e taxas de hoje`,
    blocos: [
      {
        tipo: "tabela",
        titulo: "Cascata",
        colunas: ["", ...cols.flatMap((k) => [k.nome, "% do faturado"])],
        linhas: LINHAS_CASCATA.map((l) => [l.rot, ...cols.flatMap((k) => [valor(k.x, l), perc(k.x, l)])]),
      },
      { tipo: "texto", titulo: "Como ler", linhas: ["Faturado = o que o cliente pagou (já com os descontos). Taxas = o que a plataforma fica (comissão e taxa fixa). Impostos = o imposto (%) de cada canal (MEI = 0; o DAS do MEI entra em Contas fixas). Ads por canal pelo canal de cada período; o que não tem canal fica só no total. Contas fixas = as recorrentes do Caixa no período."] },
    ],
  });

  return (
    <div className="panel">
      <h3>
        Do faturamento ao lucro
        <Ajuda texto="Do preço cheio até o lucro líquido, linha por linha. Pelos pedidos importados, com custo e taxas de HOJE. Ads = a mesma conta do teto. Contas fixas = as recorrentes de saída do Caixa (sem Ads, filamento e mercadoria, que já estão nas outras linhas)." />
      </h3>
      <div className="toolbar" style={{ gap: 6 }}>
        <select value={per} onChange={(e) => setPer(e.target.value)}>
          {PERIODOS.map((p) => (
            <option key={p.k} value={p.k}>
              {p.rot}
            </option>
          ))}
        </select>
        <span className="muted-cel">
          {dmy(de)} a {dmy(ate)} · {c.total.nPedidos} pedidos
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-mini" onClick={() => imprimirRelatorio(relatorio(), nomeLoja)}>
            Gerar relatório (PDF)
          </button>
          <button type="button" className="btn btn-mini" onClick={() => baixarCsvRelatorio(relatorio(), `faturamento-ao-lucro-${de}-${ate}.csv`)}>
            CSV
          </button>
        </span>
      </div>
      <div className="table-wrap">
        <table className="cascata">
          <thead>
            <tr>
              <th />
              {cols.map((k) => (
                <th key={k.nome} className="num" colSpan={2}>
                  {k.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINHAS_CASCATA.map((l) => (
              <tr key={l.k} className={`${l.total ? "cascata-total" : ""}${l.forte ? " cascata-forte" : ""}`}>
                <td>{l.rot}</td>
                {cols.map((k) => (
                  <FragmentoValor key={k.nome} v={valor(k.x, l)} p={perc(k.x, l)} neg={(l.total && k.x[l.k] < 0) || false} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.total.semCusto > 0 && <p className="hint">{c.total.semCusto} item(ns) sem produto ligado (SKU não cadastrado) entram no faturamento, mas sem custo.</p>}
    </div>
  );
}
function FragmentoValor({ v, p, neg }) {
  return (
    <>
      <td className={`num${neg ? " neg" : ""}`}>{v}</td>
      <td className="num muted-cel">{p}</td>
    </>
  );
}
