import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { BRL, PCT } from "../lib/format.js";
import { referenciasAvulso, alertasAvulso, statusPrecoSalvo, ESCADA_PADRAO } from "../lib/escada.js";
import Ajuda from "./Ajuda.jsx";
import Kpis from "./Kpis.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

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
  { k: "margemMin", label: "Margem mínima (%)", ajuda: "Piso absoluto — nem o concorrente derruba abaixo disso." },
  { k: "margemDesejada", label: "Margem desejada (%)", ajuda: "Usada no preço de partida do avulso e pra avisar quando ele virou 'atração'." },
];

export default function PrecoPorQuantidade({ onToast }) {
  const { lojaId, atualizar } = useLoja();
  const { itens, canais, produtos, cfgLoja, cfgDoProduto, escada } = useEscada();
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
  const alertas = dados ? alertasAvulso({ canal, p1: dados.p1, base1: { custo: dados.custo1, peso: dados.peso1 }, cfg, escada: e, concorrente: dados.concorrente1 }) : [];
  const kits = e ? e.linhas.filter((l) => !l.base) : [];
  const k2 = kits.find((l) => l.n === 2);
  const melhor = kits.reduce((a, b) => (a == null || b.lucro > a.lucro ? b : a), null);
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

  async function salvarPreco({ itemTipo, itemId, preco, custo, lucro, margem }) {
    return supabase.from("precos_canal").upsert(
      {
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
    );
  }

  async function executar() {
    const c = confirmar;
    if (!c || !supabase) return;
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
      const { data, error: err } = await supabase
        .from("produto_variacoes")
        .insert({ loja_id: lojaId || null, produto_id: pid, quantidade: c.linha.n, nome: `Kit ${c.linha.n}`, producao_modo: "multiplicar" })
        .select()
        .single();
      error = err;
      if (!error && data) {
        // O custo real da variação (caixa, chapa…) aparece assim que o catálogo recarregar;
        // o preço é salvo já com o sugerido calculado agora.
        ({ error } = await salvarPreco({ itemTipo: "variacao", itemId: data.id, preco: c.linha.sugerido, custo: c.linha.custo, lucro: c.linha.lucro, margem: c.linha.margem }));
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
    setRegrasEdit({ valores: r, propria: !!escadaPropria });
    setMostrarRegras(true);
  }
  async function salvarRegras() {
    const v = regrasEdit.valores;
    const frac = (k) => Math.max(0, Math.min(1, (Number(v[k]) || 0) / 100));
    const doProduto = { r2: frac("r2"), r10: frac("r10"), piso: frac("piso"), vantagemMin: frac("vantagemMin") };
    const daLoja = { ...(cfgLoja || {}), margemMin: frac("margemMin"), margemDesejada: frac("margemDesejada") };
    if (!regrasEdit.propria) Object.assign(daLoja, doProduto);
    setSalvando(true);
    const r = await atualizar(lojaId, { configEscada: daLoja });
    let erro = r.ok ? null : r.error;
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
    onToast(regrasEdit.propria ? "Regras salvas (escada própria deste produto)" : "Regras da escada salvas pra loja toda");
  }

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
        <div className="grid-auto">
          <div className="field">
            <label>Produto pai</label>
            <select value={pid} onChange={(ev) => setProdutoId(ev.target.value)}>
              {produtosLista.map((p) => (
                <option key={p.id} value={p.id.slice(2)}>
                  {p.nome}
                  {p.sku ? ` · ${p.sku}` : ""}
                </option>
              ))}
            </select>
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
            <div className="chips">
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
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input type="number" min="2" placeholder="ex: 20" style={{ width: 90 }} value={novaQtd} onChange={(ev) => setNovaQtd(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && adicionarQtd()} />
              <button type="button" className="btn" onClick={adicionarQtd}>
                + simular
              </button>
            </div>
          </div>
        </div>
        {refs && (
          <div className="refs-linha">
            Referências: <b>margem desejada {BRL(refs.margemDesejada)}</b> · <b>margem mínima {BRL(refs.margemMinima)}</b> · <b>sem prejuízo {BRL(refs.semPrejuizo)}</b>
            {refs.concorrente != null && (
              <>
                {" "}
                · <b>concorrente {BRL(refs.concorrente)}</b>
              </>
            )}
          </div>
        )}
      </div>

      {alertas.map((a) => (
        <div key={a.titulo} className={`alerta alerta-${a.tom}`}>
          <b>{a.titulo}</b>
          {a.texto}
        </div>
      ))}

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
                {CAMPOS_ESCADA.map((c) => {
                  const soLoja = c.k === "margemMin" || c.k === "margemDesejada";
                  return (
                    <div className="field" key={c.k}>
                      <label>
                        {c.label}
                        {soLoja && regrasEdit.propria ? " · loja" : ""}
                      </label>
                      <input type="number" step="1" value={regrasEdit.valores[c.k]} onChange={(ev) => setRegrasEdit((prev) => ({ ...prev, valores: { ...prev.valores, [c.k]: ev.target.value } }))} />
                      <div className="hint" style={{ marginTop: 3, marginBottom: 0 }}>{c.ajuda}</div>
                    </div>
                  );
                })}
              </div>
              <label className="check-linha">
                <input type="checkbox" checked={regrasEdit.propria} onChange={(ev) => setRegrasEdit((prev) => ({ ...prev, propria: ev.target.checked }))} />
                Usar escada própria só pra <b>{produto?.nome}</b> (kit 2, kit 10, piso e vantagem). Desmarcado = regras valem pra loja toda.
              </label>
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
          <div className="table-wrap tabela-escada">
            <table>
              <thead>
                <tr>
                  <th>Kit</th>
                  <th className="num">Custo</th>
                  <th className="num">Preço sugerido</th>
                  <th className="num">Cliente economiza</th>
                  <th className="num">Lucro do pedido</th>
                  <th>Texto pro anúncio</th>
                  <th className="num">Preço salvo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let salvoPPAnterior = dados.p1;
                  return e.linhas.map((l) => {
                    if (l.base) {
                      return (
                        <tr key="base" className="linha-cad">
                          <td>
                            <b className="kit-n">1 un.</b>
                            <span className="sub">{dados.itemPai.nome} · base</span>
                          </td>
                          <td className="num">
                            {BRL(l.custo)}
                            <span className="sub">alvo {BRL(e.lBase)}/peça</span>
                            {e.baseRef && <span className="nota">base = margem desejada (avulso é atração)</span>}
                          </td>
                          <td className="num">
                            <b>{BRL(l.sugerido)}</b>
                            <span className="sub">preço avulso</span>
                            <span className="nota">{faixaTxt(canal, l.taxas)}</span>
                          </td>
                          <td className="num">—</td>
                          <td className="num">
                            <b>{BRL(l.lucro)}</b> · {PCT(l.margem)}
                            <span className="sub">{BRL(l.lucro)}/peça</span>
                            <div className="barra-lpp"><i style={{ width: `${Math.max(0, (l.lucro / maxLpp) * 100)}%` }} /></div>
                          </td>
                          <td className="quebra">
                            <span className="anuncio">{BRL(l.sugerido)} a unidade</span>
                          </td>
                          <td className="num">
                            {dados.salvo1 != null ? BRL(dados.salvo1) : "—"}
                            <span className="sub"><span className="badge good">base</span></span>
                          </td>
                          <td></td>
                        </tr>
                      );
                    }
                    const st = statusPrecoSalvo(l.salvo, l, salvoPPAnterior);
                    if (l.salvo != null) salvoPPAnterior = l.salvo / l.n;
                    const kConc = `${pid}|${canal.id}|${l.n}`;
                    return (
                      <tr key={l.n} className={l.cadastrada ? "linha-cad" : ""}>
                        <td>
                          <b className="kit-n">{l.n} un.</b>
                          <span className="sub">{l.cadastrada ? `${l.nome} · cadastrada` : "ainda não existe"}</span>
                          <input
                            className="input-conc"
                            type="number"
                            step="0.1"
                            placeholder="concorrente"
                            title="Preço do concorrente pra essa quantidade (opcional)"
                            value={concEdit[kConc] ?? (l.concorrente ?? "")}
                            onChange={(ev) => setConcEdit((prev) => ({ ...prev, [kConc]: ev.target.value }))}
                            onBlur={() => l.cadastrada && salvarConcorrente(l.n, "variacao", l.variacaoId)}
                          />
                        </td>
                        <td className="num">
                          {BRL(l.custo)}
                          <span className="sub">
                            alvo {BRL(l.alvoLpp)}/peça · {pctTxt(l.ret)}
                          </span>
                          {l.estimado && <span className="nota">custo estimado — crie a variação pro custo real</span>}
                        </td>
                        <td className="num">
                          <span className="sug">{BRL(l.sugerido)}</span>
                          <span className="sub">{BRL(l.porPeca)} cada</span>
                          <span className="nota">
                            {faixaTxt(canal, l.taxas)}
                            {l.notas.length ? ` · ${l.notas.join(" · ")}` : ""}
                          </span>
                          {l.concorrenteAbaixoDoPiso && <span className="frete-tag bad">concorrente abaixo da sua margem mínima — não acompanhado</span>}
                        </td>
                        <td className="num" style={{ color: "var(--good)" }}>
                          {BRL(l.economia)}
                          <span className="sub">
                            {PCT(l.economiaPct)} vs {l.n}× avulso
                          </span>
                        </td>
                        <td className="num">
                          <b>{BRL(l.lucro)}</b> · {PCT(l.margem)}
                          <span className="sub">{BRL(l.lucroPorPeca)}/peça</span>
                          <div className="barra-lpp"><i style={{ width: `${Math.max(0, (l.lucroPorPeca / maxLpp) * 100)}%` }} /></div>
                        </td>
                        <td className="quebra">
                          <span className="anuncio">
                            {l.n} un. = {BRL(l.porPeca)} cada
                          </span>{" "}
                          <span className="anuncio">
                            {l.nAnterior === 1 && l.n === 2 ? `2ª unidade por ${BRL(l.sugerido - dados.p1)}` : `+${l.n - l.nAnterior} un. por só ${BRL(l.maisQueAnterior)} a mais`}
                          </span>
                        </td>
                        <td className="num">
                          {l.salvo != null ? (
                            <>
                              {BRL(l.salvo)}
                              <span className="sub">{BRL(l.salvo / l.n)}/peça</span>
                            </>
                          ) : (
                            "—"
                          )}
                          {st ? (
                            <span className="sub">
                              <span className={`badge ${st.tom === "acc" ? "acc" : st.tom === "neu" ? "" : st.tom}`}>{st.texto}</span>
                            </span>
                          ) : l.cadastrada ? (
                            <span className="sub">
                              <span className="badge">sem preço</span>
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {l.naoCompensa ? (
                            <span className="badge bad">não compensa</span>
                          ) : l.cadastrada ? (
                            st?.tom === "good" ? null : (
                              <button type="button" className="btn primary btn-sm" onClick={() => setConfirmar({ tipo: "aplicar", linha: l })}>
                                Aplicar {BRL(l.sugerido)}
                              </button>
                            )
                          ) : (
                            <button type="button" className="btn btn-sm" onClick={() => setConfirmar({ tipo: "criar", linha: l })}>
                              + Criar variação
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmar && (
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
