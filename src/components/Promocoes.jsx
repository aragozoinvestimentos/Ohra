import { useEffect, useMemo, useState } from "react";
import { ML_CATEGORY_PCT, calcCanal, calcCanalCustom, resolverFaixaML, resolverFaixaShopee } from "../lib/calc.js";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

const TIPOS = [
  { key: "desconto", label: "Desconto direto" },
  { key: "progressivo", label: "Progressivo por quantidade" },
  { key: "combo", label: "Combo (leve mais, pague menos)" },
  { key: "frete", label: "Frete grátis" },
];

const TIERS_PADRAO = [
  { qtd: 2, desconto: 8 },
  { qtd: 3, desconto: 15 },
  { qtd: 5, desconto: 22 },
];

export default function Promocoes() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [produtoId, setProdutoId] = useState("");
  const [canalId, setCanalId] = useState("");
  const [custoManual, setCustoManual] = useState("");
  const [frete, setFrete] = useState(0);
  const [embalagem, setEmbalagem] = useState(0);
  const [mlCategoria, setMlCategoria] = useState(ML_CATEGORIAS[0]);
  const [lucratividade, setLucratividade] = useState(30);

  const [tipo, setTipo] = useState("desconto");
  const [desconto, setDesconto] = useState(10);
  const [tiers, setTiers] = useState(TIERS_PADRAO);
  const [levar, setLevar] = useState(3);
  const [pagar, setPagar] = useState(2);
  const [freteAbsorvido, setFreteAbsorvido] = useState(12);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let qp = supabase.from("produtos_cadastro").select("*").order("nome");
        let qc = supabase.from("canais").select("*").eq("ativo", true).order("tipo");
        if (lojaId) {
          qp = qp.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
        }
        const [rp, rc] = await Promise.all([qp, qc]);
        if (!ativo) return;
        if (!rp.error) setProdutos(rp.data || []);
        if (!rc.error) {
          setCanais(rc.data || []);
          if (rc.data && rc.data.length > 0) setCanalId((prev) => prev || rc.data[0].id);
        }
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [lojaId]);

  const produto = produtos.find((p) => p.id === produtoId) || null;
  const canal = canais.find((c) => c.id === canalId) || null;

  useEffect(() => {
    if (!produto) return;
    setFrete(produto.frete_padrao || 0);
    setEmbalagem(produto.embalagem_padrao || 0);
  }, [produtoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (v) => (isFinite(v) ? v : 0);
  const custoProduto = produto ? Number(produto.custo_producao) || 0 : parseFloat(custoManual) || 0;

  // Resolve preço normal (sem promoção) pelo canal escolhido, e guarda as
  // taxas efetivas (comissão/taxa fixa) pra reaproveitar nos cálculos de
  // combo, que precisam montar um "pedido" com custo/preço diferentes.
  const base = useMemo(
    () => ({
      custoProduto,
      frete: n(frete),
      embalagem: n(embalagem),
      lucratividadePct: n(lucratividade) / 100,
      imposto: canal?.imposto_pct || 0,
      custosFixosPct: canal?.custos_fixos_pct || 0,
    }),
    [custoProduto, frete, embalagem, lucratividade, canal]
  );

  const { normal, feeInfo } = useMemo(() => {
    if (!canal) return { normal: null, feeInfo: null };
    if (canal.tipo === "shopee") {
      const r = resolverFaixaShopee(base);
      return { normal: r.resultado, feeInfo: { comissaoPct: r.tier.pct, taxaFixa: r.tier.fixo } };
    }
    if (canal.tipo === "ml") {
      const r = resolverFaixaML(mlCategoria, base);
      return { normal: r.resultado, feeInfo: { comissaoPct: ML_CATEGORY_PCT[mlCategoria] ?? 0.13, taxaFixa: r.tier.fixo } };
    }
    return { normal: calcCanalCustom(canal, base), feeInfo: { comissaoPct: canal.comissao_pct || 0, taxaFixa: canal.taxa_fixa || 0 } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, base, mlCategoria]);

  function atualizarTier(idx, campo, valor) {
    setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  }

  const linhasProgressivo = useMemo(() => {
    if (!normal) return [];
    return tiers.map((t) => {
      const precoUnit = normal.preco * (1 - (n(t.desconto) || 0) / 100);
      const lucroUnit = normal.lucroEm(precoUnit);
      return { ...t, precoUnit, lucroUnit, margemUnit: precoUnit > 0 ? lucroUnit / precoUnit : null };
    });
  }, [normal, tiers]);

  const combo = useMemo(() => {
    if (!normal || !feeInfo) return null;
    const L = Math.max(1, n(levar) || 1);
    const P = Math.min(L, Math.max(0, n(pagar) || 0));
    const custoKit = custoProduto * L + n(embalagem) * L;
    const resultadoKit = calcCanal({
      imposto: base.imposto,
      comissaoPct: feeInfo.comissaoPct,
      taxaFixa: feeInfo.taxaFixa,
      custosFixosPct: base.custosFixosPct,
      lucratividadePct: base.lucratividadePct,
      custoProduto: custoKit,
      frete: n(frete),
      embalagem: 0,
    });
    const precoKit = normal.preco * P;
    const lucroKit = resultadoKit.lucroEm(precoKit);
    return {
      L,
      P,
      precoKit,
      lucroKit,
      margemKit: precoKit > 0 ? lucroKit / precoKit : null,
      precoUnidadeEfetivo: precoKit / L,
      lucroUnidadeEfetivo: lucroKit / L,
      economiaTaxaFixa: feeInfo.taxaFixa * (L - 1),
    };
  }, [normal, feeInfo, levar, pagar, custoProduto, embalagem, frete, base]);

  const freteGratis = useMemo(() => {
    if (!normal) return null;
    const lucro = normal.lucro - (n(freteAbsorvido) || 0);
    return { lucro, margem: normal.preco > 0 ? lucro / normal.preco : null };
  }, [normal, freteAbsorvido]);

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Promoções</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="save-row" style={{ marginBottom: 18, gap: 6, flexWrap: "wrap" }}>
        {TIPOS.map((t) => (
          <button
            key={t.key}
            className={`btn${tipo === t.key ? " primary" : ""}`}
            onClick={() => setTipo(t.key)}
            style={{ flex: "none" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid2">
        <div>
          <div className="panel">
            <h3 className="section-title">
              Produto e canal
              <Ajuda texto="Simula o impacto de uma promoção no lucro, a partir do preço normal calculado pro canal escolhido (mesmas taxas de Cadastros → Canais)." />
            </h3>
            {carregando ? (
              <div className="empty">Carregando…</div>
            ) : (
              <>
                <div className="field">
                  <label>Produto cadastrado</label>
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
                <div className="field">
                  <label>Canal</label>
                  <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
                    {canais.length === 0 && <option value="">Nenhum canal cadastrado</option>}
                    {canais.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                {canal?.tipo === "ml" && (
                  <div className="field">
                    <label>Categoria (Mercado Livre)</label>
                    <select value={mlCategoria} onChange={(e) => setMlCategoria(e.target.value)}>
                      {ML_CATEGORIAS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                )}
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
                  <label>Lucratividade líquida desejada (%)</label>
                  <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
                </div>
              </>
            )}
          </div>

          {normal && (
            <div className="panel">
              <h3>Preço normal (sem promoção)</h3>
              <div className="kv"><span className="k">Preço</span><span className="v">{BRL(normal.preco)}</span></div>
              <div className="kv"><span className="k">Lucro</span><span className="v">{BRL(normal.lucro)}</span></div>
              <div className="kv"><span className="k">Margem</span><span className="v">{PCT(normal.margem)}</span></div>
            </div>
          )}
        </div>

        <div>
          {!normal ? (
            <div className="panel"><div className="empty">Escolha um canal cadastrado pra simular.</div></div>
          ) : tipo === "desconto" ? (
            <div className="panel">
              <h3 className="section-title">Desconto direto</h3>
              <div className="field">
                <label>Desconto sobre o preço normal (%)</label>
                <input type="number" step="1" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
              </div>
              {(() => {
                const precoPromo = normal.preco * (1 - (n(desconto) || 0) / 100);
                const lucroPromo = normal.lucroEm(precoPromo);
                const margemPromo = precoPromo > 0 ? lucroPromo / precoPromo : null;
                return (
                  <>
                    <div className="kv"><span className="k">Preço com desconto</span><span className="v">{BRL(precoPromo)}</span></div>
                    <div className="kv total"><span className="k">Lucro com desconto</span><span className="v">{BRL(lucroPromo)}</span></div>
                    <div className="kv"><span className="k">Margem com desconto</span><span className="v">{margemPromo != null ? PCT(margemPromo) : "—"}</span></div>
                    <Termometro valor={margemPromo || 0} meta={n(lucratividade) / 100} />
                  </>
                );
              })()}
            </div>
          ) : tipo === "progressivo" ? (
            <div className="panel">
              <h3 className="section-title">
                Progressivo por quantidade
                <Ajuda texto="Cada faixa aplica um desconto % maior conforme a quantidade comprada — a taxa fixa do canal continua sendo cobrada por unidade (é assim que Shopee/ML tratam item por item, mesmo em um pedido só)." />
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>A partir de</th>
                      <th className="num">Desconto</th>
                      <th className="num">Preço/un.</th>
                      <th className="num">Lucro/un.</th>
                      <th className="num">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasProgressivo.map((t, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            type="number"
                            step="1"
                            style={{ width: 55 }}
                            value={t.qtd}
                            onChange={(e) => atualizarTier(i, "qtd", e.target.value)}
                          />{" "}
                          un.
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="1"
                            style={{ width: 55, textAlign: "right" }}
                            value={t.desconto}
                            onChange={(e) => atualizarTier(i, "desconto", e.target.value)}
                          />%
                        </td>
                        <td className="num">{BRL(t.precoUnit)}</td>
                        <td className="num">{BRL(t.lucroUnit)}</td>
                        <td className="num">{t.margemUnit != null ? PCT(t.margemUnit) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tipo === "combo" ? (
            <div className="panel">
              <h3 className="section-title">
                Combo — leve mais, pague menos
                <Ajuda texto="Vendido como um único pedido/kit: a taxa fixa do canal é cobrada uma vez só (não por unidade), então quanto maior o kit, mais essa economia ajuda a bancar o desconto." />
              </h3>
              <div className="row2">
                <div className="field">
                  <label>Leva (unidades)</label>
                  <input type="number" step="1" min="1" value={levar} onChange={(e) => setLevar(e.target.value)} />
                </div>
                <div className="field">
                  <label>Paga (unidades)</label>
                  <input type="number" step="1" min="0" value={pagar} onChange={(e) => setPagar(e.target.value)} />
                </div>
              </div>
              {combo && (
                <>
                  <div className="kv"><span className="k">Preço do kit ({combo.L} un.)</span><span className="v">{BRL(combo.precoKit)}</span></div>
                  <div className="kv"><span className="k">Preço efetivo por unidade</span><span className="v">{BRL(combo.precoUnidadeEfetivo)}</span></div>
                  <div className="kv total"><span className="k">Lucro do kit</span><span className="v">{BRL(combo.lucroKit)}</span></div>
                  <div className="kv"><span className="k">Lucro efetivo por unidade</span><span className="v">{BRL(combo.lucroUnidadeEfetivo)}</span></div>
                  <div className="kv">
                    <span className="k">Margem do kit</span>
                    <span className="v">{combo.margemKit != null ? PCT(combo.margemKit) : "—"}</span>
                  </div>
                  <Termometro valor={combo.margemKit || 0} meta={n(lucratividade) / 100} />
                  <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                    Economia de taxa fixa por vender junto: {BRL(combo.economiaTaxaFixa)} (comparado a vender as {combo.L} unidades em pedidos separados).
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="panel">
              <h3 className="section-title">Frete grátis subsidiado</h3>
              <div className="field">
                <label>Frete que você vai absorver (R$)</label>
                <input type="number" step="0.01" value={freteAbsorvido} onChange={(e) => setFreteAbsorvido(e.target.value)} />
              </div>
              {freteGratis && (
                <>
                  <div className="kv"><span className="k">Preço (não muda)</span><span className="v">{BRL(normal.preco)}</span></div>
                  <div className="kv total"><span className="k">Lucro absorvendo o frete</span><span className="v">{BRL(freteGratis.lucro)}</span></div>
                  <div className="kv">
                    <span className="k">Margem absorvendo o frete</span>
                    <span className="v">{freteGratis.margem != null ? PCT(freteGratis.margem) : "—"}</span>
                  </div>
                  <Termometro valor={freteGratis.margem || 0} meta={n(lucratividade) / 100} />
                  <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                    Frete grátis costuma aumentar conversão e ranking no marketplace — vale comparar esse lucro com o ganho esperado em volume de vendas.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
