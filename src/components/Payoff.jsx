import { useMemo } from "react";
import { BRL } from "../lib/format.js";
import { payoff, ritmoPedidos, rotuloMes, seta } from "../lib/payoff.js";
import { rotuloCategoria } from "../lib/fluxoCaixa.js";
import { saldoReserva } from "../lib/vendasMes.js";
import { useEscada } from "../hooks/useEscada.js";
import { useVendasReais } from "../hooks/useVendasReais.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import Estado from "./Estado.jsx";

// Dinheiro → 4 · Payoff (19/10/2026, aprovado pela prévia): seu dinheiro na
// loja, o que a loja já pagou, o que entrou, e quando o seu dinheiro volta no
// ritmo de hoje. Só lê o Caixa e os pedidos importados (conta em lib/payoff.js).
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const um = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export default function Payoff({ lancamentos, hoje, saldoAds, reservaRegistros }) {
  const { itens, canais, cfgDoProduto } = useEscada();
  const reais = useVendasReais({ itens, canais, cfgDoProduto });
  const saldoAdsShopee = saldoAds?.temRecarga ? Math.max(0, saldoAds.saldo) : 0;
  const p = useMemo(() => payoff({ lancamentos, hoje, saldoAdsShopee }), [lancamentos, hoje, saldoAdsShopee]);
  const ritmo = useMemo(() => ritmoPedidos(reais.linhas, hoje), [reais.linhas, hoje]);
  const reserva = useMemo(() => saldoReserva(reservaRegistros || []).saldo, [reservaRegistros]);

  if (!lancamentos.length)
    return <div className="empty">Ainda não há lançamentos no Caixa. O Payoff sai do que você lança lá (aporte, saldo inicial, compras, recebimentos).</div>;

  const prev = p.previsao;
  return (
    <div className="payoff-tela">
      <Kpis
        itens={[
          { label: "Seu dinheiro na loja", valor: BRL(p.doBolso), sub: p.doBolso > 0 ? "o que você tirou do bolso (aporte + saldo inicial)" : "lance o aporte / saldo inicial no Caixa" },
          { label: "A loja já pagou", valor: BRL(p.pagou), sub: `com o seu dinheiro e com o das vendas · impressoras ${BRL(p.equipamento)} · operar ${BRL(p.operar)}` },
          { label: "Entrou de vendas", valor: BRL(p.entrou), sub: "recebido de verdade (pedidos, vendas físicas, encomendas)" },
          { label: "Resultado da loja", valor: `${p.resultado < 0 ? "− " : ""}${BRL(Math.abs(p.resultado))}`, tom: p.resultado < 0 ? "bad" : undefined, sub: "entrou − a loja pagou (sem o seu aporte)" },
          {
            label: "Falta voltar pro seu bolso",
            valor: BRL(p.falta),
            sub: p.voltou != null ? `${pctTxt(p.voltou)} do seu dinheiro já voltou${p.retiradas > 0 ? ` · você já retirou ${BRL(p.retiradas)}` : ""}` : "quanto a loja ainda deve a você",
          },
        ]}
      />
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {p.pagou > p.doBolso && p.doBolso > 0 ? "“A loja já pagou” é maior que o seu dinheiro porque parte das contas foi paga com o dinheiro das vendas. " : ""}Quando o que <b>entrou</b> passar o que a loja <b>pagou</b>, o seu dinheiro voltou.
        <Ajuda texto="Seu dinheiro na loja = lançamentos de aporte e saldo inicial. A loja já pagou = todas as saídas pagas do Caixa, menos a retirada (pró-labore, que é dinheiro voltando pra você); recarga de Ads conta aqui, o gasto dos CSVs não (pra não contar 2×); parcela da impressora conta quando é paga. Entrou = entradas recebidas, sem aporte/saldo inicial. Falta voltar = −(resultado + saldo de Ads ainda parado na Shopee). O aporte não é somado de novo às saídas: foi ele que pagou parte delas." />
      </p>

      <div className="panel">
        <h3>
          Quando o seu dinheiro volta <span className="faint">no ritmo dos últimos 3 meses fechados</span>
        </h3>
        <div className="payoff-prev">
          {prev.status === "voltou" ? (
            <Estado tipo="oportunidade">✓ O seu dinheiro já voltou — daqui pra frente é lucro da loja</Estado>
          ) : prev.status === "volta" ? (
            <>
              <b>
                ~ {prev.meses} {prev.meses === 1 ? "mês" : "meses"} — por volta de {rotuloMes(prev.mes)}
              </b>
              <span className="faint">
                Resultado médio {BRL(prev.media)}/mês ({prev.base.map((x) => `${rotuloMes(x.mes)} ${x.resultado >= 0 ? "+" : "−"} ${BRL(Math.abs(x.resultado))}`).join(" · ")})
                {p.tendencia != null ? (p.tendencia > 0 ? " · ritmo subindo" : p.tendencia < 0 ? " · ritmo caindo" : "") : ""}
              </span>
            </>
          ) : prev.status === "nao-volta" ? (
            <Estado tipo="atencao">No ritmo atual ainda não volta — o resultado médio dos últimos meses está em {BRL(prev.media)}/mês. Veja o que mais pesa em “Pra onde foi o dinheiro”.</Estado>
          ) : (
            <span className="faint">Precisa de pelo menos 1 mês fechado com lançamentos pra prever.</span>
          )}
          {p.aVencer > 0 && <span className="faint">Ainda vai sair: {BRL(p.aVencer)} em parcelas/equipamento a pagar (entra na conta quando for pago).</span>}
        </div>
      </div>

      <div className="payoff-grade">
        <div className="panel">
          <h3>
            A loja pagou × entrou, acumulado <span className="faint">mês a mês</span>
          </h3>
          <GraficoPayoff serie={p.serie} />
        </div>
        <div className="panel">
          <h3>
            Pra onde foi o dinheiro <span className="faint">desde o começo</span>
          </h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {p.categorias.map((c) => (
                  <tr key={c.cat}>
                    <td>
                      {rotuloCategoria("saida", c.cat)}
                      {c.cat === "equipamento" && <span className="faint"> · fica com você</span>}
                    </td>
                    <td style={{ width: "30%" }}>
                      <div className="payoff-barra">
                        <i style={{ width: `${Math.max(2, c.pct * 100)}%` }} />
                      </div>
                    </td>
                    <td className="num">{BRL(c.valor)}</td>
                    <td className="num muted-cel">{pctTxt(c.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ padding: "6px 14px 10px" }}>
            Guardado (saiu do caixa, mas ainda não foi gasto): saldo de Ads na Shopee <b>{BRL(saldoAdsShopee)}</b>
            {reserva > 0 && (
              <>
                {" "}· reserva de produção <b>{BRL(reserva)}</b> (continua dentro do caixa)
              </>
            )}
            .
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>
          Ritmo de vendas <span className="faint">pedidos, não produtos — o detalhe por produto fica em Análise → Evolução</span>
        </h3>
        {!ritmo.temDados ? (
          <div className="empty">Importe os pedidos em Análise → Importar dados pra ver o ritmo.</div>
        ) : (
          <div className="payoff-minis">
            <Mini rotulo="Pedidos por semana" valor={um(ritmo.porSemana)} v={ritmo.varSemana} sub="média das 4 últimas semanas completas × as 4 antes" barras={ritmo.semanas.map((x) => x.n)} />
            <Mini rotulo="Pedidos no mês" valor={String(ritmo.nMesAtual)} v={ritmo.varMes} sub={`${rotuloMes(ritmo.meses[5].mes)} (projetado pelo ritmo do mês) · ${rotuloMes(ritmo.meses[4].mes)} ${ritmo.meses[4].n}`} barras={ritmo.meses.map((x) => x.projetado ?? x.n)} />
            <Mini
              rotulo="Resultado por mês"
              valor={p.serie.length ? `${p.serie[p.serie.length - 1].resultado >= 0 ? "+" : "−"} ${BRL(Math.abs(p.serie[p.serie.length - 1].resultado))}` : "—"}
              v={null}
              sub="entrou − a loja pagou no mês (o atual ainda em andamento)"
              barras={p.serie.slice(-6).map((x) => Math.max(0, x.resultado))}
            />
            <Mini rotulo="Ticket médio" valor={ritmo.ticket != null ? BRL(ritmo.ticket) : "—"} v={ritmo.varTicket} sub="por pedido · 4 últimas semanas" barras={ritmo.semanas.map((x) => (x.n ? x.valor / x.n : 0))} />
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ rotulo, valor, v, sub, barras }) {
  const st = seta(v);
  const max = Math.max(...barras, 0) || 1;
  return (
    <div className="payoff-mini">
      <small>{rotulo}</small>
      <b>
        {valor}{" "}
        {st && (
          <Estado tipo={st.tipo} icone={null}>
            {st.s} {Math.abs(Math.round(v * 100))}%
          </Estado>
        )}
      </b>
      <span className="faint">{sub}</span>
      <div className="payoff-bars">
        {barras.map((x, i) => (
          <span key={i} className={i === barras.length - 1 ? "ult" : undefined} style={{ height: `${Math.max(4, (x / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

// Duas linhas acumuladas: a loja pagou (grafite) × entrou (terracota).
function GraficoPayoff({ serie }) {
  if (serie.length < 1) return <div className="empty">Sem meses com lançamento ainda.</div>;
  const W = 620;
  const H = 220;
  const x0 = 56;
  const y0 = 196;
  const topo = 16;
  const max = Math.max(...serie.map((s) => Math.max(s.accPagou, s.accEntrou)), 1);
  const passo = (() => {
    const bruto = max / 4;
    const p10 = 10 ** Math.floor(Math.log10(bruto));
    return [1, 2, 2.5, 5, 10].map((m) => m * p10).find((m) => m >= bruto);
  })();
  const teto = passo * 4;
  const X = (i) => (serie.length === 1 ? (x0 + W - 10) / 2 : x0 + (i * (W - 10 - x0)) / (serie.length - 1));
  const Y = (v) => y0 - (v / teto) * (y0 - topo);
  const linha = (k) => serie.map((s, i) => `${X(i)},${Y(s[k])}`).join(" ");
  const k = (v) => (v >= 1000 ? `${um(v / 1000)} mil` : String(Math.round(v)));
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H + 14}`} width="100%" role="img" aria-label="A loja pagou e entrou, acumulado por mês">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={x0} x2={W - 10} y1={Y(passo * i)} y2={Y(passo * i)} stroke="var(--border)" />
            <text x={x0 - 6} y={Y(passo * i) + 3} textAnchor="end" fontSize="10" fill="var(--ink-faint)">
              {k(passo * i)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="var(--ink)" strokeWidth="2.5" points={linha("accPagou")} />
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={linha("accEntrou")} />
        {serie.map((s, i) => (
          <text key={s.mes} x={X(i)} y={H + 8} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">
            {rotuloMes(s.mes).slice(0, 3)}
          </text>
        ))}
      </svg>
      <div className="payoff-leg">
        <span>
          <i style={{ background: "var(--ink)" }} />a loja pagou (acumulado)
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} />
          entrou de vendas (acumulado)
        </span>
        <span>quando a linha laranja passar a escura, o dinheiro voltou</span>
      </div>
    </>
  );
}
