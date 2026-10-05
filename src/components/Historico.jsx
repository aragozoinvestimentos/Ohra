import { hojeSP } from "../lib/datas.js";
import { Fragment, useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { resultadoNoPreco } from "../lib/calc.js";
import { supabase } from "../lib/supabaseClient.js";
import { gravarPrecoNovo } from "../lib/estrategia.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { ML_CATEGORIA_PADRAO, ML_TIPO_ANUNCIO_PADRAO } from "../hooks/useRankingData.js";
import { useEscada } from "../hooks/useEscada.js";
import { statusPrecoSalvo, sugestaoKit, configEscada, pareceAtracao, precoMinimoAceitavel } from "../lib/escada.js";
import { alertaPreco, rotuloEstrategia, ESTRATEGIAS } from "../lib/estrategia.js";
import EstrategiaDialog from "./EstrategiaDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import { itemTipoDoId, formatarPeso } from "../lib/variacoes.js";
import { precoSalvoAoVivo } from "../lib/aoVivo.js";
import CanalTag from "./CanalTag.jsx";
import CustoFilamentosDialog from "./CustoFilamentosDialog.jsx";
import { useRampas } from "../hooks/useRampas.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { pegarPedido } from "../lib/navegar.js";

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
  const { itens, canais, carregando, escada, precos: precosVivos, precosBrutos: precos, cfgLoja, cfgDoProduto, estrategiaDe, alertaDe } = useEscada();
  const [estrategiaAlvo, setEstrategiaAlvo] = useState(null); // { alvo, inicial } — diálogo "Manter assim"
  const [aplicarAlvo, setAplicarAlvo] = useState(null);
  const [filamentosAlvo, setFilamentosAlvo] = useState(null);
  const { rampas } = useRampas(); // id do item com a janela ⇄ Filamentos aberta
  const [excluirVariacao, setExcluirVariacao] = useState(null); // item "v:<id>" // { item, canal, sugerido, linha }
  const [salvandoAplicar, setSalvandoAplicar] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editAlvo, setEditAlvo] = useState(null); // { id, nomeItem, nomeCanal, custoTotal, canal }
  const [edicao, setEdicao] = useState({ preco: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos"); // todos | Produto | Kit
  const [soCustoMudou, setSoCustoMudou] = useState(false);
  const [visao, setVisao] = useLembrado("ohra:precificados:visao", "salvos"); // salvos | comparar
  const [mostrarCanais, setMostrarCanais] = useLembrado("ohra:precificados:canais", "com-preco"); // com-preco | todos
  const [sel, setSel] = useState(null); // "itemId|canalId" com o detalhe aberto
  const alternarSel = (k) => setSel((atual) => (atual === k ? null : k));
  // Outras telas mandam pra cá ("ver em Produtos precificados") com o filtro Custo mudou.
  useEffect(() => {
    const aplicar = (pedido) => {
      if (!pedido) return;
      if (pedido.custoMudou) setSoCustoMudou(true);
      if (pedido.busca != null) setBusca(pedido.busca);
    };
    aplicar(pegarPedido("historico"));
    const ouvir = (e) => e.detail.aba === "historico" && aplicar(pegarPedido("historico"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);
  const [expandidos, setExpandidos] = useState(() => new Set()); // produtos com variações abertas
  const [expandirTudo, setExpandirTudo] = useState(false);
  const [clonarAlvo, setClonarAlvo] = useState(null); // item original sendo clonado
  const [clonarForm, setClonarForm] = useState({ nome: "", sku: "" });
  const [salvandoClone, setSalvandoClone] = useState(false);
  const [excluirCompletoAlvo, setExcluirCompletoAlvo] = useState(null); // { item, aviso }
  const [clonarPrecoAlvo, setClonarPrecoAlvo] = useState(null); // { item, canalDestino } — clonar preço já salvo de outro canal
  const [canalOrigemId, setCanalOrigemId] = useState("");
  const [salvandoClonePreco, setSalvandoClonePreco] = useState(false);

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
          const itV = itens.find((i) => i.id === l.itemId);
          const st = statusPrecoSalvo(l.salvo, l, salvoPPAnterior, { silenciarPiso: !!itV && estrategiaDe(itV, c).chave !== "normal" });
          if (l.salvo != null) salvoPPAnterior = l.salvo / l.n;
          mapa.set(`${l.itemId}|${c.id}`, { linha: l, st, p1Origem: d.p1Origem });
        }
      }
    }
    // Kits de produtos diferentes: sugerido comparando com as peças separadas.
    const cfgKit = configEscada(cfgLoja, null);
    for (const k of itens.filter((i) => i.id.startsWith("k:"))) {
      for (const c of canais) {
        const sug = sugestaoKit({ canal: c, kitItem: k, itens, precos: precosVivos, cfg: cfgKit });
        if (!sug) continue;
        const salvo = precosVivos.find((p) => p.item_tipo === "kit" && p.item_id === k.id.slice(2) && p.canal_id === c.id);
        let st = salvo ? statusPrecoSalvo(Number(salvo.preco), sug, null, { silenciarPiso: estrategiaDe(k, c).chave !== "normal" }) : null;
        if (salvo && st?.tom !== "bad" && Number(salvo.preco) >= sug.separado - 0.005) st = { tom: "neu", texto: "↓ sem vantagem vs separado" };
        mapa.set(`${k.id}|${c.id}`, { linha: sug, st });
      }
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, canais, escada, precosVivos, cfgLoja, estrategiaDe]);

  // "Manter assim": abre o diálogo de estratégia pro preço salvo do item no canal.
  function abrirEstrategia(item, canalObj, inicial) {
    const linha = precoDe(item, canalObj);
    if (!linha) return;
    const outras = canais.map((c) => ({ canal: c, linha: precoDe(item, c) })).filter((o) => o.linha);
    setEstrategiaAlvo({ alvo: { item, canal: canalObj, linha, outras }, inicial });
  }
  // Avulso que "parece atração" (margem abaixo da desejada, kit 2 compensa) e
  // ainda sem estratégia escolhida → só sugestão.
  function sugereAtracao(item, canalObj, al) {
    if (!item.id.startsWith("p:") || !al || al.estrategia.origem !== "padrao" || al.linha?.estrategia) return false;
    const d = escada(item.id.slice(2), canalObj);
    return !!d && pareceAtracao(d.escada, d.p1, cfgDoProduto(item.id.slice(2)));
  }

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
    await supabase.from("publicacoes_canal").delete().eq("item_tipo", "variacao").eq("item_id", vid);
    recarregarCatalogo();
    onToast(`${item.nomeVariacao || item.nome} excluída`);
  }

  async function aplicarSugerido() {
    const a = aplicarAlvo;
    if (!a || !supabase) return;
    setSalvandoAplicar(true);
    // Preço novo = decisão nova: zera a estratégia (estrategia.js).
    const { error } = await gravarPrecoNovo((extra) => supabase.from("precos_canal").upsert(
      {
        ...extra,
        loja_id: lojaId || null,
        item_tipo: itemTipoDoId(a.item.id),
        item_id: a.item.id.slice(2),
        canal_id: a.canal.id,
        preco: Math.round(a.linha.sugerido * 100) / 100,
        custo_total: Math.round(a.linha.custo * 100) / 100,
        lucro: Math.round(a.linha.lucro * 100) / 100,
        margem: a.linha.margem,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "item_tipo,item_id,canal_id" }
    ));
    setSalvandoAplicar(false);
    setAplicarAlvo(null);
    if (error) {
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    onToast(`${a.item.nomeVariacao || a.item.nome}: ${BRL(a.linha.sugerido)} salvo em ${a.canal.nome}`);
  }

  // Rampa de preço (aba Crescimento): só informa em que degrau o produto está
  // vendendo — o preço salvo (alvo) e os números da célula não mudam.
  function rampaDe(item, canalObj) {
    if (!item.id.startsWith("p:")) return null;
    const r = rampas.find((x) => x.produto_id === item.id.slice(2) && x.canal_id === canalObj.id);
    if (!r) return null;
    const d = r.degraus || [];
    const atual = Number(d[r.degrau_atual ?? 0]);
    const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === item.id.slice(2) && p.canal_id === canalObj.id);
    // só informa quando está vendendo num preço diferente do salvo (abaixo na rampa ou testando acima)
    return atual > 0 && (!salvo || Math.abs(atual - Number(salvo.preco)) >= 0.005) ? atual : null;
  }

  function precoDe(item, canalObj) {
    const id = item.id.split(":")[1];
    const itemTipo = itemTipoDoId(item.id);
    const linha = precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalObj.id) || null;
    // Lucro/margem sempre recalculados com o custo de HOJE do item e as
    // taxas atuais do canal — nunca o número congelado no dia do "Salvar".
    return linha ? precoSalvoAoVivo(linha, item.custoTotal, canalObj, item.peso) : null;
  }

  // Custo de hoje × custo gravado no dia do "Salvar" (mudou a fabricação, a
  // embalagem ou o preço médio do filamento): quanto isso mexeu no lucro.
  function mudancaCusto(item, canalObj) {
    const p = precoDe(item, canalObj);
    if (!p || p.custo_salvo == null || p.lucro_salvo == null) return null;
    const dCusto = Number(item.custoTotal) - Number(p.custo_salvo);
    if (Math.abs(dCusto) < 0.05) return null;
    // só o efeito do custo (mudança de taxa do canal fica de fora — essa já aparece no ↻)
    return { dCusto, dLucro: -dCusto };
  }
  const itemCustoMudou = (item) => canais.some((c) => mudancaCusto(item, c));
  const sinal = (v) => `${v >= 0 ? "+" : "−"}${BRL(Math.abs(v))}`;

  // Mudança de TAXA do canal desde o "Salvar" (o resto da diferença de lucro
  // que não é custo) — aparece só no detalhe, nunca como "custo mudou".
  function mudancaTaxa(item, canalObj) {
    const p = precoDe(item, canalObj);
    if (!p || p.lucro_salvo == null || p.lucro == null) return null;
    const efeitoCusto = p.custo_salvo != null ? -(Number(item.custoTotal) - Number(p.custo_salvo)) : 0;
    const dLucro = Number(p.lucro) - Number(p.lucro_salvo) - efeitoCusto;
    return Math.abs(dLucro) >= 0.05 ? { dLucro } : null;
  }

  // O que a célula mostra: preço, lucro · margem (cor SÓ do alertaDe) e no
  // máximo UMA etiqueta, por prioridade: prejuízo > abaixo do mínimo > custo
  // mudou > em rampa > estratégia. O resto fica no detalhe.
  function infoCelula(item, canalObj) {
    const p = precoDe(item, canalObj);
    if (!p) return null;
    const al = alertaDe(item, canalObj);
    const m = mudancaCusto(item, canalObj);
    const rampa = rampaDe(item, canalObj);
    const rotEst = al ? rotuloEstrategia(al.estrategia) : null;
    const tom = p.margem == null || !al ? "" : al.tipo === "prejuizo" ? "ruim" : al.tipo === "abaixo-minimo" ? "atencao" : "boa";
    let chip = null;
    if (al?.tipo === "prejuizo") chip = { cls: al.discreto ? "ruim discreto" : "ruim", txt: al.discreto && rotEst ? `prejuízo · ${rotEst}` : "prejuízo" };
    else if (al?.tipo === "abaixo-minimo") chip = { cls: "atencao", txt: al.estrategia?.vencida ? rotEst : "abaixo do mínimo" };
    else if (m) chip = { cls: "neutro", txt: `custo ${sinal(m.dCusto)}` };
    else if (rampa != null) chip = { cls: "rampa", txt: `em rampa · ${BRL(rampa)}` };
    else if (rotEst) chip = { cls: al.estrategia.vencida ? "neutro vencida" : "neutro", txt: rotEst };
    return { p, al, m, rampa, tom, chip, rotEst };
  }

  const diaMesIso = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

  // Detalhe da célula selecionada (abre na linha logo abaixo).
  function detalheCelula(item, canalObj) {
    if (!canalObj) return null;
    const info = infoCelula(item, canalObj);
    const chave = `${item.id}|${canalObj.id}`;
    const sg = item.tipo === "Variação" || item.tipo === "Kit" ? sugeridos.get(chave) : null;
    const p = info?.p;
    const al = info?.al;
    const est = al?.estrategia;
    const t = p ? mudancaTaxa(item, canalObj) : null;
    return (
      <div className="detalhe-cel">
        <div className="detalhe-cel-topo">
          <b>{item.nomeVariacao ? `${item.nome} — ${item.nomeVariacao}` : item.nome}</b> <CanalTag canal={canalObj} />
          <button type="button" className="del" title="Fechar" onClick={() => setSel(null)}>
            ×
          </button>
        </div>
        <div className="detalhe-cel-grade">
          <div className="kv-cel">
            <small>Preço salvo</small>
            <b>{p ? BRL(p.preco) : "—"}</b>
            <span>{p ? "é o que vale" : "ainda sem preço neste canal"}</span>
          </div>
          {p && (
            <div className="kv-cel">
              <small>Lucro hoje</small>
              <b>
                {p.lucro != null ? BRL(p.lucro) : "—"} · {p.margem != null ? PCT(p.margem) : "—"}
              </b>
              <span>custo e taxas de hoje{item.pecas > 1 && p.lucro != null ? ` · ${BRL(p.lucro / item.pecas)}/peça` : ""}</span>
            </div>
          )}
          <div className="kv-cel">
            <small>Custo hoje</small>
            <b>{BRL(item.custoTotal)}</b>
            <span>{p?.custo_salvo != null ? `no dia do salvar: ${BRL(Number(p.custo_salvo))}` : "fabricação + embalagem + frete"}</span>
          </div>
          {al?.minimo != null && (
            <div className="kv-cel">
              <small>Mínimo aceitável</small>
              <b>{BRL(al.minimo)}</b>
              <span>margem mínima ou lucro mínimo da loja/produto</span>
            </div>
          )}
          {sg && (
            <div className="kv-cel">
              <small>Sugerido (só comparação)</small>
              <b>{BRL(sg.linha.sugerido)}</b>
              <span>{sg.st ? sg.st.texto.replace(/^[^\wÀ-ú]+\s*/, "") : item.tipo === "Kit" ? `separado: ${BRL(sg.linha.separado)}` : "escada do Por quantidade"}</span>
            </div>
          )}
        </div>
        <div className="detalhe-cel-avisos">
          {al && (al.tipo === "abaixo-minimo" || al.tipo === "prejuizo") && (
            <div className={`aviso-cel ${al.tipo === "prejuizo" && !al.discreto ? "ruim" : al.tipo === "prejuizo" ? "" : "atencao"}`}>
              <b>{al.tipo === "prejuizo" ? "Dando prejuízo" : `Abaixo do mínimo (${BRL(al.minimo)})`}</b>
              {al.tipo === "prejuizo"
                ? al.discreto
                  ? ` Explicado pela estratégia (${info.rotEst}), mas o prejuízo continua aparecendo.`
                  : " Cada venda neste preço perde dinheiro."
                : " Se é de propósito, marque a estratégia e o aviso some."}{" "}
              {al.tipo === "abaixo-minimo" &&
                (sugereAtracao(item, canalObj, al) ? (
                  <button type="button" className="link-btn" onClick={() => abrirEstrategia(item, canalObj, "atracao")} title="Margem abaixo da desejada, mas o kit 2 compensa">
                    parece atração — marcar?
                  </button>
                ) : (
                  <button type="button" className="link-btn" onClick={() => abrirEstrategia(item, canalObj)}>
                    manter assim
                  </button>
                ))}
            </div>
          )}
          {est?.vencida && (
            <div className="aviso-cel atencao">
              <b>{ESTRATEGIAS[est.anterior] || "Estratégia"} venceu</b>
              {est.motivoVencida === "lucro"
                ? ` O custo piorou depois da sua decisão: o lucro de hoje (${BRL(Number(p?.lucro))}) ficou abaixo do lucro do dia em que você decidiu (${BRL(Number(est.linha?.estrategia_lucro_ref))}). Agora vale como Normal (o aviso de mínimo volta a valer).`
                : ` O prazo acabou em ${diaMesIso(est.ate)}. Agora vale como Normal (o aviso de mínimo volta a valer).`}{" "}
              <button type="button" className="link-btn" onClick={() => abrirEstrategia(item, canalObj, est.anterior)}>
                manter assim
              </button>
            </div>
          )}
          {est && !est.vencida && est.origem === "escolhida" && (
            <div className="aviso-cel">
              <b>Decisão sua: {info.rotEst}</b>
              {est.motivo ? ` ${est.motivo}.` : ""}{" "}
              <button type="button" className="link-btn" onClick={() => abrirEstrategia(item, canalObj)}>
                mudar
              </button>
            </div>
          )}
          {est && (est.origem === "rampa" || est.origem === "kit-em-rampa") && (
            <div className="aviso-cel rampa">
              <b>{est.origem === "rampa" ? "Em rampa de preço" : "Peça em rampa"}</b>
              {info.rampa != null ? ` Vendendo ${BRL(info.rampa)} agora (Vender → Crescimento). ` : " "}O preço salvo é o alvo e não muda; enquanto a rampa sobe, o aviso de mínimo fica de lado (prejuízo continua aparecendo).
            </div>
          )}
          {info?.m && (
            <div className="aviso-cel">
              <b>Custo mudou desde o salvar</b> custo {sinal(info.m.dCusto)} → lucro {sinal(info.m.dLucro)}/venda (fabricação, embalagem, frete ou filamento).
            </div>
          )}
          {t && (
            <div className="aviso-cel">
              <b>Taxa do canal mudou</b> lucro {sinal(t.dLucro)}/venda desde o salvar (tarifa oficial do canal).
            </div>
          )}
          {p?.desatualizado && p.lucro_salvo != null && (
            <div className="sub-num">
              ↻ No dia do salvar: lucro {BRL(Number(p.lucro_salvo))}
              {p.margem_salva != null ? ` · ${PCT(Number(p.margem_salva))}` : ""} — a célula já mostra o de hoje.
            </div>
          )}
        </div>
        <div className="detalhe-cel-acoes">
          {p && (
            <button type="button" className="btn btn-mini" onClick={() => iniciarEdicao(p, item, canalObj)}>
              ✎ Editar preço
            </button>
          )}
          {sg && (!p || (sg.st && sg.st.tom !== "good")) && (
            <button type="button" className="btn btn-mini" onClick={() => setAplicarAlvo({ item, canal: canalObj, linha: sg.linha, salvo: p ? p.preco : null })}>
              Aplicar sugerido {BRL(sg.linha.sugerido)}
            </button>
          )}
          {!p && canaisComPrecoSalvo(item).length > 0 && (
            <button type="button" className="btn btn-mini" onClick={() => abrirClonarPreco(item, canalObj)}>
              ⇄ Clonar de outro canal
            </button>
          )}
          <button type="button" className="btn btn-mini" onClick={() => setFilamentosAlvo(item.id)}>
            ⇄ Filamentos
          </button>
          {p && (
            <button type="button" className="btn btn-mini" onClick={() => setExcluirAlvo({ ...p, nomeItem: item.nome, nomeCanal: canalObj.nome })}>
              × Excluir preço
            </button>
          )}
        </div>
      </div>
    );
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
    const { data, error } = await gravarPrecoNovo((extra) => supabase
      .from("precos_canal")
      .upsert(
        {
          ...extra,
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
      .single());
    setSalvandoClonePreco(false);
    if (error) {
      onToast(`Não foi possível clonar o preço: ${error.message}`);
      return;
    }
    recarregarCatalogo();
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
    recarregarCatalogo();
  }

  function iniciarEdicao(p, item, canalObj) {
    setEditAlvo({ id: p.id, nomeItem: item.nome, nomeCanal: canalObj.nome, custoTotal: item.custoTotal, canal: canalObj, pecas: item.pecas || 1, peso: item.peso || null, produtoId: item.produtoId || (item.id.startsWith("p:") ? item.id.slice(2) : null), linha: p });
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
    const { error } = await gravarPrecoNovo((extra) =>
      supabase
        .from("precos_canal")
        .update({ preco: arredondarPreco(preco), lucro, margem, atualizado_em: new Date().toISOString(), ...extra })
        .eq("id", precoId)
    );
    setSalvandoEdicao(false);
    if (error) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    recarregarCatalogo();
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
      // Cada parte copiada é conferida: se alguma falhar, o clone continua
      // existindo, mas o aviso diz exatamente o que faltou (antes dizia
      // "Clonado com sucesso" mesmo com um kit sem peças, custo 0).
      const falhas = [];
      const copiar = async (rotulo, tabelaFilha, campoPai, transformar) => {
        const { data, error: eLer } = await supabase.from(tabelaFilha).select("*").eq(campoPai, id);
        if (eLer) {
          // Tabela que ainda não existe (schema antigo) não conta como falha.
          if (!/relation|does not exist|schema cache/i.test(eLer.message)) falhas.push(rotulo);
          return;
        }
        if (!data?.length) return;
        const { error: eIns } = await supabase.from(tabelaFilha).insert(data.map(transformar));
        if (eIns) falhas.push(rotulo);
      };

      if (tabela === "produtos_cadastro") {
        await copiar("receita de embalagem", "produto_embalagens", "produto_id", ({ id: _oid, produto_id: _pid, ...resto }) => ({ ...resto, produto_id: novoId }));
        // Variações de quantidade vão junto (sem os preços salvos delas).
        await copiar("variações", "produto_variacoes", "produto_id", ({ id: _oid, produto_id: _pid, criado_em: _c, ...resto }) => ({
          ...resto,
          produto_id: novoId,
          sku: null,
          atualizado_em: new Date().toISOString(),
        }));
      } else {
        await copiar("peças do kit", "kit_produtos", "kit_id", ({ id: _oid, kit_id: _kid, ...resto }) => ({ ...resto, kit_id: novoId }));
        await copiar("embalagens do kit", "kit_embalagens", "kit_id", ({ id: _oid, kit_id: _kid, ...resto }) => ({ ...resto, kit_id: novoId }));
      }

      const itemTipo = tipoLetra === "k" ? "kit" : "produto";
      const precosOriginais = precos.filter((p) => p.item_tipo === itemTipo && p.item_id === id);
      if (precosOriginais.length) {
        // Item novo = decisão nova: a estratégia do preço não é copiada.
        const { error: ePrecos } = await gravarPrecoNovo((extra) =>
          supabase.from("precos_canal").insert(precosOriginais.map(({ id: _oid, item_id: _iid, ...resto }) => ({ ...resto, ...extra, item_id: novoId })))
        );
        if (ePrecos) falhas.push("preços salvos");
      }

      recarregarCatalogo();
      if (falhas.length) {
        onToast(`Clone criado, mas não copiou: ${falhas.join(", ")} — confira em Cadastros`);
        setClonarAlvo(null);
        return;
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
    .filter((item) => !soCustoMudou || itemCustoMudou(item) || (item.tipo === "Produto" && variacoesDe(item.id.split(":")[1]).some(itemCustoMudou)))
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
  // "Só com preço": canal sem nenhum preço salvo nos itens da lista some (na
  // visão Comparar com sugerido todos aparecem, pra dar pra aplicar).
  const canaisComAlgum = canais.filter((c) => itensFiltrados.some((i) => precoDe(i, c)));
  const canaisVis = mostrarCanais === "todos" || visao === "comparar" || !canaisComAlgum.length ? canais : canaisComAlgum;
  const canaisOcultos = canais.length - canaisVis.length;

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
    a.download = `produtos-precificados-${hojeSP()}.csv`;
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
          { label: "Com canal sem preço", valor: resumo.incompletos, tom: resumo.incompletos > 0 ? "warn" : "good", sub: "itens (com variações) com algum canal vazio" },
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
          <button
            type="button"
            className={`btn btn-mini${soCustoMudou ? " primary" : ""}`}
            title="Itens cujo custo mudou desde que o preço foi salvo (fabricação, embalagem, frete ou preço médio do filamento)"
            onClick={() => setSoCustoMudou((v) => !v)}
          >
            Custo mudou
          </button>
          {totalVariacoes > 0 && (
            <button type="button" className="btn btn-mini" onClick={() => { setExpandirTudo((v) => !v); setExpandidos(new Set()); }}>
              {expandirTudo ? "Recolher variações" : "Abrir todas as variações"}
            </button>
          )}
          <div className="subabas subabas-compacta" title="O preço que vale é sempre o salvo; o sugerido é só pra comparar (aplicar passa por confirmação)">
            {[
              ["salvos", "Preços salvos"],
              ["comparar", "Comparar com sugerido"],
            ].map(([k, label]) => (
              <button key={k} className={`btn${visao === k ? " primary" : ""}`} onClick={() => setVisao(k)}>
                {label}
              </button>
            ))}
          </div>
          {visao === "salvos" && (
            <div className="subabas subabas-compacta" title="Só com preço: esconde o canal que não tem nenhum preço salvo na lista">
              {[
                ["com-preco", "Canais com preço"],
                ["todos", "Todos os canais"],
              ].map(([k, label]) => (
                <button key={k} className={`btn${mostrarCanais === k ? " primary" : ""}`} onClick={() => setMostrarCanais(k)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="toolbar-info">
            {topo.length} de {itens.length - totalVariacoes}
            {canaisOcultos > 0 ? ` · ${canaisOcultos} canal${canaisOcultos > 1 ? "is" : ""} sem preço oculto${canaisOcultos > 1 ? "s" : ""}` : ""}
          </span>
        </div>
      )}
      {itens.length > 0 && (
        <div className="legenda-tabela">
          <span className="legenda-tit">Legenda</span>
          {visao === "salvos" ? (
            <>
              <span><b>R$ 11,90</b> preço salvo (o que vale)</span>
              <span>lucro · margem de hoje (custo e taxas atuais)</span>
              <span><i className="leg-ponto boa" /> ok</span>
              <span><i className="leg-ponto atencao" /> abaixo do mínimo</span>
              <span><i className="leg-ponto ruim" /> prejuízo</span>
              <span><span className="chip-cel neutro">custo +R$0,40</span> custo mudou desde o salvar</span>
              <span><span className="chip-cel rampa">em rampa</span> vendendo abaixo, rumo ao salvo</span>
              <span className="legenda-dica">Clique numa célula pra ver detalhe e ações.</span>
            </>
          ) : (
            <>
              <span>salvo = o que vale · sug. = só comparação</span>
              <span><i className="leg-ponto st-good" /> salvo ok</span>
              <span><i className="leg-ponto st-acc" /> dá pra cobrar mais</span>
              <span><i className="leg-ponto st-neu" /> acima do sugerido</span>
              <span><i className="leg-ponto st-bad" /> abaixo do piso / escada invertida</span>
              <span className="legenda-dica">Clique na célula pra aplicar o sugerido (com confirmação).</span>
            </>
          )}
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
          <div className="table-wrap cabecalho-fixo">
            <table>
              <thead>
                <tr>
                  <th>Produto/Kit</th>
                  <th>SKU</th>
                  <th className="num">Custo total</th>
                  {canaisVis.map((c) => (
                    <th key={c.id} className="num">
                      <CanalTag canal={c} />
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map(({ item, variacao, nVariacoes, aberto, pid }) => (
                  <Fragment key={item.id}>
                  <tr className={variacao ? "linha-variacao" : aberto ? "linha-aberta" : ""}>
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
                        {nVariacoes > 0 && (
                          <button type="button" className={`variacoes-toggle abaixo${aberto ? " aberto" : ""}`} onClick={() => alternarExpandido(pid)} title={aberto ? "Esconder variações" : "Ver variações"}>
                            <span className="seta">▸</span> {nVariacoes} {nVariacoes === 1 ? "variação" : "variações"}
                          </button>
                        )}
                      </div>
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
                      <div>
                        <button type="button" className="link-btn" title="Custo, preço sugerido e lucro em cada filamento cadastrado" onClick={() => setFilamentosAlvo(item.id)}>
                          ⇄ filamentos
                        </button>
                      </div>
                    </td>
                    {canaisVis.map((c) => {
                      const info = infoCelula(item, c);
                      const chaveSel = `${item.id}|${c.id}`;
                      const sg = (variacao || item.tipo === "Kit") ? sugeridos.get(chaveSel) : null;
                      const ativo = sel === chaveSel;
                      if (visao === "comparar") {
                        return (
                          <td key={c.id} className="num">
                            {info || sg ? (
                              <button type="button" className={`cel-preco${ativo ? " sel" : ""}`} onClick={() => alternarSel(chaveSel)}>
                                <span className="cel-preco-cmp">salvo <b>{info ? BRL(info.p.preco) : "—"}</b></span>
                                {sg ? (
                                  <span className="cel-preco-cmp">
                                    sug. <b>{BRL(sg.linha.sugerido)}</b>
                                    {sg.st && <span className={`ponto-st ${sg.st.tom}`} title={sg.st.texto.replace(/^[^\wÀ-ú]+\s*/, "")} />}
                                  </span>
                                ) : (
                                  <span className="sub-num">sem sugerido</span>
                                )}
                              </button>
                            ) : (
                              <span className="cel-vazia">—</span>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={c.id} className="num">
                          {info ? (
                            <button type="button" className={`cel-preco${ativo ? " sel" : ""}`} onClick={() => alternarSel(chaveSel)}>
                              <span className="cel-preco-v">
                                {BRL(info.p.preco)}
                                {recemSalvoId === info.p.id && <span className="salvo-check">✓</span>}
                              </span>
                              <span className={`preco-canal-linha ${info.tom}`}>
                                {info.p.lucro != null ? BRL(info.p.lucro) : "—"} · {info.p.margem != null ? PCT(info.p.margem) : "—"}
                              </span>
                              {info.chip && <span className={`chip-cel ${info.chip.cls}`}>{info.chip.txt}</span>}
                            </button>
                          ) : canaisComPrecoSalvo(item).length > 0 ? (
                            <span className="cel-vazia">
                              —
                              <button className="del" title={`Clonar preço de outro canal pra ${c.nome}`} onClick={() => abrirClonarPreco(item, c)}>
                                ⇄
                              </button>
                            </span>
                          ) : (
                            <span className="cel-vazia">—</span>
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
                  {sel && sel.startsWith(`${item.id}|`) && canaisVis.some((c) => sel === `${item.id}|${c.id}`) && (
                    <tr className="linha-detalhe">
                      <td colSpan={canaisVis.length + 4}>
                        {detalheCelula(item, canaisVis.find((c) => sel === `${item.id}|${c.id}`))}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {estrategiaAlvo && <EstrategiaDialog alvo={estrategiaAlvo.alvo} inicial={estrategiaAlvo.inicial} onToast={onToast} onClose={() => setEstrategiaAlvo(null)} />}

      {filamentosAlvo && <CustoFilamentosDialog itemId={filamentosAlvo} onToast={onToast} onClose={() => setFilamentosAlvo(null)} />}

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
          {resultadoEdicao && (() => {
            // Preço novo = decisão nova (Normal) — o alerta é o da função única.
            const minimo = precoMinimoAceitavel(editAlvo.canal, Number(editAlvo.custoTotal) || 0, Number(editAlvo.peso) || 0, cfgDoProduto(editAlvo.produtoId));
            const al = alertaPreco({ lucro: resultadoEdicao.lucro, preco: numOuNull(edicao.preco), minimo, estrategia: { chave: "normal" } });
            const atual = editAlvo.linha?.estrategia;
            return (
              <>
                {al.tipo && (
                  <div className={`alerta alerta-${al.tipo === "prejuizo" ? "bad" : "warn"}`} style={{ marginTop: 8 }}>
                    <b>{al.tipo === "prejuizo" ? "Esse preço dá prejuízo" : `Abaixo do mínimo aceitável (${BRL(minimo)})`}</b>
                    {al.tipo === "abaixo-minimo" ? "Se for de propósito, salve e depois use “manter assim” na célula (crescimento ou atração)." : "Cada venda nesse preço tira dinheiro do seu bolso."}
                  </div>
                )}
                {atual && atual !== "normal" && (
                  <p className="hint" style={{ margin: "6px 0 0" }}>
                    Hoje este preço está marcado como <b>{atual === "atracao" ? "atração" : "crescimento"}</b>. Salvar um preço novo desfaz essa decisão.
                  </p>
                )}
              </>
            );
          })()}
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
          mensagem={`Salva ${BRL(aplicarAlvo.linha.sugerido)} como preço de ${aplicarAlvo.item.nome} em ${aplicarAlvo.canal.nome}${aplicarAlvo.salvo != null ? `, no lugar de ${BRL(aplicarAlvo.salvo)}` : ""}. Lucro ${BRL(aplicarAlvo.linha.lucro)} ${aplicarAlvo.linha.kit ? `(peças separadas: ${BRL(aplicarAlvo.linha.lucroSeparado)}), cliente economiza ${PCT(aplicarAlvo.linha.economiaPct)} vs ${BRL(aplicarAlvo.linha.separado)}` : `(${BRL(aplicarAlvo.linha.lucroPorPeca)}/peça)`}.`}
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
