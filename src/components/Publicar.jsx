import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { BRL } from "../lib/format.js";
import { calcularPublicacao, publicacaoMudou, configEscada } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import Ajuda from "./Ajuda.jsx";

const NOME_CANAL = { shopee: "Shopee", ml: "Mercado Livre", tiktok: "TikTok Shop", shein: "Shein" };
const nomeCanal = (c) => c?.nome || NOME_CANAL[c?.tipo] || "Canal";

// Publicar — o ÚNICO lugar do app com informação da Olist. Pra cada item com
// preço salvo: o preço pra cadastrar na Olist (um só por item) e, em cada
// canal com acréscimo configurado, a promoção % a lançar na plataforma pra o
// cliente pagar o preço real salvo. Base = a menor que funciona em todos os
// canais (nenhum precisa de promoção negativa); promo arredondada pra baixo.
export default function Publicar({ onToast }) {
  const { lojaId, lojas, atualizar } = useLoja();
  const { itens, canais, precos, publicacoes } = useRankingData();
  const cfgLoja = lojas.find((l) => l.id === lojaId)?.config_escada || null;
  const promoMin = configEscada(cfgLoja).promoMinOlist;
  const [promoMinEdit, setPromoMinEdit] = useState(null);
  const [baseEdit, setBaseEdit] = useState(null); // { chave, valor } — "já está na Olist"
  const [verTodos, setVerTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const canaisOlist = canais.filter((c) => c.acrescimo_olist_pct != null && c.acrescimo_olist_pct !== "");
  const acrescimos = Object.fromEntries(canaisOlist.map((c) => [c.id, Number(c.acrescimo_olist_pct) || 0]));
  const modos = Object.fromEntries(canaisOlist.map((c) => [c.id, c.acrescimo_olist_modo || "dentro"]));

  const linhas = useMemo(() => {
    const ordem = [];
    const pais = itens.filter((i) => i.id.startsWith("p:"));
    for (const p of pais) {
      ordem.push(p);
      for (const v of itens.filter((i) => i.id.startsWith("v:") && i.produtoId === p.id.slice(2)).sort((a, b) => (a.pecas || 0) - (b.pecas || 0))) ordem.push(v);
    }
    for (const k of itens.filter((i) => i.id.startsWith("k:"))) ordem.push(k);
    return ordem
      .map((item) => {
        const tipo = itemTipoDoId(item.id);
        const id = item.id.slice(2);
        const reais = {};
        for (const c of canaisOlist) {
          const s = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === c.id);
          if (s && Number(s.preco) > 0) reais[c.id] = Number(s.preco);
        }
        const salva = publicacoes.find((x) => x.item_tipo === tipo && x.item_id === id) || null;
        // base que já está na Olist (última publicada ou informada) é mantida enquanto servir
        const pub = calcularPublicacao(reais, acrescimos, promoMin, salva ? Number(salva.base) : null, modos);
        if (!pub) return null;
        return { item, tipo, id, pub, salva, mudou: publicacaoMudou(salva, pub), nunca: !salva };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, precos, publicacoes, canais, promoMin]);

  const pendentes = linhas.filter((l) => l.mudou);
  const visiveis = verTodos ? linhas : pendentes;

  async function salvarPromoMin() {
    if (promoMinEdit === null) return;
    const v = Math.max(0, Math.min(60, Number(String(promoMinEdit).replace(",", ".")) || 0)) / 100;
    const r = await atualizar(lojaId, { configEscada: { ...(cfgLoja || {}), promoMinOlist: v } });
    if (!r.ok) {
      onToast(/config_escada|column/i.test(r.error || "") ? "Rode o SQL v27 no Supabase pra salvar" : `Não foi possível salvar: ${r.error}`);
      return;
    }
    setPromoMinEdit(null);
  }

  // "Já está na Olist por R$ X": grava a base atual (sem promos) — a tela passa
  // a calcular as promos a partir dela, em vez de sugerir outra base.
  async function informarBase(l, valor) {
    const base = Number(String(valor).replace(",", "."));
    setBaseEdit(null);
    if (!(base > 0) || !supabase) return;
    const { error } = await supabase
      .from("publicacoes_olist")
      .upsert({ loja_id: lojaId || null, item_tipo: l.tipo, item_id: l.id, base, promos: {}, publicado_em: new Date().toISOString() }, { onConflict: "item_tipo,item_id" });
    if (error) onToast(`Não foi possível salvar: ${error.message}`);
    else onToast(`Base da Olist registrada: ${BRL(base)} — lance as promos indicadas e marque como publicado`);
  }

  async function marcar(lista) {
    if (!supabase || !lista.length) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from("publicacoes_olist").upsert(
      lista.map((l) => ({
        loja_id: lojaId || null,
        item_tipo: l.tipo,
        item_id: l.id,
        base: l.pub.base,
        promos: Object.fromEntries(Object.entries(l.pub.canais).map(([cid, c]) => [cid, c.promo])),
        publicado_em: agora,
      })),
      { onConflict: "item_tipo,item_id" }
    );
    setSalvando(false);
    if (error) {
      onToast(/relation|does not exist|schema cache/i.test(error.message) ? "Rode o SQL v27 no Supabase pra marcar como publicado" : `Não foi possível salvar: ${error.message}`);
      return;
    }
    onToast(lista.length === 1 ? "Marcado como publicado" : `${lista.length} itens marcados como publicados`);
  }

  function exportarCsv() {
    const cab = ["Item", "SKU", "Cadastrar na Olist", ...canaisOlist.flatMap((c) => [`${nomeCanal(c)} promo %`, `${nomeCanal(c)} cliente paga`])];
    const num = (v) => (v == null ? "" : String(v.toFixed(2)).replace(".", ","));
    const rows = visiveis.map((l) => [
      l.item.nome,
      l.item.sku || "",
      num(l.pub.base),
      ...canaisOlist.flatMap((c) => {
        const x = l.pub.canais[c.id];
        return x ? [String(x.promo), num(x.clientePaga)] : ["", ""];
      }),
    ]);
    const csv = [cab, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `publicar-olist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!canaisOlist.length) {
    return (
      <div className="panel">
        <h3>Publicar na Olist</h3>
        <div className="empty">
          Nenhum canal com acréscimo da Olist configurado. Preencha o “Acréscimo Olist (%)” de cada canal em Configuração → Lojas, canais e taxas → Canais (o mesmo % da
          integração na Olist) e os preços aparecem aqui.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h3 className="section-title h3-split">
          <span>
            O que digitar na Olist e nas plataformas
            <Ajuda texto="Cadastrar na Olist = preço do item na Olist (um só). Cada canal aplica o próprio acréscimo (Configuração → Canais) do jeito configurado na Olist: “base por dentro” = base ÷ (1 − acréscimo) (ex.: R$11,90 com 30% → R$17,00) ou “base simples” = base × (1 + acréscimo); promo = % a lançar na plataforma pro cliente pagar o preço real salvo em Produtos precificados. A base é escolhida pra todo canal ficar com pelo menos a 'promo mínima' (o anúncio sempre mostra desconto). A promoção é arredondada pra baixo (% inteiro), então o cliente paga no máximo alguns centavos a mais. ↻ = mudou desde a última vez que você marcou como publicado (custo, preço, taxa ou acréscimo)." />
          </span>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <label className="promo-min" title="A base da Olist é calculada pra todo canal ficar com pelo menos essa promoção">
              promo mínima
              <input
                type="number"
                step="1"
                value={promoMinEdit ?? String(Math.round(promoMin * 100))}
                onChange={(e) => setPromoMinEdit(e.target.value)}
                onBlur={salvarPromoMin}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              />
              %
            </label>
            <button type="button" className="btn btn-sm" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? `Só o que precisa atualizar (${pendentes.length})` : `Ver todos (${linhas.length})`}
            </button>
            <button type="button" className="btn btn-sm" onClick={exportarCsv} disabled={!visiveis.length}>
              Exportar CSV
            </button>
            <button type="button" className="btn primary btn-sm" onClick={() => marcar(pendentes)} disabled={salvando || !pendentes.length}>
              Marcar tudo como publicado
            </button>
          </span>
        </h3>
        {visiveis.length ? (
          <div className="table-wrap tabela-pub">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Cadastrar na Olist</th>
                  {canaisOlist.map((c) => (
                    <th className="num" key={c.id}>
                      {nomeCanal(c)}
                      <span className="sub" style={{ textTransform: "none", letterSpacing: 0 }}>
                        acréscimo {Math.round((Number(c.acrescimo_olist_pct) || 0) * 1000) / 10}% · {c.acrescimo_olist_modo === "simples" ? "base simples" : "por dentro"}
                      </span>
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => (
                  <tr key={l.item.id} className={l.tipo === "variacao" ? "linha-cad" : ""}>
                    <td>
                      {l.tipo === "variacao" ? `↳ ${l.item.nomeVariacao || l.item.nome}` : l.item.nome}
                      <span className="sub">
                        {l.tipo === "variacao" ? `${l.item.pecas} un.` : l.tipo === "kit" ? "kit" : "avulso"}
                        {l.item.sku ? ` · ${l.item.sku}` : ""}
                      </span>
                    </td>
                    <td className="num">
                      {baseEdit?.chave === l.item.id ? (
                        <input
                          className="input-base-olist"
                          type="number"
                          step="0.01"
                          autoFocus
                          value={baseEdit.valor}
                          onChange={(e) => setBaseEdit({ chave: l.item.id, valor: e.target.value })}
                          onBlur={() => informarBase(l, baseEdit.valor)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                            if (e.key === "Escape") setBaseEdit(null);
                          }}
                        />
                      ) : (
                        <span className="base">{BRL(l.pub.base)}</span>
                      )}
                      {l.pub.baseMantida && <span className="sub">já está na Olist</span>}
                      {l.pub.baseAtualNaoServe && <span className="sub" style={{ color: "var(--bad)" }}>a atual ({BRL(Number(l.salva.base))}) não dá mais — troque</span>}
                      {l.mudou && (
                        <span className="sub">
                          <span className="badge warn">{l.nunca ? "novo" : l.pub.baseMantida ? "↻ promo mudou" : "↻ atualizar"}</span>
                        </span>
                      )}
                      {baseEdit?.chave !== l.item.id && (
                        <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={() => setBaseEdit({ chave: l.item.id, valor: l.salva ? String(l.salva.base) : "" })}>
                          {l.nunca ? "já tenho preço na Olist" : "mudar preço da Olist"}
                        </button>
                      )}
                    </td>
                    {canaisOlist.map((c) => {
                      const x = l.pub.canais[c.id];
                      if (!x)
                        return (
                          <td className="num" key={c.id}>
                            <span className="sub">sem preço salvo</span>
                          </td>
                        );
                      const antes = l.salva?.promos?.[c.id];
                      return (
                        <td className="num" key={c.id}>
                          <span className="promo">promo {x.promo}%</span>
                          <span className="sub">cliente paga {BRL(x.clientePaga)}</span>
                          {antes != null && Number(antes) !== x.promo && <span className="sub">era {antes}%</span>}
                        </td>
                      );
                    })}
                    <td>
                      {l.mudou ? (
                        <button type="button" className="btn btn-sm" disabled={salvando} onClick={() => marcar([l])}>
                          Marcar publicado
                        </button>
                      ) : (
                        <span className="badge good">✓ publicado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">{linhas.length ? "Tudo publicado — nada mudou desde a última vez. 👌" : "Nenhum item com preço salvo nos canais com acréscimo."}</div>
        )}
      </div>
    </>
  );
}
