import { useMemo, useState } from "react";
import BuscaItem from "./BuscaItem.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { gravarPrecoNovo, alertaPreco } from "../lib/estrategia.js";
import EditarDialog from "./EditarDialog.jsx";
import FreteAviso from "./FreteAviso.jsx";
import { dicaKitFreteGratis } from "../lib/freteGratis.js";
import EstrategiaDialog from "./EstrategiaDialog.jsx";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { BRL, PCT } from "../lib/format.js";
import { referenciasAvulso, alertasAvulso, statusPrecoSalvo, ESCADA_PADRAO, gruposRegra4x, fatorOriginal, descontoDoItem, rotuloMinimo, escadaDoProduto, configEscada, lucroNoPreco, precoMinimoAceitavel } from "../lib/escada.js";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { EditorVariacao } from "./VariacoesProduto.jsx";

const NOME_CANAL = { shopee: "Shopee", ml: "Mercado Livre", tiktok: "TikTok Shop", shein: "Shein" };
const nomeCanal = (c) => c?.nome || NOME_CANAL[c?.tipo] || "Canal";
const pctTxt = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

function faixaTxt(canal, taxas) {
  if (!taxas) return "";
  return `${nomeCanal(canal)}: ${Math.round(taxas.comissaoPct * 100)}% + ${taxas.envioMl ? "envio " : ""}${BRL(taxas.taxaFixa)}`;
}

// Campos da escada editáveis (em %).
const CAMPOS_ESCADA = [
  { k: "r2", label: "Kit 2 mantém (% do lucro/peça)", ajuda: "100% = toda a economia de taxa/embalagem vai pro cliente, sem você perder nada por peça." },
  { k: "r10", label: "Kit 10 mantém (%)", ajuda: "Quanto mais baixo, mais agressivo o desconto nos kits grandes." },
  { k: "piso", label: "Piso do lucro/peça (%)", ajuda: "Nenhuma quantidade fica abaixo disso." },
  { k: "vantagemMin", label: "Vantagem mínima pro cliente (%)", ajuda: "Kit sempre sai pelo menos isso mais barato que N avulsos." },
];
// Margens próprias do produto (só com "regras próprias"; vazio = usa a da loja,
// que fica em Configuração → Lojas → Metas de preço).
const CAMPOS_MARGEM = [
  { k: "margemDesejada", label: "Margem desejada (%)", pct: true },
  { k: "margemMin", label: "Margem mínima (%)", pct: true },
  { k: "lucroMinimo", label: "Lucro mínimo por venda (R$)", pct: false },
];

export default function PrecoPorQuantidade({ onToast }) {
  const { lojaId, atualizar } = useLoja();
  const { itens, canais, produtos, kits: kitsCat, precos: precosEsc, concorrentes: concorrentesEsc, cfgLoja, cfgDoProduto, escada, variacoes: variacoesRaw, produtoEmbalagens, embalagens, materiais, estrategiaDe, clientePagaHoje } = useEscada();
  const [estrategiaAlvo, setEstrategiaAlvo] = useState(null); // diálogo "Manter assim" do avulso
  const [selPQ, setSelPQ] = useState(null); // linha com o detalhe aberto ("base" ou "n<qtd>")
  const [revisar, setRevisar] = useState(null); // linha de produto_variacoes aberta na tela suspensa (revisar insumos)
  const [produtoId, setProdutoId] = useState("");
  const [canalId, setCanalId] = useState("");
  const [p1Edit, setP1Edit] = useState({}); // { "<produto>|<canal>": "12.9" }
  const [extras, setExtras] = useState({}); // { "<produto>": [n...] }
  const [concEdit, setConcEdit] = useState({}); // { "<produto>|<canal>|<n>": "175" }
  const [novaQtd, setNovaQtd] = useState("");
  const [mostrarRegras, setMostrarRegras] = useState(false);
  const [regrasEdit, setRegrasEdit] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const produtosLista = useMemo(() => itens.filter((i) => i.id.startsWith("p:")), [itens]);
  const pid = produtoId && produtosLista.some((p) => p.id === `p:${produtoId}`) ? produtoId : produtosLista[0]?.id.slice(2) || "";
  const canal = canais.find((c) => c.id === canalId) || canais[0] || null;
  const chave = `${pid}|${canal?.id}`;
  const cfg = pid ? cfgDoProduto(pid) : null;
  const produto = produtos.find((p) => p.id === pid) || null;

  const variacoesDoProduto = itens.filter((i) => i.id.startsWith("v:") && i.produtoId === pid);
  const qtdsExtras = extras[pid] ?? (variacoesDoProduto.length ? [] : [2, 3, 5, 10]);
  const concOverrides = {};
  for (const [k, v] of Object.entries(concEdit)) {
    const [p, c, n] = k.split("|");
    if (p === pid && c === canal?.id && v !== "") concOverrides[Number(n)] = Number(v) || null;
  }

  const dados = pid && canal ? escada(pid, canal, { p1Override: p1Edit[chave], quantidadesExtras: qtdsExtras, concorrenteOverrides: concOverrides }) : null;
  const e = dados?.escada;
  const refs = dados ? referenciasAvulso(canal, dados.custo1, dados.peso1, cfg, dados.concorrente1) : null;
  const itemPai = pid ? itens.find((i) => i.id === `p:${pid}`) || null : null;
  // Estratégia do avulso nesse canal (estrategia.js) — decide se "parece atração" vira sugestão.
  const estrategiaAvulso = itemPai && canal ? estrategiaDe(itemPai, canal) : null;
  const alertas = dados ? alertasAvulso({ canal, p1: dados.p1, base1: { custo: dados.custo1, peso: dados.peso1 }, cfg, escada: e, concorrente: dados.concorrente1, estrategia: estrategiaAvulso }) : [];
  function abrirEstrategiaAvulso(inicial) {
    const linha = estrategiaAvulso?.linha || precosEsc.find((p) => p.item_tipo === "produto" && p.item_id === pid && p.canal_id === canal?.id);
    if (!linha) return onToast("Salve o preço do avulso nesse canal primeiro (1º Avulso)");
    const outras = canais.map((c) => ({ canal: c, linha: precosEsc.find((p) => p.item_tipo === "produto" && p.item_id === pid && p.canal_id === c.id) })).filter((o) => o.linha);
    setEstrategiaAlvo({ alvo: { item: itemPai, canal, linha, outras }, inicial });
  }
  const kits = e ? e.linhas.filter((l) => !l.base) : [];
  // Regra da Shopee (4×): preço usado = salvo (ou o sugerido, se não tem salvo);
  // preço original = com o desconto exibido no anúncio (canal ou do produto).
  const fatorOrig = pid && canal ? fatorOriginal(descontoDoItem(`p:${pid}`, canal, { itens, produtos, kits: kitsCat }).desconto) : 1;
  const regra4x =
    e && canal?.tipo === "shopee"
      ? gruposRegra4x(
          e.linhas.map((l) => {
            const promo = l.base ? dados.p1 : l.salvo ?? l.sugerido;
            return { n: l.n, promo, original: promo * fatorOrig };
          })
        )
      : null;
  const anuncioDe = (n) => (regra4x ? regra4x.grupos.findIndex((g) => g.includes(n)) + 1 : 1);
  const k2 = kits.find((l) => l.n === 2);
  const melhor = kits.reduce((a, b) => (a == null || b.lucro > a.lucro ? b : a), null);
  // Frete grátis (schema v38): aviso por linha pelo que o cliente paga (salvo,
  // ou o sugerido) — só avisa, a escada não muda o preço por isso.
  const freteDe = (valor) => (canal && valor > 0 ? alertaPreco({ preco: valor, canal }).frete : null);
  // Valor que conta pro frete: com preço salvo, o que o cliente PAGA HOJE
  // (degrau da rampa / cliente_paga do anúncio); sem salvo ou com o avulso
  // digitado aqui, o preço simulado da escada.
  const valorBase = !e ? null : p1Edit[chave] != null || !itemPai ? dados.p1 : clientePagaHoje(itemPai, canal) ?? dados.p1;
  const valorLinha = (l) => {
    if (l.salvo == null || !l.itemId) return l.sugerido;
    const it = itens.find((i) => i.id === l.itemId);
    return (it && clientePagaHoje(it, canal)) ?? l.salvo;
  };
  const dicaFreteAvulso = e ? dicaKitFreteGratis(canal, valorBase, kits.map((l) => ({ n: l.n, valor: valorLinha(l) }))) : null;
  const maxLpp = e ? Math.max(0.01, ...e.linhas.map((l) => (l.base ? e.l1 : l.lucroPorPeca))) : 1;

  async function salvarConcorrente(n, itemTipo, itemId) {
    const k = `${pid}|${canal.id}|${n}`;
    const v = concEdit[k];
    if (v === undefined || !supabase || !itemId) return;
    const preco = Number(v);
    if (!(preco > 0)) {
      await supabase.from("precos_concorrente").delete().eq("item_tipo", itemTipo).eq("item_id", itemId).eq("canal_id", canal.id);
    } else {
      const { error } = await supabase
        .from("precos_concorrente")
        .upsert({ loja_id: lojaId || null, item_tipo: itemTipo, item_id: itemId, canal_id: canal.id, preco, atualizado_em: new Date().toISOString() }, { onConflict: "item_tipo,item_id,canal_id" });
      if (error) {
        onToast(/relation|does not exist|schema cache/i.test(error.message) ? "Rode o SQL v27 no Supabase pra salvar concorrentes" : `Não foi possível salvar: ${error.message}`);
        return;
      }
    }
    setConcEdit((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }

  // Preço novo = decisão nova: zera a estratégia do preço (estrategia.js).
  async function salvarPreco({ itemTipo, itemId, preco, custo, lucro, margem }) {
    return gravarPrecoNovo((extra) => supabase.from("precos_canal").upsert(
      {
        ...extra,
        loja_id: lojaId || null,
        item_tipo: itemTipo,
        item_id: itemId,
        canal_id: canal.id,
        preco: Math.round(preco * 100) / 100,
        custo_total: Math.round(custo * 100) / 100,
        lucro: lucro != null ? Math.round(lucro * 100) / 100 : null,
        margem,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "item_tipo,item_id,canal_id" }
    ));
  }

  // Preço que vai ser salvo ao Aplicar/Criar: o sugerido, ou o que você digitar.
  const precoConfirmado = (c) => {
    const v = Number(String(c?.precoEdit ?? "").replace(",", "."));
    return v > 0 ? Math.round(v * 100) / 100 : c?.linha?.sugerido;
  };
  const resultadoNoPrecoConfirmado = (c) => {
    const pr = precoConfirmado(c);
    const lucro = pr > 0 ? lucroNoPreco(canal, pr, c.linha.custo, c.linha.peso, cfg) : null;
    return { preco: pr, lucro, margem: lucro != null && pr > 0 ? lucro / pr : null };
  };

  async function executar() {
    const c0 = confirmar;
    if (!c0 || !supabase) return;
    // Aplicar/Criar com preço editado: salva o preço digitado (lucro/margem recalculados).
    const c = c0.tipo === "aplicar" || c0.tipo === "criar" ? { ...c0, linha: { ...c0.linha, sugerido: resultadoNoPrecoConfirmado(c0).preco, lucro: resultadoNoPrecoConfirmado(c0).lucro, margem: resultadoNoPrecoConfirmado(c0).margem } } : c0;
    setSalvando(true);
    let error = null;
    if (c.tipo === "aplicar") {
      ({ error } = await salvarPreco({ itemTipo: "variacao", itemId: c.linha.variacaoId, preco: c.linha.sugerido, custo: c.linha.custo, lucro: c.linha.lucro, margem: c.linha.margem }));
    } else if (c.tipo === "avulso") {
      ({ error } = await salvarPreco({ itemTipo: "produto", itemId: pid, preco: dados.p1, custo: dados.custo1, lucro: e.l1, margem: dados.p1 > 0 ? e.l1 / dados.p1 : null }));
      if (!error)
        setP1Edit((prev) => {
          const next = { ...prev };
          delete next[chave];
          return next;
        });
    } else if (c.tipo === "criar") {
      // SKU padrão: SKU do produto + "-" + quantidade (edite na 3º Ficha do anúncio)
      const skuPai = produtos.find((p) => p.id === pid)?.sku || "";
      const skuNovo = skuPai ? `${skuPai}-${c.linha.n}` : null;
      const { data, error: err } = await supabase
        .from("produto_variacoes")
        .insert({ loja_id: lojaId || null, produto_id: pid, quantidade: c.linha.n, nome: `Kit ${c.linha.n}`, producao_modo: "multiplicar", sku: skuNovo })
        .select()
        .single();
      error = err;
      if (!error && data) {
        // O custo real da variação (caixa, chapa…) aparece assim que o catálogo recarregar;
        // o preço é salvo já com o sugerido calculado agora.
        ({ error } = await salvarPreco({ itemTipo: "variacao", itemId: data.id, preco: c.linha.sugerido, custo: c.linha.custo, lucro: c.linha.lucro, margem: c.linha.margem }));
        // já abre a revisão de insumos da variação nova (embalagem, produção, peso)
        if (!error) setRevisar(data);
        setExtras((prev) => ({ ...prev, [pid]: (prev[pid] ?? qtdsExtras).filter((n) => n !== c.linha.n) }));
      }
    }
    setSalvando(false);
    setConfirmar(null);
    if (error) {
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    onToast(c.tipo === "criar" ? `Kit ${c.linha.n} criado com ${BRL(c.linha.sugerido)} (${nomeCanal(canal)})` : `Preço salvo em Produtos precificados (${nomeCanal(canal)})`);
  }

  function adicionarQtd() {
    const n = Math.round(Number(novaQtd));
    if (!(n >= 2) || n > 500) return;
    const existentes = new Set([...variacoesDoProduto.map((v) => v.pecas || v.quantidade), ...qtdsExtras]);
    if (!existentes.has(n)) setExtras((prev) => ({ ...prev, [pid]: [...qtdsExtras, n] }));
    setNovaQtd("");
  }

  // ---- regras da escada (loja / produto)
  const regrasLoja = { ...ESCADA_PADRAO, ...(cfgLoja || {}) };
  const escadaPropria = produto?.escada_config || null;
  function abrirRegras() {
    const fonte = { ...regrasLoja, ...(escadaPropria || {}) };
    const r = {};
    for (const c of CAMPOS_ESCADA) r[c.k] = String(Math.round((fonte[c.k] ?? 0) * 1000) / 10);
    for (const c of CAMPOS_MARGEM) {
      const v = escadaPropria?.[c.k];
      r[c.k] = v == null || v === "" ? "" : String(c.pct ? Math.round(Number(v) * 1000) / 10 : Number(v));
    }
    setRegrasEdit({ valores: r, propria: !!escadaPropria });
    setMostrarRegras(true);
  }
  // Regras em edição → config (loja e produto) pra salvar e pra prévia ao vivo.
  function configsDaEdicao(ed) {
    const v = ed.valores;
    const frac = (k) => Math.max(0, Math.min(1, (Number(v[k]) || 0) / 100));
    const escadaCampos = { r2: frac("r2"), r10: frac("r10"), piso: frac("piso"), vantagemMin: frac("vantagemMin") };
    if (!ed.propria) return { loja: { ...(cfgLoja || {}), ...escadaCampos }, produto: null };
    const doProduto = { ...escadaCampos };
    for (const c of CAMPOS_MARGEM) {
      const t = String(v[c.k] ?? "").trim().replace(",", ".");
      if (t === "" || !isFinite(Number(t))) continue;
      doProduto[c.k] = c.pct ? Math.max(0, Math.min(0.9, Number(t) / 100)) : Math.max(0, Number(t));
    }
    return { loja: cfgLoja || {}, produto: doProduto };
  }
  async function salvarRegras() {
    const { loja, produto: doProduto } = configsDaEdicao(regrasEdit);
    setSalvando(true);
    let erro = null;
    if (!regrasEdit.propria) {
      const r = await atualizar(lojaId, { configEscada: loja });
      erro = r.ok ? null : r.error;
    }
    if (!erro && supabase && produto) {
      const { error } = await supabase.from("produtos_cadastro").update({ escada_config: regrasEdit.propria ? doProduto : null }).eq("id", produto.id);
      if (error) erro = error.message;
    }
    setSalvando(false);
    if (erro) {
      onToast(/config_escada|escada_config|column/i.test(erro) ? "Rode o SQL v27 no Supabase pra salvar as regras" : `Não foi possível salvar: ${erro}`);
      return;
    }
    setMostrarRegras(false);
    onToast(regrasEdit.propria ? `Regras próprias salvas pra ${produto?.nome}` : "Regras da escada salvas pra loja toda");
  }
  // Prévia ao vivo das regras em edição (antes de salvar).
  const previaRegras = (() => {
    if (!mostrarRegras || !regrasEdit || !pid || !canal) return null;
    const { loja, produto: doProduto } = configsDaEdicao(regrasEdit);
    const cfgPrev = configEscada(loja, doProduto);
    const d = escadaDoProduto({ produtoId: pid, canal, itens, precos: precosEsc, concorrentes: concorrentesEsc, cfg: cfgPrev, p1Override: p1Edit[chave], quantidadesExtras: qtdsExtras, concorrenteOverrides: concOverrides });
    const ks = d?.escada?.linhas.filter((l) => !l.base) || [];
    if (!ks.length) return null;
    return ks.map((l) => `${l.n} un. = ${BRL(l.sugerido)} (${Math.round(l.economiaPct * 100)}% off · mantém ${Math.round((l.lucroPorPeca / (d.escada.lBase || 1)) * 100)}% do lucro/peça)`).join(" · ");
  })();

  if (!produtosLista.length) {
    return <div className="panel"><div className="empty">Cadastre um produto em Cadastros → Produtos pra montar a escada de preços.</div></div>;
  }

  const p1Valor = p1Edit[chave] ?? (dados ? String(Math.round(dados.p1 * 100) / 100) : "");
  const p1Hint =
    dados?.p1Origem === "salvo"
      ? "Preço salvo em Produtos precificados"
      : dados?.p1Origem === "manual"
        ? dados.salvo1 != null
          ? `Editado aqui — salvo: ${BRL(dados.salvo1)}`
          : "Editado aqui — ainda não salvo"
        : "Sem preço salvo nesse canal — partindo da margem desejada";

  return (
    <>
      <div className="panel">
        <h3>
          Produto e canal
          <Ajuda texto="Escolha o produto (o 'pai') e o canal. O preço avulso é escolha sua — vem do preço salvo em Produtos precificados. A partir dele o app sugere o preço de cada quantidade pelo lucro por peça: o kit 2 mantém o mesmo lucro por peça do avulso (a economia de taxa, embalagem e frete vai pro cliente) e dali pra frente o lucro por peça cai devagar." />
        </h3>
        <div className="qtd-topo">
          <div className="field">
            <label>Produto pai</label>
            <BuscaItem
              grupos={[{ label: "Produtos", itens: produtosLista.map((p) => ({ id: p.id.slice(2), rotulo: `${p.nome}${p.sku ? ` · ${p.sku}` : ""}` })) }]}
              value={pid}
              onChange={setProdutoId}
            />
          </div>
          <div className="field">
            <label>Canal</label>
            <select value={canal?.id || ""} onChange={(ev) => setCanalId(ev.target.value)}>
              {canais.map((c) => (
                <option key={c.id} value={c.id}>
                  {nomeCanal(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Preço avulso (1 un.)</label>
            <input type="number" step="0.1" value={p1Valor} onChange={(ev) => setP1Edit((prev) => ({ ...prev, [chave]: ev.target.value }))} />
            <div className="hint" style={{ marginTop: 3, marginBottom: 0 }}>
              {p1Hint}
              {dados?.p1Origem !== "salvo" && dados?.p1 > 0 && (
                <>
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => setConfirmar({ tipo: "avulso" })}>
                    salvar {BRL(dados.p1)}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="field">
            <label>Concorrente (1 un.) — opcional</label>
            <input
              type="number"
              step="0.1"
              placeholder="ex: 22,90"
              value={concEdit[`${pid}|${canal?.id}|1`] ?? (dados?.concorrente1 ?? "")}
              onChange={(ev) => setConcEdit((prev) => ({ ...prev, [`${pid}|${canal?.id}|1`]: ev.target.value }))}
              onBlur={() => salvarConcorrente(1, "produto", pid)}
            />
          </div>
          <div className="field">
            <label>Quantidades</label>
            <div className="chips qtd-chips">
              {variacoesDoProduto
                .map((v) => v.pecas || v.quantidade)
                .filter((n) => n > 1)
                .sort((a, b) => a - b)
                .map((n) => (
                  <span className="chip chip-cad" key={`v${n}`} title="Variação cadastrada">
                    {n} un.
                  </span>
                ))}
              {qtdsExtras
                .slice()
                .sort((a, b) => a - b)
                .map((n) => (
                  <span className="chip" key={`x${n}`}>
                    {n} un.
                    <button type="button" aria-label={`Remover ${n}`} onClick={() => setExtras((prev) => ({ ...prev, [pid]: qtdsExtras.filter((x) => x !== n) }))}>
                      ×
                    </button>
                  </span>
                ))}
            </div>
            <div className="qtd-add">
              <input type="number" min="2" placeholder="ex: 20" value={novaQtd} onChange={(ev) => setNovaQtd(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && adicionarQtd()} />
              <button type="button" className="btn" onClick={adicionarQtd}>
                + simular
              </button>
            </div>
          </div>
        </div>
        {refs && (
          <div className="refs-linha">
            Referências: <b>margem desejada {BRL(refs.margemDesejada)}</b> · <b>{rotuloMinimo(cfg)} {BRL(refs.margemMinima)}</b> · <b>sem prejuízo {BRL(refs.semPrejuizo)}</b>
            {refs.concorrente != null && (
              <>
                {" "}
                · <b>concorrente {BRL(refs.concorrente)}</b>
              </>
            )}
          </div>
        )}
      </div>

      {regra4x && !regra4x.ok && (
        <div className="alerta alerta-neutro">
          <b>Shopee: num anúncio só cabem até {regra4x.maxNoPrimeiro} unidades (regra de 4×)</b>
          Só importa se você colocar mais que isso no mesmo anúncio da Shopee — anunciando até kit {regra4x.maxNoPrimeiro} (ex.: até kit 3), não precisa fazer nada. A variação mais cara (preço original, o riscado) não pode passar de 4× a mais barata (com promoção); aqui o limite é {BRL(regra4x.limite)}. Se um dia for anunciar mais:{" "}
          {regra4x.grupos.map((g, i) => `anúncio ${i + 1} (${g.join(", ")} un)`).join(" · ")}
        </div>
      )}
      {alertas.map((a) => (
        <div key={a.titulo} className={`alerta alerta-${a.tom}`}>
          <b>{a.titulo}</b>
          {a.texto}
          {a.acao === "marcar-atracao" && (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-mini" onClick={() => abrirEstrategiaAvulso("atracao")}>
                Marcar como atração…
              </button>
            </div>
          )}
        </div>
      ))}
      {estrategiaAlvo && <EstrategiaDialog alvo={estrategiaAlvo.alvo} inicial={estrategiaAlvo.inicial} onToast={onToast} onClose={() => setEstrategiaAlvo(null)} />}

      {e && (
        <Kpis
          itens={[
            { label: "Avulso", valor: BRL(dados.p1), sub: `lucro ${BRL(e.l1)} · ${PCT(dados.p1 > 0 ? e.l1 / dados.p1 : 0)}` },
            k2 ? { label: "Salto do kit 2", valor: `${PCT(k2.economiaPct)} off`, tom: "destaque", sub: `${BRL(k2.sugerido)} · ${BRL(k2.porPeca)} cada · lucro ${BRL(k2.lucro)}` } : null,
            melhor ? { label: "Maior lucro por pedido", valor: BRL(melhor.lucro), tom: "good", sub: `${melhor.n} un. a ${BRL(melhor.sugerido)} · ${BRL(melhor.porPeca)}/peça` } : null,
            kits.length ? { label: "Maior vantagem pro cliente", valor: PCT(Math.max(...kits.map((k) => k.economiaPct))), sub: "vs. comprar avulso" } : null,
          ]}
        />
      )}

      {e && (
        <div className="panel">
          <h3 className="section-title h3-split">
            <span>
              Escada de preços sugerida
              <Ajuda texto="Preço sugerido = o menor preço (terminado em ,90) que entrega o lucro por peça alvo, com a comissão e a taxa fixa da faixa real do canal pro preço do kit (o kit é um anúncio só). Travas: o cliente sempre economiza pelo menos a vantagem mínima; preço por peça sempre cai; nunca abaixo da margem mínima; concorrente vira teto mas nunca abaixo da margem mínima; se ficar logo acima de uma troca de faixa do canal e descer der mais lucro, desce. Linha laranja = variação já cadastrada." />
            </span>
            <button type="button" className="btn btn-sm" onClick={() => (mostrarRegras ? setMostrarRegras(false) : abrirRegras())}>
              ⚙ Regras da escada{escadaPropria ? " (própria)" : ""}
            </button>
          </h3>
          {mostrarRegras && regrasEdit && (
            <div className="regras-escada">
              <div className="grid-auto">
                {CAMPOS_ESCADA.map((c) => (
                  <div className="field" key={c.k}>
                    <label>{c.label}</label>
                    <input type="number" step="1" value={regrasEdit.valores[c.k]} onChange={(ev) => setRegrasEdit((prev) => ({ ...prev, valores: { ...prev.valores, [c.k]: ev.target.value } }))} />
                    <div className="hint" style={{ marginTop: 3, marginBottom: 0 }}>{c.ajuda}</div>
                  </div>
                ))}
              </div>
              <label className="check-linha">
                <input type="checkbox" checked={regrasEdit.propria} onChange={(ev) => setRegrasEdit((prev) => ({ ...prev, propria: ev.target.checked }))} />
                Regras próprias só pra <b>{produto?.nome}</b> (escada e, se quiser, margens). Desmarcado = a escada acima vale pra loja toda.
              </label>
              {regrasEdit.propria ? (
                <div className="grid-auto margens-produto">
                  {CAMPOS_MARGEM.map((c) => (
                    <div className="field" key={c.k}>
                      <label>{c.label}</label>
                      <input
                        type="number"
                        step={c.pct ? "1" : "0.5"}
                        placeholder={`loja: ${c.pct ? Math.round((regrasLoja[c.k] ?? 0) * 100) + "%" : BRL(regrasLoja[c.k] ?? 0)}`}
                        value={regrasEdit.valores[c.k]}
                        onChange={(ev) => setRegrasEdit((prev) => ({ ...prev, valores: { ...prev.valores, [c.k]: ev.target.value } }))}
                      />
                    </div>
                  ))}
                  <div className="hint" style={{ alignSelf: "end", margin: 0 }}>Vazio = usa a da loja. Vale no Avulso, aqui e nas promoções deste produto.</div>
                </div>
              ) : (
                <div className="hint" style={{ margin: "0 0 10px" }}>
                  Margens da loja: desejada <b>{Math.round((regrasLoja.margemDesejada ?? 0) * 100)}%</b> · mínima <b>{Math.round((regrasLoja.margemMin ?? 0) * 100)}%</b> · lucro mínimo <b>{BRL(regrasLoja.lucroMinimo ?? 0)}</b> — mude em Configuração → Lojas, canais e taxas → Lojas.
                </div>
              )}
              {previaRegras && <div className="previa-regras">Prévia: {previaRegras}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setMostrarRegras(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn primary" disabled={salvando} onClick={salvarRegras}>
                  {salvando ? "Salvando…" : "Salvar regras"}
                </button>
              </div>
            </div>
          )}
          <div className="legenda-tabela">
            <span className="legenda-tit">Legenda</span>
            <span>preço salvo: <i className="leg-ponto st-good" /> = sugerido</span>
            <span><i className="leg-ponto st-acc" /> dá pra cobrar mais</span>
            <span><i className="leg-ponto st-neu" /> acima do sugerido</span>
            <span><i className="leg-ponto st-bad" /> abaixo do piso / escada invertida</span>
            <span className="legenda-dica">Clique na linha: custo, faixa, texto pro anúncio, concorrente e insumos.</span>
          </div>
          <div className="table-wrap tabela-escada cabecalho-fixo">
            <table>
              <thead>
                <tr>
                  <th>Kit</th>
                  <th className="num">Preço sugerido</th>
                  <th className="num">Lucro do pedido</th>
                  <th className="num">Cliente economiza</th>
                  <th className="num">Preço salvo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let salvoPPAnterior = dados.p1;
                  const pare = (fn) => (ev) => {
                    ev.stopPropagation();
                    fn();
                  };
                  const linhaDetalhe = (chave, conteudo) =>
                    selPQ === chave && (
                      <tr className="linha-detalhe" key={`d-${chave}`}>
                        <td colSpan={6}>
                          <div className="detalhe-cel">{conteudo}</div>
                        </td>
                      </tr>
                    );
                  const alternar = (chave) => () => setSelPQ((x) => (x === chave ? null : chave));
                  return e.linhas.flatMap((l) => {
                    if (l.base) {
                      return [
                        <tr key="base" className={`linha-cad linha-clicavel${selPQ === "base" ? " linha-atual" : ""}`} onClick={alternar("base")}>
                          <td>
                            <b className="kit-n">1 un.</b>
                            <span className="sub">{dados.itemPai.nome} · base</span>
                            <FreteAviso frete={freteDe(valorBase)} compacto />
                          </td>
                          <td className="num">
                            <b>{BRL(l.sugerido)}</b>
                            <span className="sub">preço avulso</span>
                          </td>
                          <td className="num">
                            <b>{BRL(l.lucro)}</b> · {PCT(l.margem)}
                            <span className="sub">{BRL(l.lucro)}/peça</span>
                            <div className="barra-lpp"><i style={{ width: `${Math.max(0, (l.lucro / maxLpp) * 100)}%` }} /></div>
                          </td>
                          <td className="num">—</td>
                          <td className="num">
                            {dados.salvo1 != null ? BRL(dados.salvo1) : "—"}
                            <span className="sub">
                              <span className="badge good">base</span>
                            </span>
                          </td>
                          <td></td>
                        </tr>,
                        linhaDetalhe(
                          "base",
                          <>
                            <div className="detalhe-cel-grade">
                              <div className="kv-cel">
                                <small>Custo</small>
                                <b>{BRL(l.custo)}</b>
                                <span>alvo {BRL(e.lBase)}/peça</span>
                              </div>
                              <div className="kv-cel">
                                <small>Faixa do canal</small>
                                <b>{faixaTxt(canal, l.taxas)}</b>
                              </div>
                            </div>
                            {e.baseRef && (
                              <div className="aviso-cel">
                                <b>Base = margem desejada</b> (
                                {{ atracao: "avulso em atração — escolhido", crescimento: "avulso em crescimento — escolhido", rampa: "avulso em rampa", sugerido: "sugerido: avulso parece atração" }[e.baseMotivo] || "avulso abaixo da margem desejada"})
                              </div>
                            )}
                            <FreteAviso frete={freteDe(valorBase)} dica={dicaFreteAvulso} />
                            <div>
                              <div className="legenda-tit" style={{ marginBottom: 4 }}>Texto pro anúncio</div>
                              <div className="txt-anuncio">{BRL(l.sugerido)} a unidade</div>
                            </div>
                          </>
                        ),
                      ];
                    }
                    const st = statusPrecoSalvo(l.salvo, l, salvoPPAnterior);
                    if (l.salvo != null) salvoPPAnterior = l.salvo / l.n;
                    const kConc = `${pid}|${canal.id}|${l.n}`;
                    const chave = `n${l.n}`;
                    return [
                      <tr key={l.n} className={`${l.cadastrada ? "linha-cad " : ""}linha-clicavel${selPQ === chave ? " linha-atual" : ""}`} onClick={alternar(chave)}>
                        <td>
                          <b className="kit-n">{l.n} un.</b>
                          <span className="sub">{l.cadastrada ? `${l.nome} · cadastrada` : "ainda não existe"}</span>
                          {l.concorrenteAbaixoDoPiso && <span className="chip-cel ruim">concorrente abaixo do mínimo</span>}
                          <FreteAviso frete={freteDe(valorLinha(l))} compacto />
                        </td>
                        <td className="num">
                          <span className="sug">{BRL(l.sugerido)}</span>
                          <span className="sub">{BRL(l.porPeca)} cada</span>
                        </td>
                        <td className="num">
                          <b>{BRL(l.lucro)}</b> · {PCT(l.margem)}
                          <span className="sub">{BRL(l.lucroPorPeca)}/peça</span>
                          <div className="barra-lpp"><i style={{ width: `${Math.max(0, (l.lucroPorPeca / maxLpp) * 100)}%` }} /></div>
                        </td>
                        <td className="num" style={{ color: "var(--good)" }}>
                          {BRL(l.economia)}
                          <span className="sub">
                            {PCT(l.economiaPct)} vs {l.n}× avulso
                          </span>
                        </td>
                        <td className="num">
                          {l.salvo != null ? (
                            <span className="cel-preco-cmp" title={st?.texto}>
                              {st && <span className={`ponto-st ${st.tom}`} />}
                              <b>{BRL(l.salvo)}</b>
                            </span>
                          ) : l.cadastrada ? (
                            <span className="chip-cel">sem preço</span>
                          ) : (
                            <span className="chip-cel">não existe</span>
                          )}
                          {st && st.tom !== "good" && <span className="sub">{st.texto.replace(/^[^\wÀ-ú]+\s*/, "")}</span>}
                        </td>
                        <td>
                          {l.naoCompensa ? (
                            <span className="badge bad">não compensa</span>
                          ) : l.cadastrada ? (
                            st?.tom === "good" ? null : (
                              <button type="button" className="btn primary btn-sm" onClick={pare(() => setConfirmar({ tipo: "aplicar", linha: l }))}>
                                Aplicar {BRL(l.sugerido)}
                              </button>
                            )
                          ) : (
                            <button type="button" className="btn btn-sm" onClick={pare(() => setConfirmar({ tipo: "criar", linha: l }))}>
                              + Criar variação
                            </button>
                          )}
                        </td>
                      </tr>,
                      linhaDetalhe(
                        chave,
                        <>
                          <div className="detalhe-cel-grade">
                            <div className="kv-cel">
                              <small>Custo</small>
                              <b>{BRL(l.custo)}</b>
                              <span>{l.estimado ? "estimado — crie a variação pro custo real" : `alvo ${BRL(l.alvoLpp)}/peça · ${pctTxt(l.ret)}`}</span>
                            </div>
                            <div className="kv-cel">
                              <small>Faixa do canal</small>
                              <b>{faixaTxt(canal, l.taxas)}</b>
                              {l.notas.length > 0 && <span>{l.notas.join(" · ")}</span>}
                            </div>
                            <div className="kv-cel">
                              <small>Preço salvo</small>
                              <b>{l.salvo != null ? BRL(l.salvo) : "—"}</b>
                              <span>{l.salvo != null ? `${BRL(l.salvo / l.n)}/peça${st ? ` · ${st.texto.replace(/^[^\wÀ-ú]+\s*/, "")}` : ""}` : l.cadastrada ? "variação sem preço neste canal" : "variação ainda não criada"}</span>
                            </div>
                            <label className="kv-cel" onClick={(ev) => ev.stopPropagation()}>
                              <small>Concorrente (opcional)</small>
                              <input
                                className="input-conc"
                                type="number"
                                step="0.1"
                                placeholder="preço pra essa quantidade"
                                value={concEdit[kConc] ?? (l.concorrente ?? "")}
                                onChange={(ev) => setConcEdit((prev) => ({ ...prev, [kConc]: ev.target.value }))}
                                onBlur={() => l.cadastrada && salvarConcorrente(l.n, "variacao", l.variacaoId)}
                              />
                              <span>{l.cadastrada ? "teto da sugestão, nunca abaixo do mínimo" : "crie a variação pra salvar"}</span>
                            </label>
                          </div>
                          <div className="detalhe-cel-avisos">
                            <FreteAviso frete={freteDe(valorLinha(l))} />
                            {l.concorrenteAbaixoDoPiso && (
                              <div className="aviso-cel ruim">
                                <b>Concorrente abaixo do seu mínimo</b> — não acompanhado: diferencie pelo kit, foto ou qualidade.
                              </div>
                            )}
                            {regra4x && !regra4x.ok && anuncioDe(l.n) > 1 && (
                              <div className="aviso-cel">
                                <b>Shopee: anúncio {anuncioDe(l.n)} (se anunciar)</b> — pela regra de 4×, essa quantidade vai num anúncio separado do avulso.
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="legenda-tit" style={{ marginBottom: 4 }}>Texto pro anúncio</div>
                            <div className="txt-anuncio">
                              {l.n} un. = {BRL(l.porPeca)} cada ·{" "}
                              {l.nAnterior === 1 && l.n === 2 ? `2ª unidade por ${BRL(l.sugerido - dados.p1)}` : `+${l.n - l.nAnterior} un. por só ${BRL(l.maisQueAnterior)} a mais`}
                            </div>
                          </div>
                          <div className="detalhe-cel-acoes">
                            {!l.naoCompensa && l.cadastrada && (
                              <button type="button" className={`btn btn-mini${st?.tom === "good" ? "" : " primary"}`} onClick={() => setConfirmar({ tipo: "aplicar", linha: l, precoEdit: st?.tom === "good" && l.salvo != null ? l.salvo.toFixed(2) : undefined })}>
                                {st?.tom === "good" ? "✎ Editar preço" : `Aplicar ${BRL(l.sugerido)} (editável)`}
                              </button>
                            )}
                            {!l.naoCompensa && !l.cadastrada && (
                              <button type="button" className="btn btn-mini primary" onClick={() => setConfirmar({ tipo: "criar", linha: l })}>
                                + Criar variação
                              </button>
                            )}
                            {l.cadastrada && (
                              <button type="button" className="btn btn-mini" onClick={() => setRevisar(variacoesRaw.find((x) => x.id === l.variacaoId) || null)}>
                                Revisar insumos
                              </button>
                            )}
                          </div>
                        </>
                      ),
                    ];
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {revisar && produto && (
        <EditorVariacao
          key={revisar.id}
          variacao={revisar}
          produto={produto}
          produtoEmbalagens={produtoEmbalagens}
          embalagens={embalagens}
          materiais={materiais}
          onToast={onToast}
          onClose={() => setRevisar(null)}
          titulo={`Revisar insumos — ${revisar.nome || `Kit ${revisar.quantidade}`}`}
        />
      )}
      {confirmar && (confirmar.tipo === "aplicar" || confirmar.tipo === "criar") && (() => {
        const res = resultadoNoPrecoConfirmado(confirmar);
        const minimo = precoMinimoAceitavel(canal, confirmar.linha.custo, confirmar.linha.peso, cfg);
        const al = alertaPreco({ lucro: res.lucro, preco: res.preco, minimo, estrategia: { chave: "normal" }, canal });
        const editado = Math.abs(res.preco - confirmar.linha.sugerido) >= 0.005;
        return (
          <EditarDialog
            titulo={confirmar.tipo === "criar" ? `Criar Kit ${confirmar.linha.n} — ${nomeCanal(canal)}` : `Salvar preço — ${confirmar.linha.nome} em ${nomeCanal(canal)}`}
            salvando={salvando}
            onSalvar={executar}
            onCancelar={() => setConfirmar(null)}
            salvarLabel={confirmar.tipo === "criar" ? `Criar e salvar ${BRL(res.preco)}` : `Salvar ${BRL(res.preco)}`}
            classe="modal-box-md"
          >
            <p className="hint" style={{ marginTop: 0 }}>
              {confirmar.tipo === "criar"
                ? `Cria a variação "Kit ${confirmar.linha.n}" em ${dados?.itemPai.nome} (produção = custo por peça × ${confirmar.linha.n}; ajuste caixa/chapa depois em "revisar insumos") e salva o preço abaixo.`
                : `Sugerido pela escada: ${BRL(confirmar.linha.sugerido)}${confirmar.linha.salvo != null ? ` · salvo hoje: ${BRL(confirmar.linha.salvo)}` : ""}. Pode ajustar uns centavos antes de salvar.`}
            </p>
            <div className="field" style={{ maxWidth: 200 }}>
              <label>Preço (R$)</label>
              <input
                type="number"
                step="0.01"
                autoFocus
                value={confirmar.precoEdit ?? confirmar.linha.sugerido.toFixed(2)}
                onChange={(ev) => setConfirmar((cf) => ({ ...cf, precoEdit: ev.target.value }))}
              />
            </div>
            <div className="kv">
              <span className="k">Lucro · margem</span>
              <span className="v">
                {res.lucro != null ? BRL(res.lucro) : "—"} · {res.margem != null ? PCT(res.margem) : "—"}
              </span>
            </div>
            <div className="kv">
              <span className="k">Por peça ({confirmar.linha.n} un.)</span>
              <span className="v">
                {BRL(res.preco / confirmar.linha.n)} · lucro {res.lucro != null ? BRL(res.lucro / confirmar.linha.n) : "—"}
              </span>
            </div>
            {editado && <p className="hint" style={{ margin: "4px 0 0" }}>Diferente do sugerido ({BRL(confirmar.linha.sugerido)}).</p>}
            <FreteAviso frete={al.frete} />
            {(al.tipo === "prejuizo" || al.tipo === "abaixo-minimo") && (
              <div className={`alerta alerta-${al.tipo === "prejuizo" ? "bad" : "warn"}`} style={{ marginTop: 8 }}>
                <b>{al.tipo === "prejuizo" ? "Esse preço dá prejuízo" : `Abaixo do mínimo aceitável (${BRL(minimo)})`}</b>
                {al.tipo === "prejuizo" ? "Cada venda nesse preço tira dinheiro do seu bolso." : "Dá pra salvar mesmo assim; depois, se for de propósito, use “manter assim” em Produtos precificados."}
              </div>
            )}
          </EditarDialog>
        );
      })()}
      {confirmar && confirmar.tipo === "avulso" && (
        <ConfirmDialog
          titulo={confirmar.tipo === "criar" ? `Criar Kit ${confirmar.linha.n}?` : confirmar.tipo === "avulso" ? "Salvar preço avulso?" : `Aplicar ${BRL(confirmar.linha.sugerido)}?`}
          mensagem={
            confirmar.tipo === "criar"
              ? `Cria a variação "Kit ${confirmar.linha.n}" em ${dados?.itemPai.nome} (produção = custo por peça × ${confirmar.linha.n}; ajuste caixa/chapa depois no cadastro) e salva ${BRL(confirmar.linha.sugerido)} como preço em ${nomeCanal(canal)}.`
              : confirmar.tipo === "avulso"
                ? `Salva ${BRL(dados?.p1)} como preço de ${dados?.itemPai.nome} (1 un.) em ${nomeCanal(canal)}${dados?.salvo1 != null ? `, no lugar de ${BRL(dados.salvo1)}` : ""}.`
                : `Salva ${BRL(confirmar.linha.sugerido)} como preço de ${confirmar.linha.nome} em ${nomeCanal(canal)}${confirmar.linha.salvo != null ? `, no lugar de ${BRL(confirmar.linha.salvo)}` : ""}.`
          }
          confirmarLabel={salvando ? "Salvando…" : "Confirmar"}
          onConfirm={executar}
          onCancel={() => setConfirmar(null)}
        />
      )}
    </>
  );
}
