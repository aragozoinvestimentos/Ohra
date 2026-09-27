import { useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { resultadoNoPreco } from "../lib/calc.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "../hooks/useRankingData.js";
import { useEscada } from "../hooks/useEscada.js";
import { statusPrecoSalvo } from "../lib/escada.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import { itemTipoDoId, formatarPeso } from "../lib/variacoes.js";
import { precoSalvoAoVivo } from "../lib/aoVivo.js";

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
  const { itens, canais, carregando: carregandoBase, escada } = useEscada();
  const [aplicarAlvo, setAplicarAlvo] = useState(null);
  const [excluirVariacao, setExcluirVariacao] = useState(null); // item "v:<id>" // { item, canal, sugerido, linha }
  const [salvandoAplicar, setSalvandoAplicar] = useState(false);
  const [precos, setPrecos] = useState([]);
  const [carregandoPrecos, setCarregandoPrecos] = useState(true);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editAlvo, setEditAlvo] = useState(null); // { id, nomeItem, nomeCanal, custoTotal, canal }
  const [edicao, setEdicao] = useState({ preco: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos"); // todos | Produto | Kit
  const [expandidos, setExpandidos] = useState(() => new Set()); // produtos com variações abertas
  const [expandirTudo, setExpandirTudo] = useState(false);
  const [clonarAlvo, setClonarAlvo] = useState(null); // item original sendo clonado
  const [clonarForm, setClonarForm] = useState({ nome: "", sku: "" });
  const [salvandoClone, setSalvandoClone] = useState(false);
  const [excluirCompletoAlvo, setExcluirCompletoAlvo] = useState(null); // { item, aviso }
  const [clonarPrecoAlvo, setClonarPrecoAlvo] = useState(null); // { item, canalDestino } — clonar preço já salvo de outro canal
  const [canalOrigemId, setCanalOrigemId] = useState("");
  const [salvandoClonePreco, setSalvandoClonePreco] = useState(false);

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

  // Preço é a ÚNICA entrada editável aqui — Lucro e Margem são sempre
  // CALCULADOS a partir dele com a fórmula real do canal (a mesma de
  // Precificação por Canal, Promoções e "Clonar preço"): resolve a faixa de
  // comissão que esse preço realmente cai (Shopee/ML/TikTok têm faixas
  // diferentes por preço) e desconta taxa fixa, imposto e custos fixos
  // cadastrados nesse canal. Antes essa janela deixava editar Preço E Margem
  // como campos soltos e só multiplicava um pelo outro pra achar o Lucro
  // (lucro = preço × margem) — dava pra "salvar" qualquer combinação, mesmo
  // uma que o canal escolhido jamais entregaria de verdade naquele preço, e
  // o valor ficava sem relação nenhuma com Precificação por Canal.
  function editarPreco(valor) {
    setEdicao((prev) => ({ ...prev, preco: valor }));
  }

  const resultadoEdicao = useMemo(() => {
    if (!editAlvo) return null;
    const precoNum = numOuNull(edicao.preco);
    if (precoNum == null || precoNum <= 0) return null;
    const base = {
      custoProduto: editAlvo.custoTotal,
      frete: 0,
      embalagem: 0,
      imposto: editAlvo.canal?.imposto_pct || 0,
      custosFixosPct: editAlvo.canal?.custos_fixos_pct || 0,
    };
    return resultadoNoPreco(editAlvo.canal, base, precoNum, ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO, editAlvo.peso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAlvo, edicao.preco]);

  // Preço sugerido (escada por lucro por peça) de cada VARIAÇÃO em cada canal,
  // com o status do preço salvo — recalcula ao vivo com o catálogo.
  const sugeridos = useMemo(() => {
    const mapa = new Map();
    const pais = new Set(itens.filter((i) => i.id.startsWith("v:")).map((i) => i.produtoId));
    for (const pid of pais) {
      for (const c of canais) {
        const d = escada(pid, c);
        if (!d) continue;
        let salvoPPAnterior = d.p1;
        for (const l of d.escada.linhas) {
          if (l.base || !l.itemId) continue;
          const st = statusPrecoSalvo(l.salvo, l, salvoPPAnterior);
          if (l.salvo != null) salvoPPAnterior = l.salvo / l.n;
          mapa.set(`${l.itemId}|${c.id}`, { linha: l, st, p1Origem: d.p1Origem });
        }
      }
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, canais, escada]);

  // Exclui a variação (e os preços salvos dela, que não têm FK) — o produto não muda.
  async function confirmarExcluirVariacao() {
    const item = excluirVariacao;
    setExcluirVariacao(null);
    if (!item || !supabase) return;
    const vid = item.id.slice(2);
    const { error } = await supabase.from("produto_variacoes").delete().eq("id", vid);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    await supabase.from("precos_canal").delete().eq("item_tipo", "variacao").eq("item_id", vid);
    await supabase.from("precos_concorrente").delete().eq("item_tipo", "variacao").eq("item_id", vid);
    await supabase.from("publicacoes_olist").delete().eq("item_tipo", "variacao").eq("item_id", vid);
    setPrecos((prev) => prev.filter((p) => !(p.item_tipo === "variacao" && p.item_id === vid)));
    onToast(`${item.nomeVariacao || item.nome} excluída`);
  }

  async function aplicarSugerido() {
    const a = aplicarAlvo;
    if (!a || !supabase) return;
    setSalvandoAplicar(true);
    const { error } = await supabase.from("precos_canal").upsert(
      {
        loja_id: lojaId || null,
        item_tipo: "variacao",
        item_id: a.item.id.slice(2),
        canal_id: a.canal.id,
        preco: Math.round(a.linha.sugerido * 100) / 100,
        custo_total: Math.round(a.linha.custo * 100) / 100,
        lucro: Math.round(a.linha.lucro * 100) / 100,
        margem: a.linha.margem,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "item_tipo,item_id,canal_id" }
    );
    setSalvandoAplicar(false);
    setAplicarAlvo(null);
    if (error) {
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    onToast(`${a.item.nomeVariacao || a.item.nome}: ${BRL(a.linha.sugerido)} salvo em ${a.canal.nome}`);
  }

  function precoDe(item, canalObj) {
    const id = item.id.split(":")[1];
    const itemTipo = itemTipoDoId(item.id);
    const linha = precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalObj.id) || null;
    // Lucro/margem sempre recalculados com o custo de HOJE do item e as
    // taxas atuais do canal — nunca o número congelado no dia do "Salvar".
    return linha ? precoSalvoAoVivo(linha, item.custoTotal, canalObj, item.peso) : null;
  }

  // Canais onde esse item já tem preço salvo — são as opções válidas de
  // "origem" pra clonar preço pra outro canal ainda vazio.
  function canaisComPrecoSalvo(item) {
    return canais.filter((c) => precoDe(item, c));
  }

  function abrirClonarPreco(item, canalDestino) {
    const origens = canaisComPrecoSalvo(item);
    if (origens.length === 0) return;
    setClonarPrecoAlvo({ item, canalDestino });
    setCanalOrigemId(origens[0].id);
  }

  // Preço igual ao do canal de origem, mas lucro/margem recalculados com a
  // comissão/taxa fixa/imposto do canal de DESTINO (cada canal cobra
  // diferente) — mesma lógica de resultadoNoPreco usada em Promoções e em
  // "Comparar com outro preço" na Precificação por Canal.
  const previaClonePreco = useMemo(() => {
    if (!clonarPrecoAlvo) return null;
    const canalOrigem = canais.find((c) => c.id === canalOrigemId);
    const precoOrigem = canalOrigem ? precoDe(clonarPrecoAlvo.item, canalOrigem) : null;
    if (!precoOrigem) return null;
    const base = {
      custoProduto: clonarPrecoAlvo.item.custoTotal,
      frete: 0,
      embalagem: 0,
      imposto: clonarPrecoAlvo.canalDestino.imposto_pct || 0,
      custosFixosPct: clonarPrecoAlvo.canalDestino.custos_fixos_pct || 0,
    };
    return resultadoNoPreco(clonarPrecoAlvo.canalDestino, base, Number(precoOrigem.preco), ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO, clonarPrecoAlvo.item.peso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonarPrecoAlvo, canalOrigemId, canais, precos]);

  async function confirmarClonarPreco() {
    if (!previaClonePreco) {
      onToast("Escolha um canal de origem com preço já salvo");
      return;
    }
    const { item, canalDestino } = clonarPrecoAlvo;
    const id = item.id.split(":")[1];
    setSalvandoClonePreco(true);
    const { data, error } = await supabase
      .from("precos_canal")
      .upsert(
        {
          loja_id: lojaId || null,
          item_tipo: itemTipoDoId(item.id),
          item_id: id,
          canal_id: canalDestino.id,
          preco: arredondarPreco(previaClonePreco.preco),
          custo_total: arredondarPreco(previaClonePreco.custoTotal),
          lucro: previaClonePreco.lucro != null ? arredondarPreco(previaClonePreco.lucro) : null,
          margem: previaClonePreco.margem,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "item_tipo,item_id,canal_id" }
      )
      .select()
      .single();
    setSalvandoClonePreco(false);
    if (error) {
      onToast(`Não foi possível clonar o preço: ${error.message}`);
      return;
    }
    setPrecos((prev) => [...prev.filter((p) => p.id !== data.id), data]);
    setClonarPrecoAlvo(null);
    setRecemSalvoId(data.id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === data.id ? null : atual)), 1000);
    const nomeOrigem = canais.find((c) => c.id === canalOrigemId)?.nome || "outro canal";
    onToast(`Preço clonado de ${nomeOrigem} pra ${canalDestino.nome}`);
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
    setEditAlvo({ id: p.id, nomeItem: item.nome, nomeCanal: canalObj.nome, custoTotal: item.custoTotal, canal: canalObj, pecas: item.pecas || 1, peso: item.peso || null });
    setEdicao({ preco: Number(p.preco || 0).toFixed(2) });
  }

  async function salvarEdicao() {
    const precoId = editAlvo.id;
    const preco = parseFloat(String(edicao.preco).replace(",", "."));
    if (!isFinite(preco) || preco <= 0) {
      onToast("Informe um preço válido");
      return;
    }
    if (!resultadoEdicao) {
      onToast("Não foi possível calcular o lucro pra esse preço — tente de novo");
      return;
    }
    const lucro = arredondarPreco(resultadoEdicao.lucro);
    const margem = resultadoEdicao.margem;
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
        // Variações de quantidade vão junto (sem os preços salvos delas).
        const { data: vars, error: eVars } = await supabase.from("produto_variacoes").select("*").eq("produto_id", id);
        if (!eVars && vars?.length) {
          const linhas = vars.map(({ id: _oid, produto_id: _pid, criado_em: _c, ...resto }) => ({
            ...resto,
            produto_id: novoId,
            sku: null,
            atualizado_em: new Date().toISOString(),
          }));
          await supabase.from("produto_variacoes").insert(linhas);
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
    // Preços salvos das variações desse produto (as variações em si somem
    // junto com o produto, por cascata no banco).
    const idsVariacoes = itens.filter((i) => i.tipo === "Variação" && i.produtoId === id).map((i) => i.id.split(":")[1]);
    const { error } = await supabase.from(tabela).delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    // precos_canal não tem FK pro produto/kit (referência genérica) — limpa na mão.
    await supabase.from("precos_canal").delete().eq("item_tipo", itemTipo).eq("item_id", id);
    if (idsVariacoes.length) await supabase.from("precos_canal").delete().eq("item_tipo", "variacao").in("item_id", idsVariacoes);
    setExcluirCompletoAlvo(null);
    onToast("Excluído por completo");
  }

  const carregando = carregandoBase || carregandoPrecos;
  const alvoBusca = busca.trim().toLowerCase();
  // Variações ficam dentro do produto (linha "suspensa" que abre ao clicar
  // na seta) — a lista principal só tem produtos e kits. Uma busca que acha
  // uma variação mostra o produto dela já aberto.
  const bate = (item) => !alvoBusca || item.nome.toLowerCase().includes(alvoBusca) || (item.sku || "").toLowerCase().includes(alvoBusca);
  const variacoesDe = (produtoId) =>
    itens.filter((i) => i.tipo === "Variação" && i.produtoId === produtoId).sort((a, b) => a.quantidade - b.quantidade);
  const topo = itens
    .filter((item) => item.tipo !== "Variação")
    .filter((item) => filtroTipo === "todos" || item.tipo === filtroTipo)
    .filter((item) => bate(item) || (item.tipo === "Produto" && variacoesDe(item.id.split(":")[1]).some(bate)));
  const linhasTabela = topo.flatMap((item) => {
    if (item.tipo !== "Produto") return [{ item }];
    const pid = item.id.split(":")[1];
    const vars = variacoesDe(pid);
    const aberto = expandirTudo || expandidos.has(pid) || (alvoBusca && vars.some(bate) && !bate(item));
    return [{ item, nVariacoes: vars.length, aberto, pid }, ...(aberto ? vars.map((v) => ({ item: v, variacao: true })) : [])];
  });
  // Exportação e contagem usam tudo (produto + todas as variações dele).
  const itensFiltrados = topo.flatMap((item) => (item.tipo === "Produto" ? [item, ...variacoesDe(item.id.split(":")[1])] : [item]));
  const totalVariacoes = itens.filter((i) => i.tipo === "Variação").length;

  function alternarExpandido(pid) {
    setExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(pid)) novo.delete(pid);
      else novo.add(pid);
      return novo;
    });
  }

  // Resumo do topo: quantos itens já têm preço, margem média dos preços
  // salvos, quantos preços dão prejuízo e quantos itens ainda têm canal vazio.
  const resumo = (() => {
    let comPreco = 0;
    let incompletos = 0;
    let negativos = 0;
    let somaMargem = 0;
    let qtdMargem = 0;
    for (const item of itens) {
      const salvos = canais.map((c) => precoDe(item, c)).filter(Boolean);
      if (salvos.length > 0) comPreco++;
      if (canais.length > 0 && salvos.length < canais.length) incompletos++;
      for (const p of salvos) {
        if (p.margem == null) continue;
        somaMargem += Number(p.margem);
        qtdMargem++;
        if (Number(p.margem) < 0) negativos++;
      }
    }
    const qtdKits = itens.filter((i) => i.tipo === "Kit").length;
    const qtdProdutos = itens.filter((i) => i.tipo === "Produto").length;
    return { comPreco, incompletos, negativos, margemMedia: qtdMargem ? somaMargem / qtdMargem : null, qtdKits, qtdProdutos };
  })();
  const conflitoSkuClone = clonarAlvo ? achaConflitoSkuClone(clonarForm.sku) : null;

  function abrirCadastro(item) {
    const [tipoLetra, id] = item.id.split(":");
    onEditarCompleto?.(tipoLetra === "k" ? "kit" : "produto", id);
  }

  // Exporta a grade (com os filtros atuais) em CSV — abre direto no Excel/
  // Google Planilhas. Separador ";" e vírgula decimal, padrão brasileiro.
  function exportarCsv() {
    const num = (v) => (v == null || !isFinite(Number(v)) ? "" : Number(v).toFixed(2).replace(".", ","));
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cab = ["Produto/Kit", "Tipo", "SKU", "Custo total", ...canais.flatMap((c) => [`${c.nome} preço`, `${c.nome} lucro`, `${c.nome} margem %`])];
    const linhas = itensFiltrados.map((item) => [
      esc(item.nome),
      esc(item.tipo),
      esc(item.sku || ""),
      num(item.custoTotal),
      ...canais.flatMap((c) => {
        const p = precoDe(item, c);
        return p ? [num(p.preco), num(p.lucro), p.margem != null ? num(Number(p.margem) * 100) : ""] : ["", "", ""];
      }),
    ]);
    const csv = "\uFEFF" + [cab.map(esc).join(";"), ...linhas.map((l) => l.join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtos-precificados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const iniciais = (nome) =>
    nome
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");

  return (
    <>
    <TopbarAcoes aba="historico">
      <button type="button" className="btn so-pc" onClick={exportarCsv} disabled={!itensFiltrados.length}>
        Exportar CSV
      </button>
      <button type="button" className="btn primary" onClick={() => onEditarCompleto?.("produto", null)}>
        + Novo produto
      </button>
    </TopbarAcoes>
    {supabase && !carregando && itens.length > 0 && (
      <Kpis
        itens={[
          { label: "Itens com preço salvo", valor: `${resumo.comPreco} de ${itens.length}`, sub: `${resumo.qtdProdutos} produtos · ${resumo.qtdKits} kits${totalVariacoes ? ` · ${totalVariacoes} variações` : ""}` },
          { label: "Margem média", valor: resumo.margemMedia != null ? PCT(resumo.margemMedia) : "—", sub: "de todos os preços salvos" },
          { label: "Preços com prejuízo", valor: resumo.negativos, tom: resumo.negativos > 0 ? "bad" : "good", sub: "margem líquida abaixo de 0%" },
          { label: "Com canal sem preço", valor: resumo.incompletos, tom: resumo.incompletos > 0 ? "warn" : "good", sub: "itens com pelo menos 1 canal vazio" },
        ]}
      />
    )}
    <div className="panel">
      <h3>
        Preços por canal
        <Ajuda texto="Cada célula mostra o preço, lucro e margem salvos pra esse produto/kit nesse canal. Célula vazia significa que ainda não foi salvo nada pra essa combinação — preencha em Precificação por Canal (escolha o item e o canal e clique em Salvar), ou use o ⇄ da célula vazia pra clonar o preço de outro canal (lucro/margem são recalculados pra taxa desse canal). Os botões aparecem ao passar o mouse na linha. Já salvo, use o ✎ pra corrigir na mão ou o × pra excluir (com confirmação). No nome do produto/kit: ⧉ clona tudo (inclusive os preços já salvos em outros canais) pra criar uma variação rapidamente e × exclui o produto/kit por completo (não só um preço); o botão “Abrir” no fim da linha abre o cadastro completo pra editar. Produto com variações de quantidade mostra “▸ N variações”: clique pra abrir as linhas de cada variação, com preço próprio por canal." />
      </h3>
      {itens.length > 0 && (
        <div className="toolbar">
          <input type="text" placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="subabas subabas-compacta">
            {[
              ["todos", "Todos"],
              ["Produto", "Produtos"],
              ["Kit", "Kits"],
            ].map(([k, label]) => (
              <button key={k} className={`btn${filtroTipo === k ? " primary" : ""}`} onClick={() => setFiltroTipo(k)}>
                {label}
              </button>
            ))}
          </div>
          {totalVariacoes > 0 && (
            <button type="button" className="btn btn-mini" onClick={() => { setExpandirTudo((v) => !v); setExpandidos(new Set()); }}>
              {expandirTudo ? "Recolher variações" : "Abrir todas as variações"}
            </button>
          )}
          <span className="toolbar-info">{topo.length} de {itens.length - totalVariacoes}</span>
        </div>
      )}
      {!supabase ? (
        <div className="empty">Produtos precificados indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
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
              Nenhum canal cadastrado ainda — cadastre em Configuração → Canais pra começar a salvar preços aqui. Enquanto isso, dá pra clonar, editar ou
              excluir os produtos/kits abaixo.
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto/Kit</th>
                  <th>SKU</th>
                  <th className="num">Custo total</th>
                  {canais.map((c) => (
                    <th key={c.id} className="num">{c.nome}</th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map(({ item, variacao, nVariacoes, aberto, pid }) => (
                  <tr key={item.id} className={variacao ? "linha-variacao" : aberto ? "linha-aberta" : ""}>
                    <td>
                      {variacao ? (
                        <div className="item-cel item-cel-variacao">
                          <span className="variacao-seta">↳</span>
                          <div className="item-cel-nome">
                            {item.nomeVariacao}
                            <small>{item.quantidade} un.{item.peso ? ` · ${formatarPeso(item.peso)}` : ""}</small>
                          </div>
                          <span className="acoes-linha">
                            <button className="del" title="Excluir variação" onClick={() => setExcluirVariacao(item)}>
                              ×
                            </button>
                          </span>
                        </div>
                      ) : (
                      <div className="item-cel">
                      <span className={`item-thumb${item.tipo === "Kit" ? " kit" : ""}`}>{iniciais(item.nome)}</span>
                      <div className="item-cel-nome">
                        {item.nome}
                        <small>
                          {item.tipo}
                          {item.peso ? ` · ${formatarPeso(item.peso)}` : ""}
                        </small>
                      </div>
                      {nVariacoes > 0 && (
                        <button type="button" className={`variacoes-toggle${aberto ? " aberto" : ""}`} onClick={() => alternarExpandido(pid)} title={aberto ? "Esconder variações" : "Ver variações"}>
                          <span className="seta">▸</span> {nVariacoes} {nVariacoes === 1 ? "variação" : "variações"}
                        </button>
                      )}
                      <span className="acoes-linha">
                        <button className="del" title="Clonar produto/kit" onClick={() => abrirClonar(item)}>
                          ⧉
                        </button>
                        <button className="del" title="Excluir produto/kit por completo" onClick={() => pedirExclusaoCompleta(item)}>
                          ×
                        </button>
                      </span>
                      </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{item.sku || <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>
                    <td className="num">
                      {BRL(item.custoTotal)}
                      {variacao && item.quantidade > 1 && <div className="sub-num">{BRL(item.custoTotal / item.quantidade)}/un.</div>}
                    </td>
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
                                <span className="acoes-linha">
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
                                </span>
                              </div>
                              <div
                                className={`preco-canal-linha ${p.margem == null ? "" : Number(p.margem) < 0 ? "ruim" : Number(p.margem) < 0.1 ? "atencao" : "boa"}`}
                                title={
                                  p.desatualizado
                                    ? `Atualizado pro custo e as taxas de hoje (o custo do item ou a tarifa do canal mudou desde que o preço foi salvo). No dia em que foi salvo: lucro ${BRL(p.lucro_salvo)}${p.margem_salva != null ? ` · ${PCT(p.margem_salva)}` : ""}.`
                                    : undefined
                                }
                              >
                                {p.desatualizado && <span className="ponto-recalc" aria-label="recalculado">↻</span>}
                                {p.lucro != null ? BRL(p.lucro) : "—"} · {p.margem != null ? PCT(p.margem) : "—"}
                              </div>
                              {item.pecas > 1 && p.lucro != null && (
                                <div className="sub-num" title={`Lucro dividido pelas ${item.pecas} peças`}>{BRL(p.lucro / item.pecas)}/peça</div>
                              )}
                              {variacao && sugeridos.get(`${item.id}|${c.id}`) && (() => {
                                const sg = sugeridos.get(`${item.id}|${c.id}`);
                                return (
                                  <div className="sug-cel">
                                    <span className="sug-cel-v" title="Preço sugerido pela escada (Precificação por Canal → Por quantidade)">sugerido {BRL(sg.linha.sugerido)}</span>
                                    {sg.st && <span className={`badge ${sg.st.tom === "acc" ? "acc" : sg.st.tom === "neu" ? "" : sg.st.tom}`}>{sg.st.texto}</span>}
                                    {sg.st && sg.st.tom !== "good" && (
                                      <button type="button" className="link-btn" onClick={() => setAplicarAlvo({ item, canal: c, linha: sg.linha, salvo: p.preco })}>
                                        aplicar
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          ) : variacao && sugeridos.get(`${item.id}|${c.id}`) ? (
                            <div className="sug-cel sug-cel-vazia">
                              <span style={{ color: "var(--ink-faint)" }}>sem preço</span>
                              <span className="sug-cel-v">sugerido {BRL(sugeridos.get(`${item.id}|${c.id}`).linha.sugerido)}</span>
                              <button type="button" className="btn btn-mini" onClick={() => setAplicarAlvo({ item, canal: c, linha: sugeridos.get(`${item.id}|${c.id}`).linha, salvo: null })}>
                                Aplicar
                              </button>
                            </div>
                          ) : canaisComPrecoSalvo(item).length > 0 ? (
                            <button className="del" title={`Clonar preço de outro canal pra ${c.nome}`} onClick={() => abrirClonarPreco(item, c)}>
                              ⇄
                            </button>
                          ) : (
                            <span style={{ color: "var(--ink-faint)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num">
                      <button
                        className="btn btn-mini"
                        onClick={() => (variacao ? onEditarCompleto?.("produto", item.produtoId) : abrirCadastro(item))}
                        title={variacao ? "Abre o produto pra editar essa variação" : undefined}
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
          <div className="field">
            <label>
              Preço de venda (R$)
              <Ajuda texto="O preço final que aparece pro cliente nesse canal — o único campo editável aqui. Lucro e Margem abaixo são recalculados na hora pra esse preço, com a comissão/taxa fixa/imposto reais desse canal (a mesma conta de Precificação por Canal)." />
            </label>
            <input
              type="number"
              step="0.01"
              autoFocus
              value={edicao.preco}
              onChange={(e) => editarPreco(e.target.value)}
            />
          </div>
          <div className="destaque-lucro">
            <span className="k">
              Lucro
              <span className="k-sub">recalculado pra esse preço, com a comissão/taxa/imposto desse canal</span>
            </span>
            <span className="v">{resultadoEdicao ? BRL(resultadoEdicao.lucro) : "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Margem</span>
            <span className="v">{resultadoEdicao?.margem != null ? PCT(resultadoEdicao.margem) : "—"}</span>
          </div>
          {editAlvo.pecas > 1 && resultadoEdicao?.lucro != null && (
            <div className="kv">
              <span className="k">Lucro por peça ({editAlvo.pecas} peças)</span>
              <span className="v">{BRL(resultadoEdicao.lucro / editAlvo.pecas)}</span>
            </div>
          )}
        </EditarDialog>
      )}

      {excluirVariacao && (
        <ConfirmDialog
          titulo="Excluir variação"
          mensagem={`Excluir "${excluirVariacao.nome}"? Os preços salvos dela em todos os canais também saem. O produto e as outras variações não são afetados.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluirVariacao}
          onCancel={() => setExcluirVariacao(null)}
        />
      )}

      {aplicarAlvo && (
        <ConfirmDialog
          titulo={`Aplicar ${BRL(aplicarAlvo.linha.sugerido)}?`}
          mensagem={`Salva ${BRL(aplicarAlvo.linha.sugerido)} como preço de ${aplicarAlvo.item.nome} em ${aplicarAlvo.canal.nome}${aplicarAlvo.salvo != null ? `, no lugar de ${BRL(aplicarAlvo.salvo)}` : ""}. Lucro ${BRL(aplicarAlvo.linha.lucro)} (${BRL(aplicarAlvo.linha.lucroPorPeca)}/peça).`}
          confirmarLabel={salvandoAplicar ? "Salvando…" : "Aplicar"}
          onConfirm={aplicarSugerido}
          onCancel={() => setAplicarAlvo(null)}
        />
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

      {clonarPrecoAlvo && (
        <EditarDialog
          titulo={`Clonar preço pra ${clonarPrecoAlvo.canalDestino.nome}`}
          salvando={salvandoClonePreco}
          onSalvar={confirmarClonarPreco}
          onCancelar={() => setClonarPrecoAlvo(null)}
          salvarLabel="Clonar preço"
          salvandoLabel="Clonando…"
        >
          <div className="hint" style={{ marginTop: 0 }}>
            Usa o mesmo preço de venda já salvo em outro canal pra <strong>{clonarPrecoAlvo.item.nome}</strong> — o lucro e a margem são recalculados com a
            comissão/taxa fixa/imposto de {clonarPrecoAlvo.canalDestino.nome} (cada canal cobra diferente, então o lucro muda mesmo com o preço igual).
            Depois é só ajustar na mão se quiser um preço diferente.
          </div>
          <div className="field">
            <label>Copiar preço de</label>
            <select value={canalOrigemId} onChange={(e) => setCanalOrigemId(e.target.value)}>
              {canaisComPrecoSalvo(clonarPrecoAlvo.item).map((c) => {
                const p = precoDe(clonarPrecoAlvo.item, c);
                return (
                  <option key={c.id} value={c.id}>
                    {c.nome} — {BRL(p.preco)}
                  </option>
                );
              })}
            </select>
          </div>
          {previaClonePreco && (
            <>
              <div className="kv">
                <span className="k">Preço em {clonarPrecoAlvo.canalDestino.nome}</span>
                <span className="v">{BRL(previaClonePreco.preco)}</span>
              </div>
              <div className="kv total">
                <span className="k">Lucro</span>
                <span className="v">{BRL(previaClonePreco.lucro)}</span>
              </div>
              <div className="kv">
                <span className="k">Margem</span>
                <span className="v">{previaClonePreco.margem != null ? PCT(previaClonePreco.margem) : "—"}</span>
              </div>
            </>
          )}
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
    </>
  );
}
