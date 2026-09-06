import { useEffect, useMemo, useState } from "react";
import { calcCanal } from "../lib/calc.js";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Ajuda from "./Ajuda.jsx";

const QUANTIDADES_COMPARACAO = [1, 3, 5, 10, 20, 50];

// Venda direta em volume de um produto já cadastrado: sem comissão de
// marketplace, e o frete (cobrado uma vez por pedido) é diluído entre as
// unidades — por isso o preço unitário cai conforme a quantidade sobe,
// mantendo a mesma lucratividade desejada.
export default function OrcamentoVolume() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState(10);
  const [imposto, setImposto] = useState(0);
  const [custosFixos, setCustosFixos] = useState(2);
  const [lucratividade, setLucratividade] = useState(30);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("produtos_cadastro").select("*").order("nome");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo || error) return;
      setProdutos(data || []);
      if (data && data.length > 0 && !produtoId) setProdutoId(data[0].id);
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojaId]);

  const produto = produtos.find((p) => p.id === produtoId) || null;
  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  function calcularLote(qtd) {
    if (!produto) return null;
    const custoUnitario = Number(produto.custo_producao || 0) + Number(produto.embalagem_padrao || 0);
    const freteLote = Number(produto.frete_padrao || 0); // cobrado uma vez, diluído no lote
    const custoTotalLote = custoUnitario * qtd + freteLote;
    const resultado = calcCanal({
      imposto: n(imposto) / 100,
      comissaoPct: 0,
      taxaFixa: 0,
      custosFixosPct: n(custosFixos) / 100,
      lucratividadePct: n(lucratividade) / 100,
      custoProduto: custoTotalLote,
      frete: 0,
      embalagem: 0,
    });
    return {
      ...resultado,
      precoUnitario: resultado.preco / qtd,
      lucroUnitario: resultado.lucro / qtd,
    };
  }

  const resultadoAtual = useMemo(() => calcularLote(n(quantidade) || 1), [produto, quantidade, imposto, custosFixos, lucratividade]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparacao = useMemo(
    () => QUANTIDADES_COMPARACAO.map((q) => ({ q, r: calcularLote(q) })),
    [produto, imposto, custosFixos, lucratividade] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Encomenda em volume</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Produto e quantidade
            <Ajuda texto="O frete do produto cadastrado é cobrado uma vez por pedido (não por unidade) — quanto mais peças no lote, mais ele se dilui e menor fica o preço unitário, mesmo mantendo a mesma margem." />
          </h3>
          {produtos.length === 0 ? (
            <div className="empty">Cadastre um produto em Cadastros → Produtos primeiro.</div>
          ) : (
            <>
              <div className="field">
                <label>Produto cadastrado</label>
                <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Quantidade do pedido</label>
                <input type="number" step="1" min="1" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">Parâmetros</h3>
          <div className="row2">
            <div className="field">
              <label>Imposto sobre a venda (%)</label>
              <input type="number" step="0.1" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </div>
            <div className="field">
              <label>Custos fixos adicionais (%)</label>
              <input type="number" step="0.1" value={custosFixos} onChange={(e) => setCustosFixos(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>Preço deste pedido</h3>
          {!resultadoAtual ? (
            <div className="empty">Escolha um produto cadastrado.</div>
          ) : (
            <>
              <div className="kv"><span className="k">Preço total do lote</span><span className="v">{BRL(resultadoAtual.preco)}</span></div>
              <div className="kv total"><span className="k">Preço por unidade</span><span className="v">{BRL(resultadoAtual.precoUnitario)}</span></div>
              <div className="kv"><span className="k">Lucro total</span><span className="v">{BRL(resultadoAtual.lucro)}</span></div>
              <div className="kv"><span className="k">Margem líquida</span><span className="v">{PCT(resultadoAtual.margem)}</span></div>
            </>
          )}
        </div>

        {produto && (
          <div className="panel">
            <h3 className="section-title">Comparativo por quantidade</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Qtd.</th>
                    <th className="num">Preço/unidade</th>
                    <th className="num">Preço do lote</th>
                    <th className="num">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {comparacao.map(({ q, r }) => (
                    <tr key={q}>
                      <td>{q}</td>
                      <td className="num">{r ? BRL(r.precoUnitario) : "—"}</td>
                      <td className="num">{r ? BRL(r.preco) : "—"}</td>
                      <td className="num">{r ? PCT(r.margem) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
              O preço por unidade cai com o volume porque o frete é diluído entre mais peças — a margem líquida continua a mesma em todas as linhas.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
