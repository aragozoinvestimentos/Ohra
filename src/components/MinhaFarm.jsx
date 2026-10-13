import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useManutencoes } from "../hooks/useManutencoes.js";
import { itensDaImpressora, textoPrazo } from "../lib/manutencao.js";
import ManutencaoImpressora from "./ManutencaoImpressora.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useEscada } from "../hooks/useEscada.js";
import { useFarmAlteracoes } from "../hooks/useFarmAlteracoes.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { custoHora, desgaste, impressoraDoProduto, VIDA_UTIL_PADRAO, ehGrave, AVISO_DESGASTE } from "../lib/farm.js";
import { pioraDaFarm } from "../lib/farmImpacto.js";
import { hojeSP } from "../lib/datas.js";
import { irParaAba, pegarPedido } from "../lib/navegar.js";
import { BRL } from "../lib/format.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import EditarDialog from "./EditarDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Gestão → Minha farm (schema v47): impressoras + config da farm, num lugar
// só. O custo da máquina em todos os produtos vem daqui (lib/farm.js →
// produto._maquina). Salvar algo que muda custo NUNCA mexe em preço salvo,
// riscado ou promo: compara antes × depois (lib/farmImpacto.js) e, se algum
// item piorou de verdade, grava UM registro em farm_alteracoes → aviso no Início.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const horas = (v) => Math.round(v).toLocaleString("pt-BR");
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const mesAno = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "—");

const NOVA = { nome: "", valor_pago: "", vida_util_horas: String(VIDA_UTIL_PADRAO), horas_iniciais: "0", data_cadastro: "", potencia_w: "", manutencao_hora: "0" };

export default function MinhaFarm({ onToast }) {
  const { lojaId } = useLoja();
  const { impressoras, farmConfig, carregando } = useCatalogo();
  const dados = useEscada();
  const { alteracoes, disponivel: altDisponivel } = useFarmAlteracoes();
  const hoje = hojeSP();
  const [cfgForm, setCfgForm] = useState(null); // null = não editando
  const [dlg, setDlg] = useState(null); // { id?, form }
  const [confirmar, setConfirmar] = useState(null); // { titulo, mensagem, acao }
  const [salvando, setSalvando] = useState(false);
  const refAlt = useRef(null);
  const manutH = useManutencoes();
  const [aberta, setAberta] = useState(null); // impressora com a manutenção aberta

  // "Ver produtos" vindo do Início → rola até a lista do custo que subiu.
  useEffect(() => {
    const aplicar = (p) => {
      if (p?.alteracoes) setTimeout(() => refAlt.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      // "Abrir lista" da manutenção vindo do Início → abre a impressora.
      if (p?.manutencao) {
        setAberta(p.manutencao);
        setTimeout(() => document.getElementById(`manut-${p.manutencao}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
      }
    };
    aplicar(pegarPedido("farm"));
    const ouvir = (e) => e.detail.aba === "farm" && aplicar(pegarPedido("farm"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);

  const cfg = farmConfig;
  const ativas = impressoras.filter((i) => i.ativa !== false);
  const padrao = ativas.find((i) => i.padrao) || ativas[0] || null;
  const usoPorImpressora = useMemo(() => {
    const m = new Map();
    for (const p of dados.produtos) {
      const imp = impressoraDoProduto(p, impressoras);
      if (imp) m.set(imp.id, (m.get(imp.id) || 0) + 1);
    }
    return m;
  }, [dados.produtos, impressoras]);
  const pendentes = alteracoes.filter((a) => !a.revisado);
  const listaPendente = useMemo(() => {
    const m = new Map();
    for (const a of pendentes) for (const x of Array.isArray(a.produtos) ? a.produtos : []) m.set(`${x.id}|${x.canal_id}`, x);
    return [...m.values()].sort((a, b) => Number(ehGrave(b.motivo)) - Number(ehGrave(a.motivo)) || a.nome.localeCompare(b.nome));
  }, [pendentes]);

  if (!supabase) return <div className="panel"><div className="empty">Sem conexão com o banco.</div></div>;
  if (carregando) return <div className="panel"><div className="empty">Carregando…</div></div>;

  // Grava a mudança e, se o custo subiu a ponto de preocupar, registra UM aviso.
  async function aplicarMudanca({ impressorasNovas, cfgNovo, gravar, descricao, ok }) {
    setSalvando(true);
    const r = cfgNovo ? pioraDaFarm({ dados, impressoras: impressorasNovas, cfg: cfgNovo }) : { piores: [], subiu: 0, caiu: 0 };
    const erro = await gravar();
    if (erro) {
      setSalvando(false);
      onToast(`Não foi possível salvar: ${erro.message}`);
      return false;
    }
    let extra = "";
    if (r.piores.length) {
      const { error } = await supabase.from("farm_alteracoes").insert({ loja_id: lojaId, descricao, produtos: r.piores });
      extra = error ? ` · não deu pra gravar o aviso (${error.message})` : ` · custo subiu: ${r.piores.length} item(ns) pra revisar no Início`;
      window.dispatchEvent(new Event("focus")); // recarrega farm_alteracoes sem esperar o realtime
    } else if (r.subiu) extra = " · custo subiu um pouco, sem item abaixo do mínimo";
    else if (r.caiu) extra = " · custo caiu, margens atualizadas";
    recarregarCatalogo();
    setSalvando(false);
    onToast(`${ok}${extra}`);
    return true;
  }

  // ---- Config da farm ----
  async function salvarCfg() {
    const novo = { loja_id: lojaId, horas_dia_operacao: num(cfgForm.horas), tarifa_kwh: num(cfgForm.tarifa), atualizado_em: new Date().toISOString() };
    // Espalhar a manutenção de várias impressoras (v50) — só manda se mudou.
    if (cfgForm.espaco !== "" && Math.round(num(cfgForm.espaco)) !== (cfg?.manutencao_espaco_dias ?? 3)) novo.manutencao_espaco_dias = Math.max(1, Math.round(num(cfgForm.espaco)));
    const ok = await aplicarMudanca({
      impressorasNovas: impressoras,
      cfgNovo: novo,
      descricao: `Tarifa do kWh ${virg(cfg?.tarifa_kwh)} → ${virg(novo.tarifa_kwh)}`,
      ok: "Farm salva",
      gravar: async () => (await supabase.from("farm_config").upsert(novo, { onConflict: "loja_id" })).error,
    });
    if (ok) setCfgForm(null);
  }

  // ---- Impressora ----
  function abrirNova() {
    setDlg({ form: { ...NOVA, nome: `Impressora ${impressoras.length + 1}`, data_cadastro: hoje, potencia_w: padrao ? String(padrao.potencia_w) : "" } });
  }
  function abrirEditar(i) {
    setDlg({
      id: i.id,
      form: {
        nome: i.nome,
        valor_pago: virg(i.valor_pago),
        vida_util_horas: virg(i.vida_util_horas),
        horas_iniciais: virg(i.horas_iniciais),
        data_cadastro: i.data_cadastro || hoje,
        potencia_w: virg(i.potencia_w),
        manutencao_hora: virg(i.manutencao_hora),
      },
    });
  }
  async function salvarImpressora() {
    const f = dlg.form;
    if (!f.nome.trim()) return onToast("Dê um nome à impressora");
    if (!(num(f.vida_util_horas) > 0)) return onToast("Vida útil precisa ser maior que zero");
    const campos = {
      nome: f.nome.trim(),
      valor_pago: num(f.valor_pago),
      vida_util_horas: num(f.vida_util_horas),
      horas_iniciais: num(f.horas_iniciais),
      data_cadastro: f.data_cadastro || hoje,
      potencia_w: num(f.potencia_w),
      manutencao_hora: num(f.manutencao_hora),
    };
    const primeira = !impressoras.length;
    const novaLista = dlg.id ? impressoras.map((i) => (i.id === dlg.id ? { ...i, ...campos } : i)) : [...impressoras, { id: "nova", ...campos, ativa: true, padrao: primeira }];
    const ok = await aplicarMudanca({
      impressorasNovas: novaLista,
      cfgNovo: cfg || { horas_dia_operacao: 6, tarifa_kwh: 1.05 },
      descricao: dlg.id ? `${campos.nome} editada` : `${campos.nome} cadastrada`,
      ok: dlg.id ? "Impressora salva" : "Impressora cadastrada",
      gravar: async () => {
        if (!cfg) await supabase.from("farm_config").upsert({ loja_id: lojaId }, { onConflict: "loja_id" });
        const r = dlg.id
          ? await supabase.from("impressoras").update(campos).eq("id", dlg.id)
          : await supabase.from("impressoras").insert({ ...campos, loja_id: lojaId, padrao: primeira, ativa: true });
        return r.error;
      },
    });
    if (ok) setDlg(null);
  }
  async function tornarPadrao(i) {
    const novaLista = impressoras.map((x) => ({ ...x, padrao: x.id === i.id }));
    await aplicarMudanca({
      impressorasNovas: novaLista,
      cfgNovo: cfg,
      descricao: `${i.nome} virou a impressora padrão`,
      ok: `${i.nome} é a padrão agora`,
      gravar: async () => {
        const r1 = await supabase.from("impressoras").update({ padrao: false }).eq("loja_id", lojaId).neq("id", i.id);
        if (r1.error) return r1.error;
        return (await supabase.from("impressoras").update({ padrao: true }).eq("id", i.id)).error;
      },
    });
  }
  async function alternarAtiva(i) {
    const ativa = i.ativa === false;
    const novaLista = impressoras.map((x) => (x.id === i.id ? { ...x, ativa } : x));
    await aplicarMudanca({
      impressorasNovas: novaLista,
      cfgNovo: cfg,
      descricao: `${i.nome} ${ativa ? "reativada" : "desativada"}`,
      ok: ativa ? "Impressora reativada" : "Impressora desativada — os produtos dela passam a usar a padrão",
      gravar: async () => (await supabase.from("impressoras").update({ ativa }).eq("id", i.id)).error,
    });
    setConfirmar(null);
  }
  async function marcarRevisado() {
    const ids = pendentes.map((a) => a.id);
    const { error } = await supabase.from("farm_alteracoes").update({ revisado: true }).in("id", ids);
    window.dispatchEvent(new Event("focus"));
    onToast(error ? `Não foi possível marcar: ${error.message}` : "Ok, revisado — o aviso saiu do Início");
  }

  const hPadrao = padrao && cfg ? custoHora(padrao, cfg) : null;

  return (
    <>
      <Kpis
        itens={[
          { label: "Impressoras ativas", valor: String(ativas.length), sub: padrao ? `padrão: ${padrao.nome}` : "cadastre a primeira" },
          { label: "Custo por hora (padrão)", valor: hPadrao ? BRL(hPadrao.total) : "—", sub: hPadrao ? `máquina ${BRL(hPadrao.maquina)} · energia ${BRL(hPadrao.energia)}${hPadrao.manutencao ? ` · manut. ${BRL(hPadrao.manutencao)}` : ""}` : "" },
          { label: "Operação", valor: cfg ? `${virg(cfg.horas_dia_operacao)} h/dia` : "—", sub: "só pra estimar desgaste" },
          { label: "Tarifa", valor: cfg ? `${BRL(cfg.tarifa_kwh)}/kWh` : "—", sub: "energia de todas as impressoras" },
        ]}
      />

      {pendentes.length > 0 && (
        <div className="panel" ref={refAlt}>
          <h3 className="section-title">
            Custo da farm subiu — revisar
            <Ajuda texto="Nada foi mudado nos preços: o preço salvo, o riscado e a promo continuam iguais. Aqui ficam só os itens que, com o custo novo, ficaram abaixo do mínimo ou perderam 20% ou mais do lucro. Pra ajustar, edite o preço salvo em Produtos precificados — na Anunciar o preço original (riscado) fica fixo e só a promo muda." />
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Canal</th>
                  <th className="num">Custo antes → depois</th>
                  <th className="num">Lucro no preço salvo</th>
                  <th>Motivo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listaPendente.map((x) => (
                  <tr key={`${x.id}|${x.canal_id}`}>
                    <td>{x.nome}</td>
                    <td><CanalTag canal={dados.canais.find((c) => c.id === x.canal_id)} nome={x.canal_nome} /></td>
                    <td className="num">{BRL(x.custo_antes)} → <b>{BRL(x.custo_depois)}</b></td>
                    <td className="num">{BRL(x.lucro_antes)} → <b style={{ color: x.lucro_depois < 0 ? "var(--bad)" : undefined }}>{BRL(x.lucro_depois)}</b></td>
                    <td><span className={`st st-${ehGrave(x.motivo) ? "resolver" : "atencao"}`}>{ehGrave(x.motivo) ? "!" : "⚠"} {x.motivo}</span></td>
                    <td className="num">
                      <button type="button" className="link-btn" onClick={() => irParaAba("historico", { busca: x.nome.split(" — ")[0] })}>
                        ajustar pela promo →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pad-painel" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn primary" onClick={marcarRevisado}>ok, revisado</button>
            <span className="hint" style={{ margin: 0 }}>Os números são do dia da mudança; o lucro de hoje está em Produtos precificados.</span>
          </div>
        </div>
      )}

      <div className="panel">
        <h3 className="section-title">
          Impressoras
          <Ajuda texto="Custo por hora = valor pago ÷ vida útil (+ energia + manutenção por hora). É isso que entra no custo de cada produto: tempo de impressão × custo/hora da impressora dele. As horas por dia NÃO mudam o custo — servem só pra estimar o desgaste. Depois da vida útil o custo continua sendo cobrado: vira o fundo da próxima máquina." />
          <button type="button" className="btn btn-mini primary" style={{ marginLeft: "auto" }} onClick={abrirNova}>+ Impressora</button>
        </h3>
        {!impressoras.length ? (
          <div className="empty">Nenhuma impressora cadastrada. Sem impressora, o custo da máquina continua pela conta antiga (campos do detalhamento de cada produto).</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Impressora</th>
                  <th className="num">Custo/hora</th>
                  <th>Uso estimado</th>
                  <th className="num">Vida útil acaba</th>
                  <th className="num">Produtos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {impressoras.map((i) => {
                  const h = cfg ? custoHora(i, cfg) : null;
                  const d = cfg ? desgaste(i, cfg, hoje) : null;
                  const inativa = i.ativa === false;
                  const manut = cfg && manutH.disponivel && !inativa ? itensDaImpressora(i, manutH.registros, { impressoras, cfg, hoje }) : null;
                  const prox = manut?.length ? Math.min(...manut.map((x) => x.faltam)) : null;
                  return (
                    <Fragment key={i.id}>
                    <tr className="linha-clicavel" style={inativa ? { opacity: 0.55 } : undefined} onClick={() => setAberta(aberta === i.id ? null : i.id)} title="Clique pra ver a manutenção">
                      <td>
                        <b>{i.nome}</b>
                        {i.padrao && !inativa && <span className="chip-ads ligado">padrão</span>}
                        {inativa && <span className="chip-ads">desativada</span>}
                        <div className="muted-cel">
                          {BRL(i.valor_pago)} · {horas(i.vida_util_horas)} h · {virg(i.potencia_w)} W
                        </div>
                        {prox != null && (
                          <div className={prox <= 3 ? "st st-atencao" : "muted-cel"} style={{ marginTop: 3 }}>
                            {prox <= 3 ? "⚠ " : "▸ "}manutenção {textoPrazo(prox)}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <b>{h ? BRL(h.total) : "—"}</b>
                        {h && <div className="muted-cel">máq. {BRL(h.maquina)} · energia {BRL(h.energia)}{h.manutencao ? ` · manut. ${BRL(h.manutencao)}` : ""}</div>}
                      </td>
                      <td style={{ minWidth: 190 }}>
                        {d ? (
                          <>
                            <div className="farm-barra" title={`${Math.round(d.pct * 100)}% da vida útil`}>
                              <div className={d.pct >= 1 ? "fim" : d.pct >= AVISO_DESGASTE ? "alerta" : ""} style={{ width: `${Math.min(100, d.pct * 100)}%` }} />
                            </div>
                            <div className="muted-cel">{horas(d.horas)} de {horas(d.vida)} h · {Math.round(d.pct * 100)}%</div>
                          </>
                        ) : "—"}
                      </td>
                      <td className="num">
                        {d ? (d.pct >= 1 ? <span className="muted-cel">já passou — custo/hora vai pro fundo da próxima</span> : <>≈ {mesAno(d.fimVida)}<div className="muted-cel">aí o valor pago já voltou</div></>) : "—"}
                      </td>
                      <td className="num">{usoPorImpressora.get(i.id) || 0}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-mini" onClick={() => abrirEditar(i)}>✎ editar</button>{" "}
                        {!i.padrao && !inativa && <button type="button" className="btn btn-mini" disabled={salvando} onClick={() => tornarPadrao(i)}>tornar padrão</button>}{" "}
                        {!i.padrao && (
                          <button
                            type="button"
                            className="btn btn-mini"
                            disabled={salvando}
                            onClick={() =>
                              inativa
                                ? alternarAtiva(i)
                                : setConfirmar({
                                    titulo: `Desativar ${i.nome}?`,
                                    mensagem: `${usoPorImpressora.get(i.id) || 0} produto(s) usam esta impressora — passam a usar a padrão (${padrao?.nome || "—"}). Nenhum preço muda.`,
                                    acao: () => alternarAtiva(i),
                                  })
                            }
                          >
                            {inativa ? "reativar" : "desativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {aberta === i.id && (
                      <tr className="linha-detalhe" id={`manut-${i.id}`}>
                        <td colSpan={6}>
                          <ManutencaoImpressora imp={i} impressoras={impressoras} cfg={cfg} hoje={hoje} manutH={manutH} lojaId={lojaId} onToast={onToast} />
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

      <div className="panel">
        <h3 className="section-title">
          Dados gerais da farm
          <Ajuda texto="Horas de operação por dia: quanto as impressoras rodam em média — só pra estimar o desgaste e quando a vida útil acaba (não entra no custo). Tarifa do kWh: vale pra energia de todas as impressoras." />
        </h3>
        {cfgForm ? (
          <div className="pad-painel">
            <div className="grid-auto">
              <div className="field"><label>Horas de operação por dia</label><input type="text" inputMode="decimal" value={cfgForm.horas} onChange={(e) => setCfgForm((p) => ({ ...p, horas: e.target.value }))} /></div>
              <div className="field"><label>Tarifa do kWh (R$)</label><input type="text" inputMode="decimal" value={cfgForm.tarifa} onChange={(e) => setCfgForm((p) => ({ ...p, tarifa: e.target.value }))} /></div>
              <div className="field"><label>Manutenção: espalhar as impressoras de quantos em quantos dias</label><input type="text" inputMode="numeric" value={cfgForm.espaco} onChange={(e) => setCfgForm((p) => ({ ...p, espaco: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn primary" disabled={salvando} onClick={salvarCfg}>{salvando ? "Salvando…" : "Salvar"}</button>
              <button type="button" className="btn" onClick={() => setCfgForm(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="pad-painel" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span>Operação: <b>{cfg ? `${virg(cfg.horas_dia_operacao)} h/dia` : "—"}</b></span>
            <span>Tarifa: <b>{cfg ? `${BRL(cfg.tarifa_kwh)}/kWh` : "—"}</b></span>
            {ativas.length > 1 && <span>Manutenção espalhada de <b>{cfg?.manutencao_espaco_dias ?? 3}</b> em {cfg?.manutencao_espaco_dias ?? 3} dias</span>}
            <button type="button" className="btn btn-mini" onClick={() => setCfgForm({ horas: virg(cfg?.horas_dia_operacao ?? 6), tarifa: virg(cfg?.tarifa_kwh ?? 1.05), espaco: String(cfg?.manutencao_espaco_dias ?? 3) })}>✎ editar</button>
          </div>
        )}
        {!altDisponivel && <div className="alerta alerta-warn" style={{ margin: 12 }}><b>Falta o SQL</b>Rode o schema_v47.sql no Supabase.</div>}
      </div>

      {dlg && (
        <EditarDialog titulo={dlg.id ? `Editar ${dlg.form.nome || "impressora"}` : "Nova impressora"} salvando={salvando} onCancelar={() => setDlg(null)} onSalvar={salvarImpressora} salvarLabel="Salvar">
          <div className="grid-auto">
            {[
              ["nome", "Nome", "text"],
              ["valor_pago", "Valor pago (R$)", "decimal"],
              ["vida_util_horas", "Vida útil (horas)", "decimal"],
              ["horas_iniciais", "Horas já usadas (máquina usada)", "decimal"],
              ["data_cadastro", "Começou a usar em", "date"],
              ["potencia_w", "Potência (W)", "decimal"],
              ["manutencao_hora", "Manutenção por hora (R$)", "decimal"],
            ].map(([k, rot, tipo]) => (
              <div className="field" key={k}>
                <label>{rot}</label>
                <input
                  type={tipo === "date" ? "date" : "text"}
                  inputMode={tipo === "decimal" ? "decimal" : undefined}
                  value={dlg.form[k]}
                  onChange={(e) => setDlg((p) => ({ ...p, form: { ...p.form, [k]: e.target.value } }))}
                />
              </div>
            ))}
          </div>
          {num(dlg.form.vida_util_horas) > 0 && (
            <p className="hint">
              Custo por hora: {BRL(custoHora({ ...dlg.form, valor_pago: num(dlg.form.valor_pago), vida_util_horas: num(dlg.form.vida_util_horas), potencia_w: num(dlg.form.potencia_w), manutencao_hora: num(dlg.form.manutencao_hora) }, cfg || { tarifa_kwh: 1.05 }).total)} (máquina + energia + manutenção). A manutenção em % do material continua no detalhamento de cada produto; aqui é só um extra por hora, se quiser.
            </p>
          )}
        </EditarDialog>
      )}
      {confirmar && <ConfirmDialog titulo={confirmar.titulo} mensagem={confirmar.mensagem} confirmarLabel="Desativar" onConfirm={confirmar.acao} onCancel={() => setConfirmar(null)} />}
      <p className="hint">Começou a usar em {padrao ? dm(padrao.data_cadastro) : "—"} (padrão). Mudanças aqui recalculam o custo e a margem de todos os produtos na hora; preço salvo, riscado e promo nunca mudam sozinhos.</p>
    </>
  );
}
