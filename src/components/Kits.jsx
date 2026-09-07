import { useEffect, useState } from "react";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import Ajuda from "./Ajuda.jsx";

const VAZIO = { nome: "", sku: "", observacao: "", produtosItens: [], embalagemItens: [] };

export default function Kits({ abrirKitId, onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [produtoEmbalagensTodos, setProdutoEmbalagensTodos] = useState([]);
  const [kits, setKits] = useState([]);
  const [kitProdutosTodos, setKitProdutosTodos] = useState([]);
  const [kitEmbalagensTodos, setKitEmbalagensTodos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [markup, setMarkup] = useState(100);
  const [sugestoesOcultas, setSugestoesOcultas] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;

    async function carregarTudo() {
      try {
        let qProdutos = supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true });
        if (lojaId) qProdutos = qProdutos.eq("loja_id", lojaId);
        let qEmbalagens = supabase.from("embalagens").select("*").order("nome", { ascending: true });
        if (lojaId) qEmbalagens = qEmbalagens.eq("loja_id", lojaId);
        let qKits = supabase.from("kits").select("*").order("nome", { ascending: true });
        if (lojaId) qKits = qKits.eq("loja_id", lojaId);

        const [{ data: produtosData, error: e1 }, { data: embalagensData, error: e2 }, { data: kitsData, error: e3 }] =
          await Promise.all([qProdutos, qEmbalagens, qKits]);
        if (!ativo) return;
        if (e1 || e2 || e3) return;

        const produtoIds = (produtosData || []).map((p) => p.id);
        const kitIds = (kitsData || []).map((k) => k.id);

        const [peResp, kpResp, keResp] = await Promise.all([
          produtoIds.length
            ? supabase.from("produto_embalagens").select("*").in("produto_id", produtoIds)
            : Promise.resolve({ data: [] }),
          kitIds.length ? supabase.from("kit_produtos").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
          kitIds.length ? supabase.from("kit_embalagens").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
        ]);
        if (!ativo) return;

        setProdutos(produtosData || []);
        setEmbalagensCatalogo(embalagensData || []);
        setKits(kitsData || []);
        setProdutoEmbalagensTodos(peResp.data || []);
        setKitProdutosTodos(kpResp.data || []);
        setKitEmbalagensTodos(keResp.data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregarTudo();

    const canal = supabase
      .channel("kits-tudo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregarTudo)
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregarTudo)
      .on("postgres_changes", { event: "*", schema: "public", table: "produto_embalagens" }, carregarTudo)
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregarTudo)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_produtos" }, carregarTudo)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_embalagens" }, carregarTudo)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Veio de "Editar completo" em Preços por Canal — carrega o kit certo pra
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

  const catalogoProdutos = produtos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.custo_producao) || 0, unidade: "un" }));
  const catalogoEmbalagens = embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));

  const custoFabricacao = totalItens(catalogoProdutos, form.produtosItens);
  const custoEmbalagemKit = totalItens(catalogoEmbalagens, form.embalagemItens);
  const custoTotal = custoFabricacao + custoEmbalagemKit;
  const precoSugerido = custoTotal * (1 + (Number(markup) || 0) / 100);

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
      await Promise.all([
        supabase.from("kit_produtos").delete().eq("kit_id", kitId),
        supabase.from("kit_embalagens").delete().eq("kit_id", kitId),
      ]);
      const linhasProdutos = (form.produtosItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ kit_id: kitId, produto_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      const linhasEmbalagens = (form.embalagemItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ kit_id: kitId, embalagem_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      const [{ error: erroP }, { error: erroE }] = await Promise.all([
        linhasProdutos.length ? supabase.from("kit_produtos").insert(linhasProdutos) : Promise.resolve({ error: null }),
        linhasEmbalagens.length ? supabase.from("kit_embalagens").insert(linhasEmbalagens) : Promise.resolve({ error: null }),
      ]);
      if (erroP || erroE) {
        setSalvando(false);
        onToast(`Kit salvo, mas houve erro na receita: ${(erroP || erroE).message}`);
        limpar();
        return;
      }
    }
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
        <h3 className="section-title">{editandoId ? "Editar kit" : "Montar kit"}</h3>
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

        <h3 className="section-title" style={{ marginTop: 4 }}>
          Produtos no kit
          <Ajuda texto="Escolha quais produtos já cadastrados entram nesse kit e quantos de cada. O custo de fabricação do kit é a soma do custo de cada produto incluso — a embalagem fica separada, na seção abaixo." />
        </h3>
        <SeletorItens
          catalogo={catalogoProdutos}
          itens={form.produtosItens}
          onChange={(itens) => setForm((prev) => ({ ...prev, produtosItens: itens }))}
          rotuloVazio="Nenhum produto cadastrado ainda — vá em Cadastros → Produtos."
        />

        <h3 className="section-title" style={{ marginTop: 18 }}>
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
          <div className="row2" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Markup desejado (%)</label>
              <input type="number" step="1" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Preço sugerido</label>
              <input type="text" readOnly value={BRL(precoSugerido)} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editandoId ? "Salvar alterações" : "+ Cadastrar kit"}
          </button>
          {editandoId && <button className="btn" onClick={limpar}>Cancelar</button>}
        </div>
        <div className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
          {carregando
            ? "Carregando…"
            : `${kits.length} kit${kits.length === 1 ? "" : "s"} cadastrado${kits.length === 1 ? "" : "s"}. Pra ver, buscar, clonar, editar ou excluir os kits já cadastrados, use Preços por Canal (aba Cadastros).`}
        </div>
      </div>
    </div>
  );
}
