import { useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { normalizarTexto } from "../lib/texto.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { TIPOS } from "../lib/promocaoTipos.js";
import { useRankingData } from "../hooks/useRankingData.js";
import CanalTag from "./CanalTag.jsx";
import { tipoDoNome } from "../lib/canais.js";

function labelTipo(tipo) {
  return TIPOS.find((t) => t.key === tipo)?.label || tipo || "—";
}

// Lista das promoções salvas em "Promoções → Simular promoção" — mesmo
// padrão de Orçamentos salvos, só que cada linha guarda também o tipo de
// promoção e um resumo em texto da configuração usada (desconto %, leve/pague,
// tiers do progressivo…), já que cada tipo calcula de um jeito diferente e
// nem sempre tem um preço único (ex: Progressivo). Sem tabela de "campanhas"
// separada — promoções com o mesmo nome (comparado sem acento/maiúscula/
// espaço extra) são agrupadas aqui na hora de exibir, é só isso que define
// "a mesma promoção" pra efeito de agrupar/buscar.
export default function PromocoesSalvas({ onToast }) {
  const { lojaId } = useLoja();
  const [promocoes, setPromocoes] = useState([]);
  const [carregando, setCarregando] = useState(!!supabase);
  const [busca, setBusca] = useState("");
  const [editAlvo, setEditAlvo] = useState(null); // linha inteira sendo editada
  const [modoEdicaoSimples, setModoEdicaoSimples] = useState(false);
  const [edicao, setEdicao] = useState({ nome: "", preco: "", lucro: "", resumo: "", descontoPct: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [abertos, setAbertos] = useState(() => new Set()); // promoções abertas (chave normalizada)
  const [abrirTodas, setAbrirTodas] = useState(false);
  const [variacoesAbertas, setVariacoesAbertas] = useState(() => new Set()); // "promo|produto"
  // Nomes dos produtos cadastrados — a promoção salva guarda o item só como
  // texto ("Produto — Kit 3 unidades"), então é pelo nome que uma variação
  // é encaixada embaixo do produto dela.
  const { produtos: produtosCatalogo } = useRankingData();

  useEffect(() => {
    if (!supabase) return;

    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("promocoes_salvas").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setPromocoes(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("promocoes-salvas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "promocoes_salvas" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Busca por nome da promoção, do produto/kit ou do canal — filtra a lista
  // toda antes de agrupar, então buscar "Black Friday" ou buscar o nome de
  // um produto específico dão no mesmo resultado esperado.
  const promocoesFiltradas = useMemo(() => {
    const alvo = normalizarTexto(busca);
    if (!alvo) return promocoes;
    return promocoes.filter(
      (p) =>
        normalizarTexto(p.nome).includes(alvo) ||
        normalizarTexto(p.item_nome).includes(alvo) ||
        normalizarTexto(p.canal_nome).includes(alvo)
    );
  }, [promocoes, busca]);

  // Agrupa por nome normalizado — a lista já vem ordenada por criado_em
  // desc, então a primeira vez que um nome aparece já é a linha mais
  // recente daquele grupo, e os grupos saem naturalmente ordenados do mais
  // recente pro mais antigo sem precisar reordenar de novo.
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const p of promocoesFiltradas) {
      const nome = p.nome || "—";
      const chave = normalizarTexto(nome);
      if (!mapa.has(chave)) mapa.set(chave, { chave, nome, itens: [] });
      mapa.get(chave).itens.push(p);
    }
    return [...mapa.values()];
  }, [promocoesFiltradas]);

  // Produto "pai" de um item salvo: o nome de produto cadastrado mais longo
  // que é prefixo do item seguido de " — " (ex.: "Vaso Onda — Areia (P) — Kit 3"
  // → "Vaso Onda — Areia (P)"). Sem par (produto renomeado/excluído, kit,
  // item manual), o item fica como uma linha solta.
  const nomesProdutos = useMemo(
    () => (produtosCatalogo || []).map((x) => x.nome).filter(Boolean).sort((a, b) => b.length - a.length),
    [produtosCatalogo]
  );
  function paiDe(itemNome) {
    if (!itemNome) return null;
    return nomesProdutos.find((n) => itemNome !== n && itemNome.startsWith(`${n} — `)) || null;
  }

  // Linhas de um grupo: itens "normais" e, embaixo de cada produto, as
  // variações dele (recolhidas até clicar na seta).
  function linhasDoGrupo(grupo) {
    const porPai = new Map();
    const ordem = [];
    for (const p of grupo.itens) {
      const pai = paiDe(p.item_nome);
      const base = pai || p.item_nome || `__${p.id}`;
      if (!porPai.has(base)) {
        porPai.set(base, { base, temItemBase: false, normais: [], variacoes: [] });
        ordem.push(base);
      }
      const g = porPai.get(base);
      if (pai) g.variacoes.push(p);
      else {
        g.normais.push(p);
        g.temItemBase = true;
      }
    }
    const blocos = ordem.map((b) => porPai.get(b));
    for (const bl of blocos) bl.variacoes.sort((x, y) => (x.item_nome || "").localeCompare(y.item_nome || "", "pt-BR", { numeric: true }));
    return blocos;
  }

  function alternar(setter, chave) {
    setter((prev) => {
      const novo = new Set(prev);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("promocoes_salvas").delete().eq("id", id);
    if (error) {
      onToast?.("Não foi possível excluir agora — tente de novo");
      return;
    }
    setPromocoes((prev) => prev.filter((p) => p.id !== id));
  }

  // Editar aqui é editar o RESULTADO já salvo (preço/lucro/resumo) — não tem
  // como recalcular a partir de custo+canal porque a promoção salva só
  // guarda o resultado final, sem o custo nem o canal por trás. A exceção é
  // o tipo "desconto" quando salvamos preco_referencia (o preço "de") e
  // desconto_pct junto: aí dá pra abrir um modo simples com só o campo
  // "Desconto (%)", recalculando o preço sozinho (referência × (1 −
  // desconto)) — bem mais rápido que preencher preço/lucro soltos quando só
  // o desconto mudou. Pra qualquer outro caso (ou se você preferir ajustar
  // na mão), o formulário completo continua disponível.
  function iniciarEdicao(p) {
    const simplificavel = p.tipo === "desconto" && p.preco_referencia != null && p.desconto_pct != null;
    setEditAlvo(p);
    setModoEdicaoSimples(simplificavel);
    setEdicao({
      nome: p.nome || "",
      preco: p.preco != null ? String(p.preco) : "",
      lucro: p.lucro != null ? String(p.lucro) : "",
      resumo: p.resumo || "",
      descontoPct: p.desconto_pct != null ? String(p.desconto_pct) : "",
    });
  }

  const podeSimplificar =
    !!editAlvo && editAlvo.tipo === "desconto" && editAlvo.preco_referencia != null && editAlvo.desconto_pct != null;

  const precoSimplificado = useMemo(() => {
    if (!modoEdicaoSimples || !editAlvo) return null;
    const pct = parseFloat(String(edicao.descontoPct).replace(",", ".")) || 0;
    const ref = Number(editAlvo.preco_referencia) || 0;
    if (ref <= 0) return null;
    return ref * (1 - pct / 100);
  }, [modoEdicaoSimples, editAlvo, edicao.descontoPct]);

  const margemSimplificada = useMemo(() => {
    if (precoSimplificado == null || precoSimplificado <= 0 || !editAlvo || editAlvo.lucro == null) return null;
    return Number(editAlvo.lucro) / precoSimplificado;
  }, [precoSimplificado, editAlvo]);

  const margemEdicao = useMemo(() => {
    const preco = parseFloat(String(edicao.preco).replace(",", "."));
    const lucro = parseFloat(String(edicao.lucro).replace(",", "."));
    if (!isFinite(preco) || preco <= 0 || !isFinite(lucro)) return null;
    return lucro / preco;
  }, [edicao.preco, edicao.lucro]);

  async function salvarEdicao() {
    const id = editAlvo.id;
    const nome = edicao.nome.trim();
    if (!nome) {
      onToast?.("O nome não pode ficar vazio");
      return;
    }

    let payload;
    if (modoEdicaoSimples) {
      const pct = parseFloat(String(edicao.descontoPct).replace(",", ".")) || 0;
      const ref = Number(editAlvo.preco_referencia) || 0;
      const precoNovo = ref > 0 ? arredondarPreco(ref * (1 - pct / 100)) : editAlvo.preco;
      const margemNova = precoNovo > 0 && editAlvo.lucro != null ? Number(editAlvo.lucro) / precoNovo : editAlvo.margem;
      payload = {
        nome,
        preco: precoNovo,
        lucro: editAlvo.lucro,
        margem: margemNova,
        preco_referencia: ref,
        desconto_pct: pct,
        resumo: `Desconto direto de ${pct}% — preço final ${BRL(precoNovo)} (referência "de" ${BRL(ref)}).`,
      };
    } else {
      const precoNum = parseFloat(String(edicao.preco).replace(",", "."));
      const lucroNum = parseFloat(String(edicao.lucro).replace(",", "."));
      const resumo = edicao.resumo.trim();
      payload = {
        nome,
        preco: isFinite(precoNum) ? arredondarPreco(precoNum) : null,
        lucro: isFinite(lucroNum) ? arredondarPreco(lucroNum) : null,
        margem: margemEdicao,
        resumo: resumo || null,
      };
    }

    setSalvandoEdicao(true);
    const { error } = await supabase.from("promocoes_salvas").update(payload).eq("id", id);
    setSalvandoEdicao(false);
    if (error) {
      onToast?.("Não foi possível salvar — tente de novo");
      return;
    }
    setPromocoes((prev) => prev.map((p) => (p.id === id ? { ...p, ...payload } : p)));
    setEditAlvo(null);
    setRecemSalvoId(id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === id ? null : atual)), 1000);
    onToast?.("Promoção atualizada");
  }

  return (
    <div className="panel">
      <h3>Promoções salvas</h3>
      {!supabase ? (
        <div className="empty">Promoções salvas indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : promocoes.length === 0 ? (
        <div className="empty">Nenhuma promoção salva ainda. Configure uma em "Simular promoção" e clique em "Salvar".</div>
      ) : (
        <>
          <div className="toolbar">
            <input
              type="text"
              aria-label="Buscar por promoção, produto ou canal"
              placeholder="Buscar promoção, produto ou canal…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {grupos.length > 1 && (
              <button type="button" className="btn btn-mini" onClick={() => { setAbrirTodas((v) => !v); setAbertos(new Set()); }}>
                {abrirTodas ? "Recolher todas" : "Abrir todas"}
              </button>
            )}
            <span className="toolbar-info">
              {grupos.length} {grupos.length === 1 ? "promoção" : "promoções"}
            </span>
          </div>

          {grupos.length === 0 ? (
            <div className="empty">Nenhuma promoção encontrada pra "{busca}".</div>
          ) : (
            grupos.map((grupo) => {
              const somaLucro = grupo.itens.reduce((s, p) => s + (Number(p.lucro) || 0), 0);
              const margens = grupo.itens.map((p) => (p.margem != null ? Number(p.margem) : null)).filter((m) => m != null);
              const menorMargem = margens.length ? Math.min(...margens) : null;
              const canaisGrupo = [...new Set(grupo.itens.map((p) => p.canal_nome).filter(Boolean))];
              const aberto = abrirTodas || abertos.has(grupo.chave) || !!busca.trim();
              const blocos = linhasDoGrupo(grupo);
              const linha = (p, variacao) => (
                <tr key={p.id} className={variacao ? "linha-variacao" : ""}>
                  <td>
                    {variacao ? (
                      <span className="item-cel item-cel-variacao">
                        <span className="variacao-seta">↳</span>
                        <span>
                          {p.item_nome.slice(paiDe(p.item_nome).length + 3)}
                          {p.canal_nome ? <> <CanalTag tipo={tipoDoNome(p.canal_nome)} nome={p.canal_nome} className="canal-tag-mini" /></> : ""}
                        </span>
                      </span>
                    ) : (
                      <>
                        {p.item_nome || "—"}
                        {p.canal_nome ? <> <CanalTag tipo={tipoDoNome(p.canal_nome)} nome={p.canal_nome} className="canal-tag-mini" /></> : ""}
                      </>
                    )}
                    {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                    {p.resumo && (
                      <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em", paddingLeft: variacao ? 38 : 0 }}>
                        {p.resumo}
                      </div>
                    )}
                  </td>
                  <td>{labelTipo(p.tipo)}</td>
                  <td className="num">{p.preco_referencia != null ? BRL(p.preco_referencia) : "—"}</td>
                  <td className="num">{p.preco != null ? BRL(p.preco) : "—"}</td>
                  <td className="num">{p.lucro != null ? BRL(p.lucro) : "—"}</td>
                  <td className="num">
                    {p.margem != null ? (
                      <span className={`badge ${Number(p.margem) < 0 ? "bad" : Number(p.margem) < 0.1 ? "warn" : "good"}`}>{PCT(p.margem)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="acoes-linha">
                      <button className="del" title="Editar" onClick={() => iniciarEdicao(p)}>✎</button>
                      <button className="del" title="Excluir" onClick={() => setExcluirAlvo(p)}>×</button>
                    </span>
                  </td>
                </tr>
              );
              return (
                <div key={grupo.chave} className={`promo-grupo${aberto ? " aberto" : ""}`}>
                  <button type="button" className="promo-grupo-cab" onClick={() => alternar(setAbertos, grupo.chave)} aria-expanded={aberto}>
                    <span className="seta">▸</span>
                    <span className="promo-grupo-nome">{grupo.nome}</span>
                    <span className="chip-herdado">
                      {grupo.itens.length} {grupo.itens.length === 1 ? "item" : "itens"}
                    </span>
                    {canaisGrupo.length > 0 && (
                      <span className="promo-grupo-canais">
                        {canaisGrupo.map((nm) => (
                          <CanalTag key={nm} tipo={tipoDoNome(nm)} nome={nm} className="canal-tag-mini" />
                        ))}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {menorMargem != null && (
                      <span className={`badge ${menorMargem < 0 ? "bad" : menorMargem < 0.1 ? "warn" : "good"}`} title="Menor margem entre os itens dessa promoção">
                        menor margem {PCT(menorMargem)}
                      </span>
                    )}
                    <span className="promo-grupo-lucro">
                      Lucro total <strong>{BRL(somaLucro)}</strong>
                    </span>
                  </button>
                  {aberto && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Item / Canal</th>
                            <th>Tipo</th>
                            <th className="num">Preço "de"</th>
                            <th className="num">Preço</th>
                            <th className="num">Lucro</th>
                            <th className="num">Margem</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {blocos.flatMap((bl) => {
                            const chaveVar = `${grupo.chave}|${bl.base}`;
                            const varAberta = variacoesAbertas.has(chaveVar) || (!!busca.trim() && bl.variacoes.length > 0);
                            const toggle =
                              bl.variacoes.length > 0 ? (
                                <button
                                  type="button"
                                  className={`variacoes-toggle${varAberta ? " aberto" : ""}`}
                                  onClick={() => alternar(setVariacoesAbertas, chaveVar)}
                                >
                                  <span className="seta">▸</span> {bl.variacoes.length} {bl.variacoes.length === 1 ? "variação" : "variações"}
                                </button>
                              ) : null;
                            const out = [];
                            if (bl.variacoes.length > 0 && !bl.temItemBase) {
                              // Só variações desse produto na promoção — linha de cabeçalho com o nome do produto.
                              out.push(
                                <tr key={`cab-${chaveVar}`} className={varAberta ? "linha-aberta" : ""}>
                                  <td colSpan={7}>
                                    <span className="item-cel">
                                      <strong style={{ fontWeight: 600 }}>{bl.base}</strong>
                                      {toggle}
                                    </span>
                                  </td>
                                </tr>
                              );
                            }
                            bl.normais.forEach((p, i) => {
                              const tr = linha(p, false);
                              if (i === 0 && toggle && bl.temItemBase) {
                                out.push(
                                  <tr key={p.id} className={varAberta ? "linha-aberta" : ""}>
                                    {[
                                      <td key="n">
                                        <span className="item-cel">
                                          <span>
                                            {p.item_nome || "—"}
                                            {p.canal_nome ? <> <CanalTag tipo={tipoDoNome(p.canal_nome)} nome={p.canal_nome} className="canal-tag-mini" /></> : ""}
                                            {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                                            {p.resumo && <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>{p.resumo}</div>}
                                          </span>
                                          {toggle}
                                        </span>
                                      </td>,
                                      ...tr.props.children.slice(1),
                                    ]}
                                  </tr>
                                );
                              } else out.push(tr);
                            });
                            if (varAberta) bl.variacoes.forEach((p) => out.push(linha(p, true)));
                            return out;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}

      {editAlvo && (
        <EditarDialog
          titulo={`Editar promoção — ${editAlvo.item_nome || "—"}${editAlvo.canal_nome ? ` em ${editAlvo.canal_nome}` : ""}`}
          salvando={salvandoEdicao}
          onSalvar={salvarEdicao}
          onCancelar={() => setEditAlvo(null)}
        >
          <div className="field">
            <label>Nome da promoção</label>
            <input
              type="text"
              autoFocus
              value={edicao.nome}
              onChange={(e) => setEdicao((prev) => ({ ...prev, nome: e.target.value }))}
            />
          </div>

          {modoEdicaoSimples ? (
            <>
              <div className="field">
                <label>Desconto sobre o preço "de" ({BRL(editAlvo.preco_referencia)}) — %</label>
                <input
                  type="number"
                  step="1"
                  value={edicao.descontoPct}
                  onChange={(e) => setEdicao((prev) => ({ ...prev, descontoPct: e.target.value }))}
                />
              </div>
              <div className="kv">
                <span className="k">Preço com esse desconto</span>
                <span className="v">{precoSimplificado != null ? BRL(precoSimplificado) : "—"}</span>
              </div>
              <div className="kv total">
                <span className="k">Margem (aproximada)</span>
                <span className="v">{margemSimplificada != null ? PCT(margemSimplificada) : "—"}</span>
              </div>
              <div className="hint" style={{ marginTop: 8, marginBottom: 10 }}>
                O lucro considerado é o último salvo ({BRL(editAlvo.lucro)}) — não recalcula sozinho ao mudar o desconto (a promoção salva não guarda o custo/canal), então a margem acima é uma aproximação. Pra um valor exato, recalcule em Promoções → Simular promoção e salve de novo.
              </div>
              <button type="button" className="btn" onClick={() => setModoEdicaoSimples(false)}>
                Editar todos os campos manualmente
              </button>
            </>
          ) : (
            <>
              <div className="row2">
                <div className="field">
                  <label>Preço</label>
                  <input
                    type="number"
                    step="0.01"
                    value={edicao.preco}
                    onChange={(e) => setEdicao((prev) => ({ ...prev, preco: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Lucro</label>
                  <input
                    type="number"
                    step="0.01"
                    value={edicao.lucro}
                    onChange={(e) => setEdicao((prev) => ({ ...prev, lucro: e.target.value }))}
                  />
                </div>
              </div>
              <div className="destaque-lucro" style={{ marginBottom: 12 }}>
                <span className="k">Margem</span>
                <span className="v">{margemEdicao != null ? PCT(margemEdicao) : "—"}</span>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Resumo (texto livre — configuração usada)</label>
                <textarea
                  rows={3}
                  value={edicao.resumo}
                  onChange={(e) => setEdicao((prev) => ({ ...prev, resumo: e.target.value }))}
                />
              </div>
              <div className="hint" style={{ marginTop: 8, marginBottom: podeSimplificar ? 10 : 0 }}>
                Preço e lucro aqui são só o resultado guardado — editar não refaz a conta a partir do custo/canal (a promoção não guarda esses dados), a margem é sempre lucro ÷ preço dos dois valores acima.
              </div>
              {podeSimplificar && (
                <button type="button" className="btn" onClick={() => setModoEdicaoSimples(true)}>
                  Voltar pro modo simples (só desconto %)
                </button>
              )}
            </>
          )}
        </EditarDialog>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir promoção"
          mensagem={`Confirma excluir "${excluirAlvo.nome || "este item"}"? Não é possível desfazer.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </div>
  );
}
