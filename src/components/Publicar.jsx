import { hojeSP } from "../lib/datas.js";
import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { dicaKitFreteGratis } from "../lib/freteGratis.js";
import FreteAviso from "./FreteAviso.jsx";
import { BRL } from "../lib/format.js";
import { descontoPadraoCanal, gruposRegra4x } from "../lib/escada.js";
import { canalDireto, nomeCanal } from "../lib/canais.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import TirarDoCanalDialog from "./TirarDoCanalDialog.jsx";
import OndeSeDecide from "./OndeSeDecide.jsx";
import ProximoPasso from "./ProximoPasso.jsx";
import { useSelecaoPasso } from "../lib/passosPreco.js";
import { irParaAba } from "../lib/navegar.js";
import { linhasAnunciar } from "../lib/anunciar.js";
import { quebraNoValor } from "../lib/precoAgora.js";
import { QuebraLucro } from "./AlvoAgora.jsx";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem, idDoItemOpcao, opcoesDoGrupo } from "../lib/anunciosGrupo.js";

const pctTxt = (d) => `${Math.round(d * 1000) / 10}`.replace(".", ",");

// Anunciar — o anúncio é criado direto em cada marketplace (a Olist só cuida
// de estoque/pedidos/nota, com "preço fixo" na integração). Pra cada item com
// preço salvo e cada canal: o PREÇO ORIGINAL (riscado) pra digitar na
// plataforma e a PROMOÇÃO % — o cliente paga o preço real salvo. Desconto
// exibido = padrão do canal (Configuração → Canais) ou o próprio do produto/
// kit (clique no % da célula). ↻ por canal: você marca "feito" em cada
// plataforma e só aquele canal fica pendente quando o preço muda.
// Item em rampa: o cliente paga agora (Rampa) é o mesmo do alvo (salvo)?
const agoraIgualAlvo = (x) => Math.abs(Number(x.clientePaga) - Number(x.anSalvo?.clientePaga)) < 0.005;

export default function Publicar({ onToast, onSub }) {
  const { lojaId } = useLoja();
  const { itens, canais: canaisLoja, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje, cobraNoCanal, cfgDoProduto } = useEscada();
  // Venda direta (canal próprio) não tem o que digitar: fica fora da Anunciar.
  const canais = useMemo(() => canaisLoja.filter((c) => !canalDireto(c)), [canaisLoja]);
  // Lucro pelo que o cliente paga (lib/precoAgora.js), com a quebra recebe − repor.
  const lucroPago = (item, c, valor) => quebraNoValor(item, c, valor, cfgDoProduto(item.produtoId || (item.id.startsWith("p:") ? item.id.slice(2) : null)));
  const [verTodos, setVerTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [abertos, setAbertos] = useState(() => new Set());
  const [descEdit, setDescEdit] = useState(null); // { chave, itemId, canalId, valor }
  const [sel, setSel] = useState(null); // "itemId|canalId" com o detalhe aberto
  const [recalcular, setRecalcular] = useState(null);
  const [tirarAlvo, setTirarAlvo] = useState(null); // { item, canal } — "Tirar do <canal>"
  const [lancado, setLancado] = useState(null); // { nome, emRampa } — tudo do item marcado "feito"
  const { atual: selPasso } = useSelecaoPasso(); // { l, c } — recalcular o riscado (ação explícita)
  // Itens em rampa (aba Crescimento) vendendo num preço diferente do salvo:
  // o que digitar vem da Rampa (riscado fixo no alvo + promo do degrau) e o
  // "↻ atualizar" compara com isso. No alvo / rampa encerrada → preço salvo.
  const rampaMapa = mapaRampa; // useEscada: mesma conta da Rampa (lib/rampaAnuncio.js)

  // Anúncios com vários itens (Ficha etapa 2, v46): cada opção é o MESMO item ×
  // canal da lista (mesma marcação "feito"); item de grupo conta como anunciado.
  const { grupos } = useAnunciosGrupo();
  const mapaGrupos = useMemo(() => gruposPorItem(grupos), [grupos]);
  const anunciadoAqui = useMemo(() => (it, c) => cobraNoCanal(it, c) || mapaGrupos.has(it.id), [cobraNoCanal, mapaGrupos]);
  const linhas = useMemo(
    () => linhasAnunciar({ itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa: rampaMapa, clientePagaHoje, anunciadoNoCanal: anunciadoAqui }),
    [itens, canais, precos, produtos, kits, publicacoesCanal, rampaMapa, clientePagaHoje, anunciadoAqui]
  );
  // Item de grupo só aparece solto se também tem anúncio próprio fora dele
  // (produto com variações de quantidade soltas); o ↻ é o mesmo item × canal.
  const linhasSoltas = useMemo(
    () =>
      linhas.filter(
        (l) => !mapaGrupos.has(l.item.id) || (l.tipo === "produto" && linhas.some((v) => v.tipo === "variacao" && v.item.produtoId === l.id && !mapaGrupos.has(v.item.id)))
      ),
    [linhas, mapaGrupos]
  );
  const blocos = useMemo(
    () =>
      grupos
        .map((g) => {
          // Opção sem preço salvo em nenhum canal continua no bloco ("sem preço salvo").
          const ops = opcoesDoGrupo(g).map((o) => ({ o, l: linhas.find((l) => l.item.id === idDoItemOpcao(o)) || null, item: itens.find((i) => i.id === idDoItemOpcao(o)) || null }));
          const unicas = [...new Map(ops.filter((x) => x.l).map((x) => [x.l.item.id, x.l])).values()];
          return { g, ops, unicas, pendentes: unicas.reduce((t, l) => t + l.pendentes, 0) };
        })
        .filter((b) => b.ops.length),
    [grupos, linhas, itens]
  );

  // Regra da Shopee (4×) por produto: variações do mesmo produto num anúncio;
  // preço original = riscado, promo = o que o cliente paga.
  const regra4xPorProduto = useMemo(() => {
    const out = new Map();
    const shopee = canais.find((c) => c.tipo === "shopee");
    if (!shopee) return out;
    const porProduto = new Map();
    for (const l of linhas) {
      const pid = l.tipo === "produto" ? l.id : l.tipo === "variacao" ? l.item.produtoId : null;
      const x = l.porCanal[shopee.id];
      if (!pid || !x) continue;
      if (!porProduto.has(pid)) porProduto.set(pid, []);
      porProduto.get(pid).push({ n: l.tipo === "produto" ? 1 : l.item.pecas || 1, promo: x.anSalvo.clientePaga, original: x.anSalvo.original, itemId: l.item.id });
    }
    for (const [pid, ls] of porProduto) {
      const r = gruposRegra4x(ls);
      if (!r.ok) out.set(pid, { ...r, anuncioDoItem: Object.fromEntries(ls.map((l) => [l.itemId, r.grupos.findIndex((g) => g.includes(l.n)) + 1])) });
    }
    return out;
  }, [linhas, canais]);
  const regra4xDe = (l) => regra4xPorProduto.get(l.tipo === "produto" ? l.id : l.item.produtoId) || null;

  const comPendencia = linhasSoltas.filter((l) => l.pendentes > 0);
  const totalPendentes = linhas.reduce((s, l) => s + l.pendentes, 0);
  const visiveis = verTodos ? linhasSoltas : comPendencia;
  const blocosVisiveis = verTodos ? blocos : blocos.filter((b) => b.pendentes > 0);

  // Variações recolhidas embaixo do produto (▸ N variações). O pai aparece
  // sempre que ele ou alguma variação dele estiver na lista.
  const linhasTela = useMemo(() => {
    const visivel = new Set(visiveis.map((l) => l.item.id));
    const out = [];
    const paisComPreco = new Set(linhasSoltas.filter((l) => l.tipo === "produto").map((l) => l.id));
    for (const l of linhasSoltas) {
      if (l.tipo === "produto") {
        const vars = linhasSoltas.filter((v) => v.tipo === "variacao" && v.item.produtoId === l.id && visivel.has(v.item.id));
        if (!visivel.has(l.item.id) && !vars.length) continue;
        const aberto = abertos.has(l.id);
        out.push({ l, pid: l.id, nVars: vars.length, nPend: vars.reduce((s, v) => s + v.pendentes, 0), aberto });
        if (aberto) for (const v of vars) out.push({ l: v });
      } else if (visivel.has(l.item.id) && !(l.tipo === "variacao" && paisComPreco.has(l.item.produtoId))) {
        out.push({ l });
      }
    }
    return out;
  }, [linhasSoltas, visiveis, abertos]);
  const alternar = (pid) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });

  // pares: [{ l, canalId }]
  async function marcar(pares) {
    if (!supabase || !pares.length) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from("publicacoes_canal").upsert(
      pares.map(({ l, canalId }) => {
        const x = l.porCanal[canalId];
        return {
          loja_id: lojaId || null,
          item_tipo: l.tipo,
          item_id: l.id,
          canal_id: canalId,
          preco_original: x.original,
          promo: x.promo,
          cliente_paga: x.clientePaga,
          publicado_em: agora,
        };
      }),
      { onConflict: "item_tipo,item_id,canal_id" }
    );
    setSalvando(false);
    if (error) {
      onToast(/relation|does not exist|schema cache/i.test(error.message) ? "Rode o SQL v30 no Supabase pra marcar como atualizado" : `Não foi possível salvar: ${error.message}`);
      return;
    }
    recarregarCatalogo();
    // Tudo do item marcado "feito" → produto lançado.
    const doItem = new Map();
    for (const pr of pares) doItem.set(pr.l.item.id, [...(doItem.get(pr.l.item.id) || []), pr]);
    const completo = [...doItem.values()].find((ps) => ps.length >= ps[0].l.pendentes);
    if (completo) setLancado({ nome: completo[0].l.item.nome, emRampa: Object.values(completo[0].l.porCanal).some((x) => x.rampa) });
    onToast(pares.length === 1 ? `Marcado como atualizado na ${nomeCanal(canais.find((c) => c.id === pares[0].canalId))}` : `${pares.length} preços marcados como atualizados`);
  }
  // Recalcular o riscado SÓ por ação explícita: apaga a marcação "feito" deste
  // item × canal; o anúncio volta pra sugestão (real ÷ (1 − desconto)) e o
  // próximo "feito" grava o novo riscado fixo.
  async function confirmarRecalcular() {
    const r = recalcular;
    setRecalcular(null);
    if (!r || !supabase) return;
    const { error } = await supabase.from("publicacoes_canal").delete().eq("item_tipo", r.l.tipo).eq("item_id", r.l.id).eq("canal_id", r.c.id);
    if (error) return onToast(`Não foi possível recalcular: ${error.message}`);
    recarregarCatalogo();
    onToast(`Preço original de ${r.l.item.nome} na ${nomeCanal(r.c)} será recalculado — digite o novo e marque "feito"`);
  }
  const pendentesDe = (lista) => lista.flatMap((l) => Object.entries(l.porCanal).filter(([, x]) => x.mudou).map(([canalId]) => ({ l, canalId })));

  // Desconto próprio do produto (vale pras variações dele) ou do kit, por
  // canal. Vazio = volta pro padrão do canal.
  async function salvarDesconto() {
    const e = descEdit;
    setDescEdit(null);
    if (!e || !supabase) return;
    const txt = String(e.valor).trim().replace(",", ".");
    const isKit = e.itemId.startsWith("k:");
    const donoId = isKit ? e.itemId.slice(2) : e.itemId.startsWith("v:") ? itens.find((i) => i.id === e.itemId)?.produtoId : e.itemId.slice(2);
    const dono = isKit ? kits.find((k) => k.id === donoId) : produtos.find((p) => p.id === donoId);
    if (!dono) return;
    const mapa = { ...(dono.desconto_anuncio || {}) };
    if (txt === "") {
      if (!(e.canalId in mapa)) return;
      delete mapa[e.canalId];
    } else {
      const v = Number(txt);
      if (!isFinite(v) || v < 0 || v > 90) {
        onToast("Desconto entre 0 e 90%");
        return;
      }
      mapa[e.canalId] = Math.round(v * 10) / 1000;
    }
    const { error } = await supabase
      .from(isKit ? "kits" : "produtos_cadastro")
      .update({ desconto_anuncio: Object.keys(mapa).length ? mapa : null })
      .eq("id", donoId);
    if (error) onToast(/desconto_anuncio|column/i.test(error.message) ? "Rode o SQL v30 no Supabase pra salvar o desconto" : `Não foi possível salvar: ${error.message}`);
    else onToast(txt === "" ? "Voltou pro desconto padrão do canal" : `Desconto de ${txt}% salvo pra ${dono.nome}`);
  }

  function exportarCsv(canalId) {
    const c = canais.find((x) => x.id === canalId);
    if (!c) return;
    const num = (v) => (v == null ? "" : String(Number(v).toFixed(2)).replace(".", ","));
    const cab = ["Item", "SKU", "Preço original", "Promoção %", "Cliente paga", "Situação"];
    const rows = linhas
      .filter((l) => l.porCanal[c.id])
      .map((l) => {
        const x = l.porCanal[c.id];
        return [l.item.nome, l.item.sku || "", num(x.original), String(x.promo), num(x.clientePaga), x.mudou ? (x.nunca ? "novo" : "atualizar") : "ok"];
      });
    const csv = [cab, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `anunciar-${String(c.nome || c.tipo).toLowerCase().replace(/\s+/g, "-")}-${hojeSP()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Avulso abaixo do frete grátis: 1ª variação/kit do produto que passa (pelo cliente paga).
  function dicaFretePub(l, c) {
    if (l.tipo !== "produto") return null;
    const pid = l.item.id.slice(2);
    const opcoes = linhas
      .filter((o) => (o.tipo === "variacao" && o.item.produtoId === pid) || (o.tipo === "kit" && (o.item.componentes || []).some((k) => k.produtoId === pid)))
      .filter((o) => o.porCanal[c.id])
      .map((o) => ({ n: o.item.pecas || 2, valor: o.porCanal[c.id].clientePaga, rotulo: o.tipo === "kit" ? o.item.nome : `${o.item.pecas} un.` }));
    return dicaKitFreteGratis(c, l.porCanal[c.id].clientePaga, opcoes);
  }

  // Detalhe de uma célula (abre na linha de baixo): o que digitar, desconto
  // (editável), rampa, o que trocar e "feito".
  function detalhe(l, c) {
    if (!c) return null;
    const x = l.porCanal[c.id];
    const chave = `${l.item.id}|${c.id}`;
    const copiar = (v, rot) => {
      navigator.clipboard?.writeText(v).then(
        () => onToast(`${rot} copiado: ${v}`),
        () => onToast("Não foi possível copiar")
      );
    };
    return (
      <div className="detalhe-cel">
        <div className="detalhe-cel-topo">
          <b>{l.item.nomeVariacao ? `${l.item.nome}` : l.item.nome}</b> <CanalTag canal={c} />
          <span className="sub-num-inline">o que digitar no anúncio</span>
          <button type="button" className="del" title="Fechar" onClick={() => setSel(null)}>
            ×
          </button>
        </div>
        <div className="detalhe-cel-grade">
          <button type="button" className="kv-cel kv-copiar" onClick={() => copiar(x.original.toFixed(2).replace(".", ","), "Preço original")} title="Clique pra copiar">
            <small>Preço original</small>
            <b>{BRL(x.original)}</b>
            <span>riscado · clique pra copiar</span>
          </button>
          <button type="button" className="kv-cel kv-copiar" onClick={() => copiar(String(x.promo), "Promo")} title="Clique pra copiar">
            <small>Promo</small>
            <b>{x.promo}%</b>
            <span>clique pra copiar</span>
          </button>
          <div className="kv-cel">
            <small>Cliente paga</small>
            {x.rampa ? (
              <>
                <b>agora {BRL(x.clientePaga)}</b>
                <span>{agoraIgualAlvo(x) ? "= alvo" : `alvo ${BRL(x.anSalvo.clientePaga)} (preço salvo)`}</span>
                <span>agora = preço da Rampa (Crescimento)</span>
              </>
            ) : (
              <>
                <b>{BRL(x.clientePaga)}</b>
                <span>preço salvo</span>
              </>
            )}
          </div>
          {(() => {
            const q = lucroPago(l.item, c, x.clientePaga);
            const qa = x.rampa && x.anSalvo && !agoraIgualAlvo(x) ? lucroPago(l.item, c, x.anSalvo.clientePaga) : null;
            return q ? (
              <div className="kv-cel">
                <small>{x.rampa ? "Lucro agora" : "Lucro"}</small>
                <b style={q.lucro < 0 ? { color: "var(--bad)" } : undefined}>{BRL(q.lucro)}</b>
                <QuebraLucro q={q} />
                <span>{qa ? `no alvo: ${BRL(qa.lucro)}` : "pelo que o cliente paga"}</span>
              </div>
            ) : null;
          })()}
          <div className="kv-cel">
            <small>Desconto do anúncio</small>
            {descEdit?.chave === chave ? (
              <input
                className="input-desc"
                type="number"
                step="1"
                autoFocus
                placeholder={pctTxt(descontoPadraoCanal(c))}
                value={descEdit.valor}
                onChange={(e) => setDescEdit({ ...descEdit, valor: e.target.value })}
                onBlur={salvarDesconto}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") setDescEdit(null);
                }}
              />
            ) : (
              <b>
                {pctTxt(x.desconto)}%{x.proprio ? "*" : ""}
              </b>
            )}
            <span>
              {x.proprio ? "próprio do item" : "padrão do canal"} ·{" "}
              <button
                type="button"
                className="link-btn"
                title={`Vazio volta pro padrão do canal${l.tipo === "variacao" ? ". Vale pro produto e todas as variações" : ""}`}
                onClick={() => setDescEdit({ chave, itemId: l.item.id, canalId: c.id, valor: x.proprio ? pctTxt(x.desconto).replace(",", ".") : "" })}
              >
                ✎ mudar
              </button>
            </span>
          </div>
        </div>
        <div className="detalhe-cel-avisos">
          {x.riscadoFixo && !x.acimaDoRiscado && (
            <div className="aviso-cel">
              <b>Preço original fixo</b> {BRL(x.original)} é o que já está anunciado — mudança de preço é só pela promo (mexer no preço cheio pode ser visto como manipulação).
            </div>
          )}
          {x.acimaDoRiscado && (
            <div className="aviso-cel atencao">
              <b>Precisaria subir o preço original</b> O preço desejado ({BRL(x.real)}) passou do preço original anunciado ({BRL(x.original)}): com promo 0% o cliente paga {BRL(x.original)}. Subir o preço cheio pode ser visto como manipulação — considere manter. Nada foi trocado.
            </div>
          )}
          {x.frete && (
            <div className="aviso-cel atencao">
              <b>Cliente paga o frete</b> {x.frete.texto}.{dicaFretePub(l, c) ? ` Dica: ${dicaFretePub(l, c)}.` : ""}
            </div>
          )}
          {x.rampa && (
            <div className="aviso-cel rampa">
              <b>{x.rampa.acima ? "Testando acima do alvo" : "Em rampa"} · use o preço da Rampa</b> Vendendo {BRL(x.rampa.real)} (Vender → Crescimento): {x.riscadoFixo ? "preço original já anunciado" : "riscado fixo no alvo"}, só a promo muda. Quando chegar no alvo, volta pro preço salvo.
            </div>
          )}
          {x.mudou && (
            <div className="aviso-cel atencao">
              <b>{x.nunca ? "Ainda não marcado como feito" : "O que trocar no anúncio"}</b>{" "}
              {x.nunca ? "Digite os números acima e marque feito." : x.oQueMudou || `era ${BRL(Number(x.salvo.preco_original))} · ${Number(x.salvo.promo)}%`}
            </div>
          )}
        </div>
        <div className="detalhe-cel-acoes">
          {x.mudou ? (
            <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={() => marcar([{ l, canalId: c.id }])}>
              ✓ Já digitei na {nomeCanal(c)} — marcar feito
            </button>
          ) : (
            <span className="badge neutro">✓ atualizado</span>
          )}
          {x.riscadoFixo && (
            <button type="button" className="btn btn-mini" onClick={() => setRecalcular({ l, c })} title="Ação explícita: o preço original volta pra sugestão">
              Recalcular preço original
            </button>
          )}
          <button type="button" className="btn btn-mini" onClick={() => setTirarAlvo({ item: l.item, canal: c })} title="Removeu o anúncio deste canal? Apaga a marcação ou tudo deste item neste canal">
            Tirar deste canal <CanalTag canal={c} />
          </button>
        </div>
      </div>
    );
  }

  // Célula de um canal (preço original, promo, etiqueta) — a mesma nas linhas
  // soltas e nas opções de um anúncio com vários itens (base = chave da linha).
  const celulas = (l, base) =>
    canais.map((c) => {
                    const x = l.porCanal[c.id];
                    if (!x)
                      return (
                        <td className="num" key={c.id}>
                          <span className="cel-vazia" title="Sem preço salvo neste canal">—</span>
                        </td>
                      );
                    const chave = `${base}|${c.id}`;
                    return (
                      <td className="num" key={c.id}>
                        <button type="button" className={`cel-preco${sel === chave ? " sel" : ""}`} onClick={() => setSel((v) => (v === chave ? null : chave))}>
                          <span className="cel-preco-v" title="Preço original (riscado) — digite no anúncio">{BRL(x.original)}</span>
                          <span className="preco-canal-linha">
                            promo <b>{x.promo}%</b>
                            {(() => {
                              const q = lucroPago(l.item, c, x.clientePaga);
                              return q ? <> · lucro <b style={q.lucro < 0 ? { color: "var(--bad)" } : undefined}>{BRL(q.lucro)}</b></> : null;
                            })()}
                          </span>
                          {x.rampa && (
                            <span className="preco-canal-linha agora-alvo" title="Cliente paga agora (preço da Rampa) × no alvo (preço salvo)">
                              agora <b>{BRL(x.clientePaga)}</b>
                              <br />
                              {agoraIgualAlvo(x) ? "= alvo" : <>alvo {BRL(x.anSalvo.clientePaga)}</>}
                            </span>
                          )}
                          {x.acimaDoRiscado ? (
                            <Estado tipo="atencao" title="O preço desejado passou do preço original já anunciado">acima do riscado</Estado>
                          ) : x.rampa ? (
                            <Estado tipo="decisao" icone={null}>{`${x.rampa.acima ? "testando acima" : "rampa"}${x.mudou ? " · ↻" : ""}`}</Estado>
                          ) : x.mudou ? (
                            <Estado tipo="atencao" icone={x.nunca ? "↻" : undefined}>{x.nunca ? "novo" : "↻ atualizar"}</Estado>
                          ) : x.frete ? null : (
                            <Estado tipo="oportunidade">✓ em dia</Estado>
                          )}
                          <FreteAviso frete={x.frete} compacto />
                        </button>
                      </td>
                    );
                  });
  const linhaDetalhe = (l, base) => {
    if (!sel || !sel.startsWith(`${base}|`)) return null;
    const c = canais.find((x) => sel === `${base}|${x.id}`);
    if (!c || !l.porCanal[c.id]) return null;
    return (
      <tr className="linha-detalhe">
        <td colSpan={canais.length + 2}>{detalhe(l, c)}</td>
      </tr>
    );
  };

  if (!canais.length) {
    return (
      <div className="panel">
        <h3>Anunciar</h3>
        <div className="empty">Nenhum canal cadastrado. Cadastre seus canais em Configuração → Lojas, canais e taxas → Canais.</div>
      </div>
    );
  }

  return (
    <>
    {tirarAlvo && <TirarDoCanalDialog item={tirarAlvo.item} canal={tirarAlvo.canal} onToast={onToast} onClose={() => setTirarAlvo(null)} />}
    {recalcular && (
      <ConfirmDialog
        titulo="Recalcular o preço original?"
        mensagem={`${recalcular.l.item.nome} na ${nomeCanal(recalcular.c)}: o preço original anunciado (${BRL(recalcular.l.porCanal[recalcular.c.id].original)}) deixa de ser fixo e volta pra sugestão (${BRL(recalcular.l.porCanal[recalcular.c.id].riscadoSugerido)}). Atenção: mudar o preço cheio no marketplace pode ser visto como manipulação de preço e levar a punição. Prefira mudar só a promo. Depois de digitar o novo, marque "feito".`}
        confirmarLabel="Recalcular mesmo assim"
        onConfirm={confirmarRecalcular}
        onCancel={() => setRecalcular(null)}
      />
    )}
    <OndeSeDecide />
    {lancado && (
      <div className="alerta alerta-good lancado-ok">
        <b>{lancado.nome}: produto lançado ✓</b>
        {lancado.emRampa ? "Está em rampa: acompanhe no Crescimento (as semanas se montam com os pedidos importados)." : "Tudo atualizado nas plataformas."}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {lancado.emRampa ? (
            <button type="button" className="btn btn-mini primary" onClick={() => irParaAba("crescimento", { sub: "rampa" })}>Acompanhar no Crescimento →</button>
          ) : (
            <button type="button" className="btn btn-mini primary" onClick={() => irParaAba("inicio")}>Voltar ao Início</button>
          )}
          <button type="button" className="btn btn-mini" onClick={() => setLancado(null)}>Fechar</button>
        </div>
      </div>
    )}
    <div className="aviso-fluxo">
      Os preços vêm de <b>Precificação</b> (1º Avulso / 2º Por quantidade). Aqui você só confere o que digitar em cada plataforma — o <b>preço original</b> (“de”) e a <b>promo</b> — e marca “feito” depois de atualizar.
    </div>
    <div className="panel">
      <h3 className="section-title h3-split">
        <span>
          O que digitar em cada plataforma
          <Ajuda texto="Preço original = o valor cheio (riscado) que você digita no anúncio; promo = o % de desconto a lançar na plataforma. Com isso o cliente paga o preço real salvo em Produtos precificados (ou, no máximo, alguns centavos a mais, porque a promoção é um % inteiro). O desconto exibido é o padrão do canal (Configuração → Canais) — clique no “desconto X%” de uma célula pra dar um desconto próprio a um produto (vale pras variações dele) ou kit; * = desconto próprio. ↻ = o preço mudou desde a última vez que você marcou “feito” naquela plataforma." />
        </span>
        <span className="acoes-cab">
          <button type="button" className="btn btn-sm" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? `Só o que precisa atualizar (${totalPendentes})` : `Ver todos (${linhas.length})`}
          </button>
          <select className="select-sm" value="" onChange={(e) => e.target.value && exportarCsv(e.target.value)} aria-label="Exportar CSV de um canal">
            <option value="">Exportar CSV…</option>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {nomeCanal(c)}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary btn-sm" onClick={() => marcar(pendentesDe(linhas))} disabled={salvando || !totalPendentes}>
            Marcar tudo como atualizado
          </button>
        </span>
      </h3>
      {(visiveis.length > 0 || blocosVisiveis.length > 0) && (
        <div className="legenda-tabela">
          <span className="legenda-tit">Legenda</span>
          <span><b>R$ 17,00</b> preço original (riscado) a digitar</span>
          <span><b>promo 30%</b> a digitar</span>
          <span><Estado tipo="oportunidade">✓ em dia</Estado> feito</span>
          <span><Estado tipo="atencao">↻ atualizar</Estado> o anúncio está diferente</span>
          <span><Estado tipo="decisao" icone={null}>rampa</Estado> use a promo da Rampa · <b>agora</b> × <b>alvo</b> = cliente paga hoje × no preço salvo</span>
          <span className="legenda-dica">Clique na célula: cliente paga, desconto, o que trocar e “feito”.</span>
        </div>
      )}
      {visiveis.length || blocosVisiveis.length ? (
        <div className="table-wrap tabela-pub cabecalho-fixo">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                {canais.map((c) => (
                  <th className="num" key={c.id}>
                    <CanalTag canal={c} />
                    <span className="sub" style={{ textTransform: "none", letterSpacing: 0 }}>
                      desconto padrão {pctTxt(descontoPadraoCanal(c))}%
                    </span>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {blocosVisiveis.map((b) => (
                <Fragment key={`g:${b.g.id}`}>
                  <tr className="pub-grupo-cab">
                    <td colSpan={canais.length + 1}>
                      <b>Anúncio: {b.g.nome}</b> · {b.g.variacao_nome}
                      <span className="sub">anúncio com vários itens (3º Ficha) · {b.ops.length} opções</span>
                    </td>
                    <td>
                      {b.pendentes > 0 ? (
                        <button type="button" className="btn btn-sm" disabled={salvando} onClick={() => marcar(pendentesDe(b.unicas))} title="Marcar todas as opções deste anúncio como atualizadas">
                          Marcar tudo
                        </button>
                      ) : (
                        <span className="badge good">✓</span>
                      )}
                    </td>
                  </tr>
                  {b.ops.map(({ o, l, item }) => {
                    if (!l)
                      return (
                        <tr key={`g:${b.g.id}:${o.item_id}${o.sufixo_sku}`} className="linha-cad">
                          <td>
                            ↳ {o.rotulo || item?.nome || "?"}
                            <span className="sub">{item ? item.nome : "item não encontrado"}</span>
                          </td>
                          <td colSpan={canais.length + 1} className="num">
                            <span className="cel-vazia">{item ? "sem preço salvo — salve em Precificação" : "item excluído — edite o anúncio na 3º Ficha"}</span>
                          </td>
                        </tr>
                      );
                    const base = `g:${b.g.id}:${l.item.id}`;
                    return (
                      <Fragment key={base + o.sufixo_sku}>
                        <tr className="linha-cad">
                          <td>
                            ↳ {o.rotulo || l.item.nome}
                            <span className="sub">
                              {l.item.nome}
                              {l.item.sku ? ` · ${l.item.sku}${o.sufixo_sku || ""}` : ""}
                            </span>
                            {o.vitrine && (
                              <span className="sub" style={{ color: "var(--st-decisao)" }}>
                                vitrine em {canais.find((c) => c.id === o.vitrine.canal_id)?.nome || "canal"}: neste anúncio o cliente paga {BRL(rampaMapa.get(`g:${b.g.id}|${b.ops.indexOf(b.ops.find((x) => x.o === o))}|${o.vitrine.canal_id}`)?.clientePaga ?? o.vitrine.preco)}
                                {rampaMapa.get(`g:${b.g.id}|${b.ops.indexOf(b.ops.find((x) => x.o === o))}|${o.vitrine.canal_id}`) ? " (rampa do anúncio)" : ""}
                              </span>
                            )}
                          </td>
                          {celulas(l, base)}
                          <td>
                            {l.pendentes > 0 ? (
                              <button type="button" className="btn btn-sm" disabled={salvando} onClick={() => marcar(pendentesDe([l]))} title="Marcar todos os canais desta opção como atualizados">
                                Marcar
                              </button>
                            ) : (
                              <span className="badge good">✓</span>
                            )}
                          </td>
                        </tr>
                        {linhaDetalhe(l, base)}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              {linhasTela.map(({ l, pid, nVars, nPend, aberto }) => (
                <Fragment key={l.item.id}>
                <tr className={l.tipo === "variacao" ? "linha-cad" : ""}>
                  <td>
                    {l.tipo === "variacao" ? `↳ ${l.item.nomeVariacao || l.item.nome}` : l.item.nome}
                    {mapaGrupos.has(l.item.id) && (
                      <span className="frete-tag info-4x" title="Este item também é uma opção de um anúncio com vários itens (mesma marcação “feito”)">
                        também em: {mapaGrupos.get(l.item.id).map((x) => x.grupo.nome).join(", ")}
                      </span>
                    )}
                    <span className="sub">
                      {l.tipo === "variacao" ? `${l.item.pecas} un.` : l.tipo === "kit" ? "kit" : "avulso"}
                      {l.item.sku ? ` · ${l.item.sku}` : ""}
                    </span>
                    {regra4xDe(l) && l.tipo === "produto" && (
                      <span
                        className="frete-tag info-4x"
                        title={`Regra da Shopee: num anúncio, a variação mais cara (preço original) não pode passar de 4× a mais barata (com promoção). Só importa se você anunciar mais de ${regra4xDe(l).maxNoPrimeiro} un. no mesmo anúncio — anunciando até kit 3, não precisa fazer nada.`}
                      >
                        Shopee: cabe até {regra4xDe(l).maxNoPrimeiro} un. por anúncio
                      </span>
                    )}
                    {regra4xDe(l) && l.tipo === "variacao" && regra4xDe(l).anuncioDoItem[l.item.id] > 1 && (
                      <span className="frete-tag info-4x" title="Só se você anunciar essa quantidade na Shopee: pela regra de 4×, ela vai num anúncio separado do avulso">
                        Shopee: outro anúncio, se anunciar
                      </span>
                    )}
                    {nVars > 0 && (
                      <button type="button" className={`variacoes-toggle${aberto ? " aberto" : ""}`} onClick={() => alternar(pid)} title={aberto ? "Esconder variações" : "Ver variações"}>
                        <span className="seta">▸</span> {nVars} {nVars === 1 ? "variação" : "variações"}
                        {nPend > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>↻ {nPend} p/ atualizar</span>}
                      </button>
                    )}
                  </td>
                  {celulas(l, l.item.id)}
                  <td>
                    {l.pendentes > 0 ? (
                      <button type="button" className="btn btn-sm" disabled={salvando} onClick={() => marcar(pendentesDe([l]))} title="Marcar todos os canais deste item como atualizados">
                        Marcar tudo
                      </button>
                    ) : (
                      <span className="badge good">✓</span>
                    )}
                  </td>
                </tr>
                {linhaDetalhe(l, l.item.id)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">{linhas.length ? "Tudo atualizado — nenhum preço mudou desde a última vez." : "Nenhum item com preço salvo ainda. Salve os preços em Precificação por Canal e eles aparecem aqui."}</div>
      )}
    </div>
    <ProximoPasso atual="publicar" itemId={selPasso.itemId} canalId={selPasso.canalId} onSub={onSub} />
    </>
  );
}
