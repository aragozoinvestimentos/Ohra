import { useEffect, useMemo, useState } from "react";
import { arredondarPreco } from "../lib/format.js";
import { calcProducao, DEFAULTS_PRODUCAO } from "../lib/calc.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import DetalhamentoCusto from "./DetalhamentoCusto.jsx";
import Ajuda from "./Ajuda.jsx";

const VAZIO = {
  nome: "",
  sku: "",
  material_nome: "",
  custo_producao: "",
  frete_padrao: "",
  embalagem_padrao: "",
  observacao: "",
  embalagemItens: [],
  producao_detalhe: null,
  pecas_por_impressao: 1,
};

export default function Produtos({ produtoRecebido, abrirProdutoId, onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [, setCarregando] = useState(true);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [materiais, setMateriais] = useState([]);
  const [kitsSku, setKitsSku] = useState([]); // só id/nome/sku, pra conferir SKU duplicado contra Kits também
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [detalheSalvo, setDetalheSalvo] = useState(null); // snapshot carregado do banco, só pra comparar "valor anterior"
  const [pecasPorImpressaoSalvo, setPecasPorImpressaoSalvo] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [sugestoesOcultas, setSugestoesOcultas] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setProdutos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("produtos-cadastro-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Catálogo de embalagens, pra escolher os itens da receita de cada produto.
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("embalagens").select("*").order("nome", { ascending: true });
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setEmbalagensCatalogo(data || []);
    }
    carregar();
    const canal = supabase
      .channel("produtos-embalagens-catalogo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Catálogo de materiais, só pro Detalhamento do custo de produção (mesmas
  // listas de filamento/consumível que a aba Custo de Produção usa).
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("materiais").select("*").order("nome", { ascending: true });
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setMateriais(data || []);
    }
    carregar();
    const canal = supabase
      .channel("produtos-materiais-catalogo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Só nome/SKU dos Kits, pra conferir SKU duplicado contra os dois
  // catálogos (Produtos e Kits) — SKU é pensado como identificador único
  // pra qualquer item, não só dentro de Produtos.
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("kits").select("id, nome, sku");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setKitsSku(data || []);
    }
    carregar();
    const canal = supabase
      .channel("produtos-kits-sku-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  // Abre um produto específico pra edição vindo de outra aba (hoje: o ✎ de
  // "editar cadastro completo" em Preços por Canal) — mesma ação de clicar
  // no ✎ da lista, só que disparada de fora.
  useEffect(() => {
    if (!abrirProdutoId?.id) return;
    (async () => {
      let p = produtos.find((x) => x.id === abrirProdutoId.id) || null;
      if (!p && supabase) {
        const { data } = await supabase.from("produtos_cadastro").select("*").eq("id", abrirProdutoId.id).single();
        p = data || null;
      }
      if (p) editar(p);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirProdutoId?.seq]);

  // SKU pensado como identificador único de qualquer item (produto ou kit) —
  // confere os dois catálogos e avisa sem bloquear salvar (pode ser
  // proposital em algum caso raro).
  function achaConflitoSku(sku, meuProdutoId) {
    const alvo = sku.trim().toLowerCase();
    if (!alvo) return null;
    const emProdutos = produtos.find((p) => p.id !== meuProdutoId && (p.sku || "").trim().toLowerCase() === alvo);
    if (emProdutos) return { tipo: "produto", nome: emProdutos.nome };
    const emKits = kitsSku.find((k) => (k.sku || "").trim().toLowerCase() === alvo);
    if (emKits) return { tipo: "kit", nome: emKits.nome };
    return null;
  }

  // Quando "Salvar como Produto"/"Atualizar produto cadastrado" é clicado na
  // aba de Simular Custo de Produção.
  useEffect(() => {
    if (produtoRecebido == null) return;
    // Veio de um produto já cadastrado (escolhido lá em Simular Custo de
    // Produção) — entra direto no modo de edição desse mesmo produto, em vez
    // de criar um duplicado, preservando frete/embalagem/observação já salvos.
    if (produtoRecebido.id) {
      (async () => {
        let pExistente = produtos.find((p) => p.id === produtoRecebido.id) || null;
        if (!pExistente && supabase) {
          const { data } = await supabase.from("produtos_cadastro").select("*").eq("id", produtoRecebido.id).single();
          pExistente = data || null;
        }
        let itens = [];
        if (supabase) {
          const { data } = await supabase.from("produto_embalagens").select("*").eq("produto_id", produtoRecebido.id);
          itens = (data || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
        }
        setEditandoId(produtoRecebido.id);
        setForm({
          nome: produtoRecebido.nome || pExistente?.nome || "",
          sku: pExistente?.sku || "",
          material_nome: produtoRecebido.materialNome || pExistente?.material_nome || "",
          custo_producao: arredondarPreco(produtoRecebido.custo),
          frete_padrao: arredondarPreco(pExistente?.frete_padrao || 0),
          embalagem_padrao: arredondarPreco(pExistente?.embalagem_padrao || 0),
          observacao: pExistente?.observacao || "",
          embalagemItens: itens,
          producao_detalhe: produtoRecebido.detalhe || null,
          pecas_por_impressao: produtoRecebido.pecasPorImpressao ?? pExistente?.pecas_por_impressao ?? 1,
        });
        setDetalheSalvo(produtoRecebido.detalhe || null);
        setPecasPorImpressaoSalvo(produtoRecebido.pecasPorImpressao ?? pExistente?.pecas_por_impressao ?? 1);
      })();
      return;
    }
    setEditandoId(null);
    setForm({
      ...VAZIO,
      material_nome: produtoRecebido.materialNome || "",
      custo_producao: arredondarPreco(produtoRecebido.custo),
      producao_detalhe: produtoRecebido.detalhe || null,
      pecas_por_impressao: produtoRecebido.pecasPorImpressao ?? 1,
    });
    // Nada aparece como "alterado" logo depois de trazer da Simular Custo de
    // Produção — o snapshot de referência começa igual ao que acabou de vir.
    setDetalheSalvo(produtoRecebido.detalhe || null);
    setPecasPorImpressaoSalvo(produtoRecebido.pecasPorImpressao ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoRecebido?.seq]);

  const setCampo = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const catalogoEmbalagem = embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));
  const usaReceitaEmbalagem = (form.embalagemItens || []).length > 0;
  const custoEmbalagemReceita = totalItens(catalogoEmbalagem, form.embalagemItens);

  const filamentos = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  const consumiveisCatalogo = materiais
    .filter((m) => m.tipo === "consumivel")
    .map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));

  const custoConsumiveisDetalhe = form.producao_detalhe
    ? totalItens(consumiveisCatalogo, form.producao_detalhe.consumiveisItens || [])
    : 0;

  // Mesma fórmula da aba Custo de Produção — recalcula ao vivo com o preço
  // ATUAL do material selecionado, não um valor congelado do dia do cadastro.
  const resultadoDetalhe = useMemo(() => {
    if (!form.producao_detalhe) return null;
    const d = form.producao_detalhe;
    const material = filamentos.find((m) => m.nome === d.materialNome) || filamentos[0] || null;
    const n = (v) => {
      const x = Number(v);
      return isFinite(x) ? x : 0;
    };
    return calcProducao({
      comprimento: n(d.comprimento),
      diametro: n(d.diametro),
      densidade: n(d.densidade),
      tempo: n(d.tempo),
      precoKg: material?.preco ?? 0,
      kwh: n(d.kwh),
      consumo: n(d.consumo),
      falhasPct: n(d.falhasPct) / 100,
      manutencaoPct: n(d.manutencaoPct) / 100,
      acabamentoPct: n(d.acabamentoPct) / 100,
      consumiveis: custoConsumiveisDetalhe,
      maquina: n(d.maquina),
      prazoMeses: n(d.prazoMeses),
      horasDia: n(d.horasDia),
      diasMes: n(d.diasMes),
      modelagem: n(d.modelagem),
      markupRapido: 0,
      pecasPorPlaca: n(form.pecas_por_impressao) || 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producao_detalhe, form.pecas_por_impressao, filamentos, custoConsumiveisDetalhe]);

  function limpar() {
    setForm(VAZIO);
    setEditandoId(null);
    setDetalheSalvo(null);
    setPecasPorImpressaoSalvo(null);
  }

  function iniciarDetalhamento() {
    setForm((prev) => ({
      ...prev,
      producao_detalhe: { ...DEFAULTS_PRODUCAO, materialNome: filamentos[0]?.nome || "" },
    }));
  }

  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao produto");
      return;
    }
    const payload = {
      nome,
      sku: form.sku.trim() || null,
      material_nome: form.material_nome.trim() || null,
      custo_producao: arredondarPreco(resultadoDetalhe ? resultadoDetalhe.total : parseFloat(form.custo_producao) || 0),
      frete_padrao: arredondarPreco(parseFloat(form.frete_padrao) || 0),
      embalagem_padrao: arredondarPreco(usaReceitaEmbalagem ? custoEmbalagemReceita : parseFloat(form.embalagem_padrao) || 0),
      observacao: form.observacao.trim() || null,
      producao_detalhe: form.producao_detalhe || null,
      pecas_por_impressao: Math.max(1, parseInt(form.pecas_por_impressao, 10) || 1),
      atualizado_em: new Date().toISOString(),
    };
    setSalvando(true);
    let produtoId = editandoId;
    let error;
    if (editandoId) {
      ({ error } = await supabase.from("produtos_cadastro").update(payload).eq("id", editandoId));
    } else {
      const resposta = await supabase
        .from("produtos_cadastro")
        .insert({ ...payload, ...(lojaId ? { loja_id: lojaId } : {}) })
        .select()
        .single();
      error = resposta.error;
      produtoId = resposta.data?.id;
    }
    if (error) {
      setSalvando(false);
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    // Grava a receita de embalagem: apaga o que já existia e recria — lista
    // curta, mais simples e seguro que tentar diferenciar linha por linha.
    if (produtoId) {
      await supabase.from("produto_embalagens").delete().eq("produto_id", produtoId);
      const linhas = (form.embalagemItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ produto_id: produtoId, embalagem_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      if (linhas.length > 0) {
        const { error: erroReceita } = await supabase.from("produto_embalagens").insert(linhas);
        if (erroReceita) {
          setSalvando(false);
          onToast(`Produto salvo, mas a receita de embalagem falhou: ${erroReceita.message}`);
          limpar();
          return;
        }
      }
    }
    setSalvando(false);
    onToast(editandoId ? "Produto atualizado" : "Produto cadastrado");
    limpar();
  }

  async function editar(p) {
    setEditandoId(p.id);
    let itens = [];
    if (supabase) {
      const { data } = await supabase.from("produto_embalagens").select("*").eq("produto_id", p.id);
      itens = (data || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    }
    setForm({
      nome: p.nome,
      sku: p.sku || "",
      material_nome: p.material_nome || "",
      custo_producao: arredondarPreco(p.custo_producao),
      frete_padrao: arredondarPreco(p.frete_padrao),
      embalagem_padrao: arredondarPreco(p.embalagem_padrao),
      observacao: p.observacao || "",
      embalagemItens: itens,
      producao_detalhe: p.producao_detalhe || null,
      pecas_por_impressao: p.pecas_por_impressao ?? 1,
    });
    setDetalheSalvo(p.producao_detalhe || null);
    setPecasPorImpressaoSalvo(p.pecas_por_impressao ?? 1);
  }

  // Puxa os dados de um produto já cadastrado como ponto de partida pra um
  // novo (ex: uma variação de cor/tamanho) — igual ao Clonar de Preços por
  // Canal, mas sem criar nada ainda: só preenche o formulário. Nome e SKU
  // ficam do jeito que a pessoa já tinha digitado (é o que diferencia essa
  // variação da original), só o resto vem copiado.
  async function usarComoBase(p) {
    let itens = [];
    if (supabase) {
      const { data } = await supabase.from("produto_embalagens").select("*").eq("produto_id", p.id);
      itens = (data || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    }
    setForm((prev) => ({
      ...prev,
      material_nome: p.material_nome || "",
      custo_producao: arredondarPreco(p.custo_producao),
      frete_padrao: arredondarPreco(p.frete_padrao),
      embalagem_padrao: arredondarPreco(p.embalagem_padrao),
      observacao: p.observacao || "",
      embalagemItens: itens,
      producao_detalhe: p.producao_detalhe || null,
      pecas_por_impressao: p.pecas_por_impressao ?? 1,
    }));
    setDetalheSalvo(p.producao_detalhe || null);
    setPecasPorImpressaoSalvo(p.pecas_por_impressao ?? 1);
    setSugestoesOcultas(true);
    onToast(`Dados de "${p.nome}" usados como base — nome e SKU continuam os que você digitou, ajuste o resto se precisar antes de salvar`);
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Produtos</h3>
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
      : produtos
          .filter(
            (p) =>
              (nomeQuery.length >= 2 && p.nome.toLowerCase().includes(nomeQuery)) ||
              (skuQuery.length >= 2 && (p.sku || "").toLowerCase().includes(skuQuery))
          )
          .slice(0, 5);

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">{editandoId ? "Editar produto" : "Cadastrar produto"}</h3>
        <div className="row3">
          <div className="field">
            <label>Nome do produto</label>
            <input
              type="text"
              placeholder="ex: Vaso decorativo médio"
              value={form.nome}
              onChange={(e) => {
                setCampo("nome")(e);
                setSugestoesOcultas(false);
              }}
            />
          </div>
          <div className="field">
            <label>
              SKU (opcional)
              <Ajuda texto="Código próprio seu pra identificar o produto (o mesmo que você usa no Shopee/ML/etc, se tiver). Não é obrigatório — dá pra deixar em branco e preencher depois. Serve pra buscar mais rápido e, no futuro, vincular qualquer métrica a esse código." />
            </label>
            <input
              type="text"
              placeholder="ex: VS-MED-01"
              value={form.sku}
              onChange={(e) => {
                setCampo("sku")(e);
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
            <label>Material</label>
            <input type="text" placeholder="ex: PLA (seu custo real)" value={form.material_nome} onChange={setCampo("material_nome")} />
          </div>
        </div>
        {sugestoes.length > 0 && (
          <div className="hint" style={{ marginTop: -4 }}>
            Parece com um produto já cadastrado — usar como base copia material, custo, frete, embalagem e detalhamento (o nome e o SKU continuam os que
            você já digitou):
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {sugestoes.map((p) => (
                <button type="button" key={p.id} className="btn" style={{ fontWeight: 400 }} onClick={() => usarComoBase(p)}>
                  Usar "{p.nome}{p.sku ? ` · ${p.sku}` : ""}" como base
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row3">
          <div className="field">
            <label>Custo de produção (R$)</label>
            <input
              type="number"
              step="0.01"
              disabled={!!form.producao_detalhe}
              value={form.producao_detalhe ? resultadoDetalhe?.total.toFixed(2) ?? "0.00" : form.custo_producao}
              onChange={setCampo("custo_producao")}
              title={form.producao_detalhe ? "Calculado a partir do detalhamento abaixo" : "Valor manual — preencha o detalhamento abaixo pra calcular sozinho"}
            />
          </div>
          <div className="field">
            <label>Frete padrão (R$)</label>
            <input type="number" step="0.01" value={form.frete_padrao} onChange={setCampo("frete_padrao")} />
          </div>
          <div className="field">
            <label>Embalagem (R$)</label>
            <input
              type="number"
              step="0.01"
              disabled={usaReceitaEmbalagem}
              value={usaReceitaEmbalagem ? custoEmbalagemReceita.toFixed(2) : form.embalagem_padrao}
              onChange={setCampo("embalagem_padrao")}
              title={usaReceitaEmbalagem ? "Calculado a partir dos itens de embalagem abaixo" : "Valor manual — some itens abaixo pra calcular sozinho"}
            />
          </div>
        </div>
        <div className="field">
          <label>Observação (opcional)</label>
          <input type="text" value={form.observacao} onChange={setCampo("observacao")} />
        </div>

        <h3 className="section-title" style={{ marginTop: 4 }}>
          Itens de embalagem
          <Ajuda texto="Escolha os itens (cadastrados em Cadastros → Embalagens) que esse produto gasta pra ser enviado, e quantos de cada. O total substitui o campo manual 'Embalagem' acima e atualiza sozinho se o preço de um item mudar. Deixe vazio pra usar o campo manual." />
        </h3>
        <SeletorItens
          catalogo={catalogoEmbalagem}
          itens={form.embalagemItens}
          onChange={(itens) => setForm((prev) => ({ ...prev, embalagemItens: itens }))}
          rotuloVazio='Nenhuma embalagem cadastrada — cadastre em Cadastros → Embalagens (caixa, plástico bolha...), ou use o campo manual acima.'
        />

        <h3 className="section-title" style={{ marginTop: 4 }}>
          Detalhamento do custo de produção
          <Ajuda texto="As métricas que geraram o custo de produção desse produto (filamento, tempo de impressão, consumíveis, ROI da máquina etc.), pra você consultar ou ajustar depois. Recalcula ao vivo com os preços ATUAIS de material. Ao lado de um campo que você mudou aparece '(era X)' com o valor salvo antes dessa edição." />
        </h3>
        <DetalhamentoCusto
          detalhe={form.producao_detalhe}
          salvo={detalheSalvo}
          filamentos={filamentos}
          consumiveisCatalogo={consumiveisCatalogo}
          resultado={resultadoDetalhe}
          custoConsumiveis={custoConsumiveisDetalhe}
          onChange={(detalhe) => setForm((prev) => ({ ...prev, producao_detalhe: detalhe }))}
          onIniciar={iniciarDetalhamento}
          pecasPorImpressao={form.pecas_por_impressao}
          pecasPorImpressaoSalvo={pecasPorImpressaoSalvo}
          onChangePecasPorImpressao={(v) => setForm((prev) => ({ ...prev, pecas_por_impressao: v }))}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editandoId ? "Salvar alterações" : "+ Cadastrar produto"}
          </button>
          <button type="button" className="btn" onClick={limpar} disabled={salvando}>
            {editandoId ? "Cancelar" : "Limpar"}
          </button>
        </div>
        <div className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
          Dica: na aba Custo de Produção, o botão "Salvar como Produto" já traz o custo calculado pra cá. Pra ver, buscar, clonar, editar ou excluir os
          produtos já cadastrados, use Preços por Canal (aba Cadastros).
        </div>
      </div>
    </div>
  );
}
