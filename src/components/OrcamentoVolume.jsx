import { useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens from "./SeletorItens.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { MARKUP_PADRAO, canalEmMarkup, configEscada, escadaDoProduto, markupDoCanal, precoPorMarkup } from "../lib/escada.js";
import { ATACADO_PADRAO, configAtacado, orcarPedido, precoMedioNaFaixa, proximaFaixa, rotuloFaixa } from "../lib/vendaDireta.js";
import Ajuda from "./Ajuda.jsx";

const PADROES = { freteLote: 0, imposto: 0, custosFixos: 2 };
const virgula = (v) => String(Math.round(Number(v) * 100) / 100).replace(".", ",");

// Encomenda em volume (venda direta, out/2026): ATACADO POR FAIXAS — preço por
// peça = custo × multiplicador da faixa da loja (lojas.config_escada.atacado,
// 10–49 2,0× · 50–99 1,8× · 100+ 1,6×), com trava no mínimo aceitável por
// peça; abaixo da 1ª faixa vale o VAREJO DIRETO (canal próprio em markup —
// mesma conta da escada). + PERSONALIZAÇÃO (arte por pedido + adicional por
// peça). Conta única em lib/vendaDireta.js; esta tela só mostra e salva.
export default function OrcamentoVolume({ onToast }) {
  const { lojaId, atualizar } = useLoja();
  const { itens, canais, precos, concorrentes, cfgLoja, cfgDoProduto } = useEscada();
  const [itensLote, setItensLote] = useState([]); // [{ itemId, quantidade }]
  const [freteLote, setFreteLote] = useState(PADROES.freteLote);
  const [imposto, setImposto] = useState(PADROES.imposto);
  const [custosFixos, setCustosFixos] = useState(PADROES.custosFixos);
  const [pers, setPers] = useState({ ativa: false, porPeca: null, arte: null, isentarArte: null, isentarArteMin: null });
  const [nomePedido, setNomePedido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [regras, setRegras] = useState(null); // edição das faixas da loja

  const [lojaAnterior, setLojaAnterior] = useState(lojaId);
  if (lojaId !== lojaAnterior) {
    setLojaAnterior(lojaId);
    setItensLote([]);
  }

  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  const cfgA = configAtacado(cfgLoja);
  const cfgL = configEscada(cfgLoja, null);
  // Personalização: padrões da loja, editáveis só neste orçamento.
  const persEf = {
    ativa: pers.ativa,
    porPeca: pers.porPeca ?? cfgA.porPeca,
    arte: pers.arte ?? cfgA.arte,
    isentarArte: pers.isentarArte ?? cfgA.isentarArte,
    isentarArteMin: pers.isentarArteMin ?? cfgA.isentarArteMin,
  };

  // Varejo direto (abaixo da 1ª faixa): o canal próprio em markup (o 1º que
  // tiver); sem nenhum, um canal direto sem taxa com markup padrão.
  const canalVarejo = useMemo(() => {
    const c = canais.find((x) => canalEmMarkup(x));
    return c || { id: "__direto", nome: "venda direta", tipo: "custom", comissao_pct: 0, taxa_fixa: 0, imposto_pct: 0, custos_fixos_pct: 0, modo_preco: "markup", markup: MARKUP_PADRAO };
  }, [canais]);

  // Catálogo: custo por unidade SEM o frete (o frete aqui é o do pedido).
  const catalogoProdutos = useMemo(
    () =>
      itens.map((it) => ({
        id: it.id,
        nome: it.tipo === "Kit" ? `[Kit] ${it.nome}` : it.nome,
        sku: it.sku || "",
        preco:
          it.tipo === "Variação"
            ? arredondarPreco((it.custoProducao || 0) + (it.embalagem || 0) + (it.calc?.ajuste || 0))
            : it.tipo === "Produto"
            ? arredondarPreco(it.custoTotal - (it.freteProduto || 0))
            : arredondarPreco(it.custoTotal || 0),
        unidade: "un",
      })),
    [itens]
  );

  const linhas = itensLote
    .filter((it) => it.itemId && n(it.quantidade) > 0)
    .map((it) => {
      const c = catalogoProdutos.find((x) => x.id === it.itemId);
      return { id: it.itemId, nome: c?.nome || "", custo: n(c?.preco), qtd: n(it.quantidade) };
    });

  // Varejo direto de uma linha: produto = escada do canal próprio (avulso por
  // markup + curva pra 2–9 un.); variação/kit = custo × markup por unidade.
  function varejoDe(l) {
    const item = itens.find((i) => i.id === l.id);
    if (item?.id.startsWith("p:")) {
      const pid = item.id.slice(2);
      const d = escadaDoProduto({ produtoId: pid, canal: canalVarejo, itens, precos, concorrentes, cfg: cfgDoProduto(pid), quantidadesExtras: l.qtd > 1 ? [l.qtd] : [] });
      if (d?.escada) {
        if (l.qtd <= 1) return d.p1 * l.qtd;
        const linha = d.escada.linhas.find((x) => x.n === l.qtd);
        if (linha?.sugerido > 0) return linha.sugerido;
        return d.p1 * l.qtd;
      }
    }
    const p = precoPorMarkup(l.custo, markupDoCanal(canalVarejo, item?.produtoId ? cfgDoProduto(item.produtoId) : cfgL));
    return (p || 0) * l.qtd;
  }

  const totalPct = (n(imposto) + n(custosFixos)) / 100;
  const opts = { margemMin: cfgL.margemMin, totalPct, lucroMinPeca: cfgA.lucroMinPeca };
  const orc = orcarPedido({ linhas, cfgA, totalPct, margemMin: cfgL.margemMin, pers: persEf, frete: n(freteLote), varejoDe });
  const prox = orc ? proximaFaixa(orc.pecas, cfgA) : null;
  const proxPreco = prox ? precoMedioNaFaixa(linhas, prox, opts) : null;
  const umItem = linhas.length === 1;

  async function salvar() {
    const nome = nomePedido.trim();
    if (!nome) return onToast?.("Dê um nome ao pedido antes de salvar");
    if (!supabase) return onToast?.("Histórico indisponível (Supabase não configurado)");
    if (!orc) return onToast?.("Adicione pelo menos um item antes de salvar");
    setSalvando(true);
    const base = {
      nome,
      quantidade: Math.round(orc.pecas) || 1,
      custo_total: arredondarPreco(orc.custo + orc.frete),
      preco: arredondarPreco(orc.total),
      lucro: arredondarPreco(orc.lucro),
      margem: orc.margem,
      ...(lojaId ? { loja_id: lojaId } : {}),
    };
    const extra = { personalizacao: orc.personalizacao, arte: orc.arte, frete: orc.frete, valor_pecas: orc.valorPecas };
    let { error } = await supabase.from("orcamentos_avulsos").insert({ ...base, ...extra });
    let semColunas = false;
    if (error && /personalizacao|arte|valor_pecas|frete|column/i.test(error.message || "")) {
      semColunas = true;
      ({ error } = await supabase.from("orcamentos_avulsos").insert(base));
    }
    setSalvando(false);
    if (error) return onToast?.("Não foi possível salvar agora — tente de novo");
    onToast?.(semColunas ? "Salvo (sem o detalhe da personalização — rode o SQL v43)" : "Orçamento salvo em Orçamentos salvos");
    setNomePedido("");
  }

  // ---- Regras da loja (faixas + padrões de personalização)
  function abrirRegras() {
    setRegras({
      faixas: cfgA.faixas.map((f) => ({ min: String(f.min), mult: virgula(f.mult) })),
      lucroMinPeca: virgula(cfgA.lucroMinPeca),
      arte: virgula(cfgA.arte),
      porPeca: virgula(cfgA.porPeca),
      isentarArte: cfgA.isentarArte,
      isentarArteMin: String(cfgA.isentarArteMin),
    });
  }
  const numTxt = (t) => Number(String(t ?? "").trim().replace(",", "."));
  async function salvarRegras() {
    const faixas = regras.faixas.map((f) => ({ min: Math.round(numTxt(f.min)), mult: numTxt(f.mult) })).filter((f) => f.min > 0 && f.mult > 0);
    if (!faixas.length) return onToast?.("Informe ao menos uma faixa (a partir de N un. e o multiplicador)");
    const atacado = {
      faixas: faixas.sort((a, b) => a.min - b.min),
      lucroMinPeca: Math.max(0, numTxt(regras.lucroMinPeca) || 0),
      arte: Math.max(0, numTxt(regras.arte) || 0),
      porPeca: Math.max(0, numTxt(regras.porPeca) || 0),
      isentarArte: !!regras.isentarArte,
      isentarArteMin: Math.max(1, Math.round(numTxt(regras.isentarArteMin) || 100)),
    };
    const r = await atualizar(lojaId, { configEscada: { ...(cfgLoja || {}), atacado } });
    if (!r.ok) return onToast?.(/config_escada|column/i.test(r.error || "") ? "Rode o SQL v27 no Supabase pra salvar as regras" : `Não foi possível salvar: ${r.error}`);
    setRegras(null);
    onToast?.("Faixas de atacado salvas pra loja");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Encomenda em volume</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  function limparTudo() {
    setItensLote([]);
    setFreteLote(PADROES.freteLote);
    setImposto(PADROES.imposto);
    setCustosFixos(PADROES.custosFixos);
    setPers({ ativa: false, porPeca: null, arte: null, isentarArte: null, isentarArteMin: null });
  }

  const textoFaixas = cfgA.faixas.map((f) => `${rotuloFaixa(f, cfgA)} = ${virgula(f.mult)}×`).join(" · ");

  return (
    <>
      <TopbarAcoes aba="orcamento">
        <button type="button" className="btn" onClick={limparTudo}>
          Limpar
        </button>
      </TopbarAcoes>
      <div className="grid2">
        <div>
          <div className="panel">
            <h3 className="section-title">
              <span>
                Produtos e quantidades
                <Ajuda texto="Pedido direto (fora do marketplace). A faixa de atacado vale pelo TOTAL de peças do pedido: preço por peça = custo × multiplicador da faixa, nunca abaixo do mínimo aceitável por peça (margem mínima da loja). Abaixo da 1ª faixa vale o varejo direto — o mesmo preço do canal próprio por markup (Configuração → Canais). O frete do pedido é repassado ao cliente (entra no total, não no lucro)." />
              </span>
            </h3>
            {catalogoProdutos.length === 0 ? (
              <div className="empty">Cadastre um produto em Cadastros → Produtos primeiro.</div>
            ) : (
              <SeletorItens catalogo={catalogoProdutos} itens={itensLote} onChange={setItensLote} rotuloVazio="Cadastre um produto em Cadastros → Produtos primeiro." />
            )}
            <div className="row3" style={{ marginTop: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Frete do pedido (R$)</label>
                <input type="number" step="0.01" min="0" value={freteLote} onChange={(e) => setFreteLote(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Imposto (%)</label>
                <input type="number" step="0.1" value={imposto} onChange={(e) => setImposto(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Custos fixos (%)</label>
                <input type="number" step="0.1" value={custosFixos} onChange={(e) => setCustosFixos(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 className="section-title">
              <span>
                Personalização
                <Ajuda texto="Arte/preparação é cobrada uma vez por pedido; o adicional é por peça (deixe 0 quando a personalização não aumenta o tempo). Dá pra isentar a arte a partir de N peças. Os padrões vêm das regras da loja (abaixo) e podem ser mudados só neste orçamento." />
              </span>
            </h3>
            <label className="check-inline">
              <input type="checkbox" checked={pers.ativa} onChange={(e) => setPers((x) => ({ ...x, ativa: e.target.checked }))} /> Pedido personalizado
            </label>
            {pers.ativa && (
              <div className="row3" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Adicional por peça (R$)</label>
                  <input type="number" min="0" step="0.05" value={persEf.porPeca} onChange={(e) => setPers((x) => ({ ...x, porPeca: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Arte / preparação (R$)</label>
                  <input type="number" min="0" step="1" value={persEf.arte} onChange={(e) => setPers((x) => ({ ...x, arte: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="check-inline" style={{ marginBottom: 4 }}>
                    <input type="checkbox" checked={!!persEf.isentarArte} onChange={(e) => setPers((x) => ({ ...x, isentarArte: e.target.checked }))} /> Isentar arte a partir de
                  </label>
                  <input type="number" min="1" step="1" value={persEf.isentarArteMin} disabled={!persEf.isentarArte} onChange={(e) => setPers((x) => ({ ...x, isentarArteMin: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h3 className="section-title">
              <span>
                Regras do atacado (loja)
                <Ajuda texto="Faixas pelo total de peças do pedido e o multiplicador sobre o custo por peça. Lucro mínimo por peça é uma trava extra (0 = só a margem mínima da loja). Também os padrões de personalização. Vale pra loja toda (lojas.config_escada.atacado)." />
              </span>
              {!regras && (
                <button type="button" className="btn btn-sm" onClick={abrirRegras}>
                  ⚙ Editar
                </button>
              )}
            </h3>
            {!regras ? (
              <div className="hint" style={{ margin: 0 }}>
                {textoFaixas} sobre o custo por peça · abaixo de {cfgA.faixas[0].min} un. = varejo direto ({canalVarejo.id === "__direto" ? `markup ${virgula(MARKUP_PADRAO)}× — ligue o modo markup no canal próprio em Configuração → Canais` : `${canalVarejo.nome}, markup ${virgula(markupDoCanal(canalVarejo, cfgL))}×`}) · personalização: arte {BRL(cfgA.arte)} + {BRL(cfgA.porPeca)}/peça
                {cfgA.isentarArte ? ` (arte isenta a partir de ${cfgA.isentarArteMin} un.)` : ""}
              </div>
            ) : (
              <>
                <div className="grid-auto">
                  {regras.faixas.map((f, i) => (
                    <div className="field" key={i}>
                      <label>Faixa {i + 1}: a partir de (un.) · ×</label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input type="text" inputMode="numeric" value={f.min} onChange={(e) => setRegras((r) => ({ ...r, faixas: r.faixas.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)) }))} />
                        <input type="text" inputMode="decimal" value={f.mult} onChange={(e) => setRegras((r) => ({ ...r, faixas: r.faixas.map((x, k) => (k === i ? { ...x, mult: e.target.value } : x)) }))} />
                        <button type="button" className="del" title="Tirar faixa" onClick={() => setRegras((r) => ({ ...r, faixas: r.faixas.filter((_, k) => k !== i) }))}>
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="field">
                    <label>Lucro mínimo por peça (R$)</label>
                    <input type="text" inputMode="decimal" value={regras.lucroMinPeca} onChange={(e) => setRegras((r) => ({ ...r, lucroMinPeca: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Arte / preparação padrão (R$)</label>
                    <input type="text" inputMode="decimal" value={regras.arte} onChange={(e) => setRegras((r) => ({ ...r, arte: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Adicional por peça padrão (R$)</label>
                    <input type="text" inputMode="decimal" value={regras.porPeca} onChange={(e) => setRegras((r) => ({ ...r, porPeca: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="check-inline" style={{ marginBottom: 4 }}>
                      <input type="checkbox" checked={regras.isentarArte} onChange={(e) => setRegras((r) => ({ ...r, isentarArte: e.target.checked }))} /> Isentar arte a partir de (un.)
                    </label>
                    <input type="text" inputMode="numeric" value={regras.isentarArteMin} disabled={!regras.isentarArte} onChange={(e) => setRegras((r) => ({ ...r, isentarArteMin: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                  <button type="button" className="link-btn" onClick={() => setRegras((r) => ({ ...r, faixas: [...r.faixas, { min: "", mult: "" }] }))}>
                    + faixa
                  </button>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="link-btn" onClick={() => setRegras({ ...regras, faixas: ATACADO_PADRAO.faixas.map((f) => ({ min: String(f.min), mult: virgula(f.mult) })) })}>
                      voltar ao padrão
                    </button>
                    <button type="button" className="btn" onClick={() => setRegras(null)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn primary" onClick={salvarRegras}>
                      Salvar regras
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <h3 className="section-title">Preço deste pedido</h3>
            {!orc ? (
              <div className="empty">Adicione pelo menos um item acima.</div>
            ) : (
              <>
                <div className="kv">
                  <span className="k">Faixa</span>
                  <span className="v">{orc.faixa ? `${rotuloFaixa(orc.faixa, cfgA)} · ${virgula(orc.faixa.mult)}× o custo` : `varejo direto (abaixo de ${cfgA.faixas[0].min} un.)`}</span>
                </div>
                {orc.linhas.map((l) => (
                  <div className="kv" key={l.id}>
                    <span className="k">
                      {l.nome} · {l.qtd} × {BRL(l.precoPeca)}
                      {l.travado && <span className="sub-num-inline"> · no mínimo por peça</span>}
                    </span>
                    <span className="v">{BRL(l.subtotal)}</span>
                  </div>
                ))}
                <div className="kv"><span className="k">Peças ({orc.pecas})</span><span className="v">{BRL(orc.valorPecas)}</span></div>
                {pers.ativa && <div className="kv"><span className="k">Personalização ({orc.pecas} × {BRL(n(persEf.porPeca))})</span><span className="v">{BRL(orc.personalizacao)}</span></div>}
                {pers.ativa && <div className="kv"><span className="k">Arte / preparação{orc.arteIsenta ? " (isenta)" : ""}</span><span className="v">{BRL(orc.arte)}</span></div>}
                {orc.frete > 0 && <div className="kv"><span className="k">Frete (repassado)</span><span className="v">{BRL(orc.frete)}</span></div>}
                <div className="kv total"><span className="k">Total do pedido</span><span className="v">{BRL(orc.total)}</span></div>
                <div className="kv"><span className="k">Lucro</span><span className="v">{BRL(orc.lucro)} · {PCT(orc.margem)}</span></div>
                {prox && proxPreco != null && (
                  <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                    Com {prox.min} un.{umItem ? "" : " no pedido"} cai pra {BRL(proxPreco)} {umItem ? "cada" : "por peça (média)"} ({virgula(prox.mult)}× o custo).
                  </div>
                )}
              </>
            )}
          </div>

          {orc && (
            <div className="panel">
              <h3 className="section-title">Salvar em Orçamentos</h3>
              <div className="save-row">
                <div className="field">
                  <label>Nome do pedido</label>
                  <input
                    type="text"
                    placeholder={`ex: Encomenda ${Math.round(orc.pecas) || 1} peças`}
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
                Salva o TOTAL do pedido de {Math.round(orc.pecas) || 1} peças (peças · personalização · arte · frete separados).
              </div>
            </div>
          )}

          {orc && (
            <div className="panel">
              <h3 className="section-title">Tabela de atacado</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Faixa</th>
                      <th className="num">× custo</th>
                      <th className="num">{umItem ? "Preço por peça" : "Preço médio por peça"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={!orc.faixa ? "linha-atual" : ""}>
                      <td>1–{cfgA.faixas[0].min - 1} un. (varejo direto){!orc.faixa ? " · atual" : ""}</td>
                      <td className="num">markup</td>
                      <td className="num">{umItem ? BRL(precoPorMarkup(linhas[0].custo, markupDoCanal(canalVarejo, cfgL)) || 0) : "—"}</td>
                    </tr>
                    {cfgA.faixas.map((f) => (
                      <tr key={f.min} className={orc.faixa === f ? "linha-atual" : ""}>
                        <td>
                          {rotuloFaixa(f, cfgA)}
                          {orc.faixa === f ? " · atual" : ""}
                        </td>
                        <td className="num">{virgula(f.mult)}×</td>
                        <td className="num">{BRL(precoMedioNaFaixa(linhas, f, opts) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
