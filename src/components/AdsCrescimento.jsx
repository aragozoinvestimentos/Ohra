import { Fragment, useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { periodoLigado, resumoPeriodo, valoresAtuais } from "../lib/ads.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { EncerrarAdsDialog, NAO_RECOMENDA, PeriodoAdsDialog } from "./AdsPeriodoDialogs.jsx";
import { ajustarPeriodoAds, encerrarPeriodoAds, excluirPeriodoAds, iniciarPeriodoAds } from "../lib/adsAcoes.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Crescimento → Ads (schema v44): avaliação semanal de Ads por produto/kit ×
// canal — a decisão vem SÓ de lib/ads.js (avaliarAds); aqui só mostra e grava
// os períodos (início, ajustes, fim) quando o Gustavo clica.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const um = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const ORDEM = { resolver: 0, atencao: 1, oportunidade: 2, decisao: 3, info: 4, ok: 5 };

function Situacao({ av, compacto }) {
  if (av.estado === "ok") return <span className={compacto ? "muted-cel" : undefined}>✓ {av.titulo}</span>;
  return <Estado tipo={av.estado}>{av.titulo}</Estado>;
}

export default function AdsCrescimento({ linhasAds, adsH, regrasA, regras, hoje, canais, onToast, podeRegistrar, onRegistrar }) {
  const { lojaId, lojas, atualizar } = useLoja();
  const loja = lojas?.find((l) => l.id === lojaId) || null;
  const canaisComLinha = useMemo(() => canais.filter((c) => linhasAds.linhas.some((l) => l.canal.id === c.id)), [canais, linhasAds]);
  const [canalId, setCanalId] = useState(null);
  const canal = canaisComLinha.find((c) => c.id === canalId) || canaisComLinha.find((c) => c.tipo === "shopee") || canaisComLinha[0] || null;
  const [soLigados, setSoLigados] = useState(false);
  const [aberta, setAberta] = useState(null);
  const [periodoDlg, setPeriodoDlg] = useState(null); // { linha }
  const [ajusteDlg, setAjusteDlg] = useState(null); // { linha, orcamento, meta }
  const [encerrarDlg, setEncerrarDlg] = useState(null); // { linha }
  const [excluirDlg, setExcluirDlg] = useState(null); // { periodo }
  const [verRegras, setVerRegras] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const linhas = useMemo(
    () =>
      linhasAds.linhas
        .filter((l) => l.canal.id === canal?.id && (!soLigados || l.av.ativo))
        .sort((a, b) => (b.av.ativo ? 1 : 0) - (a.av.ativo ? 1 : 0) || ORDEM[a.av.estado] - ORDEM[b.av.estado] || a.item.nome.localeCompare(b.item.nome)),
    [linhasAds, canal, soLigados]
  );
  const ligados = linhasAds.linhas.filter((l) => l.av.ativo).length;
  const L = linhasAds.loja;

  if (!adsH.disponivel)
    return (
      <div className="panel">
        <h3>Ads</h3>
        <div className="empty">
          Falta rodar o <b>supabase/schema_v44.sql</b> no SQL Editor do Supabase (tabela dos períodos de Ads). Depois recarregue a página.
        </div>
      </div>
    );

  // Teste de lançamento possível: produto em rampa com o teste ainda não feito.
  const testeDe = (l) => {
    const t = l.rampa?.est.teste;
    if (!t || !["observando", "recomendado"].includes(t.status)) return null;
    return { padrao: t.status === "recomendado", dias: regras.testeDias, orcamentoDia: t.porDia, meta: regras.testeMeta };
  };
  async function rodar(fn, ok) {
    setSalvando(true);
    const r = await fn();
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg), false;
    window.dispatchEvent(new Event("focus"));
    onToast?.(r.semTipo ? `${ok} — rode o supabase/schema_v45.sql pra separar teste de período normal` : ok);
    return true;
  }

  async function salvarPeriodo(f) {
    const l = periodoDlg.linha;
    const ok = await rodar(
      () =>
        iniciarPeriodoAds({
          lojaId,
          tipo: l.tipo,
          id: l.id,
          canalId: l.canal.id,
          inicio: f.inicio,
          fim: f.fim || null,
          orcamento: f.orcamento === "" ? null : num(f.orcamento),
          meta: f.meta === "" ? null : num(f.meta),
          nota: f.nota || null,
          teste: f.comoTeste,
          rampa: l.rampa?.r || null,
          regras,
        }),
      f.comoTeste ? `Teste de lançamento iniciado: ${l.item.nome}` : `Período de Ads iniciado: ${l.item.nome}`
    );
    if (ok) setPeriodoDlg(null);
  }

  async function salvarAjuste(f) {
    const p = ajusteDlg.linha.av.ativo;
    const ok = await rodar(
      () => ajustarPeriodoAds(p, { data: f.data, orcamento: f.orcamento === "" ? null : num(f.orcamento), meta: f.meta === "" ? null : num(f.meta), motivo: f.motivo || null }),
      "Ajuste registrado — a Shopee reaprende uns dias"
    );
    if (ok) setAjusteDlg(null);
  }

  async function encerrar(f) {
    const l = encerrarDlg.linha;
    const ok = await rodar(() => encerrarPeriodoAds(l.av.ativo, { fim: f.fim, motivo: f.motivo || null, rampa: l.rampa?.r || null }), "Período encerrado — lembre de pausar na plataforma");
    if (ok) setEncerrarDlg(null);
  }

  async function excluir() {
    const ok = await rodar(() => excluirPeriodoAds(excluirDlg.periodo, { rampa: excluirDlg.rampa || null, hoje }), "Período excluído");
    if (ok) setExcluirDlg(null);
  }

  async function salvarRegras(f) {
    if (!loja) return;
    const novo = { ...(loja.config_escada?.ads || {}), aumento: num(f.aumento) / 100, tetoLoja: num(f.teto) / 100 };
    setSalvando(true);
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), ads: novo } });
    setSalvando(false);
    onToast?.(r.ok ? "Regras do Ads salvas pra loja" : `Não foi possível salvar: ${r.error}`);
    if (r.ok) setVerRegras(false);
  }

  return (
    <>
      <Kpis
        itens={[
          { label: "Ads na semana (loja)", valor: BRL(L.gasto), sub: "últimos 7 dias registrados" },
          {
            label: "Ads ÷ faturamento",
            valor: pct(L.pct),
            tom: L.acimaTeto ? "bad" : undefined,
            sub: `teto ${Math.round(regrasA.tetoLoja * 100)}%${L.faturamento ? ` · faturamento ${BRL(L.faturamento)}` : ""}`,
          },
          { label: "Vendas via Ads", valor: pct(L.pctVendasAds), tom: L.dependente ? "bad" : undefined, sub: L.dependente ? "mais da metade das vendas — dependência" : "das vendas da semana" },
          { label: "Com Ads ligado", valor: String(ligados), sub: `de ${linhasAds.linhas.length} produto${linhasAds.linhas.length === 1 ? "" : "s"} × canal` },
        ]}
      />
      {L.acimaTeto && (
        <div className="alerta alerta-warn">
          <b>Ads acima do teto da loja</b>A semana gastou {pct(L.pct)} do faturamento em Ads (teto {Math.round(regrasA.tetoLoja * 100)}%). Antes de aumentar algum produto, reduza os que estão abaixo do empate.
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          Ads por produto
          <Ajuda
            texto={
              <>
                Uma avaliação por semana, a partir das semanas registradas (ou importadas da Shopee). Ads é custo de venda: não entra no preço.
                <br />• <b>7 dias de aprendizado</b> a cada período ou ajuste: não mexa em meta nem orçamento.
                <br />• Depois: ROAS ≥ meta e gastou quase tudo → <b>aumentar {Math.round(regrasA.aumento * 100)}%</b> (1× por semana); entre o empate e a meta → manter; abaixo do empate → reduzir ou subir a meta; 2 semanas abaixo → pausar; {regrasA.cliquesSemVenda} cliques sem venda → pausar e revisar o anúncio.
                <br />• <b>Empate</b> = preço ÷ lucro por venda: abaixo dele, o Ads tira lucro.
                <br />• Sem Ads: o app diz se vale impulsionar, se o anúncio precisa ser arrumado antes ou se o Ads não se paga neste preço.
              </>
            }
          />
        </h3>
        <div className="toolbar">
          {canaisComLinha.length > 1 && (
            <select value={canal?.id || ""} onChange={(e) => setCanalId(e.target.value)} aria-label="Canal" style={{ width: "auto" }}>
              {canaisComLinha.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
          <label className="check-inline">
            <input type="checkbox" checked={soLigados} onChange={(e) => setSoLigados(e.target.checked)} /> só com Ads ligado
          </label>
          <button type="button" className="btn btn-mini" onClick={() => setVerRegras((v) => !v)}>Regras do Ads</button>
          {podeRegistrar && (
            <button type="button" className="btn btn-mini" onClick={onRegistrar}>Registrar semana</button>
          )}
        </div>
        {verRegras && <RegrasAds regrasA={regrasA} salvando={salvando} onSalvar={salvarRegras} />}
        {!linhas.length ? (
          <div className="empty">{soLigados ? "Nenhum produto com Ads ligado neste canal." : "Nenhum produto com preço salvo neste canal."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Situação</th>
                  <th className="num">ROAS semana</th>
                  <th className="num">Empate</th>
                  <th className="num">Meta</th>
                  <th className="num">Orçamento/dia</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const av = l.av;
                  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
                  const roasSemana = av.numeros?.roasSemana;
                  return (
                    <Fragment key={l.chave}>
                      <tr className="linha-clicavel" onClick={() => setAberta(aberta === l.chave ? null : l.chave)}>
                        <td>
                          <b>{l.item.nome}</b> <CanalTag canal={l.canal} />
                          {l.rampa && <span className="muted-cel"> · em rampa</span>}
                          <div className="muted-cel">{BRL(l.preco)} · lucro {l.lucro != null ? BRL(l.lucro) : "—"}</div>
                        </td>
                        <td><Situacao av={av} compacto /></td>
                        <td className="num" style={{ color: roasSemana == null || !av.empate ? undefined : roasSemana >= av.empate ? "var(--good)" : "var(--bad)" }}>{um(roasSemana)}</td>
                        <td className="num">{um(av.empate)}</td>
                        <td className="num">{vals?.meta ? um(vals.meta) : "—"}</td>
                        <td className="num">{vals?.orcamento ? BRL(vals.orcamento) : "—"}</td>
                      </tr>
                      {aberta === l.chave && (
                        <tr className="linha-detalhe">
                          <td colSpan={6}>
                            <Detalhe
                              l={l}
                              regrasA={regrasA}
                              hoje={hoje}
                              onNovo={() => setPeriodoDlg({ linha: l })}
                              onAjuste={(sug) => setAjusteDlg({ linha: l, ...sug })}
                              onEncerrar={() => setEncerrarDlg({ linha: l })}
                              onExcluir={(periodo) => setExcluirDlg({ periodo, rampa: l.rampa?.r || null })}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {periodoDlg && <PeriodoAdsDialog nome={periodoDlg.linha.item.nome} av={periodoDlg.linha.av} teste={testeDe(periodoDlg.linha)} hoje={hoje} regrasA={regrasA} salvando={salvando} onCancelar={() => setPeriodoDlg(null)} onSalvar={salvarPeriodo} />}
      {ajusteDlg && <AjusteDialog d={ajusteDlg} hoje={hoje} salvando={salvando} onCancelar={() => setAjusteDlg(null)} onSalvar={salvarAjuste} />}
      {encerrarDlg && <EncerrarAdsDialog nome={encerrarDlg.linha.item.nome} teste={encerrarDlg.linha.av.ativo?.tipo === "teste"} hoje={hoje} salvando={salvando} onCancelar={() => setEncerrarDlg(null)} onSalvar={encerrar} />}
      {excluirDlg && (
        <ConfirmDialog
          titulo="Excluir este período de Ads?"
          mensagem={`${dm(excluirDlg.periodo.inicio)}${excluirDlg.periodo.fim ? `–${dm(excluirDlg.periodo.fim)}` : " (ligado)"}. As semanas registradas continuam; só o período (datas, meta, orçamento e ajustes) é apagado.`}
          confirmarLabel="Excluir período"
          perigo
          onConfirm={excluir}
          onCancel={() => setExcluirDlg(null)}
        />
      )}
    </>
  );
}

function Detalhe({ l, regrasA, hoje, onNovo, onAjuste, onEncerrar, onExcluir }) {
  const av = l.av;
  const n = av.numeros || {};
  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
  const historico = l.periodos.map((p) => ({ p, r: resumoPeriodo(p, l.semanas, l.preco, av.empate, regrasA) }));
  const totalDias = av.ativo?.fim ? diasEntre(av.ativo.inicio, av.ativo.fim) + 1 : null;
  const diaAtual = (n.dias ?? 0) + 1;
  const tomRoas = (r) => (r == null || !av.empate ? "" : r >= av.empate ? " bom" : " ruim");
  return (
    <div className="detalhe-cel ads-det">
      <div className={`alerta alerta-${{ resolver: "bad", atencao: "warn", oportunidade: "good" }[av.estado] || "neutro"}`}>
        <b>{av.titulo}</b>
        {av.texto}
      </div>
      {av.ativo && (
        <div className="ads-cartao">
          <div className="ads-periodo">
            <div className="ads-periodo-cab">
              <span className="ads-rotulo">{av.ativo.tipo === "teste" ? "Teste de lançamento" : "Período atual"}</span>
              <b>
                {dm(av.ativo.inicio)} → {av.ativo.fim ? dm(av.ativo.fim) : "sem data final"}
              </b>
              <span className="ads-chips">
                <span className="chip-ads">{vals.orcamento ? `${BRL(vals.orcamento)}/dia` : "sem orçamento"}</span>
                <span className="chip-ads">meta {um(vals.meta)}</span>
                <span className="chip-ads">empate {um(av.empate)}</span>
              </span>
            </div>
            {totalDias ? (
              <div className="ads-barra" title={`dia ${diaAtual} de ${totalDias}`}>
                <div style={{ width: `${Math.min(100, (diaAtual / totalDias) * 100)}%` }} />
                <small>dia {Math.min(diaAtual, totalDias)} de {totalDias}</small>
              </div>
            ) : (
              <small className="muted-cel">dia {diaAtual}</small>
            )}
          </div>
          <div className="ads-metricas">
            <div><span>Gasto</span><b>{BRL(n.gasto || 0)}</b></div>
            <div><span>Vendas via Ads</span><b>{n.vendas || 0}</b></div>
            <div><span>Cliques</span><b>{n.cliques || 0}</b></div>
            <div><span>ROAS</span><b className={`ads-roas${tomRoas(n.roas)}`}>{um(n.roas)}</b></div>
            <div><span>Custo por venda</span><b>{n.custoPorVenda != null ? BRL(n.custoPorVenda) : "—"}</b></div>
          </div>
          {n.roasSemana != null && (
            <div className="ads-semana">
              Última semana: ROAS <b className={`ads-roas${tomRoas(n.roasSemana)}`}>{um(n.roasSemana)}</b> · gastou {BRL(n.gastoSemana)}
              {n.usoOrc != null ? ` (${Math.round(n.usoOrc * 100)}% do orçamento)` : ""}
              {n.organico != null ? ` · ${Math.round(n.organico * 100)}% das vendas orgânicas` : ""}
            </div>
          )}
        </div>
      )}
      <div className="acoes-ads">
        {av.ativo ? (
          <>
            {av.chave === "aumentar" && (
              <button type="button" className="btn btn-mini primary" onClick={() => onAjuste({ orcamento: av.novoOrcamento, meta: vals.meta, motivo: "aumento de 20% (ROAS ≥ meta)" })}>
                Aumentei pra {BRL(av.novoOrcamento)}/dia
              </button>
            )}
            {av.chave === "meta-alta" && (
              <button type="button" className="btn btn-mini primary" onClick={() => onAjuste({ orcamento: vals.orcamento, meta: av.novaMeta, motivo: "meta alta: gastou pouco" })}>
                Baixei a meta pra {um(av.novaMeta)}
              </button>
            )}
            <button type="button" className="btn btn-mini" onClick={() => onAjuste({ orcamento: vals.orcamento, meta: vals.meta })}>
              Registrar ajuste
            </button>
            <button type="button" className="btn btn-mini" onClick={onEncerrar}>
              Encerrar período (pausei)
            </button>
          </>
        ) : (
          <button type="button" className={`btn btn-mini${NAO_RECOMENDA.has(av.chave) ? "" : " primary"}`} onClick={onNovo}>
            + Novo período de Ads
          </button>
        )}
      </div>
      {historico.length > 0 && (
        <div className="historico-ads">
          <div className="ads-rotulo">Histórico de períodos</div>
          <table className="tabela-ads">
            <tbody>
              {historico.map(({ p, r }) => {
                const v = valoresAtuais(p);
                const ativo = periodoLigado(p, hoje);
                const nAj = Array.isArray(p.ajustes) ? p.ajustes.length : 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{dm(p.inicio)}–{p.fim ? dm(p.fim) : "agora"}</b>
                      {ativo && <span className="chip-ads ligado">ligado</span>}
                      {p.nota ? <div className="muted-cel">{p.nota}</div> : null}
                    </td>
                    <td className="muted-cel">
                      {v.orcamento ? `${BRL(v.orcamento)}/dia` : "—"}
                      {v.meta ? ` · meta ${um(v.meta)}` : ""}
                      {nAj > 0 ? ` · ${nAj} ajuste${nAj > 1 ? "s" : ""}` : ""}
                    </td>
                    <td className="num">
                      {BRL(r.gasto)} · {r.vendas} venda{r.vendas === 1 ? "" : "s"} · ROAS <span className={`ads-roas${tomRoas(r.roas)}`}>{um(r.roas)}</span>
                      {r.resultado && !ativo ? <div className="muted-cel">{r.resultado.texto}{p.motivo_fim && p.motivo_fim !== "encerrado" ? ` · ${p.motivo_fim}` : ""}</div> : null}
                    </td>
                    <td className="acao">
                      <button type="button" className="btn-icone" title="Excluir este período" onClick={() => onExcluir(p)}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ margin: "4px 0 0" }}>Os números vêm das semanas registradas: o período que começa no meio da semana é aproximado.</p>
        </div>
      )}
    </div>
  );
}

function AjusteDialog({ d, hoje, salvando, onCancelar, onSalvar }) {
  const [f, setF] = useState({ data: hoje, orcamento: virg(d.orcamento ?? ""), meta: virg(d.meta ?? ""), motivo: d.motivo || "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const empate = d.linha.av.empate;
  return (
    <EditarDialog titulo={`Ajuste de Ads — ${d.linha.item.nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => onSalvar(f)} salvarLabel="Registrar ajuste" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>Registre a mudança que você fez na plataforma. Depois dela, o app volta a esperar uns dias de aprendizado antes de sugerir outra.</p>
      <div className="grid-auto">
        <div className="field"><label>Data</label><input type="date" value={f.data} onChange={set("data")} /></div>
        <div className="field"><label>Orçamento diário (R$)</label><input type="text" inputMode="decimal" value={f.orcamento} onChange={set("orcamento")} /></div>
        <div className="field"><label>Meta de ROAS</label><input type="text" inputMode="decimal" value={f.meta} onChange={set("meta")} /></div>
      </div>
      {empate && f.meta !== "" && num(f.meta) < empate && <div className="alerta alerta-warn"><b>Meta abaixo do empate ({um(empate)})</b>Com essa meta, a Shopee pode vender com prejuízo pra você.</div>}
      <div className="field"><label>Motivo (opcional)</label><input type="text" value={f.motivo} onChange={set("motivo")} /></div>
    </EditarDialog>
  );
}

function RegrasAds({ regrasA, salvando, onSalvar }) {
  const [f, setF] = useState({ aumento: String(Math.round(regrasA.aumento * 100)), teto: String(Math.round(regrasA.tetoLoja * 100)) });
  return (
    <div className="pad-painel">
      <div className="grid-auto">
        <div className="field"><label>Aumento por semana (%)</label><input type="number" min="1" max="100" value={f.aumento} onChange={(e) => setF((p) => ({ ...p, aumento: e.target.value }))} /></div>
        <div className="field"><label>Teto de Ads da loja (% do faturamento)</label><input type="number" min="1" max="100" value={f.teto} onChange={(e) => setF((p) => ({ ...p, teto: e.target.value }))} /></div>
      </div>
      <button type="button" className="btn primary" disabled={salvando} onClick={() => onSalvar(f)}>{salvando ? "Salvando…" : "Salvar regras"}</button>
    </div>
  );
}
