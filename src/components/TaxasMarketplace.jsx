import { SHOPEE_TIERS, ML_CATEGORY_PCT, ML_FEE_TIERS, TIKTOK_TIERS, SHEIN_TIERS } from "../lib/calc.js";
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
    validado: "Vigente desde 01/03/2026 — validado em 06/09/2026 contra o Centro de Educação do Vendedor (seller.shopee.com.br) e duas fontes independentes.",
    colunas: ["Faixa de preço", "Comissão", "Taxa fixa"],
    linhas: SHOPEE_TIERS.map((t) => [t.label, PCT(t.pct), BRL(t.fixo)]),
  },
  {
    tipo: "tiktok",
    nome: "TikTok Shop",
    validado: "Vigente desde 15/07/2026 — duas faixas definidas pelo preço já com desconto aplicado, sem diferenciação por categoria.",
    colunas: ["Faixa de preço", "Comissão", "Taxa fixa"],
    linhas: TIKTOK_TIERS.map((t) => [t.label, PCT(t.pct), BRL(t.fixo)]),
  },
  {
    tipo: "shein",
    nome: "Shein",
    validado:
      "Validado em 07/09/2026 contra três fontes independentes (a página oficial retornou erro de acesso na hora da validação — vale reconferir em br.shein.com/SHEIN-Commission-Policy-a-1420.html). Comissão padrão de 16%, sem taxa fixa, sem diferenciação por categoria fora de vestuário.",
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
    <div>
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
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Faixa de preço</th>
                <th className="num">Taxa fixa</th>
              </tr>
            </thead>
            <tbody>
              {ML_FEE_TIERS.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td className="num">{BRL(t.fixo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Comissão validada em 06/09/2026 contra mercadolivre.com.br/ajuda/quanto-custa-vender-um-produto_1338 — valores de "Casa & Decoração" (categoria
          típica de produtos impressos em 3D); "Beleza" é estimativa dentro da faixa oficial divulgada (Clássico 10%–14%, Premium 15%–19%). Taxa fixa também
          validada na mesma data; desde março/2026 pode variar por peso/dimensão conforme o tipo logístico — não modelado aqui.
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">
          Canais próprios cadastrados
          <Ajuda texto="Comissão, taxa fixa, imposto e custos fixos desses canais são definidos manualmente por você em Cadastros → Canais — aqui é só uma conferência rápida." />
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : canaisProprios.length === 0 ? (
          <div className="empty">Nenhum canal próprio cadastrado ainda. Cadastre em Cadastros → Canais.</div>
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
