import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { BRL } from "../lib/format.js";
import { nomeCanal } from "../lib/canais.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { LIMITE_NOME_OPCAO, fichaDoGrupo, idDoItemOpcao, opcoesDoGrupo, variacao2DoGrupo } from "../lib/anunciosGrupo.js";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import FreteAviso from "./FreteAviso.jsx";
import EditarDialog from "./EditarDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// 3º Ficha do anúncio — modo "Anúncio com vários itens" (schema v46): um
// anúncio que junta itens diferentes numa variação ("Conjunto", "Tamanho"),
// opcionalmente combinada com uma variação própria (Cor). Cada linha usa o
// preço SALVO do item no canal (riscado fixo se já anunciado; Rampa = agora).
// Só grava o grupo (nome, variação, opções) — nunca preço.
const num2 = (v) => String(Number(v).toFixed(2)).replace(".", ",");
const sufixoAuto = (nome) => `-${String(nome).normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "X"}`;
const PREFIXO_TIPO = { p: "produto", v: "variacao", k: "kit" };

export default function FichaGrupo({ canal, canais, onCanal, grupoId, onGrupo, onToast, onIrPara }) {
  const { lojaId } = useLoja();
  const { itens, precos, produtos, kits, mapaRampa, clientePagaHoje, publicacoesCanal } = useEscada();
  const { grupos, disponivel } = useAnunciosGrupo();
  const [editar, setEditar] = useState(null); // {} novo | { grupo }
  const [excluir, setExcluir] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(null);
  const grupo = grupos.find((g) => g.id === grupoId) || null;

  const ficha = useMemo(
    () => (grupo && canal ? fichaDoGrupo({ grupo, canal, itens, precos, produtos, kits, mapaRampa, publicacoes: publicacoesCanal, clientePagaHoje }) : null),
    [grupo, canal, itens, precos, produtos, kits, mapaRampa, publicacoesCanal, clientePagaHoje]
  );

  async function salvarGrupo(f) {
    if (!supabase) return;
    const linha = {
      loja_id: lojaId || null,
      nome: f.nome.trim(),
      variacao_nome: f.variacao_nome.trim() || "Conjunto",
      opcoes: f.opcoes
        .filter((o) => o.itemId)
        .map((o) => ({ rotulo: o.rotulo.trim(), item_tipo: PREFIXO_TIPO[o.itemId.slice(0, 1)] || "produto", item_id: o.itemId.slice(2), sufixo_sku: o.sufixo.trim().toUpperCase() })),
      variacao2: f.v2ativo && f.v2nome.trim() && f.v2opcoes.length ? { nome: f.v2nome.trim(), opcoes: f.v2opcoes } : null,
      atualizado_em: new Date().toISOString(),
    };
    setSalvando(true);
    const r = editar?.grupo ? await supabase.from("anuncios_grupo").update(linha).eq("id", editar.grupo.id).select().single() : await supabase.from("anuncios_grupo").insert(linha).select().single();
    setSalvando(false);
    if (r.error) return onToast?.(/anuncios_grupo|schema cache|does not exist/.test(r.error.message) ? "Falta rodar o supabase/schema_v46.sql no Supabase" : `Não foi possível salvar: ${r.error.message}`);
    window.dispatchEvent(new Event("focus"));
    setEditar(null);
    if (r.data?.id) onGrupo(r.data.id);
    onToast?.(`Anúncio “${linha.nome}” salvo`);
  }

  async function confirmarExcluir() {
    const g = excluir;
    setExcluir(null);
    const { error } = await supabase.from("anuncios_grupo").delete().eq("id", g.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    window.dispatchEvent(new Event("focus"));
    if (grupoId === g.id) onGrupo("");
    onToast?.(`Anúncio “${g.nome}” excluído (os itens e preços continuam)`);
  }

  async function copiarValor(texto, chave) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1200);
    } catch {
      onToast?.("Não deu pra copiar automaticamente neste navegador");
    }
  }
  const colunas = ficha ? [ficha.varNome, ...(ficha.v2 ? [ficha.v2.nome] : [])] : [];
  const valores = (l) => [l.rotulo, ...(ficha?.v2 ? [l.cor] : [])];
  const tsvVariacoes = () => ["Variação\tOpções", ...ficha.tabelaVar.map((v) => `${v.nome}\t${v.opcoes.join(", ")}`)].join("\n");
  const tsvProdutos = () =>
    [
      ["SKU", ...colunas, "Preço original", "Promoção %", "Cliente paga"].join("\t"),
      ...ficha.linhas.map((l) => [l.sku, ...valores(l), l.an ? num2(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num2(l.an.clientePaga) : ""].join("\t")),
    ].join("\n");
  function exportarCsv() {
    const rows = [["Anúncio", "SKU", ...colunas, "Item", "Preço original", "Promoção %", "Cliente paga"]];
    ficha.linhas.forEach((l) => rows.push([grupo.nome, l.sku, ...valores(l), l.item?.nome || "", l.an ? num2(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num2(l.an.clientePaga) : ""]));
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ficha-${String(grupo.nome).toLowerCase().replace(/\s+/g, "-")}-${String(canal?.tipo || "canal")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function copiar(texto, rotulo) {
    try {
      await navigator.clipboard.writeText(texto);
      onToast?.(`${rotulo} copiada — cole na planilha ou na plataforma`);
    } catch {
      onToast?.("Não deu pra copiar automaticamente neste navegador");
    }
  }

  return (
    <>
      <div className="ficha-topo">
        <div className="panel">
          <h3 className="section-title h3-split">
            <span>
              Anúncio com vários itens
              <Ajuda texto="Junta itens DIFERENTES num anúncio só, com uma variação (ex.: Conjunto = Letreiro / Kit Básico / Kit Completo; Tamanho = Vaso P / M / G cadastrados como produtos separados). Cada opção aponta pra um item cadastrado — o preço de cada linha é o preço salvo desse item no canal (Precificação). Dá pra combinar com uma variação própria (ex.: Cor) — no máximo 2 variações por anúncio." />
            </span>
            {disponivel && (
              <button type="button" className="btn btn-sm" onClick={() => setEditar({})}>
                + Novo anúncio
              </button>
            )}
          </h3>
          {!disponivel ? (
            <div className="hint" style={{ margin: 0 }}>Falta rodar o <b>supabase/schema_v46.sql</b> no Supabase pra criar anúncios com vários itens.</div>
          ) : !grupos.length ? (
            <div className="hint" style={{ margin: 0 }}>Nenhum ainda. Clique em “+ Novo anúncio” (ex.: Kit de Natal com Letreiro, Kit Básico e Kit Completo).</div>
          ) : (
            <div className="ficha-grupos">
              {grupos.map((g) => (
                <span key={g.id} className={`ficha-grupo${g.id === grupoId ? " on" : ""}`}>
                  <button type="button" className="link-btn" onClick={() => onGrupo(g.id)}>
                    {g.nome} <span className="muted-cel">· {g.variacao_nome} ({opcoesDoGrupo(g).length})</span>
                  </button>
                  <button type="button" className="btn-icone" title="Editar" onClick={() => setEditar({ grupo: g })}>✎</button>
                  <button type="button" className="btn-icone" title="Excluir este anúncio (os itens e preços continuam)" onClick={() => setExcluir(g)}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="field" style={{ margin: "10px 0 0" }}>
            <label>Canal</label>
            <div className="ficha-canais">
              {canais.map((c) => (
                <button key={c.id} type="button" className={`ficha-canal${canal?.id === c.id ? " on" : ""}`} onClick={() => onCanal(c.id)}>
                  <CanalTag canal={c} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <h3 className="section-title">Opções do anúncio</h3>
          {!grupo ? (
            <div className="hint" style={{ margin: 0 }}>Escolha um anúncio ao lado.</div>
          ) : (
            <div className="ficha-grupo-resumo">
              <div>
                <b>{grupo.variacao_nome}</b>:{" "}
                {opcoesDoGrupo(grupo).map((o) => {
                  const it = itens.find((i) => i.id === idDoItemOpcao(o));
                  return (
                    <span key={o.item_id + o.sufixo_sku} className="ficha-cor" title={it ? `${it.nome}${it.sku ? ` · ${it.sku}` : ""}` : "item não encontrado"}>
                      {o.rotulo || it?.nome || "?"} {o.sufixo_sku && <code>{o.sufixo_sku}</code>}
                    </span>
                  );
                })}
              </div>
              {variacao2DoGrupo(grupo) && (
                <div>
                  <b>{variacao2DoGrupo(grupo).nome}</b>:{" "}
                  {variacao2DoGrupo(grupo).opcoes.map((o) => (
                    <span key={o.sufixo + o.nome} className="ficha-cor">
                      {o.nome} <code>{o.sufixo}</code>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {grupo && canal && ficha && (
        <>
          <div className="ficha-checks">
            {ficha.nomesLongos.length ? (
              <span className="chk warn">⚠ Nome com mais de {LIMITE_NOME_OPCAO} caracteres: {ficha.nomesLongos.join(", ")}</span>
            ) : (
              <span className="chk ok">✓ Nomes das opções com até {LIMITE_NOME_OPCAO} caracteres</span>
            )}
            {canal.tipo === "shopee" && ficha.regra4x && (ficha.regra4x.ok ? (
              <span className="chk ok">✓ Regra de 4×: {ficha.regra4x.razao.toFixed(1).replace(".", ",")}× (cabe num anúncio só)</span>
            ) : (
              <span className="chk info" title="Regra da Shopee: num anúncio, o preço original da opção mais cara não pode passar de 4× o que o cliente paga na mais barata.">
                ⓘ Regra de 4×: {ficha.regra4x.maisCara.rotulo} (original {BRL(ficha.regra4x.maisCara.anSalvo.original)}) passa de 4× {ficha.regra4x.maisBarata.rotulo} ({BRL(ficha.regra4x.maisBarata.anSalvo.clientePaga)}) — {ficha.regra4x.razao.toFixed(1).replace(".", ",")}×; tire uma opção ou faça outro anúncio
              </span>
            ))}
            {ficha.semPreco.length ? (
              ficha.semPreco.map((l) => (
                <button key={l.chave} type="button" className="chk warn chk-btn" onClick={() => onIrPara?.(l.item.id.startsWith("v:") ? "quantidade" : "avulso", l.item.id.startsWith("v:") ? `p:${l.item.produtoId}` : l.item.id)}>
                  ⚠ {l.rotulo}: sem preço salvo na {nomeCanal(canal)} → salvar
                </button>
              ))
            ) : (
              <span className="chk ok">✓ Todas as opções com preço salvo na {nomeCanal(canal)}</span>
            )}
            {ficha.semItem.length > 0 && <span className="chk warn">⚠ Item não encontrado (excluído?): {ficha.semItem.map((l) => l?.rotulo || "?").join(", ")} — edite o anúncio</span>}
            {ficha.semSku.length > 0 && <span className="chk warn">⚠ Sem SKU: {ficha.semSku.map((l) => l.rotulo).join(", ")} — cadastre no item (Cadastros) ou na Ficha de um item só</span>}
            {ficha.freteAbaixo.length > 0 && <span className="chk warn">⚠ Abaixo do frete grátis: {ficha.freteAbaixo.map((l) => l.rotulo).join(", ")}</span>}
            {ficha.nomesForaML.length > 0 && <span className="chk warn">⚠ Confira se a categoria do {nomeCanal(canal)} aceita “{ficha.nomesForaML.join("”, “")}” como variação — se não, um anúncio por opção</span>}
          </div>

          <div className="ficha-anuncio">
            <div className="ficha-anuncio-cab" style={{ cursor: "default" }}>
              <span className="ficha-n">ANÚNCIO</span>
              <b>{grupo.nome}</b>
              <span className="ficha-sp" />
              <span className="ficha-meta">
                {ficha.linhas.length} {ficha.linhas.length === 1 ? "opção" : "opções"}
              </span>
            </div>
            <div className="ficha-blocos">
              <div className="ficha-bloco">
                <h4>
                  Variações
                  <span className="ficha-sp" />
                  <button type="button" className="link-btn" onClick={() => copiar(tsvVariacoes(), "Tabela de variações")}>copiar</button>
                </h4>
                <table>
                  <thead>
                    <tr>
                      <th>Variação</th>
                      <th>Opções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.tabelaVar.map((v) => (
                      <tr key={v.nome}>
                        <td>{v.nome}</td>
                        <td>
                          {v.opcoes.map((o) => (
                            <span key={o} className={`ficha-opt${String(o).length > LIMITE_NOME_OPCAO ? " longa" : ""}`} title={`${String(o).length} caracteres`}>
                              {o}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ficha-bloco">
                <h4>
                  Produtos
                  <span className="ficha-sp" />
                  <button type="button" className="link-btn" onClick={() => copiar(tsvProdutos(), "Tabela de produtos")}>copiar tabela</button>
                </h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        {colunas.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                        <th className="num">Preço original</th>
                        <th className="num">Promo</th>
                        <th className="num">Cliente paga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.linhas.map((l) => (
                        <tr key={l.chave}>
                          <td className="ficha-sku">
                            {l.semSku ? <span style={{ color: "var(--warn)" }}>sem SKU{l.sufixos}</span> : l.sku}
                            {!l.semSku && (
                              <button type="button" className={`link-btn ficha-copiar${copiado === `sku|${l.chave}` ? " ok" : ""}`} title="Copiar SKU" onClick={() => copiarValor(l.sku, `sku|${l.chave}`)}>
                                {copiado === `sku|${l.chave}` ? "✓" : "⧉"}
                              </button>
                            )}
                            <div className="muted-cel">{l.item ? l.item.nome : "item não encontrado"}</div>
                          </td>
                          {valores(l).map((vv, i) => (
                            <td key={i}>{vv}</td>
                          ))}
                          {l.an ? (
                            <>
                              <td className="num">
                                <button type="button" className={`ficha-valor${copiado === `po|${l.chave}` ? " ok" : ""}`} title="Clique pra copiar o preço original" onClick={() => copiarValor(num2(l.an.original), `po|${l.chave}`)}>
                                  <b>{BRL(l.an.original)}</b>
                                  <span className="ficha-copiar-ic">{copiado === `po|${l.chave}` ? "✓" : "⧉"}</span>
                                </button>
                                {l.an.riscadoFixo && <div className="muted-cel">já anunciado (fixo)</div>}
                              </td>
                              <td className="num">
                                {l.an.promo ? (
                                  <button type="button" className={`ficha-valor${copiado === `pr|${l.chave}` ? " ok" : ""}`} title="Clique pra copiar a promoção %" onClick={() => copiarValor(String(l.an.promo), `pr|${l.chave}`)}>
                                    {l.an.promo}%<span className="ficha-copiar-ic">{copiado === `pr|${l.chave}` ? "✓" : "⧉"}</span>
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="num" style={{ color: "var(--ink-soft)" }}>
                                {l.an.emRampa ? (
                                  <>
                                    agora <b>{BRL(l.an.clientePaga)}</b>
                                    <div className="muted-cel">{l.anSalvo && Math.abs(l.anSalvo.clientePaga - l.an.clientePaga) > 0.004 ? `alvo ${BRL(l.anSalvo.clientePaga)}` : "= alvo"}</div>
                                  </>
                                ) : (
                                  BRL(l.an.clientePaga)
                                )}
                                {l.an.clientePaga - l.an.real > 0.004 && <span className="ficha-centavo"> +{Math.round((l.an.clientePaga - l.an.real) * 100)}¢</span>}
                                {l.frete && (
                                  <div>
                                    <FreteAviso frete={l.frete} compacto />
                                  </div>
                                )}
                                {l.an.acimaDoRiscado && (
                                  <div>
                                    <span className="chip-cel atencao" title="O preço desejado passou do preço original já anunciado — considere manter">⚠ acima do riscado</span>
                                  </div>
                                )}
                                {l.an.emRampa && (
                                  <div>
                                    <span className="rampa-tag" title="Em rampa de preço (Crescimento): preço de agora — riscado fixo no alvo, só a promo muda">
                                      {l.an.acima ? "testando acima · preço da Rampa" : "em rampa · preço da Rampa"}
                                    </span>
                                  </div>
                                )}
                              </td>
                            </>
                          ) : (
                            <td className="num" colSpan={3} style={{ color: "var(--warn)" }}>
                              {l.item ? "sem preço salvo" : "item não encontrado"}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          <div className="ficha-rodape">
            <button type="button" className="btn btn-sm" onClick={exportarCsv}>
              Exportar CSV deste anúncio
            </button>
            <span className="hint" style={{ margin: 0 }}>Os preços vêm do preço salvo de cada item; o “feito” é na 5º Anunciar.</span>
          </div>
        </>
      )}

      {editar && <GrupoDialog grupo={editar.grupo || null} itens={itens} salvando={salvando} onCancelar={() => setEditar(null)} onSalvar={salvarGrupo} />}
      {excluir && (
        <ConfirmDialog
          titulo={`Excluir o anúncio “${excluir.nome}”?`}
          mensagem="Só o agrupamento é apagado: os itens, preços salvos e marcações da Anunciar continuam."
          confirmarLabel="Excluir anúncio"
          perigo
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluir(null)}
        />
      )}
    </>
  );
}

function GrupoDialog({ grupo, itens, salvando, onCancelar, onSalvar }) {
  const opcoesBusca = useMemo(() => gruposDoSeletor(itens), [itens]);
  const [f, setF] = useState(() => {
    const v2 = variacao2DoGrupo(grupo);
    return {
      nome: grupo?.nome || "",
      variacao_nome: grupo?.variacao_nome || "Conjunto",
      opcoes: grupo ? opcoesDoGrupo(grupo).map((o) => ({ rotulo: o.rotulo, itemId: idDoItemOpcao(o), sufixo: o.sufixo_sku })) : [{ rotulo: "", itemId: "", sufixo: "" }],
      v2ativo: !!v2,
      v2nome: v2?.nome || "Cor",
      v2opcoes: v2?.opcoes || [],
      novaCor: { nome: "", sufixo: "" },
    };
  });
  const setOp = (i, campo, valor) => setF((p) => ({ ...p, opcoes: p.opcoes.map((o, k) => (k === i ? { ...o, [campo]: valor } : o)) }));
  const escolherItem = (i, id) =>
    setF((p) => ({
      ...p,
      opcoes: p.opcoes.map((o, k) => (k === i ? { ...o, itemId: id, rotulo: o.rotulo || itens.find((x) => x.id === id)?.nome?.slice(0, LIMITE_NOME_OPCAO) || "" } : o)),
    }));
  const mover = (i, d) =>
    setF((p) => {
      const ops = [...p.opcoes];
      const j = i + d;
      if (j < 0 || j >= ops.length) return p;
      [ops[i], ops[j]] = [ops[j], ops[i]];
      return { ...p, opcoes: ops };
    });
  const tirar = (i) => setF((p) => ({ ...p, opcoes: p.opcoes.filter((_, k) => k !== i) }));
  const addCor = () =>
    setF((p) => {
      const nome = p.novaCor.nome.trim();
      if (!nome) return p;
      let sufixo = (p.novaCor.sufixo.trim() || sufixoAuto(nome)).toUpperCase();
      if (!sufixo.startsWith("-")) sufixo = `-${sufixo}`;
      if (p.v2opcoes.some((o) => o.sufixo === sufixo)) return p;
      return { ...p, v2opcoes: [...p.v2opcoes, { nome, sufixo }], novaCor: { nome: "", sufixo: "" } };
    });
  const validas = f.opcoes.filter((o) => o.itemId);
  const repetidas = validas.length !== new Set(validas.map((o) => `${o.itemId}|${o.sufixo}`)).size;
  const ok = f.nome.trim() && validas.length >= 2 && !repetidas;
  return (
    <EditarDialog titulo={grupo ? `Editar anúncio — ${grupo.nome}` : "Novo anúncio com vários itens"} salvando={salvando} onCancelar={onCancelar} onSalvar={() => ok && onSalvar(f)} salvarLabel="Salvar anúncio" classe="modal-box-md">
      <div className="grid-auto">
        <div className="field"><label>Nome do anúncio</label><input value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} placeholder="ex.: Kit de Natal" /></div>
        <div className="field">
          <label>Nome da variação</label>
          <input value={f.variacao_nome} list="grupo-nomes-var" maxLength={20} onChange={(e) => setF((p) => ({ ...p, variacao_nome: e.target.value }))} />
          <datalist id="grupo-nomes-var">
            <option value="Conjunto" />
            <option value="Tamanho" />
            <option value="Modelo" />
          </datalist>
        </div>
      </div>
      <div className="grupo-opcoes">
        <div className="grupo-opcao grupo-opcao-cab">
          <span>Opção (aparece no anúncio)</span>
          <span>Item cadastrado</span>
          <span>Sufixo do SKU</span>
          <span />
        </div>
        {f.opcoes.map((o, i) => (
          <div className="grupo-opcao" key={i}>
            <input value={o.rotulo} maxLength={LIMITE_NOME_OPCAO} placeholder="ex.: Kit Básico" onChange={(e) => setOp(i, "rotulo", e.target.value)} />
            <BuscaItem grupos={opcoesBusca} value={o.itemId} onChange={(id) => escolherItem(i, id)} vazio="— produto, variação ou kit —" />
            <input value={o.sufixo} maxLength={12} placeholder="opcional" onChange={(e) => setOp(i, "sufixo", e.target.value)} />
            <span className="grupo-opcao-acoes">
              <button type="button" className="btn-icone" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
              <button type="button" className="btn-icone" title="Descer" disabled={i === f.opcoes.length - 1} onClick={() => mover(i, 1)}>↓</button>
              <button type="button" className="btn-icone" title="Tirar esta opção" onClick={() => tirar(i)}>×</button>
            </span>
          </div>
        ))}
        <button type="button" className="btn btn-mini" onClick={() => setF((p) => ({ ...p, opcoes: [...p.opcoes, { rotulo: "", itemId: "", sufixo: "" }] }))}>
          + Opção
        </button>
      </div>
      <p className="hint">SKU de cada linha = SKU do item + sufixo da opção (+ sufixo da cor). Deixe o sufixo vazio se o item já tem SKU próprio.</p>
      {validas.length < 2 && <div className="hint">Escolha pelo menos 2 itens.</div>}
      {repetidas && <div className="alerta alerta-warn"><b>Opção repetida</b>O mesmo item com o mesmo sufixo aparece duas vezes.</div>}

      <label className="check-inline" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={f.v2ativo} onChange={(e) => setF((p) => ({ ...p, v2ativo: e.target.checked }))} /> Combinar com uma variação própria (ex.: Cor) — vale pra todas as opções
      </label>
      {f.v2ativo && (
        <div className="ficha-var" style={{ marginTop: 6 }}>
          <div className="ficha-var-cab">
            <input className="ficha-var-nome" value={f.v2nome} maxLength={20} onChange={(e) => setF((p) => ({ ...p, v2nome: e.target.value }))} />
          </div>
          <div className="ficha-cores">
            {f.v2opcoes.map((o) => (
              <span key={o.sufixo} className="ficha-cor">
                {o.nome} <code>{o.sufixo}</code>
                <button type="button" className="del" title="Remover" onClick={() => setF((p) => ({ ...p, v2opcoes: p.v2opcoes.filter((x) => x.sufixo !== o.sufixo) }))}>×</button>
              </span>
            ))}
            {!f.v2opcoes.length && <span className="hint" style={{ margin: 0 }}>Sem opções ainda.</span>}
          </div>
          <div className="ficha-add-cor">
            <input placeholder={`nova opção de ${f.v2nome.toLowerCase() || "cor"}`} maxLength={LIMITE_NOME_OPCAO} value={f.novaCor.nome} onChange={(e) => setF((p) => ({ ...p, novaCor: { ...p.novaCor, nome: e.target.value } }))} onKeyDown={(e) => e.key === "Enter" && addCor()} />
            <input className="ficha-sufixo" placeholder="-P" maxLength={12} value={f.novaCor.sufixo} onChange={(e) => setF((p) => ({ ...p, novaCor: { ...p.novaCor, sufixo: e.target.value } }))} onKeyDown={(e) => e.key === "Enter" && addCor()} />
            <button type="button" className="btn btn-sm" disabled={!f.novaCor.nome.trim()} onClick={addCor}>+ Opção</button>
          </div>
        </div>
      )}
    </EditarDialog>
  );
}
