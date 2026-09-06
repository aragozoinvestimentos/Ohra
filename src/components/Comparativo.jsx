import { useEffect, useMemo, useState } from "react";
import { ML_CATEGORY_PCT, resolverFaixaShopee, resolverFaixaML, calcCanalCustom, aplicarAds } from "../lib/calc.js";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

export default function Comparativo() {
  const [produtos, setProdutos] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [produtoId, setProdutoId] = useState("");
  const [custoManual, setCustoManual] = useState("");
  const [mlCategoria, setMlCategoria] = useState(ML_CATEGORIAS[0]);
  const [lucratividade, setLucratividade] = useState(20);
  const [frete, setFrete] = useState(0);
  const [embalagem, setEmbalagem] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        const [rp, rc] = await Promise.all([
          supabase.from("produtos_cadastro").select("*").order("nome"),
          supabase.from("canais").select("*").eq("ativo", true).order("tipo"),
        ]);
        if (!ativo) return;
        if (!rp.error) setProdutos(rp.data || []);
        if (!rc.error) setCanais(rc.data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const ch = supabase
      .channel("comparativo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, []);

  const produtoSelecionado = produtos.find((p) => p.id === produtoId) || null;

  useEffect(() => {
    if (produtoSelecionado) {
      setFrete(produtoSelecionado.frete_padrao || 0);
      setEmbalagem(produtoSelecionado.embalagem_padrao || 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoId]);

  const custoProduto = produtoSelecionado ? Number(produtoSelecionado.custo_producao) || 0 : parseFloat(custoManual) || 0;

  const linhas = useMemo(() => {
    const base = {
      lucratividadePct: (parseFloat(lucratividade) || 0) / 100,
      custoProduto,
      frete: parseFloat(frete) || 0,
      embalagem: parseFloat(embalagem) || 0,
    };

    return canais.map((canal) => {
      // Imposto e custos fixos são por canal (Cadastros → Canais) — cada
      // linha usa o valor daquele canal, não um input compartilhado.
      const baseCanal = {
        ...base,
        imposto: canal.imposto_pct || 0,
        custosFixosPct: canal.custos_fixos_pct || 0,
      };
      let resultado;
      if (canal.tipo === "shopee") {
        resultado = resolverFaixaShopee(baseCanal).resultado;
      } else if (canal.tipo === "ml") {
        resultado = resolverFaixaML(mlCategoria, baseCanal).resultado;
      } else {
        resultado = calcCanalCustom(canal, baseCanal);
      }
      const ads = aplicarAds(resultado, canal.ads_pct);
      return { canal, resultado, ads };
    });
  }, [canais, lucratividade, custoProduto, frete, embalagem, mlCategoria]);

  const melhorOrganico = linhas.reduce((best, l) => (!best || l.resultado.lucro > best.resultado.lucro ? l : best), null);
  const melhorComAds = linhas.reduce((best, l) => (!best || l.ads.lucroComAds > best.ads.lucroComAds ? l : best), null);

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Comparativo</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">Produto</h3>
          <div className="field">
            <label>Escolha um produto cadastrado</label>
            <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">— usar custo manual —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          {!produtoId && (
            <div className="field">
              <label>Custo de produção (R$)</label>
              <input type="number" step="0.01" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
            </div>
          )}
          {produtoSelecionado && (
            <div className="hint" style={{ marginBottom: 0 }}>
              Custo de produção: {BRL(custoProduto)} {produtoSelecionado.material_nome ? `· ${produtoSelecionado.material_nome}` : ""}
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">
            Parâmetros gerais
            <Ajuda texto="Lucratividade desejada é a margem líquida usada como meta pra colorir o termômetro de cada canal (não muda o preço aqui, que já vem do custo do produto). Frete e embalagem são custos extras por sua conta, aplicados igual em todos os canais." />
          </h3>
          <div className="field">
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Frete extra por sua conta (R$)</label>
              <input type="number" step="0.01" value={frete} onChange={(e) => setFrete(e.target.value)} />
            </div>
            <div className="field">
              <label>Embalagem (R$)</label>
              <input type="number" step="0.01" value={embalagem} onChange={(e) => setEmbalagem(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Categoria (só afeta o Mercado Livre)</label>
            <select value={mlCategoria} onChange={(e) => setMlCategoria(e.target.value)}>
              {ML_CATEGORIAS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Imposto e custos fixos de cada canal vêm de Cadastros → Canais — edite lá se algum percentual mudar.
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>Preço e lucro por canal</h3>
          {carregando ? (
            <div className="empty">Carregando…</div>
          ) : linhas.length === 0 ? (
            <div className="empty">Nenhum canal cadastrado ainda — vá em Cadastros → Canais.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th className="num">Preço</th>
                    <th className="num">Lucro orgânico</th>
                    <th className="num">Margem</th>
                    <th className="num">Lucro c/ Ads</th>
                    <th className="num">Margem c/ Ads</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ canal, resultado, ads }) => (
                    <tr key={canal.id}>
                      <td>
                        {canal.nome}
                        {melhorOrganico?.canal.id === canal.id && <span className="badge good" style={{ marginLeft: 6 }}>melhor orgânico</span>}
                        {melhorComAds?.canal.id === canal.id && canal.ads_pct > 0 && <span className="badge good" style={{ marginLeft: 6 }}>melhor c/ Ads</span>}
                      </td>
                      <td className="num">{BRL(resultado.preco)}</td>
                      <td className="num">{BRL(resultado.lucro)}</td>
                      <td className="num">
                        {PCT(resultado.margem)}
                        <Termometro valor={resultado.margem} meta={(parseFloat(lucratividade) || 0) / 100} compact />
                      </td>
                      <td className="num">{canal.ads_pct > 0 ? BRL(ads.lucroComAds) : "—"}</td>
                      <td className="num">{canal.ads_pct > 0 ? PCT(ads.margemComAds) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            O preço de venda não muda com Ads — só o lucro daquela venda específica, pelo % que você configurou em Cadastros → Canais.
          </div>
        </div>
      </div>
    </div>
  );
}
