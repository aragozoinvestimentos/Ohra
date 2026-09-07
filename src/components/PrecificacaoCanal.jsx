import { useEffect, useMemo, useState } from "react";
import { SHOPEE_TIERS, ML_CATEGORY_PCT, ML_FEE_TIERS, TIKTOK_TIERS, SHEIN_TIERS, calcCanal } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

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

export default function PrecificacaoCanal({ custoRecebido, onToast }) {
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
      const tier = SHEIN_TIERS[0];
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

  const concorrenteLucro = n(f.concorrente) > 0 ? resultado.lucroEm(n(f.concorrente)) : null;
  const negociadoLucro = n(f.negociado) > 0 ? resultado.lucroEm(n(f.negociado)) : null;

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
      onToast("Preços por Canal indisponível (Supabase não configurado)");
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
          ? "Selecione qual canal próprio é esse, ou cadastre um em Cadastros → Canais"
          : `Cadastre o canal ${canalLabel} em Cadastros → Canais pra poder salvar`
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
    onToast(`Preço salvo em Preços por Canal (${canalLabel})`);
  }

  // Zera o formulário inteiro de volta pro estado inicial — canal, produto/kit
  // escolhido e todos os campos preenchidos na mão.
  function limparTudo() {
    setF(DEFAULTS);
    setBaseSelecionada("");
    setCanalProprioId("");
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              Canal
              <Ajuda texto="Comissão e taxa fixa são o que Shopee/Mercado Livre descontam de cada venda (calculadas pelas faixas oficiais). Imposto é o % que você recolhe sobre a venda (MEI com DAS fixo pode deixar em 0%). Custos fixos adicionais é qualquer % extra recorrente (embalagens, ferramentas, assinaturas). Lucratividade desejada é a margem líquida que você quer garantir — é ela que define o preço calculado." />
            </span>
            <button type="button" className="btn" onClick={limparTudo} style={{ fontWeight: 400 }}>
              Limpar formulário
            </button>
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
                  Pra salvar em Preços por Canal, cadastre esse canal em Cadastros → Canais primeiro.
                </div>
              )}
            </>
          )}

          <div className="row2">
            <div className="field">
              <label>Imposto sobre a venda — seu CNPJ/MEI (%)</label>
              <input type="number" step="0.1" value={f.imposto} onChange={set("imposto")} />
            </div>
            <div className="field">
              <label>Custos fixos adicionais (%)</label>
              <input type="number" step="0.1" value={f.custosFixos} onChange={set("custosFixos")} />
            </div>
          </div>
          <div className="field">
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
          </div>
          <div className="hint">MEI: o DAS é fixo mensal, não por venda — deixe o imposto em 0%.</div>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Custo do produto
            <Ajuda texto="Escolha um produto já cadastrado pra puxar custo, frete e embalagem automaticamente — ou preencha na mão pra simular algo que ainda não existe no catálogo." />
          </h3>
          <div className="hint" style={{ marginTop: -4 }}>
            Três formas de preencher aqui embaixo: preencha na mão, escolha um "Produto ou kit cadastrado" abaixo (puxa custo total já calculado, e frete/embalagem quando for produto), ou vá em "Simular Custo de Produção" e use o botão "Usar este custo na Precificação por Canal →" pra trazer um cálculo feito na hora.
          </div>
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
          <div className="field">
            <label>Custo da mercadoria/produção (R$)</label>
            <input type="number" step="0.01" value={f.custoProduto} onChange={set("custoProduto")} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Frete extra por sua conta (R$)</label>
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
            Resultado
            <Ajuda texto="'Taxas descontadas por venda' mostra exatamente o que o canal tira do preço calculado: comissão % (proporcional ao preço) + taxa fixa (mesmo valor em R$ não importa o preço). Imposto e custos fixos aparecem separados porque são configurados por você (Cadastros → Canais), não pela plataforma." />
          </h3>
          <div className="destaque-custo">
            <span className="k">Custo total do produto</span>
            <span className="v">{BRL(resultado.custoTotal)}</span>
          </div>
          <div className="destaque-preco">
            <span className="k">
              Preço definido para a plataforma
              <span className="k-sub">o que vai anunciado no canal</span>
            </span>
            <span className="v">{BRL(resultado.preco)}</span>
          </div>
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
          <div className="destaque-lucro">
            <span className="k">
              Quanto cai no seu bolso
              <span className="k-sub">lucro líquido por unidade, já descontado tudo</span>
            </span>
            <span className="v">{BRL(resultado.lucro)}</span>
          </div>
          <div className="kv">
            <span className="k">Margem líquida</span>
            <span className="v">
              {PCT(resultado.margem)}{" "}
              {lucrativo
                ? <span className="badge good">lucrativo</span>
                : <span className="badge bad">abaixo da meta</span>}
            </span>
          </div>
          <Termometro valor={resultado.margem} meta={lucratividadeFrac} />

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
          <div className="field">
            <label>Preço do concorrente (R$)</label>
            <input type="number" step="0.01" value={f.concorrente} onChange={set("concorrente")} />
          </div>
          <div className="kv"><span className="k">Lucro nesse preço</span><span className="v">{concorrenteLucro != null ? BRL(concorrenteLucro) : "—"}</span></div>
          <div className="kv"><span className="k">Margem nesse preço</span><span className="v">{concorrenteLucro != null ? PCT(concorrenteLucro / n(f.concorrente)) : "—"}</span></div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Preço negociado / manual (R$)</label>
            <input type="number" step="0.01" value={f.negociado} onChange={set("negociado")} />
          </div>
          <div className="kv"><span className="k">Lucro nesse preço</span><span className="v">{negociadoLucro != null ? BRL(negociadoLucro) : "—"}</span></div>
          <div className="kv"><span className="k">Margem nesse preço</span><span className="v">{negociadoLucro != null ? PCT(negociadoLucro / n(f.negociado)) : "—"}</span></div>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Salvar em Preços por Canal
            <Ajuda texto="Salva o preço, custo e lucro calculados aqui pra esse produto/kit + canal — depois é só consultar em Preços por Canal, sem precisar recalcular tudo de novo. Se já existir um preço salvo pra essa mesma combinação, salvar de novo substitui o valor anterior (por isso avisamos antes)." />
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
              <button className="btn primary" onClick={salvar} disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
