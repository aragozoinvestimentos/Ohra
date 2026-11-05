import { sobraDoAds } from "../lib/ads.js";

// Três réguas de ROAS + "você está aqui" na decisão de 7 dias (05/11/2026, método do
// Luan). Só mostra: as contas são de lib/ads.js (reguasRoas, avaliarAds → av.caso).
const um = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const BRL = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Mínimo · Ideal · Excelente (cartões) + quanto sobra hoje pelo ROAS da Shopee e pelo só pagos. */
export function ReguasRoas({ reguas, preco, lucro, roasShopee = null, roasAjustado = null }) {
  if (!reguas) return null;
  const sS = roasShopee ? sobraDoAds(preco, lucro, roasShopee) : null;
  const sA = roasAjustado ? sobraDoAds(preco, lucro, roasAjustado) : null;
  const tom = (s) => (s == null ? "" : s.margem < 0 ? "neg" : s.margem < 0.15 ? "meio" : "pos");
  return (
    <div className="reguas-ads">
      <div className="reguas-ads-cartoes">
        <div className="regua-ads min">
          <span>ROAS mínimo</span>
          <b>{um(reguas.minimo)}×</b>
          <small>abaixo disso o Ads dá prejuízo</small>
        </div>
        <div className="regua-ads ide">
          <span>ROAS ideal</span>
          <b>{reguas.ideal ? `${um(reguas.ideal)}×` : "—"}</b>
          <small>{reguas.ideal ? `sobra 15% depois do Ads · ${BRL(reguas.lucroIdeal)} por pedido` : "inatingível: margem abaixo de 15%"}</small>
        </div>
        <div className="regua-ads exc">
          <span>ROAS excelente</span>
          <b>{reguas.excelente ? `${um(reguas.excelente)}×` : "—"}</b>
          <small>{reguas.excelente ? `sobra 30% depois do Ads · ${BRL(reguas.lucroExcelente)} por pedido` : `inatingível: a margem (${pct(reguas.margem)}) é menor que 30%`}</small>
        </div>
      </div>
      {(sS || sA) && (
        <div className="reguas-ads-sobra">
          <span>Margem antes do Ads: <b>{pct(reguas.margem)}</b></span>
          {sS && (
            <span>
              Pelo ROAS da Shopee ({um(roasShopee)}): sobra <b className={tom(sS)}>{pct(sS.margem)}</b> · {sS.porPedido >= 0 ? `${BRL(sS.porPedido)} por pedido` : `prejuízo de ${BRL(-sS.porPedido)} por pedido`}
            </span>
          )}
          {sA && (
            <span>
              Só pagos ({um(roasAjustado)}): sobra <b className={tom(sA)}>{pct(sA.margem)}</b> · {sA.porPedido >= 0 ? `${BRL(sA.porPedido)} por pedido` : `prejuízo de ${BRL(-sA.porPedido)} por pedido`}
            </span>
          )}
        </div>
      )}
      {reguas.naoIndicado && <div className="hint atencao-txt">Margem antes do Ads ({pct(reguas.margem)}) abaixo da sua margem mínima ({pct(reguas.margemMin)}): Ads não indicado — o risco de ficar no zero a zero é grande.</div>}
    </div>
  );
}

const CASOS = [
  { chave: "vermelho", quando: "Só pagos abaixo do mínimo", faz: "Pause e revise o anúncio, o preço e a oferta. 2 medições seguidas abaixo = desative." },
  { chave: "aumentar", quando: "Bateu a meta e gastou o orçamento", faz: "+20% no orçamento e +20% na meta." },
  { chave: "baixar-meta", quando: "Bateu a meta, não gastou o orçamento", faz: "Baixe a meta 10% (mais alcance) — nunca abaixo do mínimo." },
  { chave: "amarelo", quando: "Não bateu a meta, gastou o orçamento", faz: "Meta = o que bateu + 15% (nunca acima da antiga) e orçamento pela metade." },
  { chave: "teto", quando: "Não bateu a meta e não gastou", faz: "Achou o teto: meta = o que bateu, orçamento = o que gastou por dia." },
];

/** Tabela da decisão de 7 dias com a linha em que o anúncio está ("você está aqui"). */
export function CasosAds({ av }) {
  const c = av?.caso || null;
  const valores = (k) => {
    if (!c || c.chave !== k) return null;
    const partes = [];
    if (c.roasShopee != null) partes.push(`Shopee ${um(c.roasShopee)}${c.meta ? ` × meta ${um(c.meta)}` : ""}`);
    if (c.roasAjustado != null) partes.push(`só pagos ${um(c.roasAjustado)}`);
    if (c.usoOrc != null) partes.push(`gastou ${Math.round(c.usoOrc * 100)}% do orçamento`);
    const para = [];
    if (c.novoOrcamento) para.push(`orçamento ${BRL(c.orcamento)} → ${BRL(c.novoOrcamento)}`);
    if (c.novaMeta) para.push(`meta ${um(c.meta)} → ${um(c.novaMeta)}`);
    return { agora: partes.join(" · "), para: para.join(" · "), segurado: c.segurado, fimMes: c.fimMes };
  };
  return (
    <div className="casos-ads">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Na medição de 7 dias</th>
              <th>O que fazer</th>
            </tr>
          </thead>
          <tbody>
            {CASOS.map((x) => {
              const v = valores(x.chave);
              return (
                <tr key={x.chave} className={v ? "aqui" : ""}>
                  <td>
                    {v && <span className="casos-ads-aqui">● você está aqui</span>}
                    {x.quando}
                    {v?.agora && <div className="muted-cel">{v.agora}</div>}
                  </td>
                  <td>
                    {x.faz}
                    {v?.para && !v.segurado && <div><b>{v.para}</b></div>}
                    {v?.segurado && <div className="muted-cel">{v.fimMes ? "segurado: a medição pegou o fim do mês" : "por enquanto: manter (veja o cartão acima)"}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted-cel" style={{ margin: "6px 0 0" }}>
        "Bateu a meta" = ROAS que a Shopee mostra (conta não pagos — é o que o robô dela persegue). "Se paga" = só os pedidos pagos, contra o mínimo. Orçamento nunca abaixo de R$ 15/dia.
        {!c && av?.decideEm ? ` Próxima decisão em ${String(av.decideEm).slice(8, 10)}/${String(av.decideEm).slice(5, 7)}.` : ""}
      </p>
    </div>
  );
}
