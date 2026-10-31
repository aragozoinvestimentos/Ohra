import { useMemo, useState } from "react";
import { PLATAFORMAS_IMPORTACAO, TIPOS_IMPORTACAO, podeExcluir, rotuloTipo } from "../lib/importacoes.js";
import { trocarSubAba } from "../lib/subAbas.js";
import { irParaAba } from "../lib/navegar.js";
import { abrirEstoque } from "../lib/estoqueNav.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";

// Atualizar dados → Últimas importações (31/10/2026): todos os envios da loja,
// do mais novo pro mais antigo, com filtro por tipo e marketplace e o × pra
// desfazer um envio errado (só o mais novo de cada tipo — conta em
// lib/importacoes.js; a exclusão é feita pela CentralImportacao, que refaz o
// caixa e o andamento do Ads).
const POR_PAGINA = 30;
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const quando = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export default function UltimasImportacoes({ lista, pedidos, ocupado, onExcluir }) {
  const [tipo, setTipo] = useState("");
  const [plat, setPlat] = useState("");
  const [qtd, setQtd] = useState(POR_PAGINA);
  const itensPorEnvio = useMemo(() => {
    const m = new Map();
    for (const p of pedidos) if (p.importacao_id) m.set(p.importacao_id, (m.get(p.importacao_id) || 0) + 1);
    return m;
  }, [pedidos]);
  const tiposComEnvio = TIPOS_IMPORTACAO.filter((t) => lista.some((e) => e.tipo === t.v));
  const platsComEnvio = PLATAFORMAS_IMPORTACAO.filter((p) => lista.some((e) => e.plataformas.includes(p.v)));
  const filtrada = lista.filter((e) => (!tipo || e.tipo === tipo) && (!plat || e.plataformas.includes(plat)));

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          Últimas importações
          <Ajuda texto="Cada arquivo enviado em Atualizar dados. O × desfaz um envio errado: tira o que aquele arquivo trouxe (pedidos novos, transações do extrato, janela de Ads) e refaz o caixa e o andamento do Ads. Dá pra desfazer só do mais novo pro mais antigo, um tipo de cada vez — os envios se somam e um pedido pode ter vindo de novo no arquivo seguinte. Envio de pedidos ou extrato de antes do SQL v71 não sabe quais pedidos trouxe: excluir tira só o registro, e reenviar o arquivo certo corrige." />
        </span>
        <span className="dir">{lista.length} envio{lista.length === 1 ? "" : "s"}</span>
      </h3>
      <div className="toolbar imp-filtros">
        <div className="subabas">
          <button type="button" className={`btn btn-mini${!tipo ? " primary" : ""}`} onClick={() => setTipo("")}>
            Todos
          </button>
          {tiposComEnvio.map((t) => (
            <button key={t.v} type="button" className={`btn btn-mini${tipo === t.v ? " primary" : ""}`} onClick={() => setTipo(t.v)}>
              {t.t}
            </button>
          ))}
        </div>
        {platsComEnvio.length > 0 && (
          <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Marketplace">
            <option value="">Todos os marketplaces</option>
            {platsComEnvio.map((p) => (
              <option key={p.v} value={p.v}>
                {p.t}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Enviado</th>
              <th>Tipo</th>
              <th>Marketplace</th>
              <th>Período</th>
              <th>O que entrou</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtrada.slice(0, qtd).map((e) => {
              const pode = podeExcluir(e, lista);
              const nItens = itensPorEnvio.get(e.imp.id) || 0;
              return (
                <tr key={e.imp.id} className={e.imp.ok === false ? "imp-erro" : ""}>
                  <td>
                    {quando(e.imp.criado_em)}
                    {e.maisNovo && <div className="muted-cel">mais novo</div>}
                  </td>
                  <td>
                    {e.imp.ok === false ? "✗ " : ""}
                    {rotuloTipo(e.tipo)}
                    {e.arquivoTodo && <div className="muted-cel">arquivo do ERP (todas)</div>}
                  </td>
                  <td>
                    <span className="imp-plats">
                      {e.plataformas.length ? e.plataformas.map((p) => <CanalTag key={p} tipo={PLATAFORMAS_IMPORTACAO.find((x) => x.v === p)?.tipo || p} nome={PLATAFORMAS_IMPORTACAO.find((x) => x.v === p)?.t || p} />) : <span className="muted-cel">—</span>}
                    </span>
                  </td>
                  <td>{e.imp.periodo_de ? `${dm(e.imp.periodo_de)} a ${dm(e.imp.periodo_ate)}` : "—"}</td>
                  <td className="imp-resumo">
                    {e.imp.resumo || "—"}
                    <div className="muted-cel">
                      {e.imp.arquivo}
                      {nItens ? ` · ${nItens} ite${nItens === 1 ? "m entrou" : "ns entraram"} por este envio` : ""}
                    </div>
                  </td>
                  <td>
                    {pode.pode ? (
                      <button type="button" className="btn btn-mini danger" disabled={ocupado} onClick={() => onExcluir(e)} title="Desfazer este envio">
                        × excluir
                      </button>
                    ) : (
                      <span className="muted-cel" title={pode.motivo}>
                        exclua o mais novo antes
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtrada.length && (
              <tr>
                <td colSpan={6} className="hint">
                  Nenhum envio{tipo || plat ? " com esse filtro" : " ainda"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pa-corpo">
        {filtrada.length > qtd && (
          <button type="button" className="link-btn" onClick={() => setQtd((q) => q + POR_PAGINA)}>
            ver mais ({filtrada.length - qtd})
          </button>
        )}
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Nota de compra, venda física e avaliações têm o × na tela delas:{" "}
          <button type="button" className="link-btn" onClick={() => abrirEstoque("notas")}>
            notas de compra
          </button>{" "}
          ·{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              trocarSubAba("ohra:importar-sub", "importar");
              irParaAba("importar");
            }}
          >
            venda física e avaliações (Importar)
          </button>
        </p>
      </div>
    </div>
  );
}
