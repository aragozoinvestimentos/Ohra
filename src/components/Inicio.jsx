import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useSemanaPendente } from "../hooks/useSemanaPendente.js";
import { hojeISO, loadEstimativas, mesDe, resumoCaixa, rotuloMes } from "../lib/fluxoCaixa.js";
import { linhasAnunciar } from "../lib/anunciar.js";
import { sugestoesAfiliado, vendasPorOrigem } from "../lib/afiliados.js";
import { calcTaxaFalhaAtual, TAXA_FALHA_PRIOR_PCT } from "../lib/registroImpressao.js";
import { reservaDoItem } from "../lib/calc.js";
import { GRUPOS_PENDENCIA, montarPendencias, statusInicio } from "../lib/inicio.js";
import { irParaAba } from "../lib/navegar.js";
import { BRL, PCT } from "../lib/format.js";
import Kpis from "./Kpis.jsx";
import CanalTag from "./CanalTag.jsx";
import GraficoOrigem from "./GraficoOrigem.jsx";

const VISIVEIS = 5;
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");

// Lançamentos do caixa, meta do mês e registros de impressão — só leitura.
function useDadosGestao() {
  const { lojaId } = useLoja();
  const [d, setD] = useState({ lancamentos: [], meta: null, impressoes: [], carregando: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const q = (t) => (lojaId ? supabase.from(t).select("*").eq("loja_id", lojaId) : supabase.from(t).select("*"));
        const [rl, rm, ri] = await Promise.all([q("lancamentos_caixa"), q("metas_mensais").eq("mes", hojeISO().slice(0, 7)), q("registros_impressao")]);
        if (!ativo) return;
        setD({ lancamentos: rl.error ? [] : rl.data || [], meta: rm.error ? null : (rm.data || [])[0] || null, impressoes: ri.error ? [] : ri.data || [], carregando: false });
      } catch {
        if (ativo) setD((p) => ({ ...p, carregando: false }));
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`inicio-gestao-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lancamentos_caixa" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "metas_mensais" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "registros_impressao" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
    };
  }, [lojaId]);
  return d;
}

const Bolinha = ({ tom }) => <i className={`bolinha-status ${tom}`} aria-hidden="true" />;

// Área numerada recolhível, com o resumo na linha do título.
function Area({ k, n, titulo, resumo, tom, aberta, onAlternar, children }) {
  return (
    <div className={`panel inicio-area${aberta ? "" : " panel-recolhido"}`} id={`inicio-area-${k}`}>
      <h3 className="section-title">
        <button type="button" className={`variacoes-toggle${aberta ? " aberto" : ""}`} onClick={onAlternar} aria-expanded={aberta}>
          <span className="seta">▸</span> <span className="inicio-num">{n}</span> {titulo}
        </button>
        <span className="h3-contagem inicio-resumo">
          <Bolinha tom={tom} /> {resumo}
        </span>
      </h3>
      {aberta && <div className="inicio-area-corpo">{children}</div>}
    </div>
  );
}

// Início — SÓ LÊ: status no topo → "Pra fazer" por prioridade → áreas
// numeradas. Cada pendência vem da aba que decide e o botão leva pra lá.
export default function Inicio({ onIrPara }) {
  const { lojaId } = useLoja();
  const { dados, rampasH, af, regras, hoje, linhas, linhasAf, semanaAf } = useCrescimento();
  const { itens, canais, precos, produtos, kits, materiais, publicacoesCanal, mapaRampa, clientePagaHoje, alertaDe, pareceAtracaoDe } = dados;
  const semana = useSemanaPendente();
  const gestao = useDadosGestao();
  const [verTodos, setVerTodos] = useState(false);
  const [abertas, setAbertas] = useState({}); // área → aberta (sobrepõe o padrão)

  // --- Dinheiro (mesmas contas do Fluxo de Caixa e de Metas) ---
  const caixa = useMemo(
    () => (gestao.lancamentos.length ? resumoCaixa(gestao.lancamentos, { hoje, estimativas: loadEstimativas(lojaId), meses: 3, dias: 7 }) : null),
    [gestao.lancamentos, hoje, lojaId]
  );
  const metaFat = Number(gestao.meta?.faturamento_objetivo) || 0;

  // --- Catálogo: só itens ANUNCIADOS (marcados "feito" na Anunciar) ---
  const anunciar = useMemo(
    () => linhasAnunciar({ itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje }),
    [itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, clientePagaHoje]
  );
  const anunciados = useMemo(() => {
    const out = [];
    for (const l of anunciar)
      for (const c of canais) {
        const x = l.porCanal[c.id];
        if (x && x.salvo) out.push({ item: l.item, canal: c, x });
      }
    return out;
  }, [anunciar, canais]);
  const precosAlerta = useMemo(
    () =>
      anunciados
        .map((a) => ({ ...a, al: alertaDe(a.item, a.canal) }))
        .filter((a) => a.al && (a.al.tipo === "prejuizo" || a.al.tipo === "abaixo-minimo")),
    [anunciados, alertaDe]
  );
  const anunciosAtualizar = useMemo(() => anunciados.filter((a) => a.x.mudou), [anunciados]);
  const atracao = useMemo(() => precosAlerta.filter((a) => a.al.tipo === "abaixo-minimo" && pareceAtracaoDe(a.item, a.canal, a.al)), [precosAlerta, pareceAtracaoDe]);

  // --- Afiliados (só com campanha configurada) ---
  const afAtivo = af.config.length > 0;
  const afSugestoes = useMemo(
    () =>
      afAtivo
        ? sugestoesAfiliado({ linhas: linhasAf, parceiros: af.parceiros, afRegistros: af.registros, regras, itens, hoje }).filter((s) => s.chave.startsWith("pode|") || s.chave.startsWith("amostra|"))
        : [],
    [afAtivo, linhasAf, af.parceiros, af.registros, regras, itens, hoje]
  );

  // --- Vendas ---
  const origem = useMemo(
    () => vendasPorOrigem({ afRegistros: af.registros, rampaRegistros: rampasH.registros, rampas: rampasH.rampas, hoje, n: 6 }),
    [af.registros, rampasH.registros, rampasH.rampas, hoje]
  );
  const semanasComVenda = origem.filter((w) => w.total > 0).length;
  const temSemana = linhas.some((l) => l.est.lucroSemana != null);
  const lucroSemana = temSemana ? linhas.reduce((s, l) => s + (l.est.lucroSemana || 0), 0) - (semanaAf.comissaoRampa || 0) : null;

  // --- Produção ---
  const taxa = useMemo(() => (gestao.impressoes.length ? calcTaxaFalhaAtual(gestao.impressoes) : null), [gestao.impressoes]);
  // Reserva do mês ≈ vendas registradas no Crescimento neste mês × reserva de cada item.
  const reservaMes = useMemo(() => {
    const mes = mesDe(hoje);
    let total = 0;
    let pecas = 0;
    for (const g of rampasH.registros) {
      if (g.tipo !== "semana" || mesDe(g.data) !== mes) continue;
      const r = rampasH.rampas.find((x) => x.id === g.rampa_id);
      const res = r ? reservaDoItem(itens.find((i) => i.id === `p:${r.produto_id}`), produtos, materiais) : null;
      if (res) {
        total += res.total * (Number(g.vendas) || 0);
        pecas += Number(g.vendas) || 0;
      }
    }
    for (const g of af.registros) {
      if (g.vendas_total == null || mesDe(g.data) !== mes) continue;
      const pre = { produto: "p", variacao: "v", kit: "k" }[g.item_tipo];
      const res = reservaDoItem(itens.find((i) => i.id === `${pre}:${g.item_id}`), produtos, materiais);
      if (res) {
        total += res.total * (Number(g.vendas_total) || 0);
        pecas += Number(g.vendas_total) || 0;
      }
    }
    return pecas > 0 ? { total, pecas } : null;
  }, [rampasH.registros, rampasH.rampas, af.registros, itens, produtos, materiais, hoje]);

  // --- Pra fazer + status ---
  const pendencias = useMemo(
    () => montarPendencias({ precosAlerta, caixa, rampas: linhas, semana: semana.pendentes, anunciosAtualizar, afSugestoes, atracao }),
    [precosAlerta, caixa, linhas, semana.pendentes, anunciosAtualizar, afSugestoes, atracao]
  );
  const status = statusInicio({
    caixa,
    rampas: linhas,
    semana: semana.pendentes,
    afAtivo,
    precosAlerta,
    anunciosAtualizar,
    anunciados: anunciados.length,
    taxa,
    taxaRef: TAXA_FALHA_PRIOR_PCT / 100,
    lucroSemana,
  });

  const ir = (p) => {
    if (p.pedido) irParaAba(p.aba, p.pedido);
    else onIrPara?.(p.aba);
  };
  const aberta = (k) => (abertas[k] != null ? abertas[k] : status[k].tom === "bad" || status[k].tom === "warn");
  const alternar = (k) => setAbertas((a) => ({ ...a, [k]: !aberta(k) }));
  const rolar = (k) => {
    setAbertas((a) => ({ ...a, [k]: true }));
    setTimeout(() => document.getElementById(`inicio-area-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const carregando = gestao.carregando || rampasH.carregando || dados.carregando;
  const visiveis = verTodos ? pendencias : pendencias.slice(0, VISIVEIS);

  const CARDS = [
    { k: "dinheiro", n: 1, titulo: "Dinheiro" },
    { k: "vendas", n: 2, titulo: "Vendas" },
    { k: "catalogo", n: 3, titulo: "Catálogo" },
    { k: "producao", n: 4, titulo: "Produção" },
  ];


  return (
    <div className="inicio">
      <div className="inicio-status">
        {CARDS.map((c) => (
          <button key={c.k} type="button" className={`inicio-card ${status[c.k].tom}`} onClick={() => rolar(c.k)}>
            <span className="inicio-card-tit">
              <Bolinha tom={status[c.k].tom} /> {c.titulo}
            </span>
            <span className="inicio-card-frase">{carregando ? "carregando…" : status[c.k].frase}</span>
          </button>
        ))}
      </div>

      <div className="panel inicio-fazer">
        <h3 className="section-title">
          <span>Pra fazer</span>
          <span className="h3-contagem">{pendencias.length ? `${pendencias.length} ${pendencias.length === 1 ? "item" : "itens"}` : ""}</span>
        </h3>
        {carregando && !pendencias.length ? (
          <div className="empty">Carregando…</div>
        ) : !pendencias.length ? (
          <div className="empty inicio-vazio">Nada pendente hoje ✓</div>
        ) : (
          <>
            {GRUPOS_PENDENCIA.map((g) => {
              const doGrupo = visiveis.filter((p) => p.grupo === g.chave);
              if (!doGrupo.length) return null;
              return (
                <div key={g.chave} className="inicio-grupo">
                  <div className="inicio-grupo-tit">
                    {g.titulo} <span className="muted-cel">{pendencias.filter((p) => p.grupo === g.chave).length}</span>
                  </div>
                  <ul className="inicio-lista">
                    {doGrupo.map((p) => (
                      <li key={p.id} className={`inicio-item ${p.tom}`}>
                        <Bolinha tom={p.tom} />
                        <div className="inicio-item-txt">
                          <b>{p.titulo}</b>
                          <span>{p.texto}</span>
                          {p.semana && (
                            <span className="inicio-item-sec">
                              <button type="button" className="link-btn" onClick={() => semana.adiar(p.semana, "pular")} title="Some até a semana que vem. Nada é gravado: o período fica em aberto e entra no próximo registro.">
                                não registrar esta semana
                              </button>
                              <button type="button" className="link-btn" onClick={() => semana.adiar(p.semana, "amanha")}>
                                lembrar amanhã
                              </button>
                            </span>
                          )}
                        </div>
                        <button type="button" className={`btn btn-mini${p.grupo === "resolver" ? " primary" : ""}`} onClick={() => ir(p.ir)}>
                          {p.rotulo}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {pendencias.length > VISIVEIS && (
              <button type="button" className="link-btn inicio-ver-todos" onClick={() => setVerTodos((v) => !v)}>
                {verTodos ? "ver menos" : `ver todos (${pendencias.length})`}
              </button>
            )}
          </>
        )}
      </div>

      <Area k="dinheiro" tom={status.dinheiro.tom} aberta={aberta("dinheiro")} onAlternar={() => alternar("dinheiro")} n={1} titulo="Dinheiro" resumo={status.dinheiro.frase}>
        {!caixa ? (
          <div className="empty">
            Sem lançamentos no Fluxo de Caixa.{" "}
            <button type="button" className="link-btn" onClick={() => onIrPara?.("caixa")}>Abrir Fluxo de Caixa</button>
          </div>
        ) : (
          <>
            <Kpis
              itens={[
                { label: "Saldo hoje", valor: BRL(caixa.saldoHoje), tom: caixa.saldoHoje < 0 ? "bad" : undefined, sub: "realizado até hoje" },
                {
                  label: "Menor saldo em 3 meses",
                  valor: caixa.menor ? BRL(caixa.menor.saldoFinal) : "—",
                  tom: caixa.menor && caixa.menor.saldoFinal < 0 ? "bad" : undefined,
                  sub: caixa.menor ? `fim de ${rotuloMes(caixa.menor.mes, false)} · projeção do Fluxo de Caixa` : "",
                },
                { label: "Faturamento do mês", valor: BRL(caixa.faturamento), sub: metaFat > 0 ? `meta ${BRL(metaFat)} · ${Math.round((caixa.faturamento / metaFat) * 100)}%` : "sem meta (aba Metas)" },
                { label: "Resultado do mês", valor: BRL(caixa.resultado), tom: caixa.resultado < 0 ? "bad" : undefined, sub: "entradas − saídas realizadas" },
              ]}
            />
            <h4 className="sub-h">Próximos 7 dias</h4>
            {caixa.proximos.length ? (
              <ul className="inicio-mini">
                {caixa.proximos.slice(0, 8).map((l) => (
                  <li key={l.id}>
                    <span className="muted-cel">{diaMes(l.data_prevista)}</span> {l.descricao || "—"}
                    <b className={l.tipo === "saida" ? "neg" : "pos"}>{l.tipo === "saida" ? "−" : "+"}{BRL(Number(l.valor || 0))}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted-cel">Nada previsto nos próximos 7 dias.</div>
            )}
          </>
        )}
      </Area>

      <Area k="vendas" tom={status.vendas.tom} aberta={aberta("vendas")} onAlternar={() => alternar("vendas")} n={2} titulo="Vendas e crescimento" resumo={status.vendas.frase}>
        <Kpis
          itens={[
            { label: "Lucro da semana", valor: lucroSemana != null ? BRL(lucroSemana) : "—", sub: lucroSemana != null ? "produtos em rampa (últimos 7 dias)" : "registre a semana no Crescimento" },
            { label: "Ads da semana", valor: semanaAf.adsGasto > 0 ? BRL(semanaAf.adsGasto) : "—", sub: semanaAf.adsGasto > 0 ? `${semanaAf.adsVendas} vendas via Ads` : "sem Ads registrado" },
            { label: "Produtos em rampa", valor: String(linhas.length), sub: linhas.length ? `${linhas.filter((l) => l.est.sugestao?.chave === "subir").length} prontos pra subir` : "nenhum ainda" },
            ...(afAtivo
              ? [{ label: "Afiliados na semana", valor: String(semanaAf.vendasAf), sub: semanaAf.comissao > 0 ? `comissão ${BRL(semanaAf.comissao)}` : "vendas via afiliado" }]
              : []),
          ]}
        />
        <h4 className="sub-h">Vendas por origem</h4>
        {semanasComVenda >= 2 ? <GraficoOrigem semanas={origem} /> : <div className="empty">Registre 2 semanas pra ver o gráfico.</div>}
        {linhas.length > 0 && (
          <ul className="inicio-mini">
            {linhas.map((l) => (
              <li key={l.r.id}>
                <span>
                  {l.produto.nome} <CanalTag canal={l.canal} /> <span className="muted-cel">{l.est.fase.rotulo} · vendendo {BRL(l.est.preco)}</span>
                </span>
                <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: l.r.id })}>
                  {l.est.sugestao.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Area>

      <Area k="catalogo" tom={status.catalogo.tom} aberta={aberta("catalogo")} onAlternar={() => alternar("catalogo")} n={3} titulo="Catálogo" resumo={status.catalogo.frase}>
        {!anunciados.length ? (
          <div className="empty">Nenhum anúncio marcado como feito na Anunciar ainda.</div>
        ) : !precosAlerta.length && !anunciosAtualizar.length ? (
          <div className="inicio-ok">✓ ok — {anunciados.length} {anunciados.length === 1 ? "anúncio" : "anúncios"} sem problema</div>
        ) : (
          <ul className="inicio-mini">
            {[...precosAlerta.map((a) => ({ ...a, problema: a.al.tipo === "prejuizo" ? "prejuízo" : "abaixo do mínimo", tom: a.al.tipo === "prejuizo" && !a.al.discreto ? "bad" : "warn", aba: "historico" })),
              ...anunciosAtualizar.map((a) => ({ ...a, problema: "↻ atualizar anúncio", tom: "warn", aba: "publicar" }))].map((a) => (
              <li key={`${a.item.id}|${a.canal.id}|${a.problema}`}>
                <span>
                  {a.item.nome} <CanalTag canal={a.canal} /> <span className={`chip-cel ${a.tom === "bad" ? "ruim" : "atencao"}`}>{a.problema}</span>
                </span>
                <button type="button" className="link-btn" onClick={() => (a.aba === "historico" ? irParaAba("historico", { busca: a.item.nome }) : onIrPara?.("publicar"))}>
                  {a.aba === "historico" ? "ver em Produtos precificados" : "abrir Anunciar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Area>

      <Area k="producao" tom={status.producao.tom} aberta={aberta("producao")} onAlternar={() => alternar("producao")} n={4} titulo="Produção" resumo={status.producao.frase}>
        <Kpis
          itens={[
            { label: "Taxa de falha", valor: taxa ? PCT(taxa.taxa) : "—", sub: taxa ? `${taxa.falhas} falhas em ${taxa.total} impressões · referência 12,5%` : "registre impressões" },
            {
              label: "Reserva do mês",
              valor: reservaMes ? BRL(reservaMes.total) : "—",
              sub: reservaMes ? `≈ ${reservaMes.pecas} vendas registradas no Crescimento` : "aparece com as vendas registradas",
            },
          ]}
        />
        <button type="button" className="link-btn" onClick={() => onIrPara?.("registroImpressoes")}>Abrir Registro de Impressões</button>
      </Area>
    </div>
  );
}
