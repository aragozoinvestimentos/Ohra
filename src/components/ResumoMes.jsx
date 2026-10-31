import { useMemo, useState } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { abrirAnuncio } from "../lib/anuncios.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import { lucroDaLinha } from "../lib/resumoLoja.js";
import CanalTag from "./CanalTag.jsx";
import CascataLucro from "./CascataLucro.jsx";
import VistasResultado from "./VistasResultado.jsx";

// Dinheiro → Resumo do mês (remap 21/10/2026, do vídeo "Consolidador
// financeiro"): o mês em blocos — pra onde foi cada real que o cliente pagou.
// Só lê: pedidos importados (enriquecer: pago, recebe, custo e lucro com custo
// e taxas de HOJE) + o gasto de Ads da mesma conta de Vendas do mês/teto.
const num = (v) => Number(v) || 0;
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};
const mudarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function ResumoMes() {
  const cres = useCrescimento();
  const hoje = hojeSP();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const de = `${mes}-01`;
  const ate = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;

  // Por anúncio (lucro bruto pela MESMA conta da tabela — lucroDaLinha). Os números do mês
  // (cards, frase e tabela) vêm todos do CascataLucro (cascataDoPeriodo).
  const r = useMemo(() => {
    const ls = (cres.pedidosValidos || []).filter((p) => p.valido && String(p.data).slice(0, 10) >= de && String(p.data).slice(0, 10) <= ate);
    let pago = 0;
    const porAnuncio = new Map();
    for (const p of ls) {
      pago += num(p.pago);
      if (p.item && p.canal) {
        const itemId = p.item.produtoId ? `p:${p.item.produtoId}` : p.id_item;
        const nome = p.grupo ? `Anúncio: ${p.grupo.nome}` : p.item.produtoId ? p.item.nome.split(" — ")[0] : p.item.nome;
        const ka = `${p.grupo ? `g:${p.grupo.id}` : itemId}|${p.canal.id}`;
        const a = porAnuncio.get(ka) || { itemId: p.grupo ? `g:${p.grupo.id}` : itemId, canal: p.canal, nome, un: 0, pago: 0, taxas: 0, custo: 0, lucro: 0 };
        a.un += num(p.q);
        a.pago += num(p.pago);
        a.taxas += Math.max(0, num(p.pago) - num(p.recebe ?? p.pago)) + num(p.imposto);
        a.custo += num(p.custo);
        a.lucro += lucroDaLinha(p);
        porAnuncio.set(ka, a);
      }
    }
    return { t: { pago }, porAnuncio: [...porAnuncio.values()].sort((a, b) => b.lucro - a.lucro) };
  }, [cres.pedidosValidos, de, ate]);

  const { t } = r;
  const [a, m] = mes.split("-").map(Number);

  return (
    <div>
      <VistasResultado atual="mes" />
      <div className="toolbar">
        <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, -1))}>‹</button>
        <b>
          {NOMES_MES[m - 1]} {a}
        </b>
        <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, 1))} disabled={mes >= hoje.slice(0, 7)}>›</button>
        <span className="muted-cel">pedidos importados até {ate.slice(8, 10)}/{ate.slice(5, 7)} · enviados e entregues (sem cancelados)</span>
      </div>
      {!(t.pago > 0) && (
        <div className="panel">
          <div className="empty">Sem pedidos importados neste mês — envie o arquivo da Olist em Atualizar dados.</div>
        </div>
      )}
      <CascataLucro pedidos={cres.pedidosValidos || []} linhasAds={cres.linhasAds} mes={mes} hoje={hoje} />
      {r.porAnuncio.length > 0 && (
        <div className="panel">
          <h3>
            Por anúncio <span className="dir">lucro bruto = antes do Ads · clique pra abrir o painel</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th className="num">Unidades</th>
                  <th className="num">Faturamento</th>
                  <th className="num">Taxas e impostos</th>
                  <th className="num">Repor</th>
                  <th className="num">Lucro bruto</th>
                  <th className="num">Margem</th>
                </tr>
              </thead>
              <tbody>
                {r.porAnuncio.map((x) => (
                  <tr key={`${x.itemId}|${x.canal.id}`} className="linha-clicavel" onClick={() => abrirAnuncio(x.itemId, x.canal.id)}>
                    <td>
                      <b>{x.nome}</b> <CanalTag canal={x.canal} />
                    </td>
                    <td className="num">{x.un}</td>
                    <td className="num">{BRL(x.pago)}</td>
                    <td className="num">{BRL(x.taxas)}</td>
                    <td className="num">{BRL(x.custo)}</td>
                    <td className={`num${x.lucro < 0 ? " neg" : ""}`}>{BRL(x.lucro)}</td>
                    <td className="num">{x.pago > 0 ? PCT(x.lucro / x.pago) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
