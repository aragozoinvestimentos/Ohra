import { useMemo, useState } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { gastoAdsNaJanela } from "../lib/ads.js";
import { abrirAnuncio } from "../lib/anuncios.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";

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

  const r = useMemo(() => {
    const ls = (cres.pedidosValidos || []).filter((p) => p.valido && String(p.data) >= de && String(p.data) <= ate);
    const t = { pedidos: new Set(), un: 0, bruto: 0, pago: 0, recebe: 0, custo: 0, lucro: 0, semCusto: 0 };
    const porCanal = new Map();
    const porAnuncio = new Map();
    for (const p of ls) {
      t.pedidos.add(p.pedido);
      t.un += num(p.q);
      t.bruto += num(p.bruto);
      t.pago += num(p.pago);
      t.recebe += num(p.recebe);
      t.custo += num(p.custo);
      if (p.lucro == null) t.semCusto++;
      t.lucro += num(p.lucro);
      const kc = p.canal?.id || "fisico";
      const c = porCanal.get(kc) || { canal: p.canal, un: 0, pago: 0, recebe: 0, custo: 0, lucro: 0 };
      c.un += num(p.q);
      c.pago += num(p.pago);
      c.recebe += num(p.recebe);
      c.custo += num(p.custo);
      c.lucro += num(p.lucro);
      porCanal.set(kc, c);
      if (p.item && p.canal) {
        const itemId = p.item.produtoId ? `p:${p.item.produtoId}` : p.id_item;
        const nome = p.grupo ? `Anúncio: ${p.grupo.nome}` : p.item.produtoId ? p.item.nome.split(" — ")[0] : p.item.nome;
        const ka = `${p.grupo ? `g:${p.grupo.id}` : itemId}|${p.canal.id}`;
        const a = porAnuncio.get(ka) || { itemId: p.grupo ? `g:${p.grupo.id}` : itemId, canal: p.canal, nome, un: 0, pago: 0, taxas: 0, custo: 0, lucro: 0 };
        a.un += num(p.q);
        a.pago += num(p.pago);
        a.taxas += Math.max(0, num(p.pago) - num(p.recebe));
        a.custo += num(p.custo);
        a.lucro += num(p.lucro);
        porAnuncio.set(ka, a);
      }
    }
    // Ads do mês: a mesma conta do teto/Vendas do mês (por período, o maior
    // entre semanas e o CSV, só a parte dentro do mês), inclui a campanha da loja.
    let ads = 0;
    const linhasAds = [...(cres.linhasAds?.linhas || []), ...(cres.linhasAds?.lojaLinha ? [cres.linhasAds.lojaLinha] : [])];
    for (const l of linhasAds) ads += gastoAdsNaJanela(l.periodos || [], l.semanas || [], de, ate);
    ads = Math.round(ads * 100) / 100;
    return { t, porCanal: [...porCanal.values()].sort((a, b) => b.pago - a.pago), porAnuncio: [...porAnuncio.values()].sort((a, b) => b.lucro - a.lucro), ads };
  }, [cres.pedidosValidos, cres.linhasAds, de, ate]);

  const { t, ads } = r;
  const descontos = Math.max(0, t.bruto - t.pago);
  const taxas = Math.max(0, t.pago - t.recebe);
  const sobra = t.lucro - ads;
  const base = t.pago || 1;
  const partes = [
    { k: "taxas", rot: "Taxas e imposto", v: taxas, cor: "#c46a3a" },
    { k: "repor", rot: "Repor a produção", v: t.custo, cor: "#7a9cc6" },
    { k: "ads", rot: "Ads", v: ads, cor: "#b48ad3" },
    { k: "lucro", rot: sobra >= 0 ? "Sobrou (lucro)" : "Faltou (prejuízo)", v: Math.max(0, sobra), cor: "#2e8b57" },
  ];
  const [a, m] = mes.split("-").map(Number);

  return (
    <div>
      <div className="toolbar">
        <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, -1))}>‹</button>
        <b>
          {NOMES_MES[m - 1]} {a}
        </b>
        <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, 1))} disabled={mes >= hoje.slice(0, 7)}>›</button>
        <span className="muted-cel">pedidos importados até {ate.slice(8, 10)}/{ate.slice(5, 7)} · enviados e entregues (sem cancelados)</span>
      </div>
      <Kpis
        itens={[
          { label: "Pedidos · unidades", valor: `${t.pedidos.size} · ${t.un}` },
          { label: "Faturamento (cliente pagou)", valor: BRL(t.pago), sub: descontos > 0 ? `antes dos descontos ${BRL(t.bruto)}` : null },
          { label: "Taxas e imposto", valor: BRL(taxas), sub: t.pago > 0 ? `${PCT(taxas / t.pago)} do faturamento` : null },
          { label: "Repor a produção", valor: BRL(t.custo), sub: "material, máquina, energia, embalagem" },
          { label: "Ads", valor: BRL(ads), sub: "mesma conta do teto" },
        ]}
      />
      <Kpis
        itens={[
          { label: "Descontos que você deu", valor: BRL(descontos), sub: "promo/cupom do vendedor nos pedidos" },
          { label: "Você recebe (repasse)", valor: BRL(t.recebe), sub: "já sem as taxas" },
          { label: "Lucro antes do Ads", valor: BRL(t.lucro) },
          { label: sobra >= 0 ? "Sobrou (lucro depois do Ads)" : "Prejuízo depois do Ads", valor: BRL(sobra), tom: sobra > 0 ? "good" : sobra < 0 ? "bad" : undefined, sub: t.pago > 0 ? `${PCT(sobra / t.pago)} do faturamento` : null },
        ]}
      />
      {t.pago > 0 ? (
        <div className="panel">
          <h3>
            Pra onde foi cada R$ 100 que o cliente pagou
            <Ajuda texto="Do que o cliente pagou (já com os descontos), quanto ficou com o marketplace (taxas e imposto), quanto é pra repor a produção (custo de hoje), quanto foi pro Ads e quanto sobrou. É estimativa com custo e taxas de HOJE; o dinheiro que caiu de verdade está no Caixa." />
          </h3>
          <div className="pa-corpo">
            <div className="rm-barra">
              {partes
                .filter((p) => p.v > 0)
                .map((p) => (
                  <span key={p.k} style={{ flex: p.v, background: p.cor }} title={`${p.rot}: ${BRL(p.v)}`}>
                    {p.v / base >= 0.06 ? `${p.rot} ${Math.round((p.v / base) * 100)}` : ""}
                  </span>
                ))}
            </div>
            {sobra < 0 && <p className="muted-cel">Os custos passaram do que entrou: faltaram {BRL(-sobra)}.</p>}
            {t.semCusto > 0 && <p className="muted-cel">{t.semCusto} item(ns) sem produto ligado (SKU não cadastrado) ficaram fora do custo e do lucro.</p>}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="empty">Sem pedidos importados neste mês — envie o arquivo da Olist em Atualizar dados.</div>
        </div>
      )}
      {r.porCanal.length > 0 && (
        <div className="panel">
          <h3>Por canal</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th className="num">Unidades</th>
                  <th className="num">Faturamento</th>
                  <th className="num">Taxas</th>
                  <th className="num">Repor</th>
                  <th className="num">Lucro antes do Ads</th>
                </tr>
              </thead>
              <tbody>
                {r.porCanal.map((c, i) => (
                  <tr key={c.canal?.id || `f${i}`}>
                    <td>{c.canal ? <CanalTag canal={c.canal} /> : "Venda física"}</td>
                    <td className="num">{c.un}</td>
                    <td className="num">{BRL(c.pago)}</td>
                    <td className="num">{BRL(Math.max(0, c.pago - c.recebe))}</td>
                    <td className="num">{BRL(c.custo)}</td>
                    <td className="num">{BRL(c.lucro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {r.porAnuncio.length > 0 && (
        <div className="panel">
          <h3>
            Por anúncio <span className="dir">clique pra abrir o painel</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th className="num">Unidades</th>
                  <th className="num">Faturamento</th>
                  <th className="num">Taxas</th>
                  <th className="num">Repor</th>
                  <th className="num">Lucro antes do Ads</th>
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
