import { SHOPEE_TIERS, ML_CATEGORY_PCT, ML_ENVIO_FAIXAS_PRECO, ML_ENVIO_TABELA, TIKTOK_TIERS, SHEIN_TIERS } from "../lib/calc.js";
import { BRL, PCT } from "../lib/format.js";
import { useRankingData } from "../hooks/useRankingData.js";
import Ajuda from "./Ajuda.jsx";

// Referência somática das taxas oficiais de cada marketplace, pra validar de
// vez em quando se ainda batem com o site oficial de cada um — os mesmos
// valores usados em Precificação por Canal, Ranking, Promoções etc. (vêm
// todos de src/lib/calc.js, um só lugar pra atualizar quando alguma
// plataforma mudar a tabela).
const CANAIS_OFICIAIS = [
  {
    tipo: "shopee",
    nome: "Shopee",
    validado: "Conferido em 27/09/2026 no artigo oficial do Centro de Educação do Vendedor (seller.shopee.com.br, atualizado 18/09/2026). Já com o fixo de R$ 4,50 até R$ 79,99, vigente a partir de 01/10/2026. Abaixo de R$ 9 o adicional é metade do preço. Não inclui o adicional de R$ 3/item de vendedor CPF com mais de 450 pedidos em 90 dias.",
    colunas: ["Faixa de preço", "Comissão", "Taxa fixa"],
    linhas: SHOPEE_TIERS.map((t) => [t.label, PCT(t.pct), BRL(t.fixo)]),
  },
  {
    tipo: "tiktok",
    nome: "TikTok Shop",
    validado: "Vigente desde 15/07/2026 — conferido em 27/09/2026 na Academia do Vendedor TikTok Shop (seller-br.tiktok.com, \"Tarifa de Comissão da Plataforma\"). Faixas pelo preço já com o desconto do vendedor.",
    colunas: ["Faixa de preço", "Comissão", "Taxa fixa"],
    linhas: TIKTOK_TIERS.map((t) => [t.label, PCT(t.pct), BRL(t.fixo)]),
  },
  {
    tipo: "shein",
    nome: "Shein",
    validado: "Conferido em 27/09/2026 na página oficial (br.shein.com/SHEIN-Commission-Policy-a-1420.html): 18% em \"outras categorias\" pra pedidos criados após 01/03/2026 (vestuário feminino é 20%). Sem taxa fixa.",
    colunas: ["Faixa de preço", "Comissão", "Taxa fixa"],
    linhas: SHEIN_TIERS.map((t) => [t.label, PCT(t.pct), BRL(t.fixo)]),
  },
];

export default function TaxasMarketplace() {
  const { canais, carregando } = useRankingData();
  const canaisProprios = canais.filter((c) => c.tipo === "custom");

  function statusCanal(tipo) {
    return canais.some((c) => c.tipo === tipo);
  }

  return (
    <div className="grid-cards">
      {CANAIS_OFICIAIS.map((canal) => (
        <div className="panel" key={canal.tipo}>
          <h3 className="section-title">
            {canal.nome}
            {!carregando && (
              <span className={`badge ${statusCanal(canal.tipo) ? "good" : "bad"}`} style={{ marginLeft: 10, fontWeight: 600 }}>
                {statusCanal(canal.tipo) ? "cadastrado nesta loja" : "não cadastrado nesta loja"}
              </span>
            )}
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {canal.colunas.map((c) => (
                    <th key={c} className={c === "Faixa de preço" ? "" : "num"}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {canal.linhas.map((linha, i) => (
                  <tr key={i}>
                    {linha.map((valor, j) => (
                      <td key={j} className={j === 0 ? "" : "num"}>{valor}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>{canal.validado}</div>
        </div>
      ))}

      <div className="panel">
        <h3 className="section-title">
          Mercado Livre
          {!carregando && (
            <span className={`badge ${statusCanal("ml") ? "good" : "bad"}`} style={{ marginLeft: 10, fontWeight: 600 }}>
              {statusCanal("ml") ? "cadastrado nesta loja" : "não cadastrado nesta loja"}
            </span>
          )}
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="num">Clássico</th>
                <th className="num">Premium</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ML_CATEGORY_PCT).map(([categoria, pcts]) => (
                <tr key={categoria}>
                  <td>{categoria}</td>
                  <td className="num">{PCT(pcts.classico)}</td>
                  <td className="num">{PCT(pcts.premium)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "12px 0 6px" }}>Custo dos Envios por peso × preço (cobrado em TODA venda, substitui a antiga taxa fixa)</div>
        <div className="table-wrap tabela-envio-ml">
          <table>
            <thead>
              <tr>
                <th>Peso</th>
                {ML_ENVIO_FAIXAS_PRECO.map((f) => (
                  <th className="num" key={f.label}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ML_ENVIO_TABELA.map(([max, vals], i) => (
                <tr key={max}>
                  <td>{i === 0 ? `até ${max * 1000} g` : `${ML_ENVIO_TABELA[i - 1][0] < 1 ? `${ML_ENVIO_TABELA[i - 1][0] * 1000} g` : `${String(ML_ENVIO_TABELA[i - 1][0]).replace(".", ",")} kg`} – ${max < 1 ? `${max * 1000} g` : `${String(max).replace(".", ",")} kg`}`}</td>
                  {vals.map((v, j) => (
                    <td className="num" key={j}>{BRL(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Tarifa de venda (Clássico 10%–14%, Premium 15%–19% conforme a categoria) validada em 06/09/2026; os valores acima são de &quot;Casa &amp; Decoração&quot;. Custo dos Envios conferido em
          27/09/2026 em mercadolivre.com.br/ajuda (MercadoLíder, reputação verde ou sem reputação — já com o desconto da reputação verde). Vigente desde 02/03/2026: abaixo de R$ 79 inclui o frete
          grátis padrão; a partir de R$ 79, o frete grátis rápido obrigatório. Produtos abaixo de R$ 19 pagam no máximo metade do preço. Kit vendido como um anúncio paga um custo só. O app usa o
          peso de envio do item (peça + embalagem); sem peso cadastrado, considera até 300 g.
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">
          Canais próprios cadastrados
          <Ajuda texto="Comissão, taxa fixa, imposto e custos fixos desses canais são definidos manualmente por você em Configuração → Canais — aqui é só uma conferência rápida." />
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : canaisProprios.length === 0 ? (
          <div className="empty">Nenhum canal próprio cadastrado ainda. Cadastre em Configuração → Canais.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th className="num">Comissão</th>
                  <th className="num">Taxa fixa</th>
                  <th className="num">Imposto (seu)</th>
                  <th className="num">Custos fixos</th>
                </tr>
              </thead>
              <tbody>
                {canaisProprios.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td className="num">{PCT(c.comissao_pct || 0)}</td>
                    <td className="num">{BRL(c.taxa_fixa || 0)}</td>
                    <td className="num">{PCT(c.imposto_pct || 0)}</td>
                    <td className="num">{PCT(c.custos_fixos_pct || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
