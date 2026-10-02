import Portal from "./Portal.jsx";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL, arredondarPreco } from "../lib/format.js";
import { calcVariacao, catalogoEmbalagens, formatarPeso, resumoProduto } from "../lib/variacoes.js";
import SeletorItens from "./SeletorItens.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Ajuda from "./Ajuda.jsx";
import ImpactoCusto from "./ImpactoCusto.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { impactoVariacao } from "../lib/impactoCusto.js";

// Seção "Variações de quantidade" do cadastro de produto + tela suspensa de
// edição de cada variação. A variação herda tudo do produto (passado em
// `produto`, já com os valores do formulário, ao vivo) e só grava o que foi
// personalizado. Salvar/excluir uma variação vale na hora — não depende do
// "Salvar alterações" do produto, e nunca mexe no produto pai.

const MODOS = [
  { key: "multiplicar", label: "Produto × quantidade" },
  { key: "chapa", label: "Só mudar peças/chapa" },
  { key: "fatiador", label: "Dados do fatiador próprios" },
];

function formDaVariacao(v, produto) {
  return {
    id: v?.id || null,
    quantidade: String(v?.quantidade ?? 2),
    nome: v?.nome ?? "",
    sku: v?.sku ?? "",
    producao_modo: v?.producao_modo || "multiplicar",
    pecas_por_chapa: v?.pecas_por_chapa != null ? String(v.pecas_por_chapa) : "",
    fat_comprimento: v?.producao_detalhe?.comprimento != null ? String(v.producao_detalhe.comprimento) : "",
    fat_tempo: v?.producao_detalhe?.tempo != null ? String(v.producao_detalhe.tempo) : "",
    fat_pecas: v?.producao_detalhe?.pecas != null ? String(v.producao_detalhe.pecas) : String(v?.quantidade ?? 2),
    fat_material: v?.producao_detalhe?.materialNome || produto?.producao_detalhe?.materialNome || "",
    embalagem_itens: Array.isArray(v?.embalagem_itens) ? v.embalagem_itens : null,
    frete: v?.frete != null ? String(v.frete) : "",
    peso_real_g: v?.peso_real_g != null ? String(v.peso_real_g) : "",
    ajuste: v?.ajuste ? String(v.ajuste) : "",
    observacao: v?.observacao || "",
  };
}

// Form → linha do banco (o que fica null é herdado do produto).
function registroDoForm(f, { lojaId, produtoId }) {
  const numOuNull = (v) => (v === "" || v == null || !isFinite(Number(String(v).replace(",", "."))) ? null : Number(String(v).replace(",", ".")));
  const qtd = Math.max(1, parseInt(f.quantidade, 10) || 1);
  return {
    loja_id: lojaId || null,
    produto_id: produtoId,
    quantidade: qtd,
    nome: f.nome.trim() || `Kit ${qtd} unidades`,
    sku: f.sku.trim() || null,
    producao_modo: f.producao_modo,
    pecas_por_chapa: f.producao_modo === "chapa" ? numOuNull(f.pecas_por_chapa) : null,
    producao_detalhe:
      f.producao_modo === "fatiador"
        ? { comprimento: numOuNull(f.fat_comprimento) ?? 0, tempo: numOuNull(f.fat_tempo) ?? 0, pecas: numOuNull(f.fat_pecas) ?? qtd, materialNome: f.fat_material || null }
        : null,
    embalagem_itens: f.embalagem_itens ? f.embalagem_itens.filter((it) => it.itemId) : null,
    frete: numOuNull(f.frete),
    peso_real_g: numOuNull(f.peso_real_g),
    ajuste: numOuNull(f.ajuste) ?? 0,
    observacao: f.observacao.trim() || null,
    atualizado_em: new Date().toISOString(),
  };
}

export default function VariacoesProduto({ produto, produtoEmbalagens, embalagens, materiais, onToast }) {
  const [variacoes, setVariacoes] = useState([]);
  const [indisponivel, setIndisponivel] = useState(false);
  const [form, setForm] = useState(null);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const produtoId = produto?.id;

  useEffect(() => {
    if (!supabase || !produtoId) return;
    let ativo = true;
    async function carregar() {
      const { data, error } = await supabase.from("produto_variacoes").select("*").eq("produto_id", produtoId).order("quantidade");
      if (!ativo) return;
      if (error) setIndisponivel(true);
      else {
        setIndisponivel(false);
        setVariacoes(data || []);
      }
    }
    carregar();
    const ch = supabase
      .channel(`variacoes-produto-${produtoId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "produto_variacoes" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [produtoId]);

  const ctx = { materiais, embalagens, produtoEmbalagens };
  const pai = useMemo(() => (produto ? resumoProduto(produto, { embalagens, produtoEmbalagens }) : null), [produto, embalagens, produtoEmbalagens]);


  if (!produto) return null;

  function abrirNova() {
    const proxima = Math.max(1, ...variacoes.map((v) => v.quantidade)) + 1;
    setForm({ ...formDaVariacao(null, produto), quantidade: String(proxima), fat_pecas: String(proxima), nome: `Kit ${proxima} unidades`, sku: produto.sku ? `${produto.sku}-${proxima}` : "" });
  }

  async function excluir(v) {
    const { error } = await supabase.from("produto_variacoes").delete().eq("id", v.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    // Preço salvo por canal da variação não tem FK — limpa na mão.
    await supabase.from("precos_canal").delete().eq("item_tipo", "variacao").eq("item_id", v.id);
    await supabase.from("precos_concorrente").delete().eq("item_tipo", "variacao").eq("item_id", v.id);
    await supabase.from("publicacoes_olist").delete().eq("item_tipo", "variacao").eq("item_id", v.id);
    await supabase.from("publicacoes_canal").delete().eq("item_tipo", "variacao").eq("item_id", v.id);
    setVariacoes((prev) => prev.filter((x) => x.id !== v.id));
    onToast?.("Variação excluída");
  }

  return (
    <>
      <h3 className="section-title">
        Variações de quantidade
        <Ajuda texto="Jeitos de vender o mesmo produto em quantidade (kit 2, kit 3…) sem cadastrar outro produto. Cada variação herda tudo do produto e você personaliza só o que muda — produção (ex.: imprimir as 3 juntas na mesma chapa), embalagem, frete e peso — em ✎ Editar. O produto pai não é alterado, e o que não foi personalizado acompanha o produto sozinho. Cada variação ganha preço próprio por canal em Precificação por Canal." />
        <span style={{ flex: 1 }} />
        {!indisponivel && (
          <button type="button" className="btn btn-mini" onClick={abrirNova}>
            + Adicionar variação
          </button>
        )}
      </h3>
      {indisponivel ? (
        <div className="hint">Pra usar variações, rode o <strong>supabase/schema_v26.sql</strong> no SQL Editor do Supabase e recarregue a página.</div>
      ) : variacoes.length === 0 ? (
        <div className="hint">Nenhuma variação ainda. Vende esse produto em kits de 2, 3, 5…? Use “+ Adicionar variação”.</div>
      ) : (
        <div className="table-wrap tabela-variacoes">
          <table>
            <thead>
              <tr>
                <th>Variação</th>
                <th>SKU</th>
                <th>Personalizado</th>
                <th className="num">Custo total</th>
                <th className="num">Por un.</th>
                <th className="num">Peso envio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr className="linha-variacao">
                <td>
                  <strong style={{ fontWeight: 600 }}>1 unidade</strong> <span className="chip-herdado">produto</span>
                </td>
                <td className="muted-cel">{produto.sku || "—"}</td>
                <td className="muted-cel">—</td>
                <td className="num">{BRL(pai.producao + pai.embalagem + pai.frete)}</td>
                <td className="num muted-cel">{BRL(pai.producao + pai.embalagem + pai.frete)}</td>
                <td className="num">{formatarPeso(pai.peso)}</td>
                <td></td>
              </tr>
              {variacoes.map((v) => {
                const c = calcVariacao(v, produto, ctx);
                const marcas = [
                  c.personalizado.producao && (c.modoEfetivo === "fatiador" ? "fatiador próprio" : `chapa de ${v.pecas_por_chapa}`),
                  c.personalizado.embalagem && "embalagem",
                  c.personalizado.frete && "frete",
                  c.personalizado.peso && "peso",
                  c.personalizado.ajuste && "ajuste",
                ].filter(Boolean);
                return (
                  <tr key={v.id}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{v.nome}</strong>
                      <div className="sub-num">{c.quantidade} un.</div>
                    </td>
                    <td className="muted-cel">{v.sku || "—"}</td>
                    <td>
                      {marcas.length ? (
                        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                          {marcas.map((m) => (
                            <span key={m} className="chip-personalizado">{m}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted-cel">nada — tudo do produto</span>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{BRL(c.custoTotal)}</td>
                    <td className="num muted-cel">{BRL(c.porUnidade)}</td>
                    <td className="num">
                      {formatarPeso(c.peso)}
                      {c.pesoReal != null && <div className="sub-num">balança</div>}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-mini" onClick={() => setForm(formDaVariacao(v, produto))}>
                        ✎ Editar
                      </button>
                      <button type="button" className="del" title="Excluir variação" onClick={() => setExcluirAlvo(v)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <EditorVariacao
          formInicial={form}
          produto={produto}
          produtoEmbalagens={produtoEmbalagens}
          embalagens={embalagens}
          materiais={materiais}
          onToast={onToast}
          onClose={() => setForm(null)}
        />
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir variação"
          mensagem={`Excluir "${excluirAlvo.nome}"? Os preços salvos dela em Produtos precificados também saem. O produto não é afetado.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </>
  );
}

// Tela suspensa de edição/criação de UMA variação — usada no cadastro do
// produto e também no 2º Por quantidade (logo depois de "Criar variação",
// pra revisar embalagem/produção/peso sem trocar de tela). `formInicial` vem
// de formDaVariacao (ou passe `variacao`, a linha do banco) e `produto` é o pai (ao vivo).
export function EditorVariacao({ formInicial, variacao, produto, produtoEmbalagens, embalagens, materiais, onToast, onClose, titulo }) {
  const { lojaId } = useLoja();
  const [form, setForm] = useState(() => formInicial || formDaVariacao(variacao, produto));
  const [salvando, setSalvando] = useState(false);
  const produtoId = produto?.id;
  const ctx = { materiais, embalagens, produtoEmbalagens };
  const dadosVivos = useEscada();
  const impacto = useMemo(
    () => (form?.id ? impactoVariacao({ variacaoId: form.id, variacaoNova: registroDoForm(form, { lojaId, produtoId }), dados: dadosVivos, cfgDoProduto: dadosVivos.cfgDoProduto }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, dadosVivos.itens, dadosVivos.precos, dadosVivos.canais]
  );
  const pai = useMemo(() => (produto ? resumoProduto(produto, { embalagens, produtoEmbalagens }) : null), [produto, embalagens, produtoEmbalagens]);
  const filamentos = (materiais || []).filter((m) => (m.tipo || "filamento") === "filamento");
  const catalogoEmb = catalogoEmbalagens(embalagens);
  const previa = useMemo(() => {
    if (!form || !produto) return null;
    return calcVariacao(registroDoForm(form, { lojaId, produtoId }), produto, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, produto, materiais, embalagens, produtoEmbalagens]);
  if (!form || !previa || !pai) return null;
  const setForm0 = setForm;
  const set = (k) => (e) => setForm0((p) => ({ ...p, [k]: e.target.value }));
  const chip = (personalizado) =>
    personalizado ? <span className="chip-personalizado">personalizado</span> : <span className="chip-herdado">do produto</span>;
  async function salvar() {
    const registro = registroDoForm(form, { lojaId, produtoId });
    setSalvando(true);
    const { error } = form.id
      ? await supabase.from("produto_variacoes").update(registro).eq("id", form.id)
      : await supabase.from("produto_variacoes").insert(registro);
    setSalvando(false);
    if (error) return onToast?.(`Não foi possível salvar a variação: ${error.message}`);
    onToast?.(
      form.id
        ? impacto?.relevante && impacto.linhas.length
          ? `Variação atualizada · lucro ${impacto.linhas[0].diferenca >= 0 ? "+" : "−"}${BRL(Math.abs(impacto.linhas.reduce((s, l) => s + l.diferenca, 0) / impacto.linhas.length))}/venda`
          : "Variação atualizada"
        : "Variação criada"
    );
    onClose();
  }
  const setFormFechar = (v) => (v === null ? onClose() : setForm(v));
  return (
        <Portal>
        <div className="modal-overlay modal-overlay-topo" onClick={() => !salvando && setFormFechar(null)}>
          <div className="modal-box modal-variacao" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="mv-head">
              <div style={{ minWidth: 0 }}>
                <div className="topbar-crumb">{produto.nome} · variação</div>
                <h3 style={{ margin: 0 }}>{titulo || (form.id ? `Editar variação — ${form.nome || "sem nome"}` : "Nova variação")}</h3>
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={() => setFormFechar(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="button" className="btn primary" onClick={salvar} disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar variação"}
              </button>
            </div>
            {impacto?.relevante && (
              <div className="mv-impacto">
                <ImpactoCusto impacto={impacto} titulo="Impacto desta mudança na variação" />
              </div>
            )}
            <div className="mv-body">
              <div className="mv-form">
                <div className="mv-sec">
                  <div className="mv-sech">Identificação</div>
                  <div className="row3">
                    <div className="field">
                      <label>Quantidade</label>
                      <input type="number" min="1" step="1" value={form.quantidade} onChange={set("quantidade")} />
                    </div>
                    <div className="field">
                      <label>Nome de exibição</label>
                      <input type="text" value={form.nome} placeholder={`Kit ${form.quantidade || 2} unidades`} onChange={set("nome")} />
                    </div>
                    <div className="field">
                      <label>SKU</label>
                      <input type="text" value={form.sku} onChange={set("sku")} />
                    </div>
                  </div>
                </div>

                <div className="mv-sec">
                  <div className="mv-sech">
                    Produção {chip(form.producao_modo !== "multiplicar")}
                    <span style={{ flex: 1 }} />
                    {form.producao_modo !== "multiplicar" && (
                      <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setForm((p) => ({ ...p, producao_modo: "multiplicar" }))}>
                        voltar ao do produto
                      </button>
                    )}
                  </div>
                  <div className="subabas" style={{ marginBottom: 12 }}>
                    {MODOS.map((m) => (
                      <button key={m.key} type="button" className={`btn${form.producao_modo === m.key ? " primary" : ""}`} onClick={() => setForm((p) => ({ ...p, producao_modo: m.key }))}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {form.producao_modo === "multiplicar" && (
                    <div className="hint">
                      Custo por peça do produto ({BRL(pai.producao)}) × {previa.quantidade} = <strong style={{ color: "var(--ink)" }}>{BRL(previa.producao)}</strong>.
                    </div>
                  )}
                  {form.producao_modo === "chapa" && (
                    <>
                      <div className="row3">
                        <div className="field">
                          <label>Peças por chapa</label>
                          <input type="number" min="1" step="1" value={form.pecas_por_chapa} placeholder={String(produto.pecas_por_impressao || 1)} onChange={set("pecas_por_chapa")} />
                        </div>
                      </div>
                      <div className="hint">
                        {produto.producao_detalhe
                          ? previa.modoEfetivo === "chapa"
                            ? <>Recalculado com o detalhamento do produto: <strong style={{ color: "var(--ink)" }}>{BRL(previa.porPeca)} por peça</strong> (no produto: {BRL(pai.producao)}).</>
                            : "Informe quantas peças vão na chapa."
                          : "Esse produto não tem detalhamento de produção salvo — sem ele não dá pra recalcular a chapa; fica produto × quantidade."}
                      </div>
                    </>
                  )}
                  {form.producao_modo === "fatiador" && (
                    <>
                      <div className="grid-auto">
                        <div className="field">
                          <label>Filamento da chapa (m)</label>
                          <input type="number" step="0.01" value={form.fat_comprimento} onChange={set("fat_comprimento")} />
                        </div>
                        <div className="field">
                          <label>Tempo da chapa (min)</label>
                          <input type="number" step="1" value={form.fat_tempo} onChange={set("fat_tempo")} />
                        </div>
                        <div className="field">
                          <label>Peças na chapa</label>
                          <input type="number" min="1" step="1" value={form.fat_pecas} onChange={set("fat_pecas")} />
                        </div>
                        <div className="field">
                          <label>Filamento</label>
                          <select value={form.fat_material} onChange={set("fat_material")}>
                            {filamentos.map((m) => (
                              <option key={m.id} value={m.nome}>{m.nome}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="hint">
                        Energia, manutenção, falhas, acabamento e ROI da máquina seguem os mesmos % do produto
                        {produto.producao_detalhe ? "" : " (o produto não tem detalhamento salvo — usando os valores padrão do app)"}. Resultado:{" "}
                        <strong style={{ color: "var(--ink)" }}>{BRL(previa.porPeca)} por peça</strong> (no produto: {BRL(pai.producao)}).
                      </div>
                    </>
                  )}
                </div>

                <div className="mv-sec">
                  <div className="mv-sech">
                    Embalagem {chip(!!form.embalagem_itens)}
                    <span style={{ flex: 1 }} />
                    {form.embalagem_itens ? (
                      <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setForm((p) => ({ ...p, embalagem_itens: null }))}>
                        voltar ao do produto
                      </button>
                    ) : (
                      <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setForm((p) => ({ ...p, embalagem_itens: pai.embalagemItens.map((it) => ({ ...it })) }))}>
                        personalizar
                      </button>
                    )}
                  </div>
                  {form.embalagem_itens ? (
                    <SeletorItens
                      catalogo={catalogoEmb}
                      itens={form.embalagem_itens}
                      onChange={(itens) => setForm((p) => ({ ...p, embalagem_itens: itens }))}
                      rotuloVazio="Nenhuma embalagem cadastrada — cadastre em Cadastros → Embalagens."
                    />
                  ) : (
                    <div className="hint">
                      Igual à do produto (não multiplica): {pai.embalagemItens.length
                        ? pai.embalagemItens
                            .map((it) => `${it.quantidade}× ${catalogoEmb.find((c) => c.id === it.itemId)?.nome || "item"}`)
                            .join(", ")
                        : "valor manual"}{" "}
                      — {BRL(pai.embalagem)}. Clique em “personalizar” pra trocar a caixa ou mudar quantidades.
                    </div>
                  )}
                </div>

                <div className="mv-sec">
                  <div className="mv-sech">Frete e peso</div>
                  <div className="row3">
                    <div className="field">
                      <label>
                        Frete extra (R$) {chip(form.frete !== "")}
                      </label>
                      <input type="number" step="0.01" value={form.frete} placeholder={String(arredondarPreco(pai.frete))} onChange={set("frete")} />
                    </div>
                    <div className="field">
                      <label>Peso calculado</label>
                      <input type="text" value={formatarPeso(previa.pesoCalculado)} disabled />
                    </div>
                    <div className="field">
                      <label>
                        Peso real na balança (g) {form.peso_real_g !== "" && <span className="chip-personalizado">personalizado</span>}
                      </label>
                      <input type="number" step="1" value={form.peso_real_g} placeholder="usa o calculado" onChange={set("peso_real_g")} />
                    </div>
                  </div>
                  <div className="hint">
                    Peso calculado = {previa.quantidade} × {formatarPeso(pai.pesoPeca)} (peça) + {formatarPeso(previa.pesoCalculado - pai.pesoPeca * previa.quantidade)} (embalagem).
                    {!pai.pesoPeca && " Cadastre o peso da peça no produto pra esse cálculo funcionar."}
                  </div>
                </div>

                <div className="mv-sec" style={{ borderBottom: "none" }}>
                  <div className="mv-sech">Extras (opcional)</div>
                  <div className="row3">
                    <div className="field">
                      <label>Ajuste avulso (± R$)</label>
                      <input type="number" step="0.01" value={form.ajuste} placeholder="0,00" onChange={set("ajuste")} />
                    </div>
                    <div className="field" style={{ gridColumn: "span 2" }}>
                      <label>Observação</label>
                      <input type="text" value={form.observacao} placeholder="ex: vai com cartão de agradecimento" onChange={set("observacao")} />
                    </div>
                  </div>
                </div>
              </div>

              <aside className="mv-resumo">
                <div className="mv-sech">Resumo da variação</div>
                <div className="kv"><span className="k">Produção ({previa.quantidade} peças)</span><span className="v">{BRL(previa.producao)}</span></div>
                <div className="kv"><span className="k">Embalagem</span><span className="v">{BRL(previa.embalagem)}</span></div>
                <div className="kv"><span className="k">Frete extra</span><span className="v">{BRL(previa.frete)}</span></div>
                <div className="kv"><span className="k">Ajuste</span><span className="v">{previa.ajuste ? BRL(previa.ajuste) : "—"}</span></div>
                <div className="kv total"><span className="k">Custo total</span><span className="v">{BRL(previa.custoTotal)}</span></div>
                <div className="kv"><span className="k">Por unidade</span><span className="v">{BRL(previa.porUnidade)}</span></div>
                <div className="kv"><span className="k">Peso de envio</span><span className="v">{formatarPeso(previa.peso)}</span></div>
                <div className="mv-cmp">
                  <div className="mv-sech" style={{ marginBottom: 4 }}>Comparado a {previa.quantidade}× o produto</div>
                  <div className="kv"><span className="k">Produto × {previa.quantidade} (embalagem 1×)</span><span className="v">{BRL(previa.referencia)}</span></div>
                  <div className="kv">
                    <span className="k">Diferença</span>
                    <span className="v" style={{ color: previa.diferenca <= 0 ? "var(--good)" : "var(--bad)" }}>
                      {previa.diferenca > 0 ? "+ " : previa.diferenca < 0 ? "− " : ""}
                      {BRL(Math.abs(previa.diferenca))}
                    </span>
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>O produto pai ({produto.nome}) não é alterado.</div>
              </aside>
            </div>
          </div>
        </div>
        </Portal>
  );
}
