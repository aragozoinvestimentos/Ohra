import { useEffect, useMemo, useState } from "react";
import { SHOPEE_TIERS, ML_CATEGORY_PCT, ML_FEE_TIERS, TIKTOK_TIERS, calcCanal } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

const DEFAULTS = {
  canal: "shopee",
  shopeeFaixaIdx: 0,
  mlCategoria: ML_CATEGORIAS[0],
  mlFaixaIdx: 0,
  tiktokFaixaIdx: 0,
  outroComissao: 0,
  outroFixo: 0,
  imposto: 0,
  custosFixos: 2,
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

  // Quando "Usar este custo" é clicado na aba de Produção, aplica o valor aqui.
  useEffect(() => {
    if (custoRecebido == null) return;
    setF((prev) => ({ ...prev, custoProduto: arredondarPreco(custoRecebido.value) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custoRecebido?.seq]);

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
      const pct = ML_CATEGORY_PCT[f.mlCategoria] ?? 0.13;
      const tier = ML_FEE_TIERS[f.mlFaixaIdx] || ML_FEE_TIERS[0];
      return { pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: true };
    }
    if (f.canal === "tiktok") {
      const tier = TIKTOK_TIERS[f.tiktokFaixaIdx] || TIKTOK_TIERS[0];
      return { pct: tier.pct, fixo: tier.fixo, min: tier.min, max: tier.max, temFaixa: true };
    }
    return { pct: n(f.outroComissao) / 100, fixo: n(f.outroFixo), temFaixa: false };
  }, [f.canal, f.shopeeFaixaIdx, f.mlCategoria, f.mlFaixaIdx, f.tiktokFaixaIdx, f.outroComissao, f.outroFixo]);

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

  const canalLabel = f.canal === "shopee" ? "Shopee" : f.canal === "ml" ? "Mercado Livre" : f.canal === "tiktok" ? "TikTok Shop" : "Outro canal";

  async function salvar() {
    const nome = f.nome.trim();
    if (!nome) {
      onToast('Dê um nome ao produto antes de salvar');
      return;
    }
    if (!supabase) {
      onToast("Histórico indisponível (Supabase não configurado)");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("produtos").insert({
      nome,
      canal: canalLabel,
      custo: arredondarPreco(resultado.custoTotal),
      preco: arredondarPreco(resultado.preco),
      margem: resultado.margem,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvando(false);
    if (error) {
      onToast("Não foi possível salvar agora — tente de novo");
      return;
    }
    onToast("Produto salvo no histórico");
    setF((prev) => ({ ...prev, nome: "" }));
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Canal
            <Ajuda texto="Comissão e taxa fixa são o que Shopee/Mercado Livre descontam de cada venda (calculadas pelas faixas oficiais). Imposto é o % que você recolhe sobre a venda (MEI com DAS fixo pode deixar em 0%). Custos fixos adicionais é qualquer % extra recorrente (embalagens, ferramentas, assinaturas). Lucratividade desejada é a margem líquida que você quer garantir — é ela que define o preço calculado." />
          </h3>
          <div className="field">
            <label>Canal de venda</label>
            <select value={f.canal} onChange={setStr("canal")}>
              <option value="shopee">Shopee</option>
              <option value="ml">Mercado Livre</option>
              <option value="tiktok">TikTok Shop</option>
              <option value="outro">Outro canal</option>
            </select>
          </div>

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
              <div className="field">
                <label>Categoria do produto</label>
                <select value={f.mlCategoria} onChange={setStr("mlCategoria")}>
                  {ML_CATEGORIAS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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
          )}

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
          <div className="field">
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
          </div>
          <div className="hint">MEI: o DAS é fixo mensal, não por venda — deixe o imposto em 0%.</div>
        </div>

        <div className="panel">
          <h3 className="section-title">Custo do produto</h3>
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
        </div>
      </div>

      <div>
        <div className="panel">
          <h3 className="section-title">
            Resultado
            <Ajuda texto="'Taxas descontadas por venda' mostra exatamente o que o canal tira do preço calculado: comissão % (proporcional ao preço) + taxa fixa (mesmo valor em R$ não importa o preço). Imposto e custos fixos aparecem separados porque são configurados por você (Cadastros → Canais), não pela plataforma." />
          </h3>
          <div className="kv"><span className="k">Custo total do produto</span><span className="v">{BRL(resultado.custoTotal)}</span></div>
          <div className="kv"><span className="k">Mark-up (divisor)</span><span className="v">{isFinite(Number(resultado.markup)) ? Number(resultado.markup).toFixed(3) + "×" : "—"}</span></div>
          <div className="kv total"><span className="k">Preço calculado</span><span className="v">{BRL(resultado.preco)}</span></div>
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
          <div className="kv"><span className="k">Lucro líquido</span><span className="v">{BRL(resultado.lucro)}</span></div>
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
            <div className="kv"><span className="k">Imposto sobre a venda</span><span className="v">{PCT(n(f.imposto) / 100)} · {BRL(resultado.preco * (n(f.imposto) / 100))}</span></div>
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
          <h3 className="section-title">Salvar no histórico</h3>
          <div className="save-row">
            <div className="field">
              <label>Nome do produto</label>
              <input type="text" placeholder="ex: Vaso decorativo médio" value={f.nome} onChange={setStr("nome")} />
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
