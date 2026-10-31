import { usePreferencia } from "../hooks/usePreferencia.js";
import { useEffect, useMemo, useState } from "react";
import ImpactoCusto from "./ImpactoCusto.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { impactoProduto } from "../lib/impactoCusto.js";
import { arredondarPreco } from "../lib/format.js";
import { calcProducao, custoArtesanal, DEFAULTS_PRODUCAO, entradaDoDetalhe } from "../lib/calc.js";
import { impressoraPadrao, maquinaDoProduto } from "../lib/farm.js";
import { lerUltimosPercentuais, salvarUltimosPercentuais } from "../lib/preferenciasProducao.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { trocarLinhas } from "../lib/trocarLinhas.js";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import DetalhamentoCusto from "./DetalhamentoCusto.jsx";
import Ajuda from "./Ajuda.jsx";
import VariacoesProduto from "./VariacoesProduto.jsx";
import QuandoVende from "./QuandoVende.jsx";
import { EmbalagemOrganicoBloco } from "./EmbalagemOrganico.jsx";
import BlocoRevenda from "./BlocoRevenda.jsx";
import CalculadoraPreco from "./CalculadoraPreco.jsx";
import DadosFiscais from "./DadosFiscais.jsx";
import { useRevenda } from "../hooks/useRevenda.js";
import { quandoVendeDe } from "../lib/calendario.js";
import { abrirProduto } from "../lib/anuncios.js";

// Barra das etapas do cadastro: ✓ feito · ● agora · – pulado · número = falta.
function PassosCadastro({ passos, passo, feitos, pulados, liberado, onIr }) {
  return (
    <nav className="cad-passos" aria-label="Etapas do cadastro">
      {passos.map((p, i) => {
        const agora = i === passo;
        const cls = agora ? "agora" : feitos[p.id] ? "feito" : pulados[p.id] ? "pulado" : "";
        const b = !agora && feitos[p.id] ? "✓" : !agora && pulados[p.id] ? "–" : i + 1;
        return (
          <button key={p.id} type="button" className={`cad-passo ${cls}`} aria-current={agora ? "step" : undefined} disabled={!liberado && i > 0} onClick={() => onIr(i)}>
            <span className="cad-b">{b}</span>
            <span>
              <span className="cad-t">{p.t}</span>
              <span className="cad-s">{!agora && pulados[p.id] && !feitos[p.id] ? "pulado" : p.s}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

const VAZIO = {
  nome: "",
  sku: "",
  material_nome: "",
  material_id: null,
  custo_producao: "",
  frete_padrao: "",
  embalagem_padrao: "",
  observacao: "",
  embalagemItens: [],
  producao_detalhe: null,
  pecas_por_impressao: 1,
  peso_g: "",
  impressora_id: null,
  origem: "fabricado",
  ean: "",
  fornecedor_id: null,
  // fiscais (v69)
  ncm: "",
  cest: "",
  unidade_com: "",
  origem_mercadoria: "",
  imposto_st: null,
  monofasico: null,
};

// Pedidos de "abrir pra editar" vindos de outras telas (23/10/2026): cada um vale
// UMA vez — o formulário remonta ao trocar de sub-aba e reaplicava um "Salvar
// como produto" antigo por cima do produto pedido. E só na loja em que foi feito.
const pedidosUsados = new Set();
const pedidoNovo = (tipo, pedido, lojaId) => {
  if (!pedido?.seq) return false;
  const k = `${tipo}|${pedido.seq}`;
  if (pedidosUsados.has(k)) return false;
  pedidosUsados.add(k);
  return !pedido.lojaId || pedido.lojaId === lojaId;
};
const daLoja = (p, lojaId) => !!p && (!p.loja_id || !lojaId || p.loja_id === lojaId);

export default function Produtos({ produtoRecebido, abrirProdutoId, onToast, onProdutoCriado }) {
  const { lojaId } = useLoja();
  usePreferencia("producao:ultimos-percentuais", null); // carrega do banco os últimos % de falha/manutenção/acabamento
  // Produtos (crus, como estão no banco — o formulário edita os valores
  // gravados), embalagens e materiais (receita e detalhamento) e kits (SKU
  // duplicado) vêm do catálogo compartilhado: uma busca + um realtime.
  const { produtos, embalagens: embalagensCatalogo, materiais, kits: kitsSku, impressoras, farmConfig, carregando, canais: canaisCat = [], variacoes: variacoesCat = [] } = useCatalogo();
  const revendaDados = useRevenda();
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [detalheSalvo, setDetalheSalvo] = useState(null); // snapshot carregado do banco, só pra comparar "valor anterior"
  const [pecasPorImpressaoSalvo, setPecasPorImpressaoSalvo] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [sugestoesOcultas, setSugestoesOcultas] = useState(false);
  // Cadastro em etapas (31/10/2026, aprovado pela prévia): 1 O que é · 2 Custo · 3 Embalagem ·
  // 4 Quando vende · 5 Variações · 6 Fiscal · Pronto. A etapa 1 já salva o produto.
  const [passo, setPasso] = useState(0);
  const [pulados, setPulados] = useState({});
  const ehRev = form.origem === "revenda";
  const temNotas = ehRev && !!editandoId && revendaDados.comprasItens.some((i) => i.produto_id === editandoId);

  // Abre um produto específico pra edição vindo de outra aba (hoje: o ✎ de
  // "editar cadastro completo" em Produtos precificados) — mesma ação de clicar
  // no ✎ da lista, só que disparada de fora.
  useEffect(() => {
    if (!abrirProdutoId?.id || !pedidoNovo("abrir", abrirProdutoId, lojaId)) return;
    (async () => {
      let p = produtos.find((x) => x.id === abrirProdutoId.id) || null;
      if (!p && supabase) {
        const { data } = await supabase.from("produtos_cadastro").select("*").eq("id", abrirProdutoId.id).single();
        p = data || null;
      }
      if (daLoja(p, lojaId)) editar(p);
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

  // Tenta achar o id do material no catálogo a partir de um nome solto (ex:
  // vindo de Custo de Produção, que ainda escolhe o material por
  // nome) — comparação sem diferenciar maiúscula/minúscula nem espaço nas
  // pontas. Só um "melhor esforço": se não achar (nome digitado à mão, ou
  // material já renomeado/excluído do catálogo), devolve null e o nome
  // continua exibido do jeito que veio, sem vínculo — nunca chuta.
  function acharMaterialIdPorNome(nome) {
    const alvo = (nome || "").trim().toLowerCase();
    if (!alvo) return null;
    const achado = materiais.find((m) => (m.nome || "").trim().toLowerCase() === alvo);
    return achado?.id || null;
  }

  // Quando "Salvar como Produto"/"Atualizar produto cadastrado" é clicado na
  // aba de Custo de Produção.
  useEffect(() => {
    if (produtoRecebido == null || !pedidoNovo("recebido", produtoRecebido, lojaId)) return;
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
        if (pExistente && !daLoja(pExistente, lojaId)) return; // produto de outra loja: nunca abre aqui
        let itens = [];
        if (supabase) {
          const { data } = await supabase.from("produto_embalagens").select("*").eq("produto_id", produtoRecebido.id);
          itens = (data || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
        }
        setEditandoId(produtoRecebido.id);
        setForm({
          ...VAZIO,
          // campos de revenda/fiscais do produto (30/10/2026: vinham vazios e o Salvar quebrava — e apagaria EAN/NCM)
          origem: pExistente?.origem === "revenda" ? "revenda" : "fabricado",
          ean: pExistente?.ean || "",
          fornecedor_id: pExistente?.fornecedor_id || null,
          ncm: pExistente?.ncm || "",
          cest: pExistente?.cest || "",
          unidade_com: pExistente?.unidade_com || "",
          origem_mercadoria: pExistente?.origem_mercadoria || "",
          imposto_st: pExistente?.imposto_st ?? null,
          monofasico: pExistente?.monofasico ?? null,
          nome: produtoRecebido.nome || pExistente?.nome || "",
          sku: pExistente?.sku || "",
          material_nome: produtoRecebido.materialNome || pExistente?.material_nome || "",
          // Se veio um material novo de Custo de Produção, tenta
          // religar pelo nome; senão mantém o vínculo que o produto já tinha.
          material_id: produtoRecebido.materialNome ? acharMaterialIdPorNome(produtoRecebido.materialNome) : pExistente?.material_id ?? null,
          custo_producao: arredondarPreco(produtoRecebido.custo),
          frete_padrao: arredondarPreco(pExistente?.frete_padrao || 0),
          embalagem_padrao: arredondarPreco(pExistente?.embalagem_padrao || 0),
          observacao: pExistente?.observacao || "",
          embalagemItens: itens,
          producao_detalhe: produtoRecebido.detalhe || null,
          pecas_por_impressao: produtoRecebido.pecasPorImpressao ?? pExistente?.pecas_por_impressao ?? 1,
          peso_g: produtoRecebido.peso ? String(Math.round(produtoRecebido.peso)) : pExistente?.peso_g != null ? String(pExistente.peso_g) : "",
          impressora_id: produtoRecebido.impressoraId || pExistente?.impressora_id || null,
        });
        setDetalheSalvo(produtoRecebido.detalhe || null);
        setPecasPorImpressaoSalvo(produtoRecebido.pecasPorImpressao ?? pExistente?.pecas_por_impressao ?? 1);
        setPasso(1);
      })();
      return;
    }
    setEditandoId(null);
    setForm({
      ...VAZIO,
      material_nome: produtoRecebido.materialNome || "",
      material_id: acharMaterialIdPorNome(produtoRecebido.materialNome || ""),
      custo_producao: arredondarPreco(produtoRecebido.custo),
      producao_detalhe: produtoRecebido.detalhe || null,
      pecas_por_impressao: produtoRecebido.pecasPorImpressao ?? 1,
      peso_g: produtoRecebido.peso ? String(Math.round(produtoRecebido.peso)) : "",
      impressora_id: produtoRecebido.impressoraId || null,
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
  // Máquina da impressora escolhida (Minha farm, lib/farm.js); sem farm
  // configurada, null → conta antiga pelos campos do detalhamento.
  const maquinaForm = useMemo(() => maquinaDoProduto({ impressora_id: form.impressora_id }, impressoras, farmConfig), [form.impressora_id, impressoras, farmConfig]);
  const resultadoDetalhe = useMemo(() => {
    if (!form.producao_detalhe) return null;
    const d = form.producao_detalhe;
    const material = filamentos.find((m) => m.nome === d.materialNome) || filamentos[0] || null;
    return calcProducao(
      entradaDoDetalhe(d, { precoKg: material?.preco ?? 0, consumiveis: custoConsumiveisDetalhe, pecasPorPlaca: form.pecas_por_impressao, maquina: maquinaForm, artesanal: custoArtesanal(d, materiais), materiais })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producao_detalhe, form.pecas_por_impressao, filamentos, custoConsumiveisDetalhe, maquinaForm, materiais]);

  // Impacto da edição no lucro do produto, das variações e dos kits (ao vivo).
  const dadosVivos = useEscada();
  const impacto = useMemo(() => {
    if (!editandoId) return null;
    const atual = dadosVivos.produtos.find((p) => p.id === editandoId);
    if (!atual) return null;
    const receita = (form.embalagemItens || []).filter((it) => it.itemId).map((it) => ({ embalagem_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
    const novoRaw = {
      ...atual,
      custo_producao: resultadoDetalhe ? resultadoDetalhe.total : parseFloat(form.custo_producao) || 0,
      frete_padrao: parseFloat(form.frete_padrao) || 0,
      embalagem_padrao: usaReceitaEmbalagem ? custoEmbalagemReceita : parseFloat(form.embalagem_padrao) || 0,
      producao_detalhe: form.producao_detalhe || null,
      pecas_por_impressao: Math.max(1, parseInt(form.pecas_por_impressao, 10) || 1),
      peso_g: form.peso_g === "" || form.peso_g == null ? null : Number(String(form.peso_g).replace(",", ".")) || null,
      impressora_id: form.impressora_id || null,
      _maquina: maquinaForm,
    };
    return impactoProduto({ produtoId: editandoId, produtoNovoRaw: novoRaw, receitaNova: receita, dados: dadosVivos, cfgDoProduto: dadosVivos.cfgDoProduto });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editandoId, form, resultadoDetalhe, usaReceitaEmbalagem, custoEmbalagemReceita, dadosVivos.produtos, dadosVivos.itens, dadosVivos.precos, dadosVivos.canais, maquinaForm]);

  const PASSOS_CAD = [
    { id: "oque", t: "O que é", s: "nome, SKU, tipo", salva: true },
    { id: "custo", t: "Custo", s: ehRev ? "custo de compra" : "produção", salva: true },
    { id: "emb", t: "Embalagem", s: "marketplace + orgânico", salva: true },
    { id: "quando", t: "Quando vende", s: "ano, pico, época" },
    { id: "var", t: "Variações", s: "kit 2, kit 3…" },
    { id: "fiscal", t: "Fiscal", s: "opcional", salva: true },
    { id: "pronto", t: "Pronto", s: "ir pro preço" },
  ];
  const nPos = (v) => Number(String(v ?? "").replace(",", ".")) > 0;
  const produtoAtual = editandoId ? produtos.find((x) => x.id === editandoId) || null : null;
  const feitos = {
    oque: !!editandoId,
    custo: !!editandoId && (ehRev ? temNotas || nPos(form.custo_producao) : !!form.producao_detalhe || nPos(form.custo_producao)),
    emb: !!editandoId && (usaReceitaEmbalagem || nPos(form.embalagem_padrao)),
    quando: !!quandoVendeDe(produtoAtual),
    var: !!editandoId && (variacoesCat || []).some((v) => v.produto_id === editandoId),
    fiscal: !!editandoId && !!String(form.ncm || "").trim(),
    pronto: false,
  };
  const faltam = PASSOS_CAD.filter((x) => x.id !== "pronto" && !feitos[x.id]).map((x) => x.t);
  function irPasso(i) {
    if (i > 0 && !editandoId) return onToast("Salve a etapa 1 (O que é) primeiro");
    setPasso(i);
  }

  function limpar() {
    setPasso(0);
    setPulados({});
    setForm(VAZIO);
    setEditandoId(null);
    setDetalheSalvo(null);
    setPecasPorImpressaoSalvo(null);
  }

  function iniciarDetalhamento() {
    setForm((prev) => ({
      ...prev,
      producao_detalhe: {
        ...DEFAULTS_PRODUCAO,
        ...lerUltimosPercentuais(DEFAULTS_PRODUCAO),
        materialNome: filamentos[0]?.nome || "",
      },
    }));
  }

  async function salvar({ irPara = null } = {}) {
    const nome = String(form.nome || "").trim();
    if (!nome) {
      onToast("Dê um nome ao produto");
      return;
    }
    // Guarda se era cadastro novo ANTES de qualquer coisa mudar editandoId —
    // só um produto recém-criado (não uma edição) ganha o atalho "Ir para
    // Precificação por Canal" depois de salvar.
    const eraNovo = !editandoId;
    const payload = {
      nome,
      sku: String(form.sku || "").trim() || null,
      material_nome: String(form.material_nome || "").trim() || null,
      material_id: form.material_id || null,
      custo_producao: arredondarPreco(resultadoDetalhe ? resultadoDetalhe.total : parseFloat(form.custo_producao) || 0),
      frete_padrao: arredondarPreco(parseFloat(form.frete_padrao) || 0),
      embalagem_padrao: arredondarPreco(usaReceitaEmbalagem ? custoEmbalagemReceita : parseFloat(form.embalagem_padrao) || 0),
      observacao: String(form.observacao || "").trim() || null,
      producao_detalhe: form.producao_detalhe || null,
      pecas_por_impressao: Math.max(1, parseInt(form.pecas_por_impressao, 10) || 1),
      peso_g: form.peso_g === "" || form.peso_g == null ? null : Number(String(form.peso_g).replace(",", ".")) || null,
      ...(impressoras.length ? { impressora_id: form.impressora_id || impressoraPadrao(impressoras)?.id || null } : {}),
      // Revenda (v66): o custo vem das notas de compra — o detalhamento da impressão
      // (se houver) fica guardado, mas não é usado (aoVivo.js olha a origem).
      origem: form.origem === "revenda" ? "revenda" : "fabricado",
      ean: String(form.ean || "").trim() || null,
      fornecedor_id: form.fornecedor_id || null,
      // fiscais (v69): sem a coluna, salva o resto e avisa
      ncm: String(form.ncm || "").replace(/\D/g, "") || null,
      cest: String(form.cest || "").replace(/\D/g, "") || null,
      unidade_com: String(form.unidade_com || "").trim() || null,
      origem_mercadoria: form.origem_mercadoria || null,
      imposto_st: form.imposto_st ?? null,
      monofasico: form.monofasico ?? null,
      atualizado_em: new Date().toISOString(),
    };
    if (form.origem === "revenda") payload.custo_producao = arredondarPreco(parseFloat(form.custo_producao) || 0);
    setSalvando(true);
    let produtoId = editandoId;
    let error;
    // Se a coluna peso_g ainda não existir (schema v26 não rodado), salva o
    // resto do produto mesmo assim e avisa — não trava o cadastro.
    async function gravar(dados) {
      if (editandoId) {
        const r = await supabase.from("produtos_cadastro").update(dados).eq("id", editandoId);
        return { error: r.error, id: editandoId };
      }
      const r = await supabase
        .from("produtos_cadastro")
        .insert({ ...dados, ...(lojaId ? { loja_id: lojaId } : {}) })
        .select()
        .single();
      return { error: r.error, id: r.data?.id };
    }
    let resp = await gravar(payload);
    if (resp.error && /ncm|cest|unidade_com|origem_mercadoria|monofasico/.test(resp.error.message || "")) {
      const { ncm: _n, cest: _c, unidade_com: _u, origem_mercadoria: _om, monofasico: _m, ...semFiscal } = payload;
      resp = await gravar(semFiscal);
      if (!resp.error) onToast("Produto salvo sem os dados fiscais — rode o schema_v69.sql no Supabase");
    }
    if (resp.error && /origem|ean|fornecedor_id/.test(resp.error.message || "")) {
      const { origem: _o, ean: _e, fornecedor_id: _f, ...semRevenda } = payload;
      resp = await gravar(semRevenda);
      if (!resp.error) onToast("Produto salvo sem os campos de revenda — rode o schema_v66.sql no Supabase");
    }
    if (resp.error && /peso_g/.test(resp.error.message || "")) {
      const { peso_g: _peso, ...semPeso } = payload;
      resp = await gravar(semPeso);
      if (!resp.error) onToast("Produto salvo sem o peso — rode o schema_v26.sql no Supabase pra guardar o peso");
    }
    error = resp.error;
    produtoId = resp.id;
    if (error) {
      setSalvando(false);
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    // Grava a receita de embalagem: apaga o que já existia e recria — lista
    // curta, mais simples e seguro que tentar diferenciar linha por linha.
    if (produtoId) {
      const linhas = (form.embalagemItens || [])
        .filter((it) => it.itemId)
        .map((it) => ({ produto_id: produtoId, embalagem_id: it.itemId, quantidade: Number(it.quantidade) || 0 }));
      // Grava a receita nova antes de apagar a antiga — se falhar, a antiga
      // continua lá (antes apagava primeiro e o produto podia ficar sem receita).
      const { error: erroReceita } = await trocarLinhas(supabase, "produto_embalagens", "produto_id", produtoId, linhas);
      recarregarCatalogo();
      if (erroReceita) {
        setSalvando(false);
        onToast(`Produto salvo, mas a receita de embalagem não foi atualizada (a anterior foi mantida): ${erroReceita.message}`);
        limpar();
        return;
      }
    }
    if (form.producao_detalhe) {
      salvarUltimosPercentuais(form.producao_detalhe);
    }
    setSalvando(false);
    const mediaImpacto = impacto?.relevante && impacto.linhas.length ? impacto.linhas.reduce((s, l) => s + l.diferenca, 0) / impacto.linhas.length : null;
    onToast(
      eraNovo
        ? "Produto salvo — continue o cadastro"
        : mediaImpacto != null
          ? `Produto atualizado · lucro ${mediaImpacto >= 0 ? "+" : "−"}R$ ${Math.abs(mediaImpacto).toFixed(2).replace(".", ",")}/venda em média (${impacto.itensAfetados} item(ns)) · detalhes em Produtos precificados → Custo mudou`
          : "Produto atualizado"
    );
    // Continua no cadastro em etapas: o produto (novo) passa a ser o que está sendo editado.
    setEditandoId(produtoId);
    setDetalheSalvo(form.producao_detalhe || null);
    setPecasPorImpressaoSalvo(form.pecas_por_impressao ?? 1);
    if (irPara != null) {
      setPulados((x) => ({ ...x, [PASSOS_CAD[passo]?.id]: false }));
      setPasso(irPara);
    }
  }

  async function editar(p) {
    setEditandoId(p.id);
    setPasso(0);
    setPulados({});
    let itens = [];
    if (supabase) {
      const { data } = await supabase.from("produto_embalagens").select("*").eq("produto_id", p.id);
      itens = (data || []).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    }
    setForm({
      nome: p.nome,
      sku: p.sku || "",
      material_nome: p.material_nome || "",
      material_id: p.material_id || null,
      custo_producao: arredondarPreco(p.custo_producao),
      frete_padrao: arredondarPreco(p.frete_padrao),
      embalagem_padrao: arredondarPreco(p.embalagem_padrao),
      observacao: p.observacao || "",
      embalagemItens: itens,
      producao_detalhe: p.producao_detalhe || null,
      pecas_por_impressao: p.pecas_por_impressao ?? 1,
      peso_g: p.peso_g != null ? String(p.peso_g) : "",
      impressora_id: p.impressora_id || null,
      origem: p.origem === "revenda" ? "revenda" : "fabricado",
      ean: p.ean || "",
      fornecedor_id: p.fornecedor_id || null,
      ncm: p.ncm || "",
      cest: p.cest || "",
      unidade_com: p.unidade_com || "",
      origem_mercadoria: p.origem_mercadoria || "",
      imposto_st: p.imposto_st ?? null,
      monofasico: p.monofasico ?? null,
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
      material_id: p.material_id || null,
      custo_producao: arredondarPreco(p.custo_producao),
      frete_padrao: arredondarPreco(p.frete_padrao),
      embalagem_padrao: arredondarPreco(p.embalagem_padrao),
      observacao: p.observacao || "",
      embalagemItens: itens,
      producao_detalhe: p.producao_detalhe || null,
      pecas_por_impressao: p.pecas_por_impressao ?? 1,
      peso_g: p.peso_g != null ? String(p.peso_g) : "",
      impressora_id: p.impressora_id || null,
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
      {carregando && produtos.length === 0 && (
        <div className="panel">
          <div className="empty">Carregando…</div>
        </div>
      )}
      <div className="panel">
        <h3 className="section-title">
          {editandoId ? `Editar produto${form.nome ? ` — ${form.nome}` : ""}` : "Cadastrar produto"}
          <Ajuda texto="Dica: em Custo de Produção, o botão “Salvar como produto” já traz o custo calculado pra cá. Pra ver, buscar, clonar, editar ou excluir os produtos já cadastrados, use Catálogo → Produtos precificados." />
        </h3>
        <PassosCadastro passos={PASSOS_CAD} passo={passo} feitos={feitos} pulados={pulados} liberado={!!editandoId} onIr={irPasso} />
        {passo === 0 && (
          <>
            <h3 className="section-title">1 · O que é</h3>
        <div className="origem-produto" role="radiogroup" aria-label="De onde vem este produto">
          <button type="button" role="radio" aria-checked={!ehRev} className={`origem-op${!ehRev ? " on" : ""}`} onClick={() => setForm((prev) => ({ ...prev, origem: "fabricado" }))}>
            <b>Fabricado</b>
            <span>Impressão 3D e/ou artesanal — custo pela produção.</span>
          </button>
          <button type="button" role="radio" aria-checked={ehRev} className={`origem-op${ehRev ? " on" : ""}`} onClick={() => setForm((prev) => ({ ...prev, origem: "revenda" }))}>
            <b>Revenda — comprado pronto</b>
            <span>Custo pelas notas de compra (média das últimas). Tem estoque.</span>
          </button>
        </div>
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
          {ehRev ? (
            <div className="field">
              <label>
                EAN (código de barras)
                <Ajuda texto="O código de barras do fabricante (vem na nota de compra). Com ele, o app liga sozinho o item da nota a este produto." />
              </label>
              <input type="text" inputMode="numeric" placeholder="ex: 7891234567895" value={form.ean} onChange={setCampo("ean")} />
            </div>
          ) : (
          <div className="field">
            <label>
              Material
              <Ajuda texto="Vinculado ao catálogo de Materiais (Cadastros → Materiais) por id, não só pelo nome — assim, se você renomear o material lá, esse produto continua apontando pro mesmo registro em vez de perder o vínculo." />
            </label>
            <select
              value={form.material_id || ""}
              onChange={(e) => {
                const id = e.target.value;
                const escolhido = materiais.find((m) => String(m.id) === id) || null;
                setForm((prev) => ({ ...prev, material_id: id || null, material_nome: escolhido ? escolhido.nome : prev.material_nome }));
              }}
            >
              <option value="">{form.material_nome ? `Sem vínculo — mantém "${form.material_nome}"` : "Selecione um material"}</option>
              {materiais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.tipo === "consumivel" ? " (consumível)" : ""}
                </option>
              ))}
            </select>
            {!form.material_id && form.material_nome && (
              <div className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Cadastrado como "{form.material_nome}", sem vínculo com o catálogo — escolha um item acima pra vincular (o nome digitado continua exibido enquanto isso).
              </div>
            )}
          </div>
          )}
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
            <label>
              Peso da peça (g)
              <Ajuda texto="Peso de UMA peça, sem embalagem. Vem sozinho quando você salva pelo Custo de Produção (calculado pelo filamento) — dá pra ajustar se pesar na balança. Somado ao peso dos itens de embalagem, vira o peso de envio (usado nas variações e em Produtos precificados)." />
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={form.peso_g}
              placeholder={resultadoDetalhe?.peso ? String(Math.round(resultadoDetalhe.peso)) : "ex: 82"}
              onChange={setCampo("peso_g")}
            />
          </div>
            </div>
        <div className="field">
          <label>Observação (opcional)</label>
          <input type="text" value={form.observacao} onChange={setCampo("observacao")} />
        </div>

          </>
        )}
        {passo === 1 && (
          <>
            <h3 className="section-title">2 · {ehRev ? "Custo de compra" : "Custo de produção"}</h3>
            <div className="row4">
          <div className="field">
            <label>{ehRev ? "Custo de compra (R$)" : "Custo de produção (R$)"}</label>
            {ehRev ? (
              <>
              <input
                type="number"
                step="0.01"
                disabled={temNotas}
                value={form.custo_producao}
                onChange={setCampo("custo_producao")}
                title={temNotas ? "Média das últimas notas de compra — muda sozinho a cada nota importada" : "Valor manual até a 1ª nota de compra ser importada"}
              />
              {!temNotas && <CalculadoraPreco unidade="un" onAplicar={(v) => setForm((prev) => ({ ...prev, custo_producao: String(v) }))} />}
              </>
            ) : (
              <input
                type="number"
                step="0.01"
                disabled={!!form.producao_detalhe}
                value={form.producao_detalhe ? resultadoDetalhe?.total.toFixed(2) ?? "0.00" : form.custo_producao}
                onChange={setCampo("custo_producao")}
                title={form.producao_detalhe ? "Calculado a partir do detalhamento abaixo" : "Valor manual — preencha o detalhamento abaixo pra calcular sozinho"}
              />
            )}
          </div>
            </div>
        {ehRev ? (
          <BlocoRevenda
            produtoId={editandoId}
            fornecedorId={form.fornecedor_id}
            onFornecedor={(id) => setForm((prev) => ({ ...prev, fornecedor_id: id || null }))}
            dados={revendaDados}
          />
        ) : (
          <>
        <h3 className="section-title">
          Detalhamento do custo de produção
          <Ajuda texto="As métricas que geraram o custo de produção desse produto (filamento, tempo de impressão, consumíveis, ROI da máquina etc.), pra você consultar ou ajustar depois. Recalcula ao vivo com os preços ATUAIS de material. Ao lado de um campo que você mudou aparece '(era X)' com o valor salvo antes dessa edição." />
        </h3>
        <DetalhamentoCusto
          detalhe={form.producao_detalhe}
          salvo={detalheSalvo}
          filamentos={filamentos}
          consumiveisCatalogo={consumiveisCatalogo}
          materiais={materiais}
          resultado={resultadoDetalhe}
          custoConsumiveis={custoConsumiveisDetalhe}
          onChange={(detalhe) => setForm((prev) => ({ ...prev, producao_detalhe: detalhe }))}
          onIniciar={iniciarDetalhamento}
          pecasPorImpressao={form.pecas_por_impressao}
          pecasPorImpressaoSalvo={pecasPorImpressaoSalvo}
          onChangePecasPorImpressao={(v) => setForm((prev) => ({ ...prev, pecas_por_impressao: v }))}
          impressoras={farmConfig ? impressoras : null}
          impressoraId={form.impressora_id}
          maquina={maquinaForm}
          onChangeImpressora={(id) => setForm((prev) => ({ ...prev, impressora_id: id || null }))}
          pesoCadastro={form.peso_g === "" || form.peso_g == null ? null : Number(String(form.peso_g).replace(",", ".")) || null}
        />
          </>
        )}

            {editandoId && <ImpactoCusto impacto={impacto} titulo="Impacto da mudança (se salvar)" />}
          </>
        )}
        {passo === 2 && (
          <>
            <h3 className="section-title">3 · Embalagem</h3>
            <div className="row4">
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
        <h3 className="section-title">
          Itens de embalagem
          <Ajuda texto="Escolha os itens (cadastrados em Cadastros → Embalagens) que esse produto gasta pra ser enviado, e quantos de cada. O total substitui o campo manual 'Embalagem' acima e atualiza sozinho se o preço de um item mudar. Deixe vazio pra usar o campo manual." />
        </h3>
        <SeletorItens
          catalogo={catalogoEmbalagem}
          itens={form.embalagemItens}
          onChange={(itens) => setForm((prev) => ({ ...prev, embalagemItens: itens }))}
          rotuloVazio='Nenhuma embalagem cadastrada — cadastre em Cadastros → Embalagens (caixa, plástico bolha...), ou use o campo manual acima.'
        />

            <h3 className="section-title">Embalagem no orgânico (venda na loja)</h3>
            {(() => {
              const p = produtos.find((x) => x.id === editandoId);
              return p ? (
                <EmbalagemOrganicoBloco key={`${p.id}-${JSON.stringify(p.embalagem_organico || null)}`} dono={{ tipo: "produto", id: p.id, nome: p.nome }} config={p.embalagem_organico || null} canais={canaisCat} embalagens={embalagensCatalogo} onToast={onToast} />
              ) : null;
            })()}
            {editandoId && <ImpactoCusto impacto={impacto} titulo="Impacto da mudança (se salvar)" />}
          </>
        )}
        {passo === 3 && editandoId && (
          <>
            <h3 className="section-title">4 · Quando vende</h3>
            <QuandoVende produtoId={editandoId} onToast={onToast} />
          </>
        )}
        {passo === 4 && editandoId && (
          <>
          <VariacoesProduto
            produto={{
              id: editandoId,
              nome: form.nome,
              sku: form.sku,
              custo_producao: resultadoDetalhe ? resultadoDetalhe.total : parseFloat(form.custo_producao) || 0,
              frete_padrao: parseFloat(form.frete_padrao) || 0,
              embalagem_padrao: usaReceitaEmbalagem ? custoEmbalagemReceita : parseFloat(form.embalagem_padrao) || 0,
              peso_g: form.peso_g === "" ? null : Number(form.peso_g) || 0,
              producao_detalhe: form.producao_detalhe,
              pecas_por_impressao: Math.max(1, parseInt(form.pecas_por_impressao, 10) || 1),
              _maquina: maquinaForm,
            }}
            produtoEmbalagens={(form.embalagemItens || [])
              .filter((it) => it.itemId)
              .map((it) => ({ produto_id: editandoId, embalagem_id: it.itemId, quantidade: it.quantidade }))}
            embalagens={embalagensCatalogo}
            materiais={materiais}
            onToast={onToast}
          />
          </>
        )}
        {passo === 5 && (
          <>
            <DadosFiscais form={form} setForm={setForm} revenda={ehRev} abertoInicial />
          </>
        )}
        {passo === 6 && editandoId && (
          <div className="cad-pronto">
            <div className="cad-pronto-titulo">{form.nome || "Produto"} cadastrado ✓</div>
            <p className="hint">
              {faltam.length ? `Ficou faltando: ${faltam.join(", ")} — dá pra voltar em qualquer etapa (clique na barra acima) ou completar pela Página do produto.` : "Cadastro completo."}
            </p>
            <p className="hint">Agora o preço e o anúncio: 1º Avulso → 2º Por quantidade → 3º Ficha (cores) → 4º Lançamento → 5º Anunciar.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" className="btn" onClick={() => abrirProduto(`p:${editandoId}`)}>
                Abrir a Página do produto
              </button>
              <button type="button" className="btn" onClick={() => { limpar(); }}>
                + Cadastrar outro produto
              </button>
              <button type="button" className="btn primary" onClick={() => onProdutoCriado?.(editandoId, form.nome)}>
                Precificar este produto →
              </button>
            </div>
          </div>
        )}

        {passo < 6 && (
          <div className="cad-rodape">
            {passo > 0 && (
              <button type="button" className="btn" onClick={() => setPasso(passo - 1)} disabled={salvando}>
                ← Voltar
              </button>
            )}
            <button type="button" className="link-btn" onClick={limpar} disabled={salvando}>
              {editandoId ? "Fechar (sem salvar esta etapa)" : "Limpar"}
            </button>
            <span style={{ flex: 1 }} />
            {passo > 0 && (
              <button type="button" className="link-btn" onClick={() => { setPulados((x) => ({ ...x, [PASSOS_CAD[passo].id]: true })); setPasso(passo + 1); }} disabled={salvando}>
                Pular por agora
              </button>
            )}
            {PASSOS_CAD[passo].salva ? (
              <button className="btn primary" onClick={() => salvar({ irPara: passo + 1 })} disabled={salvando}>
                {salvando ? "Salvando…" : passo === 0 && !editandoId ? "Salvar e continuar →" : "Salvar e continuar →"}
              </button>
            ) : (
              <button className="btn primary" onClick={() => setPasso(passo + 1)}>
                Próximo →
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
