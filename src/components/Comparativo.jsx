import { useCallback, useEffect, useMemo, useState } from "react";
import { ML_CATEGORY_PCT, resolverFaixaShopee, resolverFaixaML, resolverFaixaTikTok, calcCanalCustom, aplicarAds } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { totalItens } from "./SeletorItens.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

export default function Comparativo() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [kits, setKits] = useState([]);
  const [kitProdutosTodos, setKitProdutosTodos] = useState([]);
  const [kitEmbalagensTodos, setKitEmbalagensTodos] = useState([]);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [itemAId, setItemAId] = useState(""); // "" (custo manual) | `p:<id>` | `k:<id>`
  const [custoManual, setCustoManual] = useState("");
  const [freteA, setFreteA] = useState(0);
  const [embalagemA, setEmbalagemA] = useState(0);

  const [itemBId, setItemBId] = useState(""); // "" = não comparar com nada
  const [freteB, setFreteB] = useState(0);
  const [embalagemB, setEmbalagemB] = useState(0);

  const [mlCategoria, setMlCategoria] = useState(ML_CATEGORIAS[0]);
  const [mlTipoAnuncio, setMlTipoAnuncio] = useState("classico");
  const [lucratividade, setLucratividade] = useState(20);

  // Troca de loja invalida as seleções anteriores — sem isso, o item de
  // outra loja continuava "selecionado" (ainda que a lista já fosse outra).
  useEffect(() => {
    setItemAId("");
    setItemBId("");
  }, [lojaId]);

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
        let qk = supabase.from("kits").select("*").order("nome");
        let qe = supabase.from("embalagens").select("*").order("nome");
        if (lojaId) {
          qp = qp.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
          qk = qk.eq("loja_id", lojaId);
          qe = qe.eq("loja_id", lojaId);
        }
        const [rp, rc, rk, re] = await Promise.all([qp, qc, qk, qe]);
        if (!ativo) return;
        if (!rp.error) setProdutos(rp.data || []);
        if (!rc.error) setCanais(rc.data || []);
        if (!rk.error) setKits(rk.data || []);
        if (!re.error) setEmbalagensCatalogo(re.data || []);

        const kitIds = (rk.data || []).map((k) => k.id);
        const [kpResp, keResp] = await Promise.all([
          kitIds.length ? supabase.from("kit_produtos").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
          kitIds.length ? supabase.from("kit_embalagens").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
        ]);
        if (!ativo) return;
        setKitProdutosTodos(kpResp.data || []);
        setKitEmbalagensTodos(keResp.data || []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_produtos" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_embalagens" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [lojaId]);

  // Lista única de produtos + kits pros dois seletores (A e "Comparar com")
  // — mesmo padrão usado em Preços por Canal/Promoções/Ranking.
  const itensDisponiveis = useMemo(() => {
    const p = produtos.map((x) => ({ id: `p:${x.id}`, nome: x.nome, tipo: "produto" }));
    const k = kits.map((x) => ({ id: `k:${x.id}`, nome: `[Kit] ${x.nome}`, tipo: "kit" }));
    return [...p, ...k].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [produtos, kits]);

  const catalogoProdutosBase = useMemo(
    () => produtos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.custo_producao) || 0, unidade: "un" })),
    [produtos]
  );
  const catalogoEmbalagensBase = useMemo(
    () => embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade })),
    [embalagensCatalogo]
  );

  function custoKitTotal(k) {
    const prodItens = kitProdutosTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade }));
    const embItens = kitEmbalagensTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    return totalItens(catalogoProdutosBase, prodItens) + totalItens(catalogoEmbalagensBase, embItens);
  }

  // Resolve um id prefixado (`p:`/`k:`) pro objeto que a tela precisa: nome,
  // custo e frete/embalagem padrão (do cadastro do produto, ou zerado pro
  // kit — a embalagem do kit já entra no custo dele, tem receita própria).
  function resolverItem(id) {
    if (!id) return null;
    const [tipo, alvo] = id.split(":");
    if (tipo === "p") {
      const p = produtos.find((x) => x.id === alvo);
      if (!p) return null;
      return {
        nome: p.nome,
        tipo: "produto",
        custo: arredondarPreco(Number(p.custo_producao) || 0),
        freteDefault: arredondarPreco(p.frete_padrao || 0),
        embalagemDefault: arredondarPreco(p.embalagem_padrao || 0),
      };
    }
    const k = kits.find((x) => x.id === alvo);
    if (!k) return null;
    return { nome: `[Kit] ${k.nome}`, tipo: "kit", custo: arredondarPreco(custoKitTotal(k)), freteDefault: 0, embalagemDefault: 0 };
  }

  const itemA = resolverItem(itemAId);
  const itemB = resolverItem(itemBId);

  useEffect(() => {
    if (itemA) {
      setFreteA(itemA.freteDefault);
      setEmbalagemA(itemA.embalagemDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemAId]);

  useEffect(() => {
    if (itemB) {
      setFreteB(itemB.freteDefault);
      setEmbalagemB(itemB.embalagemDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemBId]);

  const custoProdutoA = itemA ? itemA.custo : parseFloat(custoManual) || 0;
  const custoProdutoB = itemB ? itemB.custo : 0;

  const construirLinhas = useCallback(
    (custoProduto, frete, embalagem) => {
      const base = {
        lucratividadePct: (parseFloat(lucratividade) || 0) / 100,
        custoProduto,
        frete: parseFloat(frete) || 0,
        embalagem: parseFloat(embalagem) || 0,
      };
      return canais.map((canal) => {
        // Imposto e custos fixos são por canal (Cadastros → Canais) — cada
        // linha usa o valor daquele canal, não um input compartilhado.
        const baseCanal = { ...base, imposto: canal.imposto_pct || 0, custosFixosPct: canal.custos_fixos_pct || 0 };
        let resultado;
        if (canal.tipo === "shopee") {
          resultado = resolverFaixaShopee(baseCanal).resultado;
        } else if (canal.tipo === "ml") {
          resultado = resolverFaixaML(mlCategoria, baseCanal, mlTipoAnuncio).resultado;
        } else if (canal.tipo === "tiktok") {
          resultado = resolverFaixaTikTok(baseCanal).resultado;
        } else {
          resultado = calcCanalCustom(canal, baseCanal);
        }
        const ads = aplicarAds(resultado, canal.ads_pct);
        return { canal, resultado, ads };
      });
    },
    [canais, lucratividade, mlCategoria, mlTipoAnuncio]
  );

  const linhasA = useMemo(() => construirLinhas(custoProdutoA, freteA, embalagemA), [construirLinhas, custoProdutoA, freteA, embalagemA]);
  const linhasB = useMemo(
    () => (itemB ? construirLinhas(custoProdutoB, freteB, embalagemB) : []),
    [construirLinhas, itemB, custoProdutoB, freteB, embalagemB]
  );

  // Uma linha só concorre a "melhor canal" se o preço calculado realmente
  // fechar dentro da própria faixa de comissão usada pra calculá-lo (Shopee/
  // ML têm comissão e taxa fixa diferentes por faixa de preço — se nenhuma
  // faixa fechar, resolverFaixaShopee/resolverFaixaML caem no último tier
  // testado mesmo sem ele valer, o que pode gerar um preço/lucro artificial,
  // às vezes R$0,00, tipicamente quando o custo do produto está zerado ou
  // muito baixo pra aquele canal). Combinação de taxas impossível (comissão +
  // imposto + custos fixos + lucratividade >= 100%) também deixa lucro/preço
  // como null — nem uma coisa nem outra pode vencer a comparação.
  function melhoresDeLinhas(linhas) {
    const confiavel = (l) => l.canal.tipo === "custom" || l.resultado.faixaOk !== false;
    const melhorOrganico = linhas.reduce(
      (best, l) => (confiavel(l) && l.resultado.lucro != null && (!best || l.resultado.lucro > best.resultado.lucro) ? l : best),
      null
    );
    const melhorComAds = linhas.reduce(
      (best, l) => (confiavel(l) && l.resultado.preco != null && (!best || l.ads.lucroComAds > best.ads.lucroComAds) ? l : best),
      null
    );
    return { melhorOrganico, melhorComAds };
  }

  const { melhorOrganico: melhorOrganicoA, melhorComAds: melhorComAdsA } = useMemo(() => melhoresDeLinhas(linhasA), [linhasA]);
  const { melhorOrganico: melhorOrganicoB, melhorComAds: melhorComAdsB } = useMemo(() => melhoresDeLinhas(linhasB), [linhasB]);

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Comparativo</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  function renderTabela(titulo, custoProduto, linhas, melhorOrganico, melhorComAds) {
    return (
      <div className="panel">
        <h3>{titulo}</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : linhas.length === 0 ? (
          <div className="empty">Nenhum canal cadastrado ainda — vá em Cadastros → Canais.</div>
        ) : custoProduto <= 0 ? (
          <div className="empty">Escolha um produto/kit cadastrado ou informe um custo de produção pra comparar os canais.</div>
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
                {linhas.map(({ canal, resultado, ads }) => {
                  const inconsistente = canal.tipo !== "custom" && resultado.faixaOk === false;
                  return (
                    <tr key={canal.id}>
                      <td>
                        {canal.nome}
                        {melhorOrganico?.canal.id === canal.id && <span className="badge good" style={{ marginLeft: 6 }}>melhor orgânico</span>}
                        {melhorComAds?.canal.id === canal.id && canal.ads_pct > 0 && <span className="badge good" style={{ marginLeft: 6 }}>melhor c/ Ads</span>}
                        {inconsistente && (
                          <span
                            className="badge bad"
                            style={{ marginLeft: 6 }}
                            title="O preço calculado não confere com a faixa de comissão usada — o custo informado é baixo demais pra esse canal fechar a conta de forma consistente. Ajuste o custo/frete ou confira manualmente na aba Precificação por Canal."
                          >
                            faixa não confere
                          </span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">Item</h3>
          <div className="field">
            <label>Escolha um produto ou kit cadastrado</label>
            <select value={itemAId} onChange={(e) => setItemAId(e.target.value)}>
              <option value="">— usar custo manual —</option>
              {itensDisponiveis.map((it) => (
                <option key={it.id} value={it.id}>{it.nome}</option>
              ))}
            </select>
          </div>
          {!itemAId && (
            <div className="field">
              <label>Custo de produção (R$)</label>
              <input type="number" step="0.01" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
            </div>
          )}
          {itemA && (
            <div className="hint" style={{ marginBottom: 0 }}>
              Custo {itemA.tipo === "kit" ? "total do kit" : "de produção"}: {BRL(itemA.custo)}
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">
            Comparar com (opcional)
            <Ajuda texto="Escolha um segundo produto ou kit pra ver os dois lado a lado — por exemplo, um produto avulso contra o kit que o contém, pra decidir onde vale mais a pena vender." />
          </h3>
          <div className="field" style={{ marginBottom: itemB ? undefined : 0 }}>
            <select value={itemBId} onChange={(e) => setItemBId(e.target.value)}>
              <option value="">— não comparar —</option>
              {itensDisponiveis.filter((it) => it.id !== itemAId).map((it) => (
                <option key={it.id} value={it.id}>{it.nome}</option>
              ))}
            </select>
          </div>
          {itemB && (
            <>
              <div className="hint" style={{ marginTop: -4 }}>
                Custo {itemB.tipo === "kit" ? "total do kit" : "de produção"}: {BRL(itemB.custo)}
              </div>
              <div className="row2" style={{ marginBottom: 0 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Frete extra (R$)</label>
                  <input type="number" step="0.01" value={freteB} onChange={(e) => setFreteB(e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Embalagem (R$)</label>
                  <input type="number" step="0.01" value={embalagemB} onChange={(e) => setEmbalagemB(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">
            Parâmetros gerais
            <Ajuda texto="Lucratividade desejada é a margem líquida usada como meta pra colorir o termômetro de cada canal (não muda o preço aqui, que já vem do custo do produto). Frete e embalagem abaixo são do primeiro item — o segundo tem os próprios campos, logo acima." />
          </h3>
          <div className="field">
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Frete extra por sua conta (R$)</label>
              <input type="number" step="0.01" value={freteA} onChange={(e) => setFreteA(e.target.value)} />
            </div>
            <div className="field">
              <label>Embalagem (R$)</label>
              <input type="number" step="0.01" value={embalagemA} onChange={(e) => setEmbalagemA(e.target.value)} />
            </div>
          </div>
          {itemA && (
            <div className="hint" style={{ marginTop: -8 }}>
              Preenchido automaticamente com o que já está cadastrado — não precisa somar de novo. Só altere aqui se quiser simular um cenário diferente.
            </div>
          )}
          <div className="row2" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>Categoria (só afeta o Mercado Livre)</label>
              <select value={mlCategoria} onChange={(e) => setMlCategoria(e.target.value)}>
                {ML_CATEGORIAS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tipo de anúncio (ML)</label>
              <select value={mlTipoAnuncio} onChange={(e) => setMlTipoAnuncio(e.target.value)}>
                <option value="classico">Clássico</option>
                <option value="premium">Premium</option>
              </select>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Imposto e custos fixos de cada canal vêm de Cadastros → Canais — edite lá se algum percentual mudar.
          </div>
        </div>
      </div>

      <div>
        {itemB && melhorOrganicoA && melhorOrganicoB && (
          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <h3 className="section-title">Resumo — qual compensa mais</h3>
            <div className="kv">
              <span className="k">{itemA?.nome || "Custo manual"} — melhor canal ({melhorOrganicoA.canal.nome})</span>
              <span className="v">{BRL(melhorOrganicoA.resultado.lucro)}</span>
            </div>
            <div className="kv">
              <span className="k">{itemB.nome} — melhor canal ({melhorOrganicoB.canal.nome})</span>
              <span className="v">{BRL(melhorOrganicoB.resultado.lucro)}</span>
            </div>
            <div className="kv total">
              <span className="k">Diferença de lucro (melhor canal de cada um)</span>
              <span className="v">
                {BRL(Math.abs(melhorOrganicoA.resultado.lucro - melhorOrganicoB.resultado.lucro))}{" "}
                {melhorOrganicoA.resultado.lucro >= melhorOrganicoB.resultado.lucro
                  ? `a mais vendendo ${itemA?.nome || "o primeiro"}`
                  : `a mais vendendo ${itemB.nome}`}
              </span>
            </div>
            <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
              Compara o melhor cenário de cada um (podem ser canais diferentes) — pra ver lado a lado no MESMO canal, confira as duas tabelas abaixo.
            </div>
          </div>
        )}

        {renderTabela(itemA?.nome || "Preço e lucro por canal", custoProdutoA, linhasA, melhorOrganicoA, melhorComAdsA)}
        {itemB && renderTabela(itemB.nome, custoProdutoB, linhasB, melhorOrganicoB, melhorComAdsB)}

        <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          O preço de venda não muda com Ads — só o lucro daquela venda específica, pelo % que você configurou em Cadastros → Canais.
        </div>
      </div>
    </div>
  );
}
