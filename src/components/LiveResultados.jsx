import { useState } from "react";
import CanalTag from "./CanalTag.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Kpis from "./Kpis.jsx";
import LiveLista from "./LiveLista.jsx";
import { NovaLive } from "./LivePlanejar.jsx";
import { Diferente } from "./LiveAoVivo.jsx";
import { BRL } from "../lib/format.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { abcDasLives, cruzarPedidos, nomeEstrategia, resumoLive } from "../lib/live.js";
import { excluirLive, salvarLive } from "../lib/liveAcoes.js";
import { dm, diaSemana, minParaTexto, rotuloLive } from "../lib/liveTexto.js";

// Live → 3 · Resultados: cada live salva (métricas, por produto, "o que fiz
// diferente", Lista da live, conferência com os pedidos importados), comparar
// 2 lives e a Curva ABC SÓ das lives (nunca mistura com a curva da loja).
// Tudo aqui é leitura/sugestão: nada mexe em preço salvo, Rampa ou Ads.

function Cruzamento({ live, cruz, plataforma, onToast }) {
  const dec = live.pedidos || {};
  const decidir = async (chave, v) => {
    const novo = { ...dec };
    if (v == null) delete novo[chave];
    else novo[chave] = v;
    const r = await salvarLive(live.id, { pedidos: novo });
    if (!r.ok) onToast(r.msg);
  };
  if (!cruz.temPedidos)
    return (
      <div className="panel">
        <h3>Conferir com os pedidos</h3>
        <div className="empty">
          Importe os pedidos de {plataforma} do dia {dm(live.data)} em <b>Atualizar dados</b> — aí o app separa o que foi da live (mesmo dia, mesmo produto, preço da live) e confere com o que você marcou.
        </div>
      </div>
    );
  const linhas = [];
  for (const p of live.produtos || []) {
    const x = cruz.porProduto.get(p.key);
    if (!x) continue;
    for (const l of x.live) linhas.push({ p, l, tipo: "live" });
    for (const l of x.provavel) linhas.push({ p, l, tipo: "provavel" });
  }
  const descartados = Object.entries(dec).filter(([, v]) => v === "nao").length;
  return (
    <div className="panel">
      <h3>
        Conferir com os pedidos <span className="faint">· {cruz.confirmados} confirmado{cruz.confirmados === 1 ? "" : "s"} · {cruz.provaveis} provável · {cruz.marcados} marcados na live</span>
      </h3>
      {!linhas.length ? (
        <div className="empty">Nenhum pedido do dia bate com os produtos da live.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Produto</th>
                <th className="num">Qtd</th>
                <th className="num">Pago (cada)</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, l, tipo }) => (
                <tr key={l.chave}>
                  <td className="faint">{l.ordem_compra || l.numero || l.pedido}</td>
                  <td>{p.nome}</td>
                  <td className="num">{l.q}</td>
                  <td className="num">{BRL(l.unit)}</td>
                  <td>{tipo === "live" ? <span className="good">✓ da live{l.decidido ? " (você marcou)" : ""}</span> : <span className="warn">? provável</span>}</td>
                  <td>
                    {tipo === "provavel" ? (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => decidir(l.chave, "live")}>
                          É da live
                        </button>{" "}
                        <button type="button" className="link-btn" onClick={() => decidir(l.chave, "nao")}>
                          não é
                        </button>
                      </>
                    ) : l.decidido ? (
                      <button type="button" className="link-btn" onClick={() => decidir(l.chave, null)}>
                        desfazer
                      </button>
                    ) : (
                      <button type="button" className="link-btn" onClick={() => decidir(l.chave, "nao")}>
                        não é da live
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hint">
        O arquivo da Olist só traz a data (sem a hora): o app junta pelo dia, pelo produto e pelo preço pago ≈ preço da live, até o que você marcou. Pedido no preço normal da loja fica como "provável".
        {descartados > 0 && (
          <>
            {" "}
            {descartados} marcado{descartados === 1 ? "" : "s"} como "não é da live" ·{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => salvarLive(live.id, { pedidos: Object.fromEntries(Object.entries(dec).filter(([, v]) => v !== "nao")) })}
            >
              voltar a considerar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DetalheLive({ live, esc, lv, ctxDaLive, linhasPedidos, onToast, canaisLive, riscadoDe, setAtualId, irPara, lojaId }) {
  const [editDif, setEditDif] = useState(false);
  const [repetir, setRepetir] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const canal = esc.canais.find((c) => c.id === live.canal_id) || null;
  const ctx = { ...ctxDaLive(live), taxaExtra: live.taxa_extra };
  const r = resumoLive(live, lv.eventos, ctx);
  const cruz = cruzarPedidos(live, lv.eventos, linhasPedidos);
  return (
    <>
      <div className="panel">
        <h3>
          {live.nome || "Live"} <CanalTag canal={canal} /> <span className="faint">· {diaSemana(live.data)} {dm(live.data)}</span>
          <button type="button" className="btn btn-sm danger live-excluir" onClick={() => setExcluir(true)}>
            × Excluir live
          </button>
        </h3>
        <Kpis
          itens={[
            { label: "Vendas", valor: r.qtd, sub: `${(live.produtos || []).length} produtos na live` },
            { label: "Faturamento", valor: BRL(r.faturamento) },
            { label: "Lucro", valor: BRL(r.lucro), sub: [live.taxa_extra ? `com taxa extra de ${Math.round(live.taxa_extra * 1000) / 10}%` : "taxas do canal + brindes", r.descontoCupom > 0 ? `− ${BRL(r.descontoCupom)} de cupom (${r.cupomUsados} usados)` : null].filter(Boolean).join(" · ") },
            { label: "Lucro por hora", valor: r.lucroHora != null ? BRL(r.lucroHora) : "—", sub: `duração ${minParaTexto(r.duracaoMin)}` },
          ]}
        />
        <div className={`live-diferente${live.diferente ? "" : " vazio"}`}>
          {editDif ? (
            <Diferente live={live} onToast={(m) => (onToast(m), setEditDif(false))} />
          ) : live.diferente ? (
            <>
              <b>O que fiz diferente:</b> {live.diferente}{" "}
              <button type="button" className="link-btn" onClick={() => setEditDif(true)}>
                ✎
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm primary" onClick={() => setEditDif(true)}>
              ✎ O que fiz diferente
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Estratégia</th>
                <th className="num">Vendas</th>
                <th className="num">Faturamento</th>
                <th className="num">Lucro</th>
                <th>Preço</th>
              </tr>
            </thead>
            <tbody>
              {r.produtos.map((x) => (
                <tr key={x.prod.key}>
                  <td>
                    {x.prod.nome} {x.prod.foraDoPlano && <span className="faint">(fora do plano)</span>}
                  </td>
                  <td className="faint">{[...new Set(x.estrategias)].map(nomeEstrategia).join(" → ")}</td>
                  <td className="num">
                    <b>{x.qtd}</b>
                  </td>
                  <td className="num">{BRL(x.faturamento)}</td>
                  <td className={`num${x.lucro < 0 ? " bad" : ""}`}>{BRL(x.lucro)}</td>
                  <td className="faint">
                    {x.vendeuAte != null ? `vendeu até ${BRL(x.vendeuAte)}` : "sem venda"}
                    {x.semVendaAcima != null && ` · sem venda a ${BRL(x.semVendaAcima)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acoes-form">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => setRepetir(true)}>
            Repetir o plano numa live nova
          </button>
        </div>
      </div>
      {repetir && (
        <NovaLive
          base={live}
          esc={esc}
          lv={lv}
          canaisLive={canaisLive}
          riscadoDe={riscadoDe}
          ctxDaLive={ctxDaLive}
          lojaId={lojaId}
          onToast={onToast}
          setAtualId={(id) => {
            setAtualId(id);
            irPara("planejar");
          }}
          onFechar={() => setRepetir(false)}
        />
      )}
      <LiveLista live={live} eventos={lv.eventos} canal={canal} cruz={cruz} esc={esc} ctx={ctx} onToast={onToast} />
      <Cruzamento live={live} cruz={cruz} plataforma={canal?.nome || "a plataforma"} onToast={onToast} />
      {excluir && (
        <ConfirmDialog
          titulo="Excluir esta live?"
          mensagem="O plano, as vendas marcadas e a conferência somem. Nada fora da aba Live muda."
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setExcluir(false)}
          onConfirm={async () => {
            setExcluir(false);
            const x = await excluirLive(live.id);
            if (!x.ok) return onToast(x.msg);
            setAtualId("");
            onToast("Live excluída");
          }}
        />
      )}
    </>
  );
}

function Comparar({ lv, esc, ctxDaLive }) {
  const enc = lv.lives.filter((l) => l.status === "encerrada");
  const [a, setA] = useState(enc[1]?.id || "");
  const [b, setB] = useState(enc[0]?.id || "");
  const la = enc.find((l) => l.id === a);
  const lb = enc.find((l) => l.id === b);
  const ra = la ? resumoLive(la, lv.eventos, { ...ctxDaLive(la), taxaExtra: la.taxa_extra }) : null;
  const rb = lb ? resumoLive(lb, lv.eventos, { ...ctxDaLive(lb), taxaExtra: lb.taxa_extra }) : null;
  if (enc.length < 2) return <div className="panel"><div className="empty">Faça pelo menos 2 lives pra comparar.</div></div>;
  const canalNome = (l) => esc.canais.find((c) => c.id === l?.canal_id)?.nome || "—";
  const linhas = [
    ["Plataforma", canalNome(la), canalNome(lb)],
    ["Duração", ra ? minParaTexto(ra.duracaoMin) : "—", rb ? minParaTexto(rb.duracaoMin) : "—"],
    ["Vendas", ra?.qtd ?? "—", rb?.qtd ?? "—"],
    ["Faturamento", ra ? BRL(ra.faturamento) : "—", rb ? BRL(rb.faturamento) : "—"],
    ["Lucro", ra ? BRL(ra.lucro) : "—", rb ? BRL(rb.lucro) : "—"],
    ["Cupom usado", ra?.descontoCupom ? `${BRL(ra.descontoCupom)} (${ra.cupomUsados}×)` : "—", rb?.descontoCupom ? `${BRL(rb.descontoCupom)} (${rb.cupomUsados}×)` : "—"],
    ["Lucro por hora", ra?.lucroHora != null ? BRL(ra.lucroHora) : "—", rb?.lucroHora != null ? BRL(rb.lucroHora) : "—"],
    ["O que fiz diferente", la?.diferente || "—", lb?.diferente || "—"],
  ];
  const itens = [...new Set([...(ra?.produtos || []), ...(rb?.produtos || [])].map((x) => x.prod.item_id))];
  const dePor = (r, id) => r?.produtos.find((x) => x.prod.item_id === id);
  return (
    <div className="panel">
      <h3>Comparar 2 lives</h3>
      <div className="toolbar">
        <select value={a} onChange={(e) => setA(e.target.value)}>
          {enc.map((l) => (
            <option key={l.id} value={l.id}>
              {rotuloLive(l, esc.canais)}
            </option>
          ))}
        </select>
        <span className="faint">×</span>
        <select value={b} onChange={(e) => setB(e.target.value)}>
          {enc.map((l) => (
            <option key={l.id} value={l.id}>
              {rotuloLive(l, esc.canais)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>{la ? `${diaSemana(la.data)} ${dm(la.data)} · ${la.nome || "Live"}` : "—"}</th>
              <th>{lb ? `${diaSemana(lb.data)} ${dm(lb.data)} · ${lb.nome || "Live"}` : "—"}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(([k, x, y]) => (
              <tr key={k}>
                <td className="faint">{k}</td>
                <td>{x}</td>
                <td>{y}</td>
              </tr>
            ))}
            {itens.map((id) => {
              const x = dePor(ra, id);
              const y = dePor(rb, id);
              const cel = (z) => (z ? `${z.qtd} vendas · ${BRL(z.lucro)} · ${[...new Set(z.estrategias)].map(nomeEstrategia).join(" → ")}${z.vendeuAte != null ? ` · até ${BRL(z.vendeuAte)}` : ""}` : "não estava");
              return (
                <tr key={id}>
                  <td>{(x || y).prod.nome}</td>
                  <td>{cel(x)}</td>
                  <td>{cel(y)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CurvaLive({ lv, ctxDaLive, canaisLive }) {
  const [canalId, setCanalId] = useState("");
  const lives = lv.lives.filter((l) => !canalId || l.canal_id === canalId);
  const lista = abcDasLives(lives, lv.eventos, (l) => ({ ...ctxDaLive(l), taxaExtra: l.taxa_extra }));
  return (
    <div className="panel">
      <h3>
        Curva ABC da live
        <span className="faint"> · só as vendas marcadas nas lives (não mistura com a curva da loja)</span>
      </h3>
      <div className="toolbar">
        <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
          <option value="">Todas as plataformas</option>
          {canaisLive.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      {!lista.length ? (
        <div className="empty">Nenhuma live encerrada ainda.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Curva</th>
                <th>Produto</th>
                <th className="num">Vendas</th>
                <th className="num">Lucro</th>
                <th className="num">Parte do lucro</th>
                <th>Frequência</th>
                <th className="num">Ter pronto</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((g) => (
                <tr key={g.item_id}>
                  <td>
                    <span className={`st ${g.classe === "A" ? "st-oportunidade" : g.classe === "B" ? "st-info" : "st-info"}`}>{g.classe}</span>
                  </td>
                  <td>
                    {g.nome} {g.sku && <span className="faint">· {g.sku}</span>}
                  </td>
                  <td className="num">{g.qtd}</td>
                  <td className={`num${g.lucro < 0 ? " bad" : ""}`}>{BRL(g.lucro)}</td>
                  <td className="num">{Math.round(g.parte * 100)}%</td>
                  <td>
                    vendeu em {g.vendeuEm} de {g.lives} live{g.lives === 1 ? "" : "s"}
                  </td>
                  <td className="num" title="média vendida por live (arredondada pra cima)">
                    ~{Math.ceil(g.media)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hint">A = os que somam até 80% do lucro das lives · B = até 95% · C = o resto. "Ter pronto" = média vendida por live — só sugestão.</div>
    </div>
  );
}

export default function LiveResultados(props) {
  const { lv, esc, atual, setAtualId, ctxDaLive } = props;
  const [visao, setVisao] = useLembrado("ohra:live-resultados", "lives");
  const enc = lv.lives.filter((l) => l.status === "encerrada");
  const sel = atual?.status === "encerrada" ? atual : null;
  return (
    <>
      <div className="subabas subabas-compacta live-visoes">
        {[
          ["lives", "Lives"],
          ["comparar", "Comparar"],
          ["abc", "Curva ABC da live"],
        ].map(([k, t]) => (
          <button key={k} type="button" className={`btn${visao === k ? " primary" : ""}`} onClick={() => setVisao(k)}>
            {t}
          </button>
        ))}
      </div>
      {visao === "comparar" && <Comparar lv={lv} esc={esc} ctxDaLive={ctxDaLive} />}
      {visao === "abc" && <CurvaLive lv={lv} ctxDaLive={ctxDaLive} canaisLive={props.canaisLive} />}
      {visao === "lives" && (
        <>
          <div className="panel">
            <h3>Lives feitas ({enc.length})</h3>
            {!enc.length ? (
              <div className="empty">Nenhuma live encerrada ainda.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Live</th>
                      <th className="num">Duração</th>
                      <th className="num">Vendas</th>
                      <th className="num">Lucro</th>
                      <th className="num">Lucro/hora</th>
                      <th>O que fiz diferente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enc.map((l) => {
                      const r = resumoLive(l, lv.eventos, { ...ctxDaLive(l), taxaExtra: l.taxa_extra });
                      return (
                        <tr key={l.id} className={`clicavel${sel?.id === l.id ? " ativo" : ""}`} onClick={() => setAtualId(l.id)}>
                          <td>{rotuloLive(l, esc.canais)}</td>
                          <td className="num">{minParaTexto(r.duracaoMin)}</td>
                          <td className="num">{r.qtd}</td>
                          <td className="num">{BRL(r.lucro)}</td>
                          <td className="num">{r.lucroHora != null ? BRL(r.lucroHora) : "—"}</td>
                          <td className="faint">{l.diferente || <span className="warn">falta registrar</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {sel && <DetalheLive key={sel.id} live={sel} {...props} />}
        </>
      )}
    </>
  );
}
