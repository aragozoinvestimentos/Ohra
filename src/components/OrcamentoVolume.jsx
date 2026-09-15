import { useEffect, useMemo, useState } from "react";
import { calcCanal } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import Ajuda from "./Ajuda.jsx";

// Multiplicadores do lote atual (não quantidades fixas) — assim funciona
// tanto com um produto só quanto com vários misturados no carrinho: "2×"
// significa o dobro de cada item já escolhido, não uma quantidade de um
// produto específico.
const MULTIPLICADORES_COMPARACAO = [1, 2, 3, 5, 10];

const PADROES = { freteLote: 0, imposto: 0, custosFixos: 2, lucratividade: 30 };

// Venda direta em volume: um ou mais produtos já cadastrados, cada um com
// sua quantidade (mesmo seletor usado em Kits/Promoções → Venda combinada).
// Sem comissão de marketplace, e o frete do PEDIDO (um valor só, não por
// produto — você decide manualmente, já que com vários itens misturados não
// dá pra "puxar" um frete padrão de um produto só) é diluído entre todas as
// peças — por isso o preço unitário médio cai conforme o total de peças sobe,
// mantendo a mesma lucratividade desejada.
export default function OrcamentoVolume({ onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [itensLote, setItensLote] = useState([]); // [{ itemId, quantidade }]
  const [freteLote, setFreteLote] = useState(PADROES.freteLote);
  const [imposto, setImposto] = useState(PADROES.imposto);
  const [custosFixos, setCustosFixos] = useState(PADROES.custosFixos);
  const [lucratividade, setLucratividade] = useState(PADROES.lucratividade);
  const [nomePedido, setNomePedido] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Troca de loja invalida o carrinho anterior (produtos de outra loja) —
  // ajustado durante a renderização (padrão React de "adjusting state while
  // rendering"), não num useEffect, porque aqui é só zerar o carrinho no
  // exato render em que lojaId muda, sem precisar de um efeito à parte.
  const [lojaAnterior, setLojaAnterior] = useState(lojaId);
  if (lojaId !== lojaAnterior) {
    setLojaAnterior(lojaId);
    setItensLote([]);
  }

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("produtos_cadastro").select("*").order("nome");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo || error) return;
      setProdutos(data || []);
    }
    carregar();
    // Sem isso, cadastrar/editar/excluir um produto em Cadastros só refletia
    // aqui depois de recarregar a página inteira.
    const canal = supabase
      .channel("orcamento-volume-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  // Catálogo pro SeletorItens — "preco" aqui é o custo unitário (produção +
  // embalagem própria do produto), igual à convenção já usada em Kits e em
  // Promoções → Venda combinada.
  const catalogoProdutos = useMemo(
    () =>
      produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku || "",
        preco: arredondarPreco((Number(p.custo_producao) || 0) + (Number(p.embalagem_padrao) || 0)),
        unidade: "un",
      })),
    [produtos]
  );

  const itensValidos = itensLote.filter((it) => it.itemId && (Number(it.quantidade) || 0) > 0);
  const custoItensTotal = totalItens(catalogoProdutos, itensValidos);
  const totalPecas = itensValidos.reduce((soma, it) => soma + (Number(it.quantidade) || 0), 0);

  // Calcula o lote pra um MULTIPLICADOR do carrinho atual (1× = como está
  // digitado). O frete do pedido não escala com o multiplicador — é cobrado
  // do mesmo jeito não importa quantas vezes o carrinho caiba nele, é isso
  // que faz o preço por peça cair quando o total de peças sobe.
  function calcularLote(multiplicador) {
    if (totalPecas <= 0) return null;
    const custoTotalLote = custoItensTotal * multiplicador + n(freteLote);
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
    const pecas = totalPecas * multiplicador;
    return {
      ...resultado,
      pecas,
      precoUnitario: resultado.preco != null ? resultado.preco / pecas : null,
      lucroUnitario: resultado.lucro != null ? resultado.lucro / pecas : null,
    };
  }

  const resultadoAtual = useMemo(
    () => calcularLote(1),
    [custoItensTotal, totalPecas, freteLote, imposto, custosFixos, lucratividade] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const comparacao = useMemo(
    () => MULTIPLICADORES_COMPARACAO.map((mult) => ({ mult, r: calcularLote(mult) })),
    [custoItensTotal, totalPecas, freteLote, imposto, custosFixos, lucratividade] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Salva o lote atual (preço/custo/lucro TOTAIS do pedido, mais o total de
  // peças) na mesma lista de "Orçamentos salvos" da Encomenda avulsa — só
  // ganha uma coluna "Qtd." a mais lá, pra diferenciar de um pedido de uma
  // peça só. Guardar a quantidade junto evita ambiguidade depois: sem ela,
  // um preço salvo de um lote de 10 pareceria (errado) o preço de uma
  // unidade só.
  async function salvar() {
    const nome = nomePedido.trim();
    if (!nome) {
      onToast?.("Dê um nome ao pedido antes de salvar");
      return;
    }
    if (!supabase) {
      onToast?.("Histórico indisponível (Supabase não configurado)");
      return;
    }
    if (!resultadoAtual) {
      onToast?.("Adicione pelo menos um item ao carrinho antes de salvar");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("orcamentos_avulsos").insert({
      nome,
      quantidade: Math.round(totalPecas) || 1,
      custo_total: arredondarPreco(resultadoAtual.custoTotal),
      preco: arredondarPreco(resultadoAtual.preco),
      lucro: arredondarPreco(resultadoAtual.lucro),
      margem: resultadoAtual.margem,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvando(false);
    if (error) {
      onToast?.("Não foi possível salvar agora — tente de novo");
      return;
    }
    onToast?.("Orçamento salvo em Orçamentos salvos");
    setNomePedido("");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Encomenda em volume</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  // Zera o carrinho e os parâmetros de volta pros padrões.
  function limparTudo() {
    setItensLote([]);
    setFreteLote(PADROES.freteLote);
    setImposto(PADROES.imposto);
    setCustosFixos(PADROES.custosFixos);
    setLucratividade(PADROES.lucratividade);
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              Produtos e quantidades
              <Ajuda texto="Adicione um ou mais produtos já cadastrados, cada um com sua quantidade — o mesmo pedido pode misturar produtos diferentes. O frete do pedido é um valor só (ajuste manualmente abaixo), cobrado uma vez não importa quantas peças — quanto mais peças no lote, mais ele se dilui e menor fica o preço unitário médio." />
            </span>
            <button type="button" className="btn" onClick={limparTudo} style={{ fontWeight: 400 }}>
              Limpar formulário
            </button>
          </h3>
          {produtos.length === 0 ? (
            <div className="empty">Cadastre um produto em Cadastros → Produtos primeiro.</div>
          ) : (
            <SeletorItens
              catalogo={catalogoProdutos}
              itens={itensLote}
              onChange={setItensLote}
              rotuloVazio="Cadastre um produto em Cadastros → Produtos primeiro."
            />
          )}
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Frete do pedido (R$)</label>
            <input type="number" step="0.01" min="0" value={freteLote} onChange={(e) => setFreteLote(e.target.value)} />
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Parâmetros</h3>
          <div className="row2">
            <div className="field">
              <label>Imposto sobre a venda — seu CNPJ/MEI (%)</label>
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
            <div className="empty">Adicione pelo menos um item acima.</div>
          ) : (
            <>
              <div className="kv"><span className="k">Total de peças</span><span className="v">{resultadoAtual.pecas}</span></div>
              <div className="kv"><span className="k">Preço total do lote</span><span className="v">{BRL(resultadoAtual.preco)}</span></div>
              <div className="kv total"><span className="k">Preço médio por unidade</span><span className="v">{BRL(resultadoAtual.precoUnitario)}</span></div>
              <div className="kv"><span className="k">Lucro total</span><span className="v">{BRL(resultadoAtual.lucro)}</span></div>
              <div className="kv"><span className="k">Margem líquida</span><span className="v">{PCT(resultadoAtual.margem)}</span></div>
              {itensValidos.length > 1 && (
                <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                  "Preço médio por unidade" divide o preço total pelo nº de peças — como o carrinho mistura produtos de custos diferentes, é uma
                  referência pra cotar o pedido inteiro, não o preço de cada produto individualmente.
                </div>
              )}
            </>
          )}
        </div>

        {resultadoAtual && (
          <div className="panel">
            <h3 className="section-title">Salvar em Orçamentos</h3>
            <div className="save-row">
              <div className="field">
                <label>Nome do pedido</label>
                <input
                  type="text"
                  placeholder={`ex: Encomenda ${Math.round(totalPecas) || 1} peças`}
                  value={nomePedido}
                  onChange={(e) => setNomePedido(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") salvar();
                  }}
                />
              </div>
              <button className="btn primary" onClick={salvar} disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              Salva o preço, custo e lucro TOTAIS desse lote de {Math.round(totalPecas) || 1} peças — não o valor por unidade.
            </div>
          </div>
        )}

        {totalPecas > 0 && (
          <div className="panel">
            <h3 className="section-title">Comparativo por volume</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Peças</th>
                    <th className="num">Preço/unidade</th>
                    <th className="num">Preço do lote</th>
                    <th className="num">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {comparacao.map(({ mult, r }) => (
                    <tr key={mult}>
                      <td>{r ? r.pecas : "—"}{mult === 1 ? " (atual)" : ""}</td>
                      <td className="num">{r ? BRL(r.precoUnitario) : "—"}</td>
                      <td className="num">{r ? BRL(r.preco) : "—"}</td>
                      <td className="num">{r ? PCT(r.margem) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
              Cada linha multiplica a quantidade de TODOS os itens do carrinho pelo mesmo fator (2×, 3×...) — o preço por unidade cai com o volume
              porque o frete do pedido é diluído entre mais peças, mantendo a mesma margem líquida em todas as linhas.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
