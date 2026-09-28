import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { BRL } from "../lib/format.js";
import { calcularAnuncio, anuncioMudou, descontoDoItem, descontoPadraoCanal, gruposRegra4x } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import { nomeCanal } from "../lib/canais.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";

const pctTxt = (d) => `${Math.round(d * 1000) / 10}`.replace(".", ",");

// Anunciar — o anúncio é criado direto em cada marketplace (a Olist só cuida
// de estoque/pedidos/nota, com "preço fixo" na integração). Pra cada item com
// preço salvo e cada canal: o PREÇO ORIGINAL (riscado) pra digitar na
// plataforma e a PROMOÇÃO % — o cliente paga o preço real salvo. Desconto
// exibido = padrão do canal (Configuração → Canais) ou o próprio do produto/
// kit (clique no % da célula). ↻ por canal: você marca "feito" em cada
// plataforma e só aquele canal fica pendente quando o preço muda.
export default function Publicar({ onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, precos, produtos, kits, publicacoesCanal } = useRankingData();
  const [verTodos, setVerTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [abertos, setAbertos] = useState(() => new Set());
  const [descEdit, setDescEdit] = useState(null); // { chave, itemId, canalId, valor }

  const linhas = useMemo(() => {
    const ordem = [];
    for (const p of itens.filter((i) => i.id.startsWith("p:"))) {
      ordem.push(p);
      for (const v of itens.filter((i) => i.id.startsWith("v:") && i.produtoId === p.id.slice(2)).sort((a, b) => (a.pecas || 0) - (b.pecas || 0))) ordem.push(v);
    }
    for (const k of itens.filter((i) => i.id.startsWith("k:"))) ordem.push(k);
    return ordem
      .map((item) => {
        const tipo = itemTipoDoId(item.id);
        const id = item.id.slice(2);
        const porCanal = {};
        for (const c of canais) {
          const s = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === c.id);
          if (!s || !(Number(s.preco) > 0)) continue;
          const { desconto, proprio } = descontoDoItem(item.id, c, { itens, produtos, kits });
          const an = calcularAnuncio(Number(s.preco), desconto);
          const salvo = publicacoesCanal.find((x) => x.item_tipo === tipo && x.item_id === id && x.canal_id === c.id) || null;
          porCanal[c.id] = { ...an, proprio, salvo, mudou: anuncioMudou(salvo, an), nunca: !salvo };
        }
        if (!Object.keys(porCanal).length) return null;
        const pendentes = Object.values(porCanal).filter((x) => x.mudou).length;
        return { item, tipo, id, porCanal, pendentes };
      })
      .filter(Boolean);
  }, [itens, canais, precos, produtos, kits, publicacoesCanal]);

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
      porProduto.get(pid).push({ n: l.tipo === "produto" ? 1 : l.item.pecas || 1, promo: x.clientePaga, original: x.original, itemId: l.item.id });
    }
    for (const [pid, ls] of porProduto) {
      const r = gruposRegra4x(ls);
      if (!r.ok) out.set(pid, { ...r, anuncioDoItem: Object.fromEntries(ls.map((l) => [l.itemId, r.grupos.findIndex((g) => g.includes(l.n)) + 1])) });
    }
    return out;
  }, [linhas, canais]);
  const regra4xDe = (l) => regra4xPorProduto.get(l.tipo === "produto" ? l.id : l.item.produtoId) || null;

  const comPendencia = linhas.filter((l) => l.pendentes > 0);
  const totalPendentes = linhas.reduce((s, l) => s + l.pendentes, 0);
  const visiveis = verTodos ? linhas : comPendencia;

  // Variações recolhidas embaixo do produto (▸ N variações). O pai aparece
  // sempre que ele ou alguma variação dele estiver na lista.
  const linhasTela = useMemo(() => {
    const visivel = new Set(visiveis.map((l) => l.item.id));
    const out = [];
    const paisComPreco = new Set(linhas.filter((l) => l.tipo === "produto").map((l) => l.id));
    for (const l of linhas) {
      if (l.tipo === "produto") {
        const vars = linhas.filter((v) => v.tipo === "variacao" && v.item.produtoId === l.id && visivel.has(v.item.id));
        if (!visivel.has(l.item.id) && !vars.length) continue;
        const aberto = abertos.has(l.id);
        out.push({ l, pid: l.id, nVars: vars.length, nPend: vars.reduce((s, v) => s + v.pendentes, 0), aberto });
        if (aberto) for (const v of vars) out.push({ l: v });
      } else if (visivel.has(l.item.id) && !(l.tipo === "variacao" && paisComPreco.has(l.item.produtoId))) {
        out.push({ l });
      }
    }
    return out;
  }, [linhas, visiveis, abertos]);
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
    onToast(pares.length === 1 ? `Marcado como atualizado na ${nomeCanal(canais.find((c) => c.id === pares[0].canalId))}` : `${pares.length} preços marcados como atualizados`);
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
    a.download = `anunciar-${String(c.nome || c.tipo).toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!canais.length) {
    return (
      <div className="panel">
        <h3>Anunciar</h3>
        <div className="empty">Nenhum canal cadastrado. Cadastre seus canais em Configuração → Lojas, canais e taxas → Canais.</div>
      </div>
    );
  }

  return (
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
      {visiveis.length ? (
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
              {linhasTela.map(({ l, pid, nVars, nPend, aberto }) => (
                <tr key={l.item.id} className={l.tipo === "variacao" ? "linha-cad" : ""}>
                  <td>
                    {l.tipo === "variacao" ? `↳ ${l.item.nomeVariacao || l.item.nome}` : l.item.nome}
                    <span className="sub">
                      {l.tipo === "variacao" ? `${l.item.pecas} un.` : l.tipo === "kit" ? "kit" : "avulso"}
                      {l.item.sku ? ` · ${l.item.sku}` : ""}
                    </span>
                    {regra4xDe(l) && l.tipo === "produto" && (
                      <span className="frete-tag" title="Regra da Shopee: num anúncio, a variação mais cara não pode passar de 4× a mais barata (contando preço original e com promoção)">
                        Shopee 4×: até {regra4xDe(l).maxNoPrimeiro} un. neste anúncio
                      </span>
                    )}
                    {regra4xDe(l) && l.tipo === "variacao" && regra4xDe(l).anuncioDoItem[l.item.id] > 1 && <span className="frete-tag bad">Shopee: vai em outro anúncio (4×)</span>}
                    {nVars > 0 && (
                      <button type="button" className={`variacoes-toggle${aberto ? " aberto" : ""}`} onClick={() => alternar(pid)} title={aberto ? "Esconder variações" : "Ver variações"}>
                        <span className="seta">▸</span> {nVars} {nVars === 1 ? "variação" : "variações"}
                        {nPend > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{nPend} p/ atualizar</span>}
                      </button>
                    )}
                  </td>
                  {canais.map((c) => {
                    const x = l.porCanal[c.id];
                    if (!x)
                      return (
                        <td className="num" key={c.id}>
                          <span className="sub">sem preço salvo</span>
                        </td>
                      );
                    const chave = `${l.item.id}|${c.id}`;
                    return (
                      <td className="num" key={c.id}>
                        <span className="base" title="Preço original (riscado) — digite no anúncio">{BRL(x.original)}</span>
                        <span className="promo-linha">
                          promo <b>{x.promo}%</b>
                          {" · "}
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
                            <button
                              type="button"
                              className={`link-btn desc-btn${x.proprio ? " proprio" : ""}`}
                              title={`${x.proprio ? "Desconto próprio" : "Desconto padrão do canal"} — clique pra mudar (vazio volta pro padrão)${l.tipo === "variacao" ? ". Vale pro produto e todas as variações" : ""}`}
                              onClick={() => setDescEdit({ chave, itemId: l.item.id, canalId: c.id, valor: x.proprio ? pctTxt(x.desconto).replace(",", ".") : "" })}
                            >
                              desconto {pctTxt(x.desconto)}%{x.proprio ? "*" : ""}
                            </button>
                          )}
                        </span>
                        <span className="sub">cliente paga {BRL(x.clientePaga)}</span>
                        {x.salvo && x.mudou && (
                          <span className="sub">
                            era {BRL(Number(x.salvo.preco_original))} · {Number(x.salvo.promo)}%
                          </span>
                        )}
                        <span className="cel-status">
                          {x.mudou ? (
                            <>
                              <span className="badge warn">{x.nunca ? "novo" : "↻ atualizar"}</span>
                              <button type="button" className="link-btn" disabled={salvando} onClick={() => marcar([{ l, canalId: c.id }])} title={`Já digitei na ${nomeCanal(c)} — marcar como atualizado`}>
                                feito
                              </button>
                            </>
                          ) : (
                            <span className="badge neutro">✓ atualizado</span>
                          )}
                        </span>
                      </td>
                    );
                  })}
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
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">{linhas.length ? "Tudo atualizado — nenhum preço mudou desde a última vez." : "Nenhum item com preço salvo ainda. Salve os preços em Precificação por Canal e eles aparecem aqui."}</div>
      )}
    </div>
  );
}
