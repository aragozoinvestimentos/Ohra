import { useEffect, useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { calcProducao, DEFAULTS_PRODUCAO } from "../lib/calc.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import DetalhamentoCusto from "./DetalhamentoCusto.jsx";
import Ajuda from "./Ajuda.jsx";

const VAZIO = {
  nome: "",
  material_nome: "",
  custo_producao: "",
  frete_padrao: "",
  embalagem_padrao: "",
  observacao: "",
  embalagemItens: [],
  producao_detalhe: null,
};

export default function Produtos({ produtoRecebido, onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [materiais, setMateriais] = useState([]);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [detalheSalvo, setDetalheSalvo] = useState(null); // snapshot carregado do banco, só pra comparar "valor anterior"
  const [salvando, setSalvando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);

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

  // Quando "Salvar como Produto" é clicado na aba de Custo de Produção.
  useEffect(() => {
    if (produtoRecebido == null) return;
    setEditandoId(null);
    setForm({
      ...VAZIO,
      material_nome: produtoRecebido.materialNome || "",
      custo_producao: produtoRecebido.custo,
      producao_detalhe: produtoRecebido.detalhe || null,
    });
    // Nada aparece como "alterado" logo depois de trazer da Custo de
    // Produção — o snapshot de referência começa igual ao que acabou de vir.
    setDetalheSalvo(produtoRecebido.detalhe || null);
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producao_detalhe, filamentos, custoConsumiveisDetalhe]);

  function limpar() {
    setForm(VAZIO);
    setEditandoId(null);
    setDetalheSalvo(null);
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
      material_nome: form.material_nome.trim() || null,
      custo_producao: resultadoDetalhe ? resultadoDetalhe.total : parseFloat(form.custo_producao) || 0,
      frete_padrao: parseFloat(form.frete_padrao) || 0,
      embalagem_padrao: usaReceitaEmbalagem ? custoEmbalagemReceita : parseFloat(form.embalagem_padrao) || 0,
      observacao: form.observacao.trim() || null,
      producao_detalhe: form.producao_detalhe || null,
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
      material_nome: p.material_nome || "",
      custo_producao: p.custo_producao,
      frete_padrao: p.frete_padrao,
      embalagem_padrao: p.embalagem_padrao,
      observacao: p.observacao || "",
      embalagemItens: itens,
      producao_detalhe: p.producao_detalhe || null,
    });
    setDetalheSalvo(p.producao_detalhe || null);
  }

  // Antes de excluir, avisa se o produto está em uso em algum kit — pra não
  // sumir silenciosamente de um combo já montado.
  async function pedirExclusao(p) {
    if (!supabase) {
      setExcluirAlvo({ ...p, emKits: 0 });
      return;
    }
    const { count } = await supabase.from("kit_produtos").select("id", { count: "exact", head: true }).eq("produto_id", p.id);
    setExcluirAlvo({ ...p, emKits: count || 0 });
  }

  async function excluir(id) {
    const { error } = await supabase.from("produtos_cadastro").delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    if (editandoId === id) limpar();
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Produtos</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  const usoMsg = (alvo) => {
    if (!alvo.emKits) return `Confirma excluir "${alvo.nome}"? Não é possível desfazer.`;
    return `"${alvo.nome}" está em uso em ${alvo.emKits} kit(s). Excluir remove ele desses kits também. Não é possível desfazer.`;
  };

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">{editandoId ? "Editar produto" : "Cadastrar produto"}</h3>
        <div className="row2">
          <div className="field">
            <label>Nome do produto</label>
            <input type="text" placeholder="ex: Vaso decorativo médio" value={form.nome} onChange={setCampo("nome")} />
          </div>
          <div className="field">
            <label>Material</label>
            <input type="text" placeholder="ex: PLA (seu custo real)" value={form.material_nome} onChange={setCampo("material_nome")} />
          </div>
        </div>
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
        />

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editandoId ? "Salvar alterações" : "+ Cadastrar produto"}
          </button>
          {editandoId && (
            <button className="btn" onClick={limpar}>Cancelar</button>
          )}
        </div>
        <div className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
          Dica: na aba Custo de Produção, o botão "Salvar como Produto" já traz o custo calculado pra cá.
        </div>
      </div>

      <div className="panel">
        <h3>Produtos cadastrados</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : produtos.length === 0 ? (
          <div className="empty">Nenhum produto cadastrado ainda.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Material</th>
                  <th className="num">Custo</th>
                  <th className="num">Frete</th>
                  <th className="num">Embalagem</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td>{p.material_nome || "—"}</td>
                    <td className="num">{BRL(p.custo_producao)}</td>
                    <td className="num">{BRL(p.frete_padrao)}</td>
                    <td className="num">{BRL(p.embalagem_padrao)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="del" title="Editar" onClick={() => editar(p)}>✎</button>
                      <button className="del" title="Excluir" onClick={() => pedirExclusao(p)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir produto"
          mensagem={usoMsg(excluirAlvo)}
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
