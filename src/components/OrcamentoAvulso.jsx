import { useEffect, useMemo, useState } from "react";
import { calcCanal } from "../lib/calc.js";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

const DEFAULTS = {
  nome: "",
  custoProduto: "",
  frete: 0,
  embalagem: 0,
  imposto: 0,
  custosFixos: 2,
  lucratividade: 30,
};

// Venda direta pra um pedido personalizado (encomenda): sem comissão nem
// taxa fixa de marketplace, já que não passa pela Shopee/ML.
export default function OrcamentoAvulso({ onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [produtoId, setProdutoId] = useState("");
  const [f, setF] = useState(DEFAULTS);
  const [salvando, setSalvando] = useState(false);

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
    return () => {
      ativo = false;
    };
  }, [lojaId]);

  const produtoSelecionado = produtos.find((p) => p.id === produtoId) || null;

  useEffect(() => {
    if (!produtoSelecionado) return;
    setF((prev) => ({
      ...prev,
      custoProduto: produtoSelecionado.custo_producao,
      frete: produtoSelecionado.frete_padrao || 0,
      embalagem: produtoSelecionado.embalagem_padrao || 0,
    }));
  }, [produtoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  const resultado = useMemo(() => {
    return calcCanal({
      imposto: n(f.imposto) / 100,
      comissaoPct: 0,
      taxaFixa: 0,
      custosFixosPct: n(f.custosFixos) / 100,
      lucratividadePct: n(f.lucratividade) / 100,
      custoProduto: n(f.custoProduto),
      frete: n(f.frete),
      embalagem: n(f.embalagem),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  async function salvar() {
    const nome = f.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao pedido antes de salvar");
      return;
    }
    if (!supabase) {
      onToast("Histórico indisponível (Supabase não configurado)");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("produtos").insert({
      nome,
      canal: "Encomenda avulsa",
      custo: resultado.custoTotal,
      preco: resultado.preco,
      margem: resultado.margem,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvando(false);
    if (error) {
      onToast("Não foi possível salvar agora — tente de novo");
      return;
    }
    onToast("Orçamento salvo no histórico");
    setF((prev) => ({ ...prev, nome: "" }));
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Pedido personalizado
            <Ajuda texto="Pra encomendas vendidas direto (fora de marketplace) — sem comissão nem taxa fixa de plataforma. Escolha um produto já cadastrado pra puxar o custo automaticamente, ou preencha manualmente pra algo sob medida." />
          </h3>
          <div className="field">
            <label>Produto cadastrado (opcional)</label>
            <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">— preencher manualmente —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Custo de produção (R$)</label>
            <input type="number" step="0.01" value={f.custoProduto} onChange={set("custoProduto")} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Frete (R$)</label>
              <input type="number" step="0.01" value={f.frete} onChange={set("frete")} />
            </div>
            <div className="field">
              <label>Embalagem (R$)</label>
              <input type="number" step="0.01" value={f.embalagem} onChange={set("embalagem")} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Parâmetros</h3>
          <div className="row2">
            <div className="field">
              <label>Imposto sobre a venda (%)</label>
              <input type="number" step="0.1" value={f.imposto} onChange={set("imposto")} />
            </div>
            <div className="field">
              <label>Custos fixos adicionais (%)</label>
              <input type="number" step="0.1" value={f.custosFixos} onChange={set("custosFixos")} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>Preço sugerido</h3>
          <div className="kv"><span className="k">Custo total</span><span className="v">{BRL(resultado.custoTotal)}</span></div>
          <div className="kv total"><span className="k">Preço do pedido</span><span className="v">{BRL(resultado.preco)}</span></div>
          <div className="kv"><span className="k">Lucro líquido</span><span className="v">{BRL(resultado.lucro)}</span></div>
          <div className="kv"><span className="k">Margem líquida</span><span className="v">{PCT(resultado.margem)}</span></div>
          <Termometro valor={resultado.margem} meta={n(f.lucratividade) / 100} />
          <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            Sem comissão de marketplace — o preço já reflete o quanto você economiza vendendo direto.
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Salvar no histórico</h3>
          <div className="save-row">
            <div className="field">
              <label>Nome do pedido</label>
              <input type="text" placeholder="ex: Encomenda 6x porta-retrato" value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
            </div>
            <button className="btn primary" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
