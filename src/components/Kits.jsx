import { useEffect, useState } from "react";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { trocarLinhas } from "../lib/trocarLinhas.js";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import { sugestaoKit, configEscada } from "../lib/escada.js";

const VAZIO = { nome: "", sku: "", observacao: "", produtosItens: [], embalagemItens: [] };

export default function Kits({ abrirKitId, onToast }) {
  const { produtos: produtosVivos, itens: itensVivos, canais: canaisVivos, precos: precosVivos } = useRankingData();
  const { lojaId, lojas } = useLoja();
  // Dados crus do catálogo compartilhado (uma busca + um realtime pro app todo).
  const {
    produtos,
    embalagens: embalagensCatalogo,
    produtoEmbalagens: produtoEmbalagensTodos,
    kits,
    kitProdutos: kitProdutosTodos,
    kitEmbalagens: kitEmbalagensTodos,
    carregando,
  } = useCatalogo();
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [sugestoesOcultas, setSugestoesOcultas] = useState(false);

  // Veio de "Editar completo" em Produtos precificados — carrega o kit certo pra
  // edição. Essa sub-aba pode acabar de montar (troca vinda de outra aba de
  // Cadastros), então o catálogo local ainda pode não ter carregado — sem
  // isso, o efeito rodava uma vez só, achava a lista vazia e desistia,
  // deixando o formulário em branco.
  useEffect(() => {
    if (!abrirKitId?.id) return;
    (async () => {
      let k = kits.find((kk) => kk.id === abrirKitId.id) || null;
      if (k) {
        editar(k);
        return;
      }
      if (!supabase) return;
      const { data: kitData } = await supabase.from("kits").select("*").eq("id", abrirKitId.id).single();
      if (!kitData) return;
      const [{ data: kp }, { data: ke }] = await Promise.all([
        supabase.from("kit_produtos").select("*").eq("kit_id", kitData.id),
        supabase.from("kit_embalagens").select("*").eq("kit_id", kitData.id),
      ]);
      setEditandoId(kitData.id);
      setForm({
        nome: kitData.nome,
        sku: kitData.sku || "",
        observacao: kitData.observacao || "",
        produtosItens: (kp || []).map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade })),
        embalagemItens: (ke || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade })),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirKitId?.seq]);

  function achaConflitoSku(sku, meuKitId) {
    const alvo = sku.trim().toLowerCase();
    if (!alvo) return null;
    const emKits = kits.find((k) => k.id !== meuKitId && (k.sku || "").trim().toLowerCase() === alvo);
    if (emKits) return { tipo: "kit", nome: emKits.nome };
    const emProdutos = produtos.find((p) => (p.sku || "").trim().toLowerCase() === alvo);
    if (emProdutos) return { tipo: "produto", nome: emProdutos.nome };
    return null;
  }

  // Custo de produção de cada produto AO VIVO (preço atual do material),
  // do catálogo compartilhado — não o número gravado no dia do cadastro.
  const catalogoProdutos = produtos.map((p) => {
    const vivo = produtosVivos.find((x) => x.id === p.id);
    return { id: p.id, nome: p.nome, sku: p.sku || "", preco: Number((vivo || p).custo_producao) || 0, unidade: "un" };
  });
  const catalogoEmbalagens = embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));

  const custoFabricacao = totalItens(catalogoProdutos, form.produtosItens);
  const custoEmbalagemKit = totalItens(catalogoEmbalagens, form.embalagemItens);
  const custoTotal = custoFabricacao + custoEmbalagemKit;
  // Preço sugerido real por canal (kit vs peças vendidas separadas — mesma
  // conta do Avulso/Produtos precificados), no lugar do antigo markup.
  const cfgKit = configEscada(lojas.find((l) => l.id === lojaId)?.config_escada, null);
  const kitItemVivo = editandoId ? itensVivos.find((i) => i.id === `k:${editandoId}`) : null;
  const sugestoesCanais = kitItemVivo
    ? canaisVivos
        .map((c) => ({ c, sug: sugestaoKit({ canal: c, kitItem: kitItemVivo, itens: itensVivos, precos: precosVivos, cfg: cfgKit }), salvo: precosVivos.find((p) => p.item_tipo === "kit" && p.item_id === editandoId && p.canal_id === c.id) }))
        .filter((x) => x.sug)
    : [];

  function limpar() {
    setForm(VAZIO);
    setEditandoId(null);
  }

  // Soma a embalagem de cada produto escolhido (vezes a quantidade dele no
  // kit) como ponto de partida — depois é só ajustar pra baixo (ex: 1 caixa
  // em vez de 2) ou pra cima (mais plástico bolha), conforme a realidade.
  function sugerirEmbalagem() {
    const soma = {};
    (form.produtosItens || []).forEach((it) => {
      const qtdProduto = Number(it.quantidade) || 0;
      produtoEmbalagensTodos
        .filter((r) => r.produto_id === it.itemId)
        .forEach((r) => {
          soma[r.embalagem_id] = (soma[r.embalagem_id] || 0) + Number(r.quantidade) * qtdProduto;
        });
    });
    const sugestao = Object.entries(soma).map(([embalagem_id, quantidade]) => ({ itemId: embalagem_id, quantidade }));
    if (sugestao.length === 0) {
      onToast("Nenhum dos produtos escolhidos tem receita de embalagem cadastrada");
      return;
    }
    setForm((prev) => ({ ...prev, embalagemItens: sugestao }));
    onToast("Sugestão aplicada — ajuste as quantidades como achar melhor");
  }

  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao kit");
      return;
    }
    if ((form.produtosItens || []).length === 0) {
      onToast("Escolha ao menos um produto para o kit");
      return;
    }
    setSalvando(true);
    // markup_desejado/preco_sugerido (schema v23) não são mais editados aqui —
    // o sugerido real (vs peças separadas) é calculado ao vivo; os valores
    // antigos continuam no banco.
    const payload = {
      nome,
      sku: form.sku.trim() || null,
      observacao: form.observacao.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    let kitId = editandoId;
    let error;
    if (editandoId) {
      ({ error } = await supabase.from("kits").update(payload).eq("id", editandoId));
    } else {
      const resposta = await supabase
        .from("kits")
        .insert({ ...payload, ...(lojaId ? { loja_id: lojaId } : {}) })
        .select()
        .single();
      error = resposta.error;
      kitId = resposta.data?.id;
    }
    if (error) {
      setSalvando(false);
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }

    if (kitId) {
      const linhasProdutos = (form.produtosItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ kit_id: kitId, produto_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      const linhasEmbalagens = (form.embalagemItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ kit_id: kitId, embalagem_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      // Grava a composição nova antes de apagar a antiga — se falhar, a
      // antiga continua lá (antes apagava primeiro e o kit podia ficar vazio).
      const [{ error: erroP }, { error: erroE }] = await Promise.all([
        trocarLinhas(supabase, "kit_produtos", "kit_id", kitId, linhasProdutos),
        trocarLinhas(supabase, "kit_embalagens", "kit_id", kitId, linhasEmbalagens),
      ]);
      recarregarCatalogo();
      if (erroP || erroE) {
        setSalvando(false);
        onToast(`Kit salvo, mas a composição não foi atualizada (a anterior foi mantida): ${(erroP || erroE).message}`);
        limpar();
        return;
      }
    }
    recarregarCatalogo();
    setSalvando(false);
    onToast(editandoId ? "Kit atualizado" : "Kit cadastrado");
    limpar();
  }

  function editar(k) {
    setEditandoId(k.id);
    setForm({
      nome: k.nome,
      sku: k.sku || "",
      observacao: k.observacao || "",
      produtosItens: kitProdutosTodos
        .filter((r) => r.kit_id === k.id)
        .map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade })),
      embalagemItens: kitEmbalagensTodos
        .filter((r) => r.kit_id === k.id)
        .map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade })),
    });
  }

  // Puxa a composição de um kit já cadastrado como ponto de partida pra um
  // novo (ex: uma variação de cor/tamanho) — igual ao Clonar de Preços por
  // Canal, mas sem criar nada ainda: só preenche o formulário. Nome e SKU
  // ficam do jeito que a pessoa já tinha digitado, só o resto vem copiado.
  function usarComoBase(k) {
    setForm((prev) => ({
      ...prev,
      observacao: k.observacao || "",
      produtosItens: kitProdutosTodos
        .filter((r) => r.kit_id === k.id)
        .map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade })),
      embalagemItens: kitEmbalagensTodos
        .filter((r) => r.kit_id === k.id)
        .map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade })),
    }));
    setSugestoesOcultas(true);
    onToast(`Composição de "${k.nome}" usada como base — nome e SKU continuam os que você digitou, ajuste o resto se precisar antes de salvar`);
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Kits</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  const conflitoSku = achaConflitoSku(form.sku, editandoId);

  const nomeQuery = form.nome.trim().toLowerCase();
  const skuQuery = form.sku.trim().toLowerCase();
  const sugestoes =
    editandoId || sugestoesOcultas || (nomeQuery.length < 2 && skuQuery.length < 2)
      ? []
      : kits
          .filter(
            (k) =>
              (nomeQuery.length >= 2 && k.nome.toLowerCase().includes(nomeQuery)) ||
              (skuQuery.length >= 2 && (k.sku || "").toLowerCase().includes(skuQuery))
          )
          .slice(0, 5);

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">
          {editandoId ? "Editar kit" : "Montar kit"}
          {!carregando && <span className="h3-contagem">{kits.length} {kits.length === 1 ? "kit cadastrado" : "kits cadastrados"}</span>}
          <Ajuda texto="Pra ver, buscar, clonar, editar ou excluir os kits já cadastrados, use Catálogo → Produtos precificados." />
        </h3>
        <div className="row3">
          <div className="field">
            <label>Nome do kit</label>
            <input
              type="text"
              placeholder="ex: Combo Vaso + Suporte"
              value={form.nome}
              onChange={(e) => {
                setForm((p) => ({ ...p, nome: e.target.value }));
                setSugestoesOcultas(false);
              }}
            />
          </div>
          <div className="field">
            <label>
              SKU (opcional)
              <Ajuda texto="Código próprio seu pra identificar o kit (o mesmo que você usa no Shopee/ML/etc, se tiver). Não é obrigatório — dá pra deixar em branco e preencher depois. Serve pra buscar mais rápido e vincular métricas a esse código." />
            </label>
            <input
              type="text"
              placeholder="ex: KIT-01"
              value={form.sku}
              onChange={(e) => {
                setForm((p) => ({ ...p, sku: e.target.value }));
                setSugestoesOcultas(false);
              }}
            />
            {conflitoSku && (
              <div className="hint" style={{ marginTop: 4, marginBottom: 0, color: "var(--warn)" }}>
                Já existe um {conflitoSku.tipo} com esse SKU: {conflitoSku.nome}
              </div>
            )}
          </div>
          <div className="field">
            <label>Observação (opcional)</label>
            <input type="text" value={form.observacao} onChange={(e) => setForm((p) => ({ ...p, observacao: e.target.value }))} />
          </div>
        </div>
        {sugestoes.length > 0 && (
          <div className="hint" style={{ marginTop: -4 }}>
            Parece com um kit já cadastrado — usar como base copia a composição (produtos + embalagem do kit; o nome e o SKU continuam os que você já
            digitou):
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {sugestoes.map((k) => (
                <button type="button" key={k.id} className="btn" style={{ fontWeight: 400 }} onClick={() => usarComoBase(k)}>
                  Usar "{k.nome}{k.sku ? ` · ${k.sku}` : ""}" como base
                </button>
              ))}
            </div>
          </div>
        )}

        <h3 className="section-title">
          Produtos no kit
          <Ajuda texto="Escolha quais produtos já cadastrados entram nesse kit e quantos de cada. O custo de fabricação do kit é a soma do custo de cada produto incluso — a embalagem fica separada, na seção abaixo." />
        </h3>
        <SeletorItens
          catalogo={catalogoProdutos}
          itens={form.produtosItens}
          onChange={(itens) => setForm((prev) => ({ ...prev, produtosItens: itens }))}
          rotuloVazio="Nenhum produto cadastrado ainda — vá em Cadastros → Produtos."
        />

        <h3 className="section-title">
          Embalagem do kit
          <Ajuda texto="A embalagem de um combo raramente é a soma exata da embalagem de cada produto sozinho — às vezes cabe tudo numa caixa só, às vezes precisa de mais plástico bolha. Por isso o kit tem sua própria receita, independente. Use 'Sugerir' como ponto de partida e ajuste à mão." />
        </h3>
        <button type="button" className="btn" style={{ marginBottom: 10 }} onClick={sugerirEmbalagem}>
          Sugerir com base nos produtos escolhidos
        </button>
        <SeletorItens
          catalogo={catalogoEmbalagens}
          itens={form.embalagemItens}
          onChange={(itens) => setForm((prev) => ({ ...prev, embalagemItens: itens }))}
          rotuloVazio="Nenhuma embalagem cadastrada — vá em Cadastros → Embalagens."
        />

        <div className="panel" style={{ background: "var(--surface-2)", marginTop: 18, marginBottom: 0 }}>
          <div className="kv"><span className="k">Custo de fabricação (produtos)</span><span className="v">{BRL(custoFabricacao)}</span></div>
          <div className="kv"><span className="k">Custo de embalagem do kit</span><span className="v">{BRL(custoEmbalagemKit)}</span></div>
          <div className="kv total"><span className="k">Custo total do kit</span><span className="v">{BRL(custoTotal)}</span></div>
        </div>

        <h3 className="section-title">
          Preço sugerido por canal
          <Ajuda texto="Comparado com vender as peças separadas: separado = soma dos preços salvos das peças em cada canal (* = peça sem preço salvo, usa a margem desejada). O kit paga uma taxa fixa só e uma embalagem, então dá pra cobrar menos mantendo o lucro — essa economia vai pro cliente. Pra salvar o preço, use Precificação por Canal → Avulso (Salvar sugerido) ou o Aplicar em Produtos precificados." />
        </h3>
        {!editandoId ? (
          <div className="hint">Salve o kit pra ver o preço sugerido em cada canal.</div>
        ) : sugestoesCanais.length ? (
          <div className="table-wrap">
            <table className="tabela-sug-kit">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th className="num">Separado</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Cliente economiza</th>
                  <th className="num">Salvo</th>
                </tr>
              </thead>
              <tbody>
                {sugestoesCanais.map(({ c, sug, salvo }) => (
                  <tr key={c.id}>
                    <td>
                      <CanalTag canal={c} />
                    </td>
                    <td className="num">
                      {BRL(sug.separado)}
                      {sug.componentes.some((x) => x.origem === "margem") ? " *" : ""}
                    </td>
                    <td className="num">
                      <b>{BRL(sug.sugerido)}</b>
                      <span className="sub-num">lucro {BRL(sug.lucro)}</span>
                    </td>
                    <td className="num">{Math.round(sug.economiaPct * 100)}%</td>
                    <td className="num">{salvo ? BRL(Number(salvo.preco)) : <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="hint">Cadastre os canais e salve os preços das peças pra ver o sugerido.</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editandoId ? "Salvar alterações" : "+ Cadastrar kit"}
          </button>
          <button type="button" className="btn" onClick={limpar} disabled={salvando}>
            {editandoId ? "Cancelar" : "Limpar"}
          </button>
        </div>
      </div>
    </div>
  );
}
