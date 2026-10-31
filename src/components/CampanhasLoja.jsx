import { useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { canalDireto } from "../lib/canais.js";
import { cuponsAtivos, textoFaixa } from "../lib/cupomLoja.js";
import {
  TIPOS_CAMPANHA,
  RESERVA_LIVE_PADRAO,
  tipoDaCampanha,
  campanhaVigente,
  anunciosDaCampanha,
  situacaoDosAnuncios,
  resumoDaCampanha,
  novaCampanha,
  vendasPorAnuncio,
  sugestaoDeCampanha,
  campanhaDaSugestao,
  PISO_SUGESTAO,
} from "../lib/campanhas.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { hojeSP } from "../lib/datas.js";
import { irParaAba } from "../lib/navegar.js";
import { BRL, DATA } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Campanhas da loja (antes "Campanhas do TikTok", 31/10/2026): um % pra todos os
// produtos da campanha; o app mostra, anúncio a anúncio, quanto do desconto
// máximo sobra pro cupom da live (reserva fixa da loja). Conta em lib/campanhas.js.
// Guardado em preferencias_loja `promocoes:campanhas` = { canalId, reserva, campanhas }.
// Só informa: nada muda no preço salvo nem na plataforma. A sugestão de campanha
// (% e produtos) é de CADA loja: vendas, taxas, custo e margem dela.
const ESTADO = {
  ok: { cls: "st st-oportunidade", txt: "✓ live cabe" },
  "come-live": { cls: "st st-atencao", txt: "⚠ come a live" },
  abaixo: { cls: "st st-atencao", txt: "⚠ abaixo do mínimo" },
  prejuizo: { cls: "st st-resolver", txt: "! prejuízo" },
  "sem-dado": { cls: "st st-info", txt: "—" },
};
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const pc = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toString().replace(".", ",")}%`;
const dt = (d) => (d ? DATA(d).slice(0, 5) : "");

function Barra({ e, reserva }) {
  if (!e || e.maxSem == null) return null;
  const total = Math.max(e.maxSem, e.foraPct, 1);
  const w = (v) => `${(Math.max(0, v) / total) * 100}%`;
  const falta = Math.max(0, e.foraPct - e.maxSem);
  const live = Math.min(reserva, e.sobra);
  return (
    <div className="camp-barra" title={`desconto máximo ${e.maxSem}%`}>
      <i className="cb-camp" style={{ width: w(Math.min(e.campPct, e.maxSem)) }} />
      <i className="cb-cup" style={{ width: w(Math.min(e.cupomPct, Math.max(0, e.maxSem - e.campPct))) }} />
      <i className="cb-frete" style={{ width: w(Math.min(e.fretePct, Math.max(0, e.maxSem - e.campPct - e.cupomPct))) }} />
      <i className="cb-live" style={{ width: w(live) }} />
      <i className="cb-falta" style={{ width: w(falta) }} />
    </div>
  );
}

export default function CampanhasLoja() {
  const dados = useEscada();
  const { canais, cfgLoja } = dados;
  const hoje = hojeSP();
  const opcoesCanal = useMemo(() => canais.filter((c) => !canalDireto(c)), [canais]);
  const [pref, setPref] = usePreferencia("promocoes:campanhas", {});
  const padraoCanal = (opcoesCanal.find((c) => c.tipo === "tiktok") || opcoesCanal[0])?.id || "";
  const canalId = pref.canalId && opcoesCanal.some((c) => c.id === pref.canalId) ? pref.canalId : padraoCanal;
  const canal = opcoesCanal.find((c) => c.id === canalId) || null;
  const reserva = pref.reserva == null || pref.reserva === "" ? RESERVA_LIVE_PADRAO : num(pref.reserva);
  const todas = useMemo(() => (Array.isArray(pref.campanhas) ? pref.campanhas : []), [pref.campanhas]);
  const doCanal = todas.filter((c) => (c.canalId || canalId) === canalId);
  const vigentes = doCanal.filter((c) => campanhaVigente(c, hoje));
  const encerradas = doCanal.filter((c) => !campanhaVigente(c, hoje));
  const faixas = useMemo(() => (canal ? cuponsAtivos(cfgLoja, canal.id) : []), [cfgLoja, canal]);
  const [ed, setEd] = useState(null); // campanha sendo criada/editada
  const [verEncerradas, setVerEncerradas] = useState(false);
  const [excluir, setExcluir] = useState(null);
  const gravar = (novo) => setPref({ ...pref, ...novo });

  const anuncios = useMemo(() => anunciosDaCampanha(dados, canal), [dados, canal]);
  const tipoEd = ed ? tipoDaCampanha(ed.tipo) : null;
  const simulada = ed && !tipoEd.live ? { ...ed, pct: num(ed.pct), valor: num(ed.valor), minimo: num(ed.minimo) } : null;
  const linhas = useMemo(
    () => situacaoDosAnuncios(anuncios, { campanhas: vigentes, faixas, hoje, reserva, simulada }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anuncios, JSON.stringify(vigentes), faixas, hoje, reserva, JSON.stringify(simulada)]
  );
  // Sugestão: sem a campanha que está sendo editada e sem simulação.
  const { pedidosValidos } = useCrescimento();
  const vendas = useMemo(() => (canal ? vendasPorAnuncio(pedidosValidos, canal.id, hoje) : new Map()), [pedidosValidos, canal, hoje]);
  const edId = ed?.id;
  const linhasBase = useMemo(
    () => situacaoDosAnuncios(anuncios, { campanhas: vigentes.filter((c) => c.id !== edId), faixas, hoje, reserva }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anuncios, JSON.stringify(vigentes), edId, faixas, hoje, reserva]
  );
  const sug = useMemo(() => sugestaoDeCampanha(linhasBase, vendas), [linhasBase, vendas]);
  const temCampPreco = vigentes.some((c) => tipoDaCampanha(c.tipo).camada === "preco" && !tipoDaCampanha(c.tipo).live);
  const marcados = new Set(ed?.itens || []);
  const resumo = ed && tipoEd.camada === "preco" ? resumoDaCampanha(linhas.filter((l) => marcados.has(l.id)), num(ed.pct)) : null;
  // relâmpago da LIVE: o % tem que caber no que sobra fora da live
  const naoCabeLive = ed && tipoEd.live ? linhas.filter((l) => marcados.has(l.id) && (l.sobra ?? 0) < num(ed.pct)) : [];
  const menorSobra = ed && tipoEd.live ? Math.min(...linhas.filter((l) => marcados.has(l.id)).map((l) => l.sobra ?? 0)) : null;

  const contar = (est) => linhas.filter((l) => l.estado === est).length;
  const ok = contar("ok");
  const come = contar("come-live");
  const abaixo = contar("abaixo") + contar("prejuizo");

  function salvar() {
    if (!ed) return;
    const limpa = { ...ed, canalId, nome: String(ed.nome || "").trim(), pct: num(ed.pct), valor: num(ed.valor), minimo: num(ed.minimo) };
    gravar({ canalId, campanhas: [...todas.filter((c) => c.id !== ed.id), limpa] });
    setEd(null);
  }
  const alternar = (id) => setEd((e) => ({ ...e, itens: (e.itens || []).includes(id) ? e.itens.filter((x) => x !== id) : [...(e.itens || []), id] }));
  const encerrar = (c) => gravar({ campanhas: todas.map((x) => (x.id === c.id ? { ...x, encerrada: true } : x)) });

  if (!opcoesCanal.length) return <div className="panel"><p className="hint">Cadastre um canal em Configuração → Canais.</p></div>;

  return (
    <div>
      <div className="camp-regra">
        <span>
          Regra fixa da loja: <b>guardar {reserva}% pro cupom da live</b>
        </span>
        <label>
          mudar{" "}
          <input type="number" min="0" max="40" value={pref.reserva ?? RESERVA_LIVE_PADRAO} onChange={(e) => gravar({ reserva: e.target.value })} style={{ width: 60 }} /> %
        </label>
        <span className="hint" style={{ margin: 0 }}>
          Todo desconto conta como pago por você. Se a plataforma bancar parte, aparece como lucro a mais nos pedidos importados.
        </span>
        <span className="camp-canal">
          Canal{" "}
          <select value={canalId} onChange={(e) => gravar({ canalId: e.target.value })}>
            {opcoesCanal.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </span>
      </div>

      <Kpis
        itens={[
          { label: "Campanhas ativas", valor: vigentes.length, sub: canal ? <CanalTag canal={canal} /> : "" },
          { label: "Com espaço pra live", valor: ok, sub: `de ${linhas.length} anúncios · guardando ${reserva}%` },
          { label: "Comendo a live", valor: come, tom: come ? "warn" : undefined, sub: "ainda lucram, mas o cupom da live não cabe inteiro" },
          { label: "Abaixo do mínimo", valor: abaixo, tom: abaixo ? "bad" : undefined, sub: "já fora da live passam do limite" },
        ]}
      />

      {canal && canal.tipo !== "tiktok" && (
        <p className="hint camp-aviso-canal">
          Esta tela segue a regra do TikTok (um % igual pra todos os produtos da campanha). Na {canal.nome} a promoção costuma ser por anúncio — a visão própria
          desse canal ainda vai ser combinada.
        </p>
      )}

      {sug && !ed && !temCampPreco && (
        <div className={`camp-sug${sug.compensa ? "" : " nao"}`}>
          {sug.compensa ? (
            <>
              <div>
                <span className="camp-tipo">Campanha sugerida · {canal?.nome}</span>
                <b>
                  Desconto no produto {sug.pct}% em {sug.itens.length} produto{sug.itens.length > 1 ? "s" : ""}
                </b>
                <span className="muted-cel">
                  Guarda os {reserva}% da live em todos eles · {sug.porVendas ? `${Math.round(sug.cobertura * 100)}% das suas vendas (90 dias) aguentam` : "pelo catálogo (ainda sem vendas neste canal)"}
                  {sug.fora.length > 0 && ` · fora: ${sug.fora.slice(0, 4).map((f) => f.nome).join(", ")}${sug.fora.length > 4 ? "…" : ""} (não aguentam ${sug.pct}%)`}
                </span>
              </div>
              <button type="button" className="btn primary" onClick={() => setEd(campanhaDaSugestao(canalId, sug, hoje))}>
                Criar com essa sugestão
              </button>
            </>
          ) : (
            <div>
              <span className="camp-tipo">Campanha sugerida · {canal?.nome}</span>
              <b>Hoje não compensa campanha de desconto</b>
              <span className="muted-cel">
                Guardando os {reserva}% da live, {sug.pct > 0 ? `os produtos que mais vendem só aguentam ${sug.pct}% — menos de ${PISO_SUGESTAO}% não chama atenção` : "os produtos que mais vendem não têm espaço nem com o preço cheio"}
                {sug.fora.length > 0 && ` (${sug.fora.slice(0, 3).map((f) => f.nome).join(", ")})`}. Campanha só depois de ter mais folga no preço.
              </span>
            </div>
          )}
          <Ajuda texto={`Calculada com os números desta loja: vendas dos últimos 90 dias, preço de agora, custo, taxas do canal, cupom ativo e o lucro mínimo. É o maior % em que os produtos que fazem 80% das vendas ainda guardam a reserva da live (pedido de 1 un., o pior caso). Abaixo de ${PISO_SUGESTAO}% não sugere. Só sugestão — a campanha é criada na plataforma.`} />
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          <span>
            Campanhas ativas
            <Ajuda texto="Registre aqui as campanhas que você criou na plataforma (tipo, %, produtos e datas) — igual você duplica lá. As promoções somam no mesmo pedido entre camadas: o desconto no produto (ou relâmpago) + um cupom + o desconto de frete. Dentro da camada do preço vale uma só (o app considera a maior). A Oferta relâmpago da LIVE fica fora da conta de fora da live: ela tem que caber no que sobra." />
          </span>
          <button type="button" className="btn btn-mini primary" onClick={() => setEd(novaCampanha(canalId))}>
            + Nova campanha
          </button>
        </h3>
        <div className="camp-cards">
          {vigentes.map((c) => {
            const t = tipoDaCampanha(c.tipo);
            return (
              <div key={c.id} className={`camp-card${ed?.id === c.id ? " on" : ""}`}>
                <div className="camp-card-t">
                  <span className="camp-tipo">{t.t}</span>
                  <span className="camp-val">{c.tipo === "frete" ? BRL(num(c.valor)) : `${num(c.pct)}%`}</span>
                </div>
                <b>{c.nome || t.t}</b>
                <span className="muted-cel">
                  {c.tipo === "frete" && c.todos ? "loja inteira" : `${(c.itens || []).length} produto(s)`}
                  {c.tipo === "frete" && num(c.minimo) > 0 ? ` · acima de ${BRL(num(c.minimo))}` : ""}
                  {c.inicio || c.fim ? ` · ${dt(c.inicio) || "…"} a ${dt(c.fim) || "sem fim"}` : ""}
                </span>
                <span className="camp-acoes">
                  <button type="button" className="link-btn" onClick={() => setEd({ ...c })}>editar</button>
                  <button type="button" className="link-btn" onClick={() => setEd(novaCampanha(canalId, c))}>duplicar</button>
                  <button type="button" className="link-btn" onClick={() => encerrar(c)}>encerrar</button>
                </span>
              </div>
            );
          })}
          {faixas.length > 0 && (
            <div className="camp-card">
              <div className="camp-card-t">
                <span className="camp-tipo">Cupom ativo</span>
                <span className="camp-val">{faixas.length} faixa{faixas.length > 1 ? "s" : ""}</span>
              </div>
              <b>Cupom da loja</b>
              <span className="muted-cel">{faixas.map(textoFaixa).join(" · ")}</span>
              <span className="camp-acoes">
                <button type="button" className="link-btn" onClick={() => irParaAba("regras")}>editar em Regras</button>
              </span>
            </div>
          )}
          <button type="button" className="camp-card camp-nova" onClick={() => setEd(novaCampanha(canalId))}>
            + Nova campanha
          </button>
        </div>
        {encerradas.length > 0 && (
          <div style={{ padding: "0 14px 10px" }}>
            <button type="button" className="link-btn" onClick={() => setVerEncerradas((v) => !v)}>
              {verEncerradas ? "▾" : "▸"} Encerradas ({encerradas.length})
            </button>
            {verEncerradas && (
              <ul className="camp-encerradas">
                {encerradas.map((c) => (
                  <li key={c.id}>
                    {c.nome || tipoDaCampanha(c.tipo).t} · {c.tipo === "frete" ? BRL(num(c.valor)) : `${num(c.pct)}%`} · {(c.itens || []).length} produto(s){" "}
                    <button type="button" className="link-btn" onClick={() => setEd(novaCampanha(canalId, c))}>duplicar</button>{" "}
                    <button type="button" className="link-btn" onClick={() => setExcluir(c)}>excluir</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {ed && (
        <div className="panel">
          <h3 className="section-title">
            <span>{todas.some((c) => c.id === ed.id) ? "Editar campanha" : "Nova campanha"}</span>
          </h3>
          <div className="pa-corpo" style={{ display: "grid", gap: 10 }}>
            <div className="grid-auto">
              <div className="field">
                <label>Tipo</label>
                <select value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value })}>
                  {TIPOS_CAMPANHA.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Nome (pra você achar)</label>
                <input type="text" value={ed.nome} placeholder="ex.: Novembro" onChange={(e) => setEd({ ...ed, nome: e.target.value })} />
              </div>
              {ed.tipo === "frete" ? (
                <>
                  <div className="field">
                    <label>Você paga de frete (R$ por pedido)</label>
                    <input type="text" inputMode="decimal" value={ed.valor} onChange={(e) => setEd({ ...ed, valor: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Pedido mínimo (R$, opcional)</label>
                    <input type="text" inputMode="decimal" value={ed.minimo} onChange={(e) => setEd({ ...ed, minimo: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="field">
                  <label>
                    Desconto <b className="camp-pct">{num(ed.pct)}%</b>
                    {sug?.compensa && num(ed.pct) !== sug.pct && (
                      <>
                        {" "}
                        <span className="muted-cel">· sugerido {sug.pct}%</span>{" "}
                        <button type="button" className="link-btn" onClick={() => setEd({ ...ed, pct: sug.pct })}>
                          usar
                        </button>
                      </>
                    )}
                  </label>
                  <input type="range" min="1" max="40" value={num(ed.pct) || 1} onChange={(e) => setEd({ ...ed, pct: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label>Começa</label>
                <input type="date" value={ed.inicio || ""} onChange={(e) => setEd({ ...ed, inicio: e.target.value })} />
              </div>
              <div className="field">
                <label>Termina (vazio = sem fim)</label>
                <input type="date" value={ed.fim || ""} onChange={(e) => setEd({ ...ed, fim: e.target.value })} />
              </div>
            </div>
            {ed.tipo === "frete" && (
              <label className="check-linha">
                <input type="checkbox" checked={!!ed.todos} onChange={(e) => setEd({ ...ed, todos: e.target.checked })} /> vale pra loja inteira
              </label>
            )}
            {resumo && (
              <div className="camp-resumo">
                <div className="camp-box ok">
                  <span>
                    Cabe pra todos os {resumo.n} produtos{resumo.semEspaco.length ? " com espaço" : ""}, guardando {reserva}% pra live
                  </span>
                  <b>{resumo.capTodos == null ? "marque os produtos" : `até ${resumo.capTodos}%`}</b>
                  {resumo.semEspaco.length > 0 && (
                    <span className="muted-cel">
                      Sem espaço nem com o preço cheio (assunto de preço): {resumo.semEspaco.map((l) => l.nome).join(" · ")}
                    </span>
                  )}
                </div>
                <div className={`camp-box ${resumo.tirar.length ? "warn" : "ok"}`}>
                  {resumo.tirar.length ? (
                    <>
                      <span>
                        Pra usar <b>{num(ed.pct)}%</b> e ainda caber a live, tire da campanha:
                      </span>
                      <b className="camp-tirar">{resumo.tirar.map((l) => l.nome).join(" · ")}</b>
                      <button type="button" className="link-btn" onClick={() => setEd({ ...ed, itens: ed.itens.filter((id) => !resumo.tirar.some((l) => l.id === id)) })}>
                        tirar {resumo.tirar.length === 1 ? "ele" : `esses ${resumo.tirar.length}`}
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        Com <b>{num(ed.pct)}%</b> todos os produtos marcados ainda têm os {reserva}% da live
                      </span>
                      <b>{marcados.size ? "✓ pode criar" : "marque os produtos na tabela"}</b>
                    </>
                  )}
                </div>
              </div>
            )}
            {tipoEd.live && (
              <div className={`camp-box ${naoCabeLive.length ? "warn" : "ok"}`}>
                <span>Oferta relâmpago da LIVE: o % tem que caber no que sobra fora da live.</span>
                <b>{marcados.size ? `cabe até ${Math.max(0, menorSobra)}% em todos` : "marque os produtos"}</b>
                {naoCabeLive.length > 0 && <span>Não cabe {num(ed.pct)}% em: {naoCabeLive.map((l) => l.nome).join(" · ")}</span>}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn primary" onClick={salvar}>
                Salvar campanha
              </button>
              <button type="button" className="btn" onClick={() => setEd(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          <span>
            {ed ? "Marque os produtos da campanha" : "Como está cada anúncio"}
            <Ajuda texto="Desconto máximo = o maior % somado que ainda deixa o seu lucro mínimo, com a comissão e as taxas do canal sobre o preço com desconto (pedido de 1 unidade, o pior caso). A barra mostra pra onde vai: campanha, cupom ativo, frete, o que sobra pra live e o que passou do máximo. Variações: vale a mais apertada." />
          </span>
        </h3>
        <div className="camp-leg">
          <span style={{ "--c": "var(--accent)" }}>campanha</span>
          <span style={{ "--c": "#c98a5b" }}>cupom ativo</span>
          <span style={{ "--c": "#a59a8e" }}>frete</span>
          <span style={{ "--c": "#1a9a96" }}>sobra pra live</span>
          <span style={{ "--c": "var(--st-resolver)" }}>passou do máximo</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {ed && !(ed.tipo === "frete" && ed.todos) && <th />}
                <th>Produto</th>
                <th className="num">Preço cheio</th>
                <th className="num">Desconto máximo</th>
                <th>Onde vai o desconto</th>
                <th className="num">Sobra pra live</th>
                <th className="num">Lucro fora da live</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const est = ESTADO[l.estado] || ESTADO["sem-dado"];
                const e = l.e;
                return (
                  <tr key={l.id} className={ed && !marcados.has(l.id) && !(ed.tipo === "frete" && ed.todos) ? "camp-fora" : ""}>
                    {ed && !(ed.tipo === "frete" && ed.todos) && (
                      <td>
                        <input type="checkbox" checked={marcados.has(l.id)} onChange={() => alternar(l.id)} aria-label={`Entra na campanha: ${l.nome}`} />
                      </td>
                    )}
                    <td>
                      {l.nome}
                      {l.pior && <div className="muted-cel">mais apertada: {l.pior}</div>}
                    </td>
                    <td className="num">{l.preco ? BRL(l.preco) : "—"}</td>
                    <td className="num">{e ? `${e.maxSem}%` : "—"}</td>
                    <td>
                      <Barra e={e} reserva={reserva} />
                      {e && (
                        <div className="muted-cel">
                          {e.campPct ? `campanha ${pc(e.campPct)}` : "sem campanha"}
                          {e.cupomPct ? ` + cupom ${pc(e.cupomPct)}` : ""}
                          {e.fretePct ? ` + frete ${pc(e.fretePct)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <b>{e ? `${e.sobra}%` : "—"}</b>
                      {e && l.estado === "come-live" && <div className="muted-cel">precisa {reserva}%</div>}
                    </td>
                    <td className="num">{e ? BRL(e.lucroFora) : "—"}</td>
                    <td>
                      <span className={est.cls}>{est.txt}</span>
                    </td>
                  </tr>
                );
              })}
              {!linhas.length && (
                <tr>
                  <td colSpan={8} className="hint">
                    Nenhum anúncio com preço salvo neste canal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {excluir && (
        <ConfirmDialog
          titulo="Excluir campanha"
          mensagem={`Excluir "${excluir.nome || tipoDaCampanha(excluir.tipo).t}" da lista? Isso não mexe em nada na plataforma.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            gravar({ campanhas: todas.filter((c) => c.id !== excluir.id) });
            setExcluir(null);
          }}
          onCancel={() => setExcluir(null)}
        />
      )}
    </div>
  );
}
