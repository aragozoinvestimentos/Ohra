import { Fragment, useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { abrirAnuncio, montarAnuncios } from "../lib/anuncios.js";
import { analiseCompraMinima, lucroLiquidoDoMes, mesAnterior, pedidosAgrupados, simularTicket } from "../lib/resumoLoja.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import { CartaoDiagnostico } from "./Diagnostico.jsx";

// Análise → Diagnóstico (24/10/2026, docs/decisoes-pendentes.md): responde
// "estou lucrando de verdade?", "qual compra mínima pro cupom?", "quanto o
// ticket muda o resultado?" e lista o diagnóstico de cada anúncio. Só lê —
// pedidos importados, Ads (mesma conta do teto), contas fixas do Caixa e
// lib/diagnostico.js. Projeções aparecem marcadas como projeção.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m) => MESES[Number(m.slice(5, 7)) - 1];
const MINIMOS = [29.9, 39.9, 49.9, 59.9];
const TICKETS = [30, 40, 50];
const PRIORIDADES = [
  { k: "todos", rot: "Todos" },
  { k: "atencao", rot: "Pedem ação" },
  { k: "oportunidade", rot: "Oportunidades" },
  { k: "info", rot: "Dados insuficientes / info" },
];

export default function AnaliseDiagnostico() {
  const esc = useEscada();
  const cres = useCrescimento();
  const { lancamentos, carregando: carregandoCaixa } = useLancamentosCaixa();
  const hoje = hojeSP();
  const mes = hoje.slice(0, 7);
  const pedidos = cres.pedidosValidos;

  // ---- Lucro líquido ----
  const liq = useMemo(() => lucroLiquidoDoMes({ pedidos, linhasAds: cres.linhasAds, lancamentos, mes, hoje }), [pedidos, cres.linhasAds, lancamentos, mes, hoje]);
  const liqAnt = useMemo(() => lucroLiquidoDoMes({ pedidos, linhasAds: cres.linhasAds, lancamentos, mes: mesAnterior(mes), hoje }), [pedidos, cres.linhasAds, lancamentos, mes, hoje]);

  // ---- Compra mínima e ticket (pedidos dos últimos 90 dias) ----
  const [canalCupom, setCanalCupom] = useLembrado("ohra:diag:canal", "");
  const [tipoDesc, setTipoDesc] = useLembrado("ohra:diag:tipo", "pct");
  const [descTxt, setDescTxt] = useState("5");
  const de90 = somarDias(hoje, -89);
  const peds = useMemo(() => pedidosAgrupados(pedidos, de90, hoje, canalCupom || null), [pedidos, de90, hoje, canalCupom]);
  const desconto = Math.max(0, Number(String(descTxt).replace(",", ".")) || 0);
  const cm = useMemo(() => analiseCompraMinima(peds, MINIMOS, { tipo: tipoDesc, desconto: tipoDesc === "pct" ? desconto / 100 : desconto }), [peds, tipoDesc, desconto]);
  const simT = useMemo(() => simularTicket(peds, TICKETS.filter((t) => !cm.ticket || t > cm.ticket)), [peds, cm.ticket]);
  const canaisPed = useMemo(() => esc.canais.filter((c) => pedidos.some((p) => p.valido && p.canal_id === c.id)), [esc.canais, pedidos]);

  // ---- Diagnóstico dos anúncios ----
  const linhas = useMemo(() => montarAnuncios({ esc, cres, pedidos, hoje }), [esc, cres, pedidos, hoje]);
  const [prio, setPrio] = useLembrado("ohra:diag:prio", "todos");
  const [canalF, setCanalF] = useLembrado("ohra:diag:canal-lista", "");
  const [aberto, setAberto] = useState(null);
  const itensDiag = useMemo(() => {
    const out = [];
    for (const l of linhas) {
      if (canalF && l.canal.id !== canalF) continue;
      const ds = l.diagnosticos || [];
      const princ = ds[0] || null;
      if (prio !== "todos") {
        if (!princ) continue;
        if (prio === "atencao" && princ.estado !== "atencao" && princ.estado !== "resolver") continue;
        if (prio !== "atencao" && princ.estado !== prio) continue;
      }
      out.push({ l, ds, princ });
    }
    const peso = { resolver: 0, atencao: 1, oportunidade: 2, info: 3 };
    return out.sort((a, b) => (peso[a.princ?.estado] ?? 4) - (peso[b.princ?.estado] ?? 4) || (b.l.vendas?.unidades || 0) - (a.l.vendas?.unidades || 0));
  }, [linhas, prio, canalF]);

  const variacao = (a, b) => (b && b > 0 && a != null ? (a - b) / b : null);
  const vLiq = liq.liquido != null && liqAnt.liquido != null ? variacao(liq.liquido, liqAnt.liquido) : null;
  const vVendas = variacao(liq.vendas, liqAnt.vendas);

  return (
    <div>
      {/* 1. Estou lucrando de verdade? */}
      <div className="panel">
        <h3>
          Estou vendendo mais e lucrando mais?{" "}
          <span className="h3-contagem">
            {nomeMes(mes)} até {dm(liq.ate)} · {nomeMes(liqAnt.mes)} inteiro ao lado
          </span>{" "}
          <Ajuda texto="Faturamento = o que os clientes pagaram (pedidos importados). Margem de contribuição = o que sobra depois das taxas e de repor o produto (custo de hoje). Depois do Ads = menos o gasto de Ads (mesma conta do teto, inclui a GMV Max da Loja). Lucro líquido = menos as contas fixas do mês (Dinheiro → Contas fixas: recorrentes de saída, sem Ads, material, embalagem e retirada, que já estão em outra conta). Sem conta fixa cadastrada, o lucro líquido fica como dado insuficiente." />
        </h3>
        <Kpis
          itens={[
            { label: "Faturamento", valor: BRL(liq.vendas), sub: `${liq.pedidos} pedidos · ${nomeMes(liqAnt.mes)}: ${BRL(liqAnt.vendas)}${vVendas != null ? ` (${vVendas >= 0 ? "↑" : "↓"} ${PCT(Math.abs(vVendas))})` : ""}` },
            { label: "Margem de contribuição", valor: BRL(liq.contribuicao), sub: liq.vendas ? `${PCT(liq.contribuicao / liq.vendas)} do faturamento · depois das taxas e do custo` : "—" },
            { label: "Depois do Ads", valor: BRL(liq.depoisAds), tom: liq.depoisAds < 0 ? "bad" : undefined, sub: `Ads ${BRL(liq.ads)}` },
            {
              label: "Lucro líquido",
              valor: liq.liquido != null ? BRL(liq.liquido) : "—",
              tom: liq.liquido != null && liq.liquido < 0 ? "bad" : undefined,
              sub:
                liq.liquido != null
                  ? `contas fixas ${BRL(liq.fixas.total)} · ${nomeMes(liqAnt.mes)}: ${liqAnt.liquido != null ? BRL(liqAnt.liquido) : "—"}${vLiq != null ? ` (${vLiq >= 0 ? "↑" : "↓"} ${PCT(Math.abs(vLiq))})` : ""}`
                  : carregandoCaixa
                    ? "carregando o Caixa…"
                    : "Dados insuficientes: cadastre as contas fixas em Dinheiro → Contas fixas",
            },
          ]}
        />
        {liq.fixas.itens.length > 0 && (
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Contas fixas consideradas: {liq.fixas.itens.map((x) => `${x.descricao} ${BRL(x.valor)}`).join(" · ")}. Parcelas de equipamento e retiradas não entram.
          </p>
        )}
        {liq.semCusto > 0 && <p className="hint" style={{ margin: "4px 0 0" }}>{liq.semCusto} venda(s) sem custo cadastrado ficam fora da margem.</p>}
      </div>

      {/* 2. Compra mínima do cupom */}
      <div className="panel">
        <h3>
          Qual compra mínima usar no cupom?{" "}
          <span className="h3-contagem">
            {cm.n} pedidos de {dm(de90)} a {dm(hoje)} · ticket médio {cm.ticket != null ? BRL(cm.ticket) : "—"}
          </span>{" "}
          <Ajuda texto="Feito com os seus pedidos reais. Um cupom com compra mínima ABAIXO do que o cliente já gasta só dá desconto pra quem compraria de qualquer jeito — é o 'custo' da coluna. Os pedidos 'logo abaixo' (até R$ 10 a menos) são os que o cupom pode puxar pra cima. 'Pra empatar' = quantos pedidos a mais (ou clientes que subirem o carrinho) pagariam esse custo pelo lucro médio. É projeção: nem todo cliente sobe o carrinho." />
        </h3>
        <div className="toolbar">
          <label className="campo-inline">
            Plataforma{" "}
            <select value={canalCupom} onChange={(e) => setCanalCupom(e.target.value)}>
              <option value="">Todas</option>
              {canaisPed.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo-inline">
            Desconto{" "}
            <select value={tipoDesc} onChange={(e) => setTipoDesc(e.target.value)}>
              <option value="pct">%</option>
              <option value="valor">R$</option>
            </select>{" "}
            <input type="text" inputMode="decimal" value={descTxt} onChange={(e) => setDescTxt(e.target.value)} style={{ width: 70 }} />
          </label>
        </div>
        {!cm.n ? (
          <div className="empty">Sem pedidos importados nos últimos 90 dias.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Compra mínima</th>
                  <th className="num">Cliente médio precisa somar</th>
                  <th className="num">Pedidos que já passam</th>
                  <th className="num">Logo abaixo (até R$ 10)</th>
                  <th className="num">Custo do cupom (90 dias)</th>
                  <th className="num">Pra empatar</th>
                </tr>
              </thead>
              <tbody>
                {cm.linhas.map((x) => (
                  <tr key={x.minimo}>
                    <td>
                      <b>{BRL(x.minimo)}</b>
                    </td>
                    <td className="num">{x.adicionar > 0 ? `+ ${BRL(x.adicionar)}` : "já passa"}</td>
                    <td className="num">
                      {x.acima} ({PCT(x.pctAcima)})
                    </td>
                    <td className="num">
                      {x.abaixo}
                      {x.faltaMedia != null ? <span className="muted-cel"> · faltam {BRL(x.faltaMedia)}</span> : ""}
                    </td>
                    <td className={`num${x.pctAcima > 0.5 ? " neg" : ""}`}>{BRL(x.custo)}</td>
                    <td className="num">{x.empateNovos != null ? `${Math.ceil(x.empateNovos)} pedido${Math.ceil(x.empateNovos) === 1 ? "" : "s"} a mais` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cm.n > 0 && (
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Lucro médio por pedido {BRL(cm.lucroMedio)} ({PCT(cm.margem)} do valor). Mínimo com mais da metade dos pedidos já acima (em vermelho) tende a só dar desconto. A margem de cada produto com o cupom está em Vender mais → Promoções e cupons → Cupom da loja.
          </p>
        )}
      </div>

      {/* 3. Ticket médio */}
      {cm.n > 0 && simT.length > 0 && (
        <div className="panel">
          <h3>
            E se o ticket médio fosse maior? <span className="h3-contagem">projeção com os mesmos {cm.n} pedidos e a margem de hoje — não é resultado garantido</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticket médio</th>
                  <th className="num">Faturamento (90 dias)</th>
                  <th className="num">Margem de contribuição</th>
                  <th className="num">A mais que hoje</th>
                </tr>
              </thead>
              <tbody>
                <tr className="linha-outras">
                  <td>Hoje: {BRL(cm.ticket)}</td>
                  <td className="num">{BRL(cm.total)}</td>
                  <td className="num">{BRL(cm.lucro)}</td>
                  <td className="num">—</td>
                </tr>
                {simT.map((x) => (
                  <tr key={x.ticket}>
                    <td>{BRL(x.ticket)}</td>
                    <td className="num">{BRL(x.faturamento)}</td>
                    <td className="num">{BRL(x.contribuicao)}</td>
                    <td className="num pos-forte">+ {BRL(x.dif)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>Caminhos: kit 2/kit 3 (2º Por quantidade), comprados juntos (Curva ABC), cupom com compra mínima acima do ticket.</p>
        </div>
      )}

      {/* 4. Diagnóstico de cada anúncio */}
      <div className="panel">
        <h3>
          Diagnóstico de cada anúncio{" "}
          <Ajuda texto="Mesma conta do Painel do anúncio (funil do Desempenho da Shopee com carrinho, lucro de agora, Ads e vendas reais). Problema = os números mostram; hipótese = vale investigar; dados insuficientes = ainda não dá pra concluir. Clique pra ver como fazer." />
        </h3>
        <div className="toolbar">
          <div className="subabas">
            {PRIORIDADES.map((p) => (
              <button key={p.k} type="button" className={`btn${prio === p.k ? " primary" : ""}`} onClick={() => setPrio(p.k)}>
                {p.rot}
              </button>
            ))}
          </div>
          <select value={canalF} onChange={(e) => setCanalF(e.target.value)}>
            <option value="">Todos os canais</option>
            {esc.canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        {!itensDiag.length ? (
          <div className="empty">Nenhum anúncio neste filtro.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th className="num">Vendas 30d</th>
                  <th>Principal</th>
                  <th>Reavaliar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itensDiag.map(({ l, ds, princ }) => (
                  <Fragment key={l.chave}>
                    <tr className="linha-clicavel" onClick={() => setAberto(aberto === l.chave ? null : l.chave)}>
                      <td>
                        <b>{l.nome}</b> <CanalTag canal={l.canal} />
                      </td>
                      <td className="num">{l.vendas?.unidades ?? 0}</td>
                      <td>
                        {princ ? <Estado tipo={princ.estado}>{princ.titulo}</Estado> : <span className="muted-cel">✓ nada fora do esperado</span>}
                        {ds.length > 1 && <span className="muted-cel"> +{ds.length - 1}</span>}
                      </td>
                      <td className="muted-cel">{princ?.reavaliar || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirAnuncio(l.itemId, l.canal.id, "resumo");
                          }}
                        >
                          Abrir anúncio →
                        </button>
                      </td>
                    </tr>
                    {aberto === l.chave && ds.length > 0 && (
                      <tr className="linha-detalhe">
                        <td colSpan={5}>
                          {ds.map((d) => (
                            <CartaoDiagnostico key={d.chave} d={d} onIr={() => abrirAnuncio(l.itemId, l.canal.id, d.ir?.pedido?.aba || "resumo")} />
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
