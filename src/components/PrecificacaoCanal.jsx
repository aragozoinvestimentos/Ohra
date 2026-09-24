import { useEffect, useMemo, useState } from "react";
import { SHOPEE_TIERS, ML_CATEGORY_PCT, ML_FEE_TIERS, TIKTOK_TIERS, resolverTaxasShein, calcCanal, resultadoNoPreco, resolverFaixaShopee, resolverFaixaML, resolverFaixaTikTok, resolverFaixaShein, calcCanalCustom } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

const DEFAULTS = {
  canal: "shopee",
  shopeeFaixaIdx: 0,
  mlCategoria: ML_CATEGORIAS[0],
  mlTipoAnuncio: "classico",
  mlFaixaIdx: 0,
  tiktokFaixaIdx: 0,
  outroComissao: 0,
  outroFixo: 0,
  imposto: 0,
  custosFixos: 0,
  lucratividade: 20,
  custoProduto: 0,
  frete: 0,
  embalagem: 0,
  concorrente: 0,
  negociado: 0,
  nome: "",
};

export default function PrecificacaoCanal({ custoRecebido, produtoParaSelecionar, onToast }) {
  const { lojaId } = useLoja();
  const [f, setF] = useState(DEFAULTS);
  const [salvando, setSalvando] = useState(false);
  const [baseSelecionada, setBaseSelecionada] = useState(""); // "" | "p:<id>" | "k:<id>"
  const [canalProprioId, setCanalProprioId] = useState("");
  const { itens: baseItens, canais, produtos, precos, composicaoDoKit } = useRankingData();

  const canaisProprios = canais.filter((c) => c.tipo === "custom");

  // Troca de loja invalida a seleção anterior de produto/kit cadastrado.
  useEffect(() => {
    setBaseSelecionada("");
    setCanalProprioId("");
  }, [lojaId]);

  useEffect(() => {
    if (!baseSelecionada) return;
    const [tipo, id] = baseSelecionada.split(":");
    if (tipo === "p") {
      const p = produtos.find((x) => x.id === id) || null;
      if (!p) {
        setF((prev) => ({ ...prev, custoProduto: "", frete: 0, embalagem: 0 }));
        return;
      }
      setF((prev) => ({
        ...prev,
        custoProduto: arredondarPreco(p.custo_producao),
        frete: arredondarPreco(p.frete_padrao || 0),
        embalagem: arredondarPreco(p.embalagem_padrao || 0),
        nome: prev.nome || p.nome,
      }));
    } else if (tipo === "k") {
      const item = baseItens.find((x) => x.id === baseSelecionada) || null;
      setF((prev) => ({
        ...prev,
        custoProduto: arredondarPreco(item?.custoTotal || 0),
        frete: 0,
        embalagem: 0,
        nome: prev.nome || item?.nome || "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSelecionada]);

  // Quando "Usar este custo" é clicado na aba de Produção, aplica o valor aqui.
  useEffect(() => {
    if (custoRecebido == null) return;
    setBaseSelecionada("");
    setF((prev) => ({ ...prev, custoProduto: arredondarPreco(custoRecebido.value) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custoRecebido?.seq]);

  // Quando "Ir para Precificação por Canal" é clicado em Produtos logo depois
  // de cadastrar um produto NOVO, seleciona esse produto automaticamente em
  // "Produto ou kit cadastrado" — o efeito de baseSelecionada acima cuida de
  // puxar custo/frete/embalagem dele.
  useEffect(() => {
    if (!produtoParaSelecionar?.id) return;
    setBaseSelecionada(`p:${produtoParaSelecionar.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoParaSelecionar?.seq]);

  // Escolher um canal próprio específico (quando o canal de venda é "outro")
  // preenche comissão/taxa fixa com o que já está cadastrado nele.
  useEffect(() => {
    if (!canalProprioId) return;
    const c = canaisProprios.find((x) => x.id === canalProprioId);
    if (!c) return;
    setF((prev) => ({
      ...prev,
      outroComissao: arredondarPreco((c.comissao_pct || 0) * 100),
      outroFixo: arredondarPreco(c.taxa_fixa || 0),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canalProprioId]);

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const setStr = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));
  const setIdx = (key) => (e) => setF((prev) => ({ ...prev, [key]: parseInt(e.target.value, 10) }));

  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  const comissaoFixo = useMemo(() => {
    if (f.canal === "shopee") {
      const tier = SHOPEE_TIERS[f.shopeeFaixaIdx] || SHOPEE_TIERS[0];
      return { pct: tier.pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: true };
    }
    if (f.canal === "ml") {
      const pcts = ML_CATEGORY_PCT[f.mlCategoria] ?? { classico: 0.13, premium: 0.18 };
      const pct = f.mlTipoAnuncio === "premium" ? pcts.premium : pcts.classico;
      const tier = ML_FEE_TIERS[f.mlFaixaIdx] || ML_FEE_TIERS[0];
      return { pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: true };
    }
    if (f.canal === "tiktok") {
      const tier = TIKTOK_TIERS[f.tiktokFaixaIdx] || TIKTOK_TIERS[0];
      return { pct: tier.pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: true };
    }
    if (f.canal === "shein") {
      const tier = resolverTaxasShein();
      return { pct: tier.pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: false };
    }
    return { pct: n(f.outroComissao) / 100, fixo: n(f.outroFixo), temFaixa: false };
  }, [f.canal, f.shopeeFaixaIdx, f.mlCategoria, f.mlTipoAnuncio, f.mlFaixaIdx, f.tiktokFaixaIdx, f.outroComissao, f.outroFixo]);

  const resultado = useMemo(() => {
    return calcCanal({
      imposto: n(f.imposto) / 100,
      comissaoPct: comissaoFixo.pct,
      taxaFixa: comissaoFixo.fixo,
      custosFixosPct: n(f.custosFixos) / 100,
      lucratividadePct: n(f.lucratividade) / 100,
      custoProduto: n(f.custoProduto),
      frete: n(f.frete),
      embalagem: n(f.embalagem),
      min: comissaoFixo.temFaixa ? comissaoFixo.min : null,
      max: comissaoFixo.temFaixa ? comissaoFixo.max : null,
    });
  }, [f, comissaoFixo]);

  const lucratividadeFrac = n(f.lucratividade) / 100;
  const lucrativo = resultado.margem != null && resultado.margem >= lucratividadeFrac - 0.001;

  // "Comparar com outro preço" avalia um preço DIFERENTE do calculado — pra
  // Shopee/ML/TikTok, esse outro preço pode cair numa faixa de comissão
  // diferente da faixa escolhida acima (Faixa 1, 2, 3…). Reaproveitar
  // `resultado.lucroEm` (que fixa a faixa selecionada) dava lucro errado
  // sempre que o preço de comparação pertencia a outra faixa — resolve a
  // faixa certa pro preço informado em vez disso. Shein/canal próprio não têm
  // faixa por preço, então usam a mesma comissão/taxa fixa de sempre.
  const baseSemComissao = {
    imposto: n(f.imposto) / 100,
    custosFixosPct: n(f.custosFixos) / 100,
    custoProduto: n(f.custoProduto),
    frete: n(f.frete),
    embalagem: n(f.embalagem),
  };
  const canalParaComparacao = {
    tipo: f.canal,
    comissao_pct: f.canal === "shein" ? resolverTaxasShein().pct : n(f.outroComissao) / 100,
    taxa_fixa: f.canal === "shein" ? resolverTaxasShein().fixo : n(f.outroFixo),
  };
  const concorrenteLucro =
    n(f.concorrente) > 0 ? resultadoNoPreco(canalParaComparacao, baseSemComissao, n(f.concorrente), f.mlCategoria, f.mlTipoAnuncio)?.lucro ?? null : null;
  const negociadoLucro =
    n(f.negociado) > 0 ? resultadoNoPreco(canalParaComparacao, baseSemComissao, n(f.negociado), f.mlCategoria, f.mlTipoAnuncio)?.lucro ?? null : null;

  // "Mesmo produto nos outros canais": o mesmo custo + margem desejada em
  // cada canal cadastrado, com o imposto/custos fixos configurados em cada
  // um (Configuração → Canais) e a faixa de comissão resolvida sozinha —
  // mesma conta do Comparativo, só que já em cima do item desta tela.
  const outrosCanais = useMemo(() => {
    if (n(f.custoProduto) <= 0) return [];
    const base = {
      lucratividadePct: n(f.lucratividade) / 100,
      custoProduto: n(f.custoProduto),
      frete: n(f.frete),
      embalagem: n(f.embalagem),
    };
    return canais
      .filter((c) => c.ativo !== false)
      .map((canal) => {
        const b = { ...base, imposto: canal.imposto_pct || 0, custosFixosPct: canal.custos_fixos_pct || 0 };
        let r;
        if (canal.tipo === "shopee") r = resolverFaixaShopee(b).resultado;
        else if (canal.tipo === "ml") r = resolverFaixaML(f.mlCategoria, b, f.mlTipoAnuncio).resultado;
        else if (canal.tipo === "tiktok") r = resolverFaixaTikTok(b).resultado;
        else if (canal.tipo === "shein") r = resolverFaixaShein(b).resultado;
        else r = calcCanalCustom(canal, b);
        let salvo = null;
        if (baseSelecionada) {
          const [t, id] = baseSelecionada.split(":");
          const itemTipo = t === "k" ? "kit" : "produto";
          salvo = precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canal.id) || null;
        }
        const confiavel = canal.tipo === "custom" || r.faixaOk !== false;
        return { canal, r, salvo, confiavel };
      })
      .sort((a, b) => (b.confiavel && b.r.lucro != null ? b.r.lucro : -Infinity) - (a.confiavel && a.r.lucro != null ? a.r.lucro : -Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canais, precos, baseSelecionada, f.custoProduto, f.frete, f.embalagem, f.lucratividade, f.mlCategoria, f.mlTipoAnuncio]);

  const canalLabel =
    f.canal === "shopee" ? "Shopee" : f.canal === "ml" ? "Mercado Livre" : f.canal === "tiktok" ? "TikTok Shop" : f.canal === "shein" ? "Shein" : "Outro canal";

  // Acha o canal cadastrado de verdade correspondente ao que está selecionado
  // aqui — pelos tipos oficiais dá pra achar sozinho; "outro" depende do
  // canal próprio escolhido no seletor extra.
  function resolverCanalId() {
    if (f.canal === "outro") return canalProprioId || null;
    const c = canais.find((x) => x.tipo === f.canal);
    return c?.id || null;
  }

  // Imposto e custos fixos normalmente são os mesmos pra toda venda naquele
  // canal (é config de loja, não de produto) — já ficam cadastrados em
  // Configuração → Canais. Em vez de digitar de novo pra cada produto, o botão
  // abaixo puxa o que já está cadastrado; continua editável na mão depois,
  // pro caso raro de um produto específico precisar de outro valor.
  function usarConfigDoCanal() {
    const canalId = resolverCanalId();
    const canalRegistrado = canais.find((x) => x.id === canalId);
    if (!canalRegistrado) {
      onToast(
        f.canal === "outro"
          ? "Escolha qual canal próprio é esse acima primeiro"
          : `Cadastre o canal ${canalLabel} em Configuração → Canais primeiro`
      );
      return;
    }
    setF((prev) => ({
      ...prev,
      imposto: arredondarPreco((canalRegistrado.imposto_pct || 0) * 100),
      custosFixos: arredondarPreco((canalRegistrado.custos_fixos_pct || 0) * 100),
    }));
  }

  // Se o produto/kit + canal escolhidos já têm um preço salvo, mostra pra não
  // sobrescrever sem avisar — o "Salvar" abaixo sempre substitui o que já
  // existia (upsert), então vale deixar claro antes de clicar.
  // Quando um kit está selecionado, detalha item a item quanto cada produto
  // (e a embalagem própria do kit) pesa no custo total mostrado acima.
  const kitSelecionadoId = baseSelecionada.startsWith("k:") ? baseSelecionada.slice(2) : null;
  const composicaoKit = kitSelecionadoId ? composicaoDoKit(kitSelecionadoId) : null;

  const canalIdAtual = resolverCanalId();
  const precoExistente =
    baseSelecionada && canalIdAtual
      ? (() => {
          const [tipo, id] = baseSelecionada.split(":");
          const itemTipo = tipo === "k" ? "kit" : "produto";
          return precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalIdAtual) || null;
        })()
      : null;

  async function salvar() {
    if (!supabase) {
      onToast("Produtos precificados indisponível (Supabase não configurado)");
      return;
    }
    if (!baseSelecionada) {
      onToast("Selecione um produto ou kit cadastrado acima pra salvar o preço por canal");
      return;
    }
    const canalId = resolverCanalId();
    if (!canalId) {
      onToast(
        f.canal === "outro"
          ? "Selecione qual canal próprio é esse, ou cadastre um em Configuração → Canais"
          : `Cadastre o canal ${canalLabel} em Configuração → Canais pra poder salvar`
      );
      return;
    }
    const [tipo, id] = baseSelecionada.split(":");
    setSalvando(true);
    const { error } = await supabase.from("precos_canal").upsert(
      {
        loja_id: lojaId || null,
        item_tipo: tipo === "k" ? "kit" : "produto",
        item_id: id,
        canal_id: canalId,
        preco: arredondarPreco(resultado.preco),
        custo_total: arredondarPreco(resultado.custoTotal),
        lucro: resultado.lucro != null ? arredondarPreco(resultado.lucro) : null,
        margem: resultado.margem,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "item_tipo,item_id,canal_id" }
    );
    setSalvando(false);
    if (error) {
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    onToast(`Preço salvo em Produtos precificados (${canalLabel})`);
  }

  // Zera o formulário inteiro de volta pro estado inicial — canal, produto/kit
  // escolhido e todos os campos preenchidos na mão.
  function limparTudo() {
    setF(DEFAULTS);
    setBaseSelecionada("");
    setCanalProprioId("");
  }

  return (
    <>
    <TopbarAcoes aba="canal">
      <button type="button" className="btn" onClick={limparTudo}>
        Limpar
      </button>
      <button
        type="button"
        className="btn primary"
        onClick={salvar}
        disabled={salvando || !baseSelecionada}
        title={baseSelecionada ? "Salvar esse preço em Produtos precificados" : "Escolha um produto ou kit cadastrado pra poder salvar"}
      >
        {salvando ? "Salvando…" : "Salvar preço"}
      </button>
    </TopbarAcoes>
    <Kpis
      itens={[
        { label: "Custo total", valor: BRL(resultado.custoTotal), sub: "produção + frete + embalagem" },
        {
          label: "Preço no canal",
          valor: BRL(resultado.preco),
          tom: "destaque",
          sub: comissaoFixo.temFaixa
            ? resultado.faixaOk
              ? `${canalLabel} · confere com a faixa`
              : `${canalLabel} · fora da faixa — teste outra`
            : canalLabel,
        },
        { label: "Lucro líquido / un.", valor: BRL(resultado.lucro), tom: resultado.lucro >= 0 ? "good" : "bad", sub: "depois de todas as taxas" },
        {
          label: "Margem líquida",
          valor: (
            <>
              {PCT(resultado.margem)}{" "}
              <span className={`badge ${lucrativo ? "good" : "bad"}`} style={{ verticalAlign: 4 }}>{lucrativo ? "lucrativo" : "abaixo da meta"}</span>
            </>
          ),
          extra: <Termometro valor={resultado.margem} meta={lucratividadeFrac} />,
        },
      ]}
    />
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            <span>
              Canal
              <Ajuda texto="Comissão e taxa fixa são o que Shopee/Mercado Livre descontam de cada venda (calculadas pelas faixas oficiais). Imposto é o % que você recolhe sobre a venda (MEI com DAS fixo pode deixar em 0%). Custos fixos adicionais é qualquer % extra recorrente (embalagens, ferramentas, assinaturas). Lucratividade desejada é a margem líquida que você quer garantir — é ela que define o preço calculado." />
            </span>
          </h3>
          <div className="field">
            <label>Canal de venda</label>
            <select value={f.canal} onChange={setStr("canal")}>
              <option value="shopee">Shopee</option>
              <option value="ml">Mercado Livre</option>
              <option value="tiktok">TikTok Shop</option>
              <option value="shein">Shein</option>
              <option value="outro">Outro canal</option>
            </select>
          </div>

          {f.canal === "shein" && (
            <div className="hint" style={{ marginTop: -4 }}>
              Comissão fixa de 16%, sem taxa por venda — não varia por categoria nem faixa de preço.
            </div>
          )}

          {f.canal === "tiktok" && (
            <div className="field">
              <label>Faixa de preço prevista (já com desconto)</label>
              <select value={f.tiktokFaixaIdx} onChange={setIdx("tiktokFaixaIdx")}>
                {TIKTOK_TIERS.map((t, i) => (
                  <option key={t.label} value={i}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {f.canal === "shopee" && (
            <div className="field">
              <label>Faixa de preço prevista</label>
              <select value={f.shopeeFaixaIdx} onChange={setIdx("shopeeFaixaIdx")}>
                {SHOPEE_TIERS.map((t, i) => (
                  <option key={t.label} value={i}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {f.canal === "ml" && (
            <>
              <div className="row2">
                <div className="field">
                  <label>Categoria do produto</label>
                  <select value={f.mlCategoria} onChange={setStr("mlCategoria")}>
                    {ML_CATEGORIAS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Tipo de anúncio</label>
                  <select value={f.mlTipoAnuncio} onChange={setStr("mlTipoAnuncio")}>
                    <option value="classico">Clássico</option>
                    <option value="premium">Premium (parcelamento sem juros)</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Faixa de preço prevista (define a taxa fixa)</label>
                <select value={f.mlFaixaIdx} onChange={setIdx("mlFaixaIdx")}>
                  {ML_FEE_TIERS.map((t, i) => (
                    <option key={t.label} value={i}>{t.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {f.canal === "outro" && (
            <>
              {canaisProprios.length > 0 && (
                <div className="field">
                  <label>Qual canal próprio é esse?</label>
                  <select value={canalProprioId} onChange={(e) => setCanalProprioId(e.target.value)}>
                    <option value="">— preencher manualmente —</option>
                    {canaisProprios.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="row2">
                <div className="field">
                  <label>Comissão (%)</label>
                  <input type="number" step="0.1" value={f.outroComissao} onChange={set("outroComissao")} />
                </div>
                <div className="field">
                  <label>Taxa fixa (R$)</label>
                  <input type="number" step="0.01" value={f.outroFixo} onChange={set("outroFixo")} />
                </div>
              </div>
              {canaisProprios.length === 0 && (
                <div className="hint" style={{ marginTop: -4 }}>
                  Pra salvar em Produtos precificados, cadastre esse canal em Configuração → Canais primeiro.
                </div>
              )}
            </>
          )}

          <div className="row3">
            <div className="field">
              <label title="Imposto sobre a venda do seu CNPJ/MEI — MEI com DAS fixo deixa em 0%">Imposto (%)</label>
              <input type="number" step="0.1" value={f.imposto} onChange={set("imposto")} />
            </div>
            <div className="field">
              <label>Custos fixos (%)</label>
              <input type="number" step="0.1" value={f.custosFixos} onChange={set("custosFixos")} />
            </div>
            <div className="field">
              <label>Margem desejada (%)</label>
              <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
            </div>
          </div>
          <button type="button" className="link-btn" onClick={usarConfigDoCanal}>
            Usar imposto/custos fixos já cadastrados nesse canal
          </button>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Custo do produto
            <Ajuda texto='Três formas de preencher: na mão; escolhendo um produto/kit cadastrado (puxa custo, frete e embalagem); ou em "Custo de Produção" usando o botão "Usar este custo na Precificação por Canal →".' />
          </h3>
          <div className="field">
            <label>Produto ou kit cadastrado (opcional)</label>
            <select value={baseSelecionada} onChange={(e) => setBaseSelecionada(e.target.value)}>
              <option value="">— preencher manualmente —</option>
              {baseItens.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}{item.sku ? ` · SKU ${item.sku}` : ""} ({item.tipo})
                </option>
              ))}
            </select>
          </div>
          <div className="row3">
            <div className="field">
              <label>Custo produção (R$)</label>
              <input type="number" step="0.01" value={f.custoProduto} onChange={set("custoProduto")} />
            </div>
            <div className="field">
              <label title="Frete extra por sua conta">Frete extra (R$)</label>
              <input type="number" step="0.01" value={f.frete} onChange={set("frete")} />
            </div>
            <div className="field">
              <label>Embalagem (R$)</label>
              <input type="number" step="0.01" value={f.embalagem} onChange={set("embalagem")} />
            </div>
          </div>
          {baseSelecionada && (
            <div className="hint" style={{ marginBottom: 0 }}>
              Preenchido automaticamente com o custo já cadastrado desse {baseSelecionada.startsWith("k:") ? "kit" : "produto"} — ajuste aqui só pra simular um cenário diferente.
            </div>
          )}
        </div>

        {composicaoKit && (composicaoKit.produtos.length > 0 || composicaoKit.embalagens.length > 0) && (
          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <h3 className="section-title">
              Composição do kit
              <Ajuda texto="Quanto cada produto (fabricação) e a embalagem própria do kit pesam no custo total mostrado ao lado — só pra conferir de onde vem o número, não muda o cálculo." />
            </h3>
            {composicaoKit.produtos.map((linha, i) => (
              <div className="kv" key={`p-${i}`}>
                <span className="k">
                  {linha.nome}
                  {linha.quantidade !== 1 && <span className="k-sub">{linha.quantidade}× {BRL(linha.custoUnit)}</span>}
                </span>
                <span className="v">{BRL(linha.subtotal)}</span>
              </div>
            ))}
            {composicaoKit.embalagens.map((linha, i) => (
              <div className="kv" key={`e-${i}`}>
                <span className="k">
                  {linha.nome} <span className="campo-anterior">(embalagem do kit)</span>
                  {linha.quantidade !== 1 && <span className="k-sub">{linha.quantidade}× {BRL(linha.custoUnit)}</span>}
                </span>
                <span className="v">{BRL(linha.subtotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="panel">
          <h3 className="section-title">
            Detalhamento do preço
            <Ajuda texto="'Taxas descontadas por venda' mostra exatamente o que o canal tira do preço calculado: comissão % (proporcional ao preço) + taxa fixa (mesmo valor em R$ não importa o preço). Imposto e custos fixos aparecem separados porque são configurados por você (Configuração → Canais), não pela plataforma." />
          </h3>
          <div className="kv"><span className="k">Mark-up (divisor)</span><span className="v">{isFinite(Number(resultado.markup)) ? Number(resultado.markup).toFixed(3) + "×" : "—"}</span></div>
          {comissaoFixo.temFaixa && (
            <div className="kv">
              <span className="k">Confere com a faixa escolhida?</span>
              <span className="v">
                {resultado.faixaOk
                  ? <span className="badge good">Sim</span>
                  : <span className="badge bad">Não — teste outra faixa</span>}
              </span>
            </div>
          )}

          <div className="detalhe-taxas">
            <div className="detalhe-taxas-titulo">Taxas descontadas por venda (nesse preço)</div>
            <div className="kv"><span className="k">Comissão do canal</span><span className="v">{PCT(comissaoFixo.pct)} · {BRL(resultado.preco * comissaoFixo.pct)}</span></div>
            <div className="kv"><span className="k">Taxa fixa do canal</span><span className="v">{BRL(comissaoFixo.fixo)}</span></div>
            <div className="kv"><span className="k">Imposto (seu CNPJ/MEI)</span><span className="v">{PCT(n(f.imposto) / 100)} · {BRL(resultado.preco * (n(f.imposto) / 100))}</span></div>
            <div className="kv"><span className="k">Custos fixos adicionais</span><span className="v">{PCT(n(f.custosFixos) / 100)} · {BRL(resultado.preco * (n(f.custosFixos) / 100))}</span></div>
            <div className="kv total"><span className="k">Total descontado da venda</span><span className="v">{BRL(resultado.preco - resultado.custoTotal - resultado.lucro)}</span></div>
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Comparar com outro preço</h3>
          <div className="row2">
            <div>
              <div className="field">
                <label>Preço do concorrente (R$)</label>
                <input type="number" step="0.01" value={f.concorrente} onChange={set("concorrente")} />
              </div>
              <div className="kv"><span className="k">Lucro</span><span className="v">{concorrenteLucro != null ? BRL(concorrenteLucro) : "—"}</span></div>
              <div className="kv"><span className="k">Margem</span><span className="v">{concorrenteLucro != null ? PCT(concorrenteLucro / n(f.concorrente)) : "—"}</span></div>
            </div>
            <div>
              <div className="field">
                <label>Preço negociado / manual (R$)</label>
                <input type="number" step="0.01" value={f.negociado} onChange={set("negociado")} />
              </div>
              <div className="kv"><span className="k">Lucro</span><span className="v">{negociadoLucro != null ? BRL(negociadoLucro) : "—"}</span></div>
              <div className="kv"><span className="k">Margem</span><span className="v">{negociadoLucro != null ? PCT(negociadoLucro / n(f.negociado)) : "—"}</span></div>
            </div>
          </div>
        </div>

        {outrosCanais.length > 0 && (
          <div className="panel">
            <h3 className="section-title">
              Mesmo produto nos outros canais
              <Ajuda texto="Preço que cada canal precisaria pra dar a mesma margem desejada, com o imposto/custos fixos cadastrados em cada canal (Configuração → Canais) e a faixa de comissão escolhida automaticamente. Ordenado do maior pro menor lucro. 'Preço salvo' é o que já está gravado em Produtos precificados pra esse item." />
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th className="num">Preço sugerido</th>
                    <th className="num">Lucro</th>
                    <th className="num">Margem</th>
                    {baseSelecionada && <th className="num">Preço salvo</th>}
                  </tr>
                </thead>
                <tbody>
                  {outrosCanais.map(({ canal, r, salvo, confiavel }) => (
                    <tr key={canal.id} className={canal.tipo === f.canal || canal.id === canalProprioId ? "linha-atual" : ""}>
                      <td>
                        <strong style={{ fontWeight: 600 }}>{canal.nome}</strong>
                        {!confiavel && <span className="badge warn" style={{ marginLeft: 6 }}>faixa não fecha</span>}
                      </td>
                      <td className="num">{r.preco != null ? BRL(r.preco) : "—"}</td>
                      <td className="num">{r.lucro != null ? BRL(r.lucro) : "—"}</td>
                      <td className="num">{r.margem != null ? <span className={`badge ${r.margem >= lucratividadeFrac - 0.001 ? "good" : "bad"}`}>{PCT(r.margem)}</span> : "—"}</td>
                      {baseSelecionada && <td className="num">{salvo ? BRL(salvo.preco) : <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="panel">
          <h3 className="section-title">
            Salvar em Produtos precificados
            <Ajuda texto="Salva o preço, custo e lucro calculados aqui pra esse produto/kit + canal — depois é só consultar em Produtos precificados, sem precisar recalcular tudo de novo. Se já existir um preço salvo pra essa mesma combinação, salvar de novo substitui o valor anterior (por isso avisamos antes)." />
          </h3>
          {!baseSelecionada ? (
            <div className="hint" style={{ marginBottom: 0 }}>
              Selecione um produto ou kit cadastrado em "Custo do produto" acima pra poder salvar.
            </div>
          ) : (
            <div className="save-row">
              <div className="hint" style={{ marginTop: 0, marginBottom: 0 }}>
                Salva o resultado atual pra <strong>{baseItens.find((i) => i.id === baseSelecionada)?.nome}</strong> no canal <strong>{canalLabel}</strong>.
              </div>
              {precoExistente && (
                <div className="hint" style={{ marginTop: 0, marginBottom: 0, color: "var(--warn)" }}>
                  Já existe um preço salvo aqui: <strong>{BRL(precoExistente.preco)}</strong>
                  {precoExistente.lucro != null && (
                    <>
                      {" "}(lucro {BRL(precoExistente.lucro)}
                      {precoExistente.margem != null ? ` · ${PCT(precoExistente.margem)}` : ""})
                    </>
                  )}
                  . Salvar agora vai substituir esse valor.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
