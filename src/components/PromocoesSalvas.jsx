import { useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { normalizarTexto } from "../lib/texto.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { TIPOS } from "../lib/promocaoTipos.js";

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
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [editAlvo, setEditAlvo] = useState(null); // linha inteira sendo editada
  const [modoEdicaoSimples, setModoEdicaoSimples] = useState(false);
  const [edicao, setEdicao] = useState({ nome: "", preco: "", lucro: "", resumo: "", descontoPct: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }

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
      if (!mapa.has(chave)) mapa.set(chave, { nome, itens: [] });
      mapa.get(chave).itens.push(p);
    }
    return [...mapa.values()];
  }, [promocoesFiltradas]);

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
          <div className="field" style={{ maxWidth: 420 }}>
            <label>Buscar por promoção, produto ou canal</label>
            <input
              type="text"
              placeholder="ex: Black Friday, nome do produto…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {grupos.length === 0 ? (
            <div className="empty">Nenhuma promoção encontrada pra "{busca}".</div>
          ) : (
            grupos.map((grupo) => {
              const somaLucro = grupo.itens.reduce((s, p) => s + (Number(p.lucro) || 0), 0);
              return (
                <div key={grupo.nome} style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <h4 style={{ margin: 0, fontSize: 15 }}>
                      {grupo.nome}
                      <span className="badge" style={{ marginLeft: 8, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
                        {grupo.itens.length} {grupo.itens.length === 1 ? "produto" : "produtos"}
                      </span>
                    </h4>
                    <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                      Lucro total do grupo: <strong style={{ color: "var(--ink)" }}>{BRL(somaLucro)}</strong>
                    </div>
                  </div>
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
                        {grupo.itens.map((p) => (
                          <tr key={p.id}>
                            <td>
                              {p.item_nome || "—"}
                              {p.canal_nome ? ` — ${p.canal_nome}` : ""}
                              {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                              {p.resumo && (
                                <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>
                                  {p.resumo}
                                </div>
                              )}
                            </td>
                            <td>{labelTipo(p.tipo)}</td>
                            <td className="num">{p.preco_referencia != null ? BRL(p.preco_referencia) : "—"}</td>
                            <td className="num">{p.preco != null ? BRL(p.preco) : "—"}</td>
                            <td className="num">{p.lucro != null ? BRL(p.lucro) : "—"}</td>
                            <td className="num">{p.margem != null ? PCT(p.margem) : "—"}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <button className="del" title="Editar" onClick={() => iniciarEdicao(p)}>✎</button>
                              <button className="del" title="Excluir" onClick={() => setExcluirAlvo(p)}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
