import { useState } from "react";
import { precoAtual, listaDaLive, prazoEnvio, PRAZO_PADRAO, copiaDoItem } from "../lib/live.js";
import { registrarEventos, salvarLive } from "../lib/liveAcoes.js";
import { dm, diaSemana } from "../lib/liveTexto.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";

// Lista da live: vendas como saíram (produto · SKU · qtd) + roteiro de
// impressão (tudo aberto em peças e somado, em ordem alfabética) + prazo de
// envio no topo. Baixar (CSV), imprimir e copiar. "✎ Editar lista" ajusta as
// quantidades (grava eventos de ajuste na live — nada fora dela muda).
// `cruz` (cruzarPedidos) liga a coluna "Confere com os pedidos".
function textoLista(live, canal, lista, envio) {
  const linhas = [`Lista da live — ${canal?.nome || ""} · ${diaSemana(live.data)} ${dm(live.data)}`, `Enviar até: ${diaSemana(envio)} ${dm(envio)}`, "", "VENDAS DA LIVE", "Produto\tSKU\tQtd"];
  for (const v of lista.vendas) linhas.push(`${v.nome}\t${v.sku || ""}\t${v.qtd}`);
  linhas.push(`Total\t\t${lista.totalVendas}`, "", "ROTEIRO DE IMPRESSÃO", "Produto\tPeças");
  for (const r of lista.roteiro) linhas.push(`${r.nome}\t${r.total}${r.noKit ? ` (${r.soltas} soltas + ${r.noKit} em kit)` : ""}`);
  linhas.push(`Total\t${lista.totalPecas} peças`);
  return linhas.join("\n");
}
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export default function LiveLista({ live, eventos, canal, cruz, esc: escada, ctx, onToast }) {
  const [editando, setEditando] = useState(false);
  const [qtds, setQtds] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [novo, setNovo] = useState("");
  const lista = listaDaLive(live, eventos);
  const prazo = live.prazo_dias ?? PRAZO_PADRAO[canal?.tipo] ?? 2;
  const envio = prazoEnvio(live.data, prazo);
  const titulo = `Lista da live — ${canal?.nome || ""} · ${diaSemana(live.data)} ${dm(live.data)}`;

  function copiar() {
    navigator.clipboard?.writeText(textoLista(live, canal, lista, envio)).then(
      () => onToast("Lista copiada"),
      () => onToast("Não deu pra copiar neste navegador")
    );
  }
  function baixar() {
    const l = [["Vendas da live"], ["Produto", "SKU", "Qtd"], ...lista.vendas.map((v) => [v.nome, v.sku || "", v.qtd]), ["Total", "", lista.totalVendas], [], ["Roteiro de impressão"], ["Produto", "Peças", "Soltas", "Em kit"], ...lista.roteiro.map((r) => [r.nome, r.total, r.soltas, r.noKit]), ["Total", lista.totalPecas], [], ["Enviar até", `${dm(envio)}/${envio?.slice(0, 4)}`]];
    const csv = "﻿" + l.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `lista-live-${live.data}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function imprimir() {
    const w = window.open("", "_blank");
    if (!w) return onToast("O navegador bloqueou a janela de impressão");
    const tab = (cab, linhas) => `<table><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr>${linhas.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{font-size:18px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;font-size:13px}th{background:#eee}.prazo{font-size:16px;font-weight:bold;margin:8px 0}</style></head><body>
<h1>${esc(titulo)}</h1><div class="prazo">Enviar até: ${diaSemana(envio)} ${dm(envio)}</div>
<h2>Vendas da live</h2>${tab(["Produto", "SKU", "Qtd"], [...lista.vendas.map((v) => [v.nome, v.sku || "", v.qtd]), ["Total", "", lista.totalVendas]])}
<h2>Roteiro de impressão</h2>${tab(["Produto", "Peças"], [...lista.roteiro.map((r) => [r.nome + (r.noKit ? ` (${r.soltas} soltas + ${r.noKit} em kit)` : ""), r.total]), ["Total", `${lista.totalPecas} peças`]])}
<script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  }

  const produtosLive = live.produtos || [];
  const qtdAtual = (key) => lista.vendas.find((v) => v.key === key)?.qtd || 0;
  const linhasEdit = produtosLive.filter((p) => qtdAtual(p.key) > 0 || qtds[p.key] != null);
  async function salvarEdicao() {
    setSalvando(true);
    const evs = [];
    for (const p of produtosLive) {
      if (qtds[p.key] == null) continue;
      const alvo = Math.max(0, Math.round(Number(qtds[p.key]) || 0));
      const delta = alvo - qtdAtual(p.key);
      if (delta) evs.push({ tipo: "venda", produto_key: p.key, quantidade: delta, preco: precoAtual(p, eventos.filter((e) => e.live_id === live.id)), manual: true });
    }
    const r = await registrarEventos(live, evs);
    setSalvando(false);
    if (!r.ok) return onToast(r.msg);
    setQtds({});
    setEditando(false);
    onToast(evs.length ? "Lista ajustada" : "Nada mudou");
  }
  async function incluir(id) {
    setNovo("");
    const ja = produtosLive.find((p) => p.item_id === id);
    if (ja) return setQtds((q) => ({ ...q, [ja.key]: (Number(q[ja.key] ?? qtdAtual(ja.key)) || 0) + 1 }));
    const item = escada.itens.find((i) => i.id === id);
    if (!item || !canal) return;
    // Produto que não estava no plano: entra na live (cópia) só pra constar na lista.
    const c = copiaDoItem(item, { canal, precos: escada.precos, produtos: escada.produtos, riscadoDe: null, ctx });
    const r = await salvarLive(live.id, { produtos: [...produtosLive, { ...c, estrategia: { tipo: "fixo", preco: c.salvo }, ordem: produtosLive.length, foraDoPlano: true }] });
    if (!r.ok) return onToast(r.msg);
    setQtds((q) => ({ ...q, [c.key]: 1 }));
  }

  const confere = (key) => {
    if (!cruz?.temPedidos) return null;
    const x = cruz.porProduto.get(key);
    if (!x) return null;
    const prov = x.provavel.reduce((t, l) => t + l.q, 0);
    const falta = Math.max(0, x.marcado - x.confirmado - prov);
    if (x.confirmado >= x.marcado && !prov) return <span className="good">✓ {x.confirmado}</span>;
    return (
      <span className={falta ? "warn" : ""}>
        {x.confirmado} confirmado{x.confirmado === 1 ? "" : "s"}
        {prov ? ` · ${prov} provável` : ""}
        {falta ? ` · ⚠ ${falta} não achado${falta === 1 ? "" : "s"}` : ""}
      </span>
    );
  };

  return (
    <div className="panel live-lista">
      <h3>
        Lista da live <CanalTag canal={canal} /> <span className="faint">· {diaSemana(live.data)} {dm(live.data)}</span>
      </h3>
      <div className="live-prazo">
        Enviar até: <b>{diaSemana(envio)} {dm(envio)}</b> <span className="faint">({prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`})</span>
      </div>
      <div className="toolbar">
        <button type="button" className="btn btn-sm" onClick={baixar} disabled={!lista.vendas.length}>
          Baixar
        </button>
        <button type="button" className="btn btn-sm" onClick={imprimir} disabled={!lista.vendas.length}>
          Imprimir
        </button>
        <button type="button" className="btn btn-sm" onClick={copiar} disabled={!lista.vendas.length}>
          Copiar
        </button>
        {!editando ? (
          <button type="button" className="btn btn-sm" onClick={() => setEditando(true)}>
            ✎ Editar lista
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-sm" onClick={() => (setEditando(false), setQtds({}))}>
              Cancelar
            </button>
            <button type="button" className="btn btn-sm primary" disabled={salvando} onClick={salvarEdicao}>
              Salvar lista
            </button>
          </>
        )}
      </div>

      <h4>Vendas da live</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>SKU</th>
              <th className="num">Qtd</th>
              {cruz?.temPedidos && <th>Confere com os pedidos</th>}
              {editando && <th />}
            </tr>
          </thead>
          <tbody>
            {(editando ? linhasEdit : lista.vendas.map((v) => v.prod)).map((p) => (
              <tr key={p.key}>
                <td>{p.nome}</td>
                <td className="faint">{p.sku || "—"}</td>
                <td className="num">
                  {editando ? (
                    <input type="number" min="0" style={{ width: 70 }} value={qtds[p.key] ?? qtdAtual(p.key)} onChange={(e) => setQtds((q) => ({ ...q, [p.key]: e.target.value }))} />
                  ) : (
                    <b>{qtdAtual(p.key)}</b>
                  )}
                </td>
                {cruz?.temPedidos && <td>{confere(p.key)}</td>}
                {editando && (
                  <td>
                    <button type="button" className="btn-icone" title="Remover" onClick={() => setQtds((q) => ({ ...q, [p.key]: 0 }))}>
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!editando && !lista.vendas.length && (
              <tr>
                <td colSpan={4} className="faint">
                  Nenhuma venda marcada nesta live.
                </td>
              </tr>
            )}
            <tr className="linha-total">
              <td>Total</td>
              <td />
              <td className="num">
                <b>{lista.totalVendas}</b>
              </td>
              {cruz?.temPedidos && <td />}
              {editando && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      {editando && (
        <div className="toolbar" style={{ marginTop: 6 }}>
          <span className="faint">+ incluir venda:</span>
          <BuscaItem grupos={gruposDoSeletor(escada.itens)} value={novo} onChange={incluir} vazio="produto da live ou outro do catálogo" />
        </div>
      )}

      <h4>Roteiro de impressão</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Peças</th>
            </tr>
          </thead>
          <tbody>
            {lista.roteiro.map((r) => (
              <tr key={r.nome + r.sku}>
                <td>{r.nome}</td>
                <td className="num">
                  <b>{r.total}</b>
                  {r.noKit > 0 && (
                    <span className="faint">
                      {" "}
                      ({r.soltas} soltas + {r.noKit} em kit)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="linha-total">
              <td>Total</td>
              <td className="num">
                <b>{lista.totalPecas} peças</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
