import { Fragment, useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { andamentoValido, periodoLigado, resumoPeriodo, valoresAtuais } from "../lib/ads.js";
import { adsPorItemApp, lerRelatorio } from "../lib/relatorioShopee.js";
import { hojeSP } from "../lib/datas.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { EncerrarAdsDialog, NAO_RECOMENDA, PeriodoAdsDialog } from "./AdsPeriodoDialogs.jsx";
import { ajustarPeriodoAds, encerrarPeriodoAds, excluirPeriodoAds, iniciarPeriodoAds, salvarAndamentoAds } from "../lib/adsAcoes.js";
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
  const [andamentoDlg, setAndamentoDlg] = useState(false);
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

  async function salvarAndamento(lista) {
    setSalvando(true);
    let n = 0;
    for (const x of lista) {
      const r = await salvarAndamentoAds(x.periodo, x.valores);
      if (!r.ok) {
        setSalvando(false);
        onToast(r.msg);
        return;
      }
      n++;
    }
    window.dispatchEvent(new Event("focus")); // recarrega os períodos sem esperar o realtime
    setSalvando(false);
    setAndamentoDlg(false);
    onToast(n ? `Andamento atualizado em ${n} produto${n > 1 ? "s" : ""}` : "Nada pra atualizar");
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
          {ligados > 0 && (
            <button type="button" className="btn btn-mini" onClick={() => setAndamentoDlg(true)} title="Ver como está o Ads no meio do período, sem encerrar nada">
              Atualizar andamento
            </button>
          )}
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
      {andamentoDlg && (
        <AndamentoDialog
          linhas={linhasAds.linhas.filter((l) => l.av.ativo)}
          hoje={hoje}
          salvando={salvando}
          onCancelar={() => setAndamentoDlg(false)}
          onSalvar={salvarAndamento}
          onToast={onToast}
        />
      )}
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
  const andamento = av.ativo ? andamentoValido(av.ativo, l.semanas) : null;
  const roasAnd = andamento && andamento.gasto > 0 ? (andamento.vendas * l.preco) / andamento.gasto : null;
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
          {andamento && (
            <div className="ads-andamento">
              <span className="ads-rotulo">Andamento até {dm(andamento.ate)}</span>
              <span>
                gasto <b>{BRL(andamento.gasto)}</b> · <b>{andamento.vendas}</b> venda{andamento.vendas === 1 ? "" : "s"} via Ads · {andamento.cliques} cliques · ROAS{" "}
                <b className={`ads-roas${tomRoas(roasAnd)}`}>{um(roasAnd)}</b>
                {andamento.custoPorVenda != null ? ` · ${BRL(andamento.custoPorVenda)} por venda` : ""}
              </span>
              <span className="muted-cel">acumulado desde {dm(av.ativo.inicio)}, informado por você — só pra acompanhar; a avaliação usa as semanas registradas</span>
            </div>
          )}
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

// Andamento do Ads (v48): números ACUMULADOS desde o início de cada período
// ligado, até a data escolhida — à mão ou pelo CSV do Shopee Ads (todos de
// uma vez). Cada envio substitui o anterior; não encerra nada nem decide nada.
function AndamentoDialog({ linhas, hoje, salvando, onCancelar, onSalvar, onToast }) {
  const ontem = (() => {
    const d = new Date(`${hoje || hojeSP()}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [ate, setAte] = useState(ontem);
  const [vals, setVals] = useState(() =>
    Object.fromEntries(
      linhas.map((l) => {
        const a = andamentoValido(l.av.ativo, l.semanas);
        return [l.chave, a ? { gasto: virg(a.gasto), cliques: String(a.cliques), vendas: String(a.vendas) } : { gasto: "", cliques: "", vendas: "" }];
      })
    )
  );
  const [doCsv, setDoCsv] = useState(() => new Set());
  const [avisos, setAvisos] = useState([]);
  const [lendo, setLendo] = useState(false);
  const set = (chave, k) => (e) => setVals((p) => ({ ...p, [chave]: { ...p[chave], [k]: e.target.value } }));

  async function importar(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (!arquivos.length) return;
    setLendo(true);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      const shopee = linhas.filter((l) => l.canal.tipo === "shopee");
      const res = adsPorItemApp(lidos, shopee.map((l) => ({ chave: l.chave, sku: l.item.sku })));
      const marc = new Set();
      setVals((p) => {
        const n = { ...p };
        for (const l of shopee) {
          const x = res.porChave[l.chave];
          // Sem linha no CSV (e SKU já conhecido) = sem gasto no período exportado.
          if (x) n[l.chave] = { gasto: virg(x.gasto), cliques: String(x.cliques), vendas: String(x.vendas) };
          else if (res.zerados.includes(l.chave)) n[l.chave] = { gasto: "0", cliques: "0", vendas: "0" };
          else continue;
          marc.add(l.chave);
        }
        return n;
      });
      setDoCsv(marc);
      if (res.periodo?.ate) setAte(res.periodo.ate);
      const av = [...res.avisos];
      if (res.periodo?.de)
        for (const l of shopee)
          if (res.periodo.de > l.av.ativo.inicio)
            av.push(`${l.item.nome}: o CSV começa em ${dm(res.periodo.de)}, mas o período de Ads começou em ${dm(l.av.ativo.inicio)} — exporte desde o início do período (o andamento é acumulado).`);
      for (const a of res.adsSemPar.filter((x) => x.conhecido)) av.push(`Anúncio ${a.nome || a.itemId}: ${BRL(a.gasto)} de Ads, mas o produto não está com período de Ads ligado no app.`);
      setAvisos(av);
    } catch (err) {
      onToast?.(err.message || "Não foi possível ler o arquivo");
    } finally {
      setLendo(false);
    }
  }

  function salvar() {
    const lista = [];
    for (const l of linhas) {
      const v = vals[l.chave];
      if (!v || [v.gasto, v.cliques, v.vendas].every((x) => x === "")) continue;
      lista.push({ periodo: l.av.ativo, valores: { ate, gasto: num(v.gasto), cliques: Math.round(num(v.cliques)), vendas: Math.round(num(v.vendas)) } });
    }
    onSalvar(lista);
  }

  return (
    <EditarDialog titulo="Atualizar andamento do Ads" classe="modal-andamento" salvando={salvando} onCancelar={onCancelar} onSalvar={salvar} salvarLabel="Salvar andamento">
      <p className="hint" style={{ marginTop: 0 }}>
        Números <b>acumulados desde o início</b> de cada período de Ads até a data abaixo. Cada envio <b>substitui</b> o anterior (nunca soma). Não encerra o período e não
        muda nenhuma decisão — a avaliação continua pelas semanas registradas, e o Registrar semana já vem com o que faltar.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Até (inclusive)</label>
          <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} />
        </div>
        <label className="btn btn-mini" style={{ cursor: "pointer" }}>
          {lendo ? "Lendo…" : "📄 Importar CSV do Shopee Ads"}
          <input type="file" accept=".csv,.xlsx" multiple hidden onChange={importar} />
        </label>
        <Ajuda texto="Shopee: Marketing → Shopee Ads → escolha o período DO INÍCIO do período de Ads até ontem → Exportar dados → Dados Gerais de Anúncios. O app liga cada anúncio ao produto pelo SKU — se pedir, importe junto (uma vez) o relatório de desempenho do produto; depois ele lembra." />
      </div>
      {avisos.map((a) => (
        <div key={a} className="alerta alerta-warn" style={{ margin: "0 0 8px" }}>{a}</div>
      ))}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Gasto (R$)</th>
              <th className="num">Cliques</th>
              <th className="num">Vendas via Ads</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const v = vals[l.chave] || {};
              const cls = doCsv.has(l.chave) ? "campo-importado" : undefined;
              const a = andamentoValido(l.av.ativo, l.semanas);
              return (
                <tr key={l.chave}>
                  <td style={{ minWidth: 200 }}>
                    <b>{l.item.nome}</b> <CanalTag canal={l.canal} />
                    <div className="muted-cel">
                      período desde {dm(l.av.ativo.inicio)}
                      {a ? ` · último andamento até ${dm(a.ate)}` : ""}
                    </div>
                  </td>
                  <td className="num"><input type="text" inputMode="decimal" className={cls} style={{ width: 90 }} value={v.gasto ?? ""} onChange={set(l.chave, "gasto")} /></td>
                  <td className="num"><input type="text" inputMode="numeric" className={cls} style={{ width: 70 }} value={v.cliques ?? ""} onChange={set(l.chave, "cliques")} /></td>
                  <td className="num"><input type="text" inputMode="numeric" className={cls} style={{ width: 70 }} value={v.vendas ?? ""} onChange={set(l.chave, "vendas")} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </EditarDialog>
  );
}
