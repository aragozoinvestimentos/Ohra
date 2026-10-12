import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { metaSugerida, resumoPeriodo, valoresAtuais } from "../lib/ads.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import EditarDialog from "./EditarDialog.jsx";
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
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const ORDEM = { resolver: 0, atencao: 1, oportunidade: 2, decisao: 3, info: 4, ok: 5 };
const NAO_RECOMENDA = new Set(["nao-viavel", "arrumar", "aguardar", "sem-necessidade"]);

function Situacao({ av, compacto }) {
  if (av.estado === "ok") return <span className={compacto ? "muted-cel" : undefined}>✓ {av.titulo}</span>;
  return <Estado tipo={av.estado}>{av.titulo}</Estado>;
}

export default function AdsCrescimento({ linhasAds, adsH, regrasA, hoje, canais, onToast, podeRegistrar, onRegistrar }) {
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

  async function gravar(fn, ok) {
    setSalvando(true);
    const { error } = await fn();
    setSalvando(false);
    if (error) return onToast?.(/ads_periodos|schema cache|does not exist/.test(error.message) ? "Falta rodar o supabase/schema_v44.sql no Supabase" : `Não foi possível salvar: ${error.message}`), false;
    window.dispatchEvent(new Event("focus"));
    onToast?.(ok);
    return true;
  }

  async function salvarPeriodo(f) {
    const l = periodoDlg.linha;
    const linha = {
      loja_id: lojaId || null,
      item_tipo: l.tipo,
      item_id: l.id,
      canal_id: l.canal.id,
      inicio: f.inicio,
      fim: f.fim || null,
      orcamento_diario: f.orcamento === "" ? null : num(f.orcamento),
      meta_roas: f.meta === "" ? null : num(f.meta),
      nota: f.nota || null,
    };
    if (await gravar(() => supabase.from("ads_periodos").insert(linha), `Período de Ads iniciado: ${l.item.nome}`)) setPeriodoDlg(null);
  }

  async function salvarAjuste(f) {
    const p = ajusteDlg.linha.av.ativo;
    const ajustes = [...(Array.isArray(p.ajustes) ? p.ajustes : []), { data: f.data, orcamento: f.orcamento === "" ? null : num(f.orcamento), meta: f.meta === "" ? null : num(f.meta), motivo: f.motivo || null }];
    if (await gravar(() => supabase.from("ads_periodos").update({ ajustes }).eq("id", p.id), "Ajuste registrado — a Shopee reaprende uns dias")) setAjusteDlg(null);
  }

  async function encerrar(f) {
    const p = encerrarDlg.linha.av.ativo;
    if (await gravar(() => supabase.from("ads_periodos").update({ fim: f.fim, motivo_fim: f.motivo || null }).eq("id", p.id), "Período encerrado — lembre de pausar na plataforma")) setEncerrarDlg(null);
  }

  async function excluir() {
    if (await gravar(() => supabase.from("ads_periodos").delete().eq("id", excluirDlg.periodo.id), "Período excluído")) setExcluirDlg(null);
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
                              onExcluir={(periodo) => setExcluirDlg({ periodo })}
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

      {periodoDlg && <PeriodoDialog l={periodoDlg.linha} hoje={hoje} regrasA={regrasA} salvando={salvando} onCancelar={() => setPeriodoDlg(null)} onSalvar={salvarPeriodo} />}
      {ajusteDlg && <AjusteDialog d={ajusteDlg} hoje={hoje} salvando={salvando} onCancelar={() => setAjusteDlg(null)} onSalvar={salvarAjuste} />}
      {encerrarDlg && <EncerrarDialog l={encerrarDlg.linha} hoje={hoje} salvando={salvando} onCancelar={() => setEncerrarDlg(null)} onSalvar={encerrar} />}
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
  return (
    <div className="detalhe-cel">
      <div className={`alerta alerta-${{ resolver: "bad", atencao: "warn", oportunidade: "good" }[av.estado] || "neutro"}`}>
        <b>{av.titulo}</b>
        {av.texto}
      </div>
      {av.ativo && (
        <div className="kv-ads">
          <span>Período</span>
          <b>
            desde {dm(av.ativo.inicio)} · dia {(n.dias ?? 0) + 1}
            {av.ativo.fim ? ` · até ${dm(av.ativo.fim)}` : " · sem data final"}
          </b>
          <span>Orçamento / meta</span>
          <b>
            {vals.orcamento ? `${BRL(vals.orcamento)}/dia` : "—"} · meta {um(vals.meta)} · empate {um(av.empate)}
          </b>
          <span>No período</span>
          <b>
            gasto {BRL(n.gasto || 0)} · {n.vendas || 0} venda{n.vendas === 1 ? "" : "s"} via Ads · {n.cliques || 0} cliques · ROAS {um(n.roas)}
            {n.custoPorVenda != null ? ` · ${BRL(n.custoPorVenda)} por venda` : ""}
          </b>
          {n.roasSemana != null && (
            <>
              <span>Última semana</span>
              <b>
                ROAS {um(n.roasSemana)} · gastou {BRL(n.gastoSemana)}
                {n.usoOrc != null ? ` (${Math.round(n.usoOrc * 100)}% do orçamento)` : ""}
                {n.organico != null ? ` · ${Math.round(n.organico * 100)}% das vendas orgânicas` : ""}
              </b>
            </>
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
          <b>Períodos</b>
          {historico.map(({ p, r }) => {
            const v = valoresAtuais(p);
            const ativo = !p.fim || p.fim >= hoje;
            return (
              <div key={p.id} className="historico-ads-linha">
                <span>
                  {dm(p.inicio)}–{p.fim ? dm(p.fim) : "agora"}
                  {p.nota ? ` · ${p.nota}` : ""}
                </span>
                <span className="muted-cel">
                  {v.orcamento ? `${BRL(v.orcamento)}/dia` : ""}
                  {v.meta ? ` · meta ${um(v.meta)}` : ""}
                  {(Array.isArray(p.ajustes) ? p.ajustes.length : 0) > 0 ? ` · ${p.ajustes.length} ajuste${p.ajustes.length > 1 ? "s" : ""}` : ""}
                </span>
                <span>
                  gasto {BRL(r.gasto)} · {r.vendas} venda{r.vendas === 1 ? "" : "s"} · ROAS {um(r.roas)}
                  {r.resultado && !ativo ? ` · ${r.resultado.texto}` : ""}
                  {p.motivo_fim ? <span className="muted-cel"> · {p.motivo_fim}</span> : null}
                </span>
                <button type="button" className="btn-icone" title="Excluir este período" onClick={() => onExcluir(p)}>×</button>
              </div>
            );
          })}
          <p className="hint" style={{ margin: "4px 0 0" }}>Os números vêm das semanas registradas: o período que começa no meio da semana é aproximado.</p>
        </div>
      )}
    </div>
  );
}

function PeriodoDialog({ l, hoje, regrasA, salvando, onCancelar, onSalvar }) {
  const av = l.av;
  const [f, setF] = useState({ inicio: hoje, orcamento: String(regrasA.minDiario), meta: av.empate ? virg(metaSugerida(av.empate)) : "", fim: "", nota: "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const metaBaixa = av.empate && f.meta !== "" && num(f.meta) < av.empate;
  return (
    <EditarDialog titulo={`Novo período de Ads — ${l.item.nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => (f.inicio ? onSalvar(f) : null)} salvarLabel="Iniciar período" classe="modal-box-md">
      {NAO_RECOMENDA.has(av.chave) && (
        <div className="alerta alerta-warn">
          <b>O app não recomenda agora: {av.titulo}</b>
          {av.texto} Dá pra iniciar mesmo assim, a decisão é sua.
        </div>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        Registre o que você configurou na plataforma. Os 7 primeiros dias são de aprendizado: o app não sugere mexer. Empate deste produto: ROAS {um(av.empate)}.
      </p>
      <div className="grid-auto">
        <div className="field"><label>Início</label><input type="date" value={f.inicio} onChange={set("inicio")} /></div>
        <div className="field"><label>Orçamento diário (R$)</label><input type="text" inputMode="decimal" value={f.orcamento} onChange={set("orcamento")} /></div>
        <div className="field"><label>Meta de ROAS</label><input type="text" inputMode="decimal" value={f.meta} onChange={set("meta")} placeholder={av.empate ? virg(metaSugerida(av.empate)) : ""} /></div>
        <div className="field"><label>Fim (opcional)</label><input type="date" value={f.fim} onChange={set("fim")} /></div>
      </div>
      {metaBaixa && <div className="alerta alerta-warn"><b>Meta abaixo do empate ({um(av.empate)})</b>Com essa meta, a Shopee pode vender com prejuízo pra você.</div>}
      {num(f.orcamento) > 0 && num(f.orcamento) < regrasA.minDiario && <div className="alerta alerta-warn"><b>Abaixo do mínimo da Shopee</b>A Shopee exige no mínimo {BRL(regrasA.minDiario)}/dia.</div>}
      <div className="field"><label>Observação (opcional)</label><input type="text" value={f.nota} onChange={set("nota")} placeholder="ex.: GMV Max, meta de ROAS" /></div>
    </EditarDialog>
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

function EncerrarDialog({ l, hoje, salvando, onCancelar, onSalvar }) {
  const [f, setF] = useState({ fim: hoje, motivo: "" });
  return (
    <EditarDialog titulo={`Encerrar Ads — ${l.item.nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => (f.fim ? onSalvar(f) : null)} salvarLabel="Encerrar período" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>Marque o dia em que pausou na plataforma. O período fica no histórico com o resultado.</p>
      <div className="grid-auto">
        <div className="field"><label>Pausei em</label><input type="date" value={f.fim} onChange={(e) => setF((p) => ({ ...p, fim: e.target.value }))} /></div>
        <div className="field"><label>Motivo (opcional)</label><input type="text" value={f.motivo} onChange={(e) => setF((p) => ({ ...p, motivo: e.target.value }))} placeholder="ex.: ROAS abaixo do empate" /></div>
      </div>
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
