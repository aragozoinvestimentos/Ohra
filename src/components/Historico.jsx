import { useEffect, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Antes esta aba lia uma tabela solta ("produtos") que só guardava um
// instantâneo do que foi salvo em Precificação por Canal, sem ligação real
// com o cadastro. Agora ela é uma grade: cada linha é um produto ou kit
// cadastrado, cada coluna é um canal cadastrado, e cada célula é o preço
// (com lucro e margem) mais recente salvo pra essa combinação — preenchida
// automaticamente quando alguém salva em Precificação por Canal. Também é
// daqui que se clona, edita por completo ou exclui por completo um produto
// ou kit — por isso as listas equivalentes em Cadastros → Produtos/Kits
// foram simplificadas pra só o formulário.
export default function Historico({ onEditarCompleto, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, carregando: carregandoBase } = useRankingData();
  const [precos, setPrecos] = useState([]);
  const [carregandoPrecos, setCarregandoPrecos] = useState(true);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editAlvo, setEditAlvo] = useState(null); // { id, nomeItem, nomeCanal, custoTotal }
  const [edicao, setEdicao] = useState({ preco: "", lucro: "", margem: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [busca, setBusca] = useState("");
  const [clonarAlvo, setClonarAlvo] = useState(null); // item original sendo clonado
  const [clonarForm, setClonarForm] = useState({ nome: "", sku: "" });
  const [salvandoClone, setSalvandoClone] = useState(false);
  const [excluirCompletoAlvo, setExcluirCompletoAlvo] = useState(null); // { item, aviso }

  useEffect(() => {
    if (!supabase) {
      setCarregandoPrecos(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("precos_canal").select("*");
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setPrecos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregandoPrecos(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("precos-canal-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "precos_canal" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  function numOuNull(v) {
    const n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) ? n : null;
  }

  // Preço e Margem são as duas entradas editáveis; o Lucro é sempre
  // CALCULADO a partir delas (lucro = preço × margem) — igual aos outros
  // calculadores do app (Precificação por Canal, Orçamento). Não dá pra
  // deixar os três "soltos" ao mesmo tempo: com só uma fórmula ligando os
  // três (margem = lucro / preço), editar um teria que assumir qual dos
  // outros dois fica fixo — então travamos o Lucro como resultado, nunca
  // como entrada, pra não ter ambiguidade. Editar o Preço recalcula o Lucro
  // mantendo a Margem; editar a Margem recalcula o Lucro mantendo o Preço.
  function editarPreco(valor) {
    setEdicao((prev) => {
      const precoNum = numOuNull(valor);
      const margemNum = numOuNull(prev.margem);
      if (precoNum != null && margemNum != null) {
        return { ...prev, preco: valor, lucro: (precoNum * (margemNum / 100)).toFixed(2) };
      }
      return { ...prev, preco: valor };
    });
  }

  function editarMargem(valor) {
    setEdicao((prev) => {
      const margemNum = numOuNull(valor);
      const precoNum = numOuNull(prev.preco);
      if (margemNum != null && precoNum != null) {
        return { ...prev, margem: valor, lucro: (precoNum * (margemNum / 100)).toFixed(2) };
      }
      return { ...prev, margem: valor };
    });
  }

  function precoDe(item, canalObj) {
    const [tipo, id] = item.id.split(":");
    const itemTipo = tipo === "k" ? "kit" : "produto";
    return precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalObj.id) || null;
  }

  async function excluir(precoId) {
    if (!supabase) return;
    const { error } = await supabase.from("precos_canal").delete().eq("id", precoId);
    if (error) {
      onToast("Não foi possível excluir agora — tente de novo");
      return;
    }
    setPrecos((prev) => prev.filter((p) => p.id !== precoId));
  }

  function iniciarEdicao(p, item, canalObj) {
    setEditAlvo({ id: p.id, nomeItem: item.nome, nomeCanal: canalObj.nome, custoTotal: item.custoTotal });
    setEdicao({
      preco: Number(p.preco || 0).toFixed(2),
      lucro: p.lucro != null ? Number(p.lucro).toFixed(2) : "",
      margem: p.margem != null ? (Number(p.margem) * 100).toFixed(1) : "",
    });
  }

  async function salvarEdicao() {
    const precoId = editAlvo.id;
    const preco = parseFloat(String(edicao.preco).replace(",", "."));
    if (!isFinite(preco) || preco <= 0) {
      onToast("Informe um preço válido");
      return;
    }
    const lucroNum = parseFloat(String(edicao.lucro).replace(",", "."));
    const margemNum = parseFloat(String(edicao.margem).replace(",", "."));
    const lucro = isFinite(lucroNum) ? arredondarPreco(lucroNum) : null;
    const margem = isFinite(margemNum) ? margemNum / 100 : null;
    setSalvandoEdicao(true);
    const { error } = await supabase
      .from("precos_canal")
      .update({ preco: arredondarPreco(preco), lucro, margem, atualizado_em: new Date().toISOString() })
      .eq("id", precoId);
    setSalvandoEdicao(false);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    setPrecos((prev) => prev.map((p) => (p.id === precoId ? { ...p, preco: arredondarPreco(preco), lucro, margem } : p)));
    setEditAlvo(null);
    setRecemSalvoId(precoId);
    setTimeout(() => setRecemSalvoId((atual) => (atual === precoId ? null : atual)), 1000);
    onToast("Preço atualizado");
  }

  function abrirClonar(item) {
    setClonarAlvo(item);
    setClonarForm({ nome: `${item.nome} (cópia)`, sku: "" });
  }

  function achaConflitoSkuClone(sku) {
    const alvo = sku.trim().toLowerCase();
    if (!alvo) return null;
    const encontrado = itens.find((i) => (i.sku || "").trim().toLowerCase() === alvo);
    return encontrado ? { tipo: encontrado.tipo, nome: encontrado.nome } : null;
  }

  async function confirmarClonar() {
    const item = clonarAlvo;
    const nome = clonarForm.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao clone");
      return;
    }
    const [tipoLetra, id] = item.id.split(":");
    const tabela = tipoLetra === "k" ? "kits" : "produtos_cadastro";
    setSalvandoClone(true);
    try {
      const { data: original, error: e1 } = await supabase.from(tabela).select("*").eq("id", id).single();
      if (e1 || !original) throw new Error(e1?.message || "Item não encontrado");
      const novo = { ...original, nome, sku: clonarForm.sku.trim() || null };
      delete novo.id;
      delete novo.criado_em;
      novo.atualizado_em = new Date().toISOString();
      const { data: criado, error: e2 } = await supabase.from(tabela).insert(novo).select().single();
      if (e2 || !criado) throw new Error(e2?.message || "Não foi possível clonar");
      const novoId = criado.id;

      if (tabela === "produtos_cadastro") {
        const { data: embs } = await supabase.from("produto_embalagens").select("*").eq("produto_id", id);
        if (embs?.length) {
          const linhas = embs.map(({ id: _oid, produto_id: _pid, ...resto }) => ({ ...resto, produto_id: novoId }));
          await supabase.from("produto_embalagens").insert(linhas);
        }
      } else {
        const { data: kp } = await supabase.from("kit_produtos").select("*").eq("kit_id", id);
        if (kp?.length) {
          const linhas = kp.map(({ id: _oid, kit_id: _kid, ...resto }) => ({ ...resto, kit_id: novoId }));
          await supabase.from("kit_produtos").insert(linhas);
        }
        const { data: ke } = await supabase.from("kit_embalagens").select("*").eq("kit_id", id);
        if (ke?.length) {
          const linhas = ke.map(({ id: _oid, kit_id: _kid, ...resto }) => ({ ...resto, kit_id: novoId }));
          await supabase.from("kit_embalagens").insert(linhas);
        }
      }

      const itemTipo = tipoLetra === "k" ? "kit" : "produto";
      const precosOriginais = precos.filter((p) => p.item_tipo === itemTipo && p.item_id === id);
      if (precosOriginais.length) {
        const linhas = precosOriginais.map(({ id: _oid, item_id: _iid, ...resto }) => ({ ...resto, item_id: novoId }));
        await supabase.from("precos_canal").insert(linhas);
      }

      onToast("Clonado com sucesso");
      setClonarAlvo(null);
    } catch (err) {
      onToast(`Não foi possível clonar: ${err.message}`);
    } finally {
      setSalvandoClone(false);
    }
  }

  async function pedirExclusaoCompleta(item) {
    const [tipoLetra, id] = item.id.split(":");
    if (tipoLetra !== "k" && supabase) {
      const { data, error } = await supabase.from("kit_produtos").select("kit_id").eq("produto_id", id);
      if (!error && data && data.length > 0) {
        const kitIds = [...new Set(data.map((r) => r.kit_id))];
        const nomes = kitIds.map((kid) => itens.find((i) => i.id === `k:${kid}`)?.nome).filter(Boolean);
        setExcluirCompletoAlvo({
          item,
          aviso: nomes.length ? `Usado no(s) kit(s): ${nomes.join(", ")}. Excluir mesmo assim vai tirá-lo desses kits.` : null,
        });
        return;
      }
    }
    setExcluirCompletoAlvo({ item, aviso: null });
  }

  async function excluirItemCompleto() {
    const { item } = excluirCompletoAlvo;
    const [tipoLetra, id] = item.id.split(":");
    const tabela = tipoLetra === "k" ? "kits" : "produtos_cadastro";
    const itemTipo = tipoLetra === "k" ? "kit" : "produto";
    const { error } = await supabase.from(tabela).delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    // precos_canal não tem FK pro produto/kit (referência genérica) — limpa na mão.
    await supabase.from("precos_canal").delete().eq("item_tipo", itemTipo).eq("item_id", id);
    setExcluirCompletoAlvo(null);
    onToast("Excluído por completo");
  }

  const carregando = carregandoBase || carregandoPrecos;
  const alvoBusca = busca.trim().toLowerCase();
  const itensFiltrados = alvoBusca
    ? itens.filter((item) => item.nome.toLowerCase().includes(alvoBusca) || (item.sku || "").toLowerCase().includes(alvoBusca))
    : itens;
  const conflitoSkuClone = clonarAlvo ? achaConflitoSkuClone(clonarForm.sku) : null;

  return (
    <div className="panel">
      <h3>
        Preços por canal
        <Ajuda texto="Cada célula mostra o preço, lucro e margem salvos pra esse produto/kit nesse canal. Célula vazia significa que ainda não foi salvo nada pra essa combinação — preencha em Precificação por Canal. Já salvo, use o ✎ pra corrigir na mão ou o × pra excluir (com confirmação). No nome do produto/kit: ⧉ clona tudo (inclusive os preços já salvos em outros canais) pra criar uma variação rapidamente, ✎ abre o cadastro completo pra editar, e × exclui o produto/kit por completo (não só um preço)." />
      </h3>
      {itens.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <input type="text" placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}
      {!supabase ? (
        <div className="empty">Preços por Canal indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="empty">Nenhum produto ou kit cadastrado ainda. Cadastre em Cadastros → Produtos ou Kits.</div>
      ) : itensFiltrados.length === 0 ? (
        <div className="empty">Nenhum produto ou kit encontrado pra essa busca.</div>
      ) : (
        <>
          {canais.length === 0 && (
            <div className="hint" style={{ marginBottom: 10 }}>
              Nenhum canal cadastrado ainda — cadastre em Cadastros → Canais pra começar a salvar preços aqui. Enquanto isso, dá pra clonar, editar ou
              excluir os produtos/kits abaixo.
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto/Kit</th>
                  <th className="num">Custo total</th>
                  {canais.map((c) => (
                    <th key={c.id} className="num">{c.nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.nome} <span className="campo-anterior">({item.tipo}{item.sku ? ` · SKU ${item.sku}` : ""})</span>
                      <span style={{ whiteSpace: "nowrap", marginLeft: 6 }}>
                        <button className="del" title="Clonar produto/kit" onClick={() => abrirClonar(item)}>
                          ⧉
                        </button>
                        <button
                          className="del"
                          title="Editar cadastro completo"
                          onClick={() => onEditarCompleto?.(item.tipo === "kit" ? "kit" : "produto", item.id.split(":")[1])}
                        >
                          ✎
                        </button>
                        <button className="del" title="Excluir produto/kit por completo" onClick={() => pedirExclusaoCompleta(item)}>
                          ×
                        </button>
                      </span>
                    </td>
                    <td className="num">{BRL(item.custoTotal)}</td>
                    {canais.map((c) => {
                      const p = precoDe(item, c);
                      return (
                        <td key={c.id} className="num">
                          {p ? (
                            <div className="preco-canal-cel">
                              <div className="preco-canal-topo">
                                <span className="preco-canal-valor">
                                  {BRL(p.preco)}
                                  {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                                </span>
                                <button className="del" title="Editar preço salvo" onClick={() => iniciarEdicao(p, item, c)}>
                                  ✎
                                </button>
                                <button
                                  className="del"
                                  title="Excluir preço salvo"
                                  onClick={() => setExcluirAlvo({ ...p, nomeItem: item.nome, nomeCanal: c.nome })}
                                >
                                  ×
                                </button>
                              </div>
                              <div className="preco-canal-linha">
                                <span className="rotulo">Lucro</span>
                                {p.lucro != null ? BRL(p.lucro) : "—"}
                              </div>
                              <div className="preco-canal-linha">
                                <span className="rotulo">Margem</span>
                                {p.margem != null ? PCT(p.margem) : "—"}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "var(--ink-faint)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        Pra preencher uma célula vazia, vá em Precificação por Canal, escolha o produto/kit e o canal, calcule e clique em "Salvar". Pra corrigir um valor já
        salvo, use o ✎ na própria célula — ou o × pra excluir (pede confirmação antes).
      </div>

      {editAlvo && (
        <EditarDialog
          titulo={`Editar preço — ${editAlvo.nomeItem} em ${editAlvo.nomeCanal}`}
          salvando={salvandoEdicao}
          onSalvar={salvarEdicao}
          onCancelar={() => setEditAlvo(null)}
        >
          <div className="destaque-custo">
            <span className="k">
              Custo total do item
              <span className="k-sub">quanto custa produzir, antes de qualquer taxa</span>
            </span>
            <span className="v">{BRL(editAlvo.custoTotal)}</span>
          </div>
          <div className="row2">
            <div className="field">
              <label>
                Preço de venda (R$)
                <Ajuda texto="O preço final que aparece pro cliente nesse canal." />
              </label>
              <input
                type="number"
                step="0.01"
                autoFocus
                value={edicao.preco}
                onChange={(e) => editarPreco(e.target.value)}
              />
            </div>
            <div className="field">
              <label>
                Margem (%)
                <Ajuda texto="O lucro dividido pelo preço de venda, em porcentagem — a meta líquida que você quer garantir nessa venda." />
              </label>
              <input
                type="number"
                step="0.1"
                value={edicao.margem}
                onChange={(e) => editarMargem(e.target.value)}
              />
            </div>
          </div>
          <div className="destaque-lucro">
            <span className="k">
              Lucro
              <span className="k-sub">calculado a partir do preço e da margem acima</span>
            </span>
            <span className="v">{numOuNull(edicao.lucro) != null ? BRL(numOuNull(edicao.lucro)) : "—"}</span>
          </div>
        </EditarDialog>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir preço salvo"
          mensagem={`Confirma excluir o preço de "${excluirAlvo.nomeItem}" em ${excluirAlvo.nomeCanal}? Não é possível desfazer.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}

      {clonarAlvo && (
        <EditarDialog
          titulo={`Clonar — ${clonarAlvo.nome}`}
          salvando={salvandoClone}
          onSalvar={confirmarClonar}
          onCancelar={() => setClonarAlvo(null)}
          salvarLabel="Clonar"
          salvandoLabel="Clonando…"
        >
          <div className="hint" style={{ marginTop: 0 }}>
            Cria um {clonarAlvo.tipo} novo com a mesma receita (materiais/embalagens) e os mesmos preços já salvos por canal — só muda o nome e o SKU.
            Depois é só ajustar o que for diferente na variação.
          </div>
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              autoFocus
              value={clonarForm.nome}
              onChange={(e) => setClonarForm((p) => ({ ...p, nome: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>
              SKU (opcional)
              <Ajuda texto="Deixe em branco se ainda não tiver um código diferente pra essa variação — dá pra preencher depois no cadastro completo." />
            </label>
            <input
              type="text"
              placeholder="ex: VS-MED-01-AZUL"
              value={clonarForm.sku}
              onChange={(e) => setClonarForm((p) => ({ ...p, sku: e.target.value }))}
            />
            {conflitoSkuClone && (
              <div className="hint" style={{ marginTop: 4, marginBottom: 0, color: "var(--warn)" }}>
                Já existe um {conflitoSkuClone.tipo} com esse SKU: {conflitoSkuClone.nome}
              </div>
            )}
          </div>
        </EditarDialog>
      )}

      {excluirCompletoAlvo && (
        <ConfirmDialog
          titulo={`Excluir ${excluirCompletoAlvo.item.tipo} por completo`}
          mensagem={
            `Confirma excluir "${excluirCompletoAlvo.item.nome}" e todos os preços salvos dele em qualquer canal? Não é possível desfazer.` +
            (excluirCompletoAlvo.aviso ? ` ${excluirCompletoAlvo.aviso}` : "")
          }
          confirmarLabel="Excluir por completo"
          perigo
          onConfirm={excluirItemCompleto}
          onCancel={() => setExcluirCompletoAlvo(null)}
        />
      )}
    </div>
  );
}
