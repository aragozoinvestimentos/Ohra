import { useEffect, useMemo, useState } from "react";
import ComoMediuOrcamento from "./ComoMediuOrcamento.jsx";
import ChaveTeto from "./ChaveTeto.jsx";
import CrescerProposito from "./CrescerProposito.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { comCupomAtivo, cuponsAtivos, textoFaixa } from "../lib/cupomLoja.js";
import { abrirAnuncio, abrirProduto, montarAnuncios } from "../lib/anuncios.js";
import { irParaAba, pegarPedido } from "../lib/navegar.js";
import { pedirPasso } from "../lib/passosPreco.js";
import { adsNaJanela, numerosDoPeriodo, REGRAS_ADS, textoAjusteAds, textoMudancaPreco } from "../lib/ads.js";
import { acaoDaRampa, proximaConferencia } from "../lib/rampaAgora.js";
import { estadoDoAlerta, ROTULO_ESTADO } from "../lib/estados.js";
import { anuncioDoItem } from "../lib/rampaAnuncio.js";
import { descontoDoItem } from "../lib/escada.js";
import { resolverTaxasNoPreco } from "../lib/calc.js";
import { rampaNoCanal } from "../lib/rampaCanal.js";
import { canalDireto } from "../lib/canais.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import { CartoesAlvoAgora, DiferencaAlvoAgora } from "./AlvoAgora.jsx";
import { CartaoDiagnostico, FunilQuatro } from "./Diagnostico.jsx";
import HistoricoAcoes from "./HistoricoAcoes.jsx";
import SurtiuEfeito from "./SurtiuEfeito.jsx";

// Painel do anúncio (remap 21/10/2026, aprovado pela prévia): TUDO de um
// produto (ou kit / anúncio com vários itens) NUM canal — resumo, vendas,
// preço, rampa, Ads, o que digitar e custo. Só LÊ: as contas são as de
// sempre (useEscada, useCrescimento, lib/ads.js, lib/rampa.js) e as ações
// abrem a tela que já faz aquilo (Rampa, Ads, 1º–5º passos) com o item escolhido.
const ABAS = [
  { k: "resumo", rot: "Resumo" },
  { k: "vendas", rot: "Vendas" },
  { k: "preco", rot: "Preço" },
  { k: "rampa", rot: "Rampa" },
  { k: "ads", rot: "Ads" },
  { k: "anuncio", rot: "Anúncio" },
  { k: "custo", rot: "Custo" },
  { k: "acoes", rot: "Ações" },
];
const ABAS_GRUPO = ["resumo", "vendas", "rampa", "ads", "anuncio", "acoes"];
const PERIODOS = [
  { d: 7, rot: "7 dias" },
  { d: 30, rot: "30 dias" },
  { d: 90, rot: "3 meses" },
  { d: 365, rot: "1 ano" },
];
const SEL_KEY = "ohra:painel-anuncio";
const num = (v) => Number(v) || 0;
const um = (v) => (v == null || !isFinite(v) ? "—" : String(Math.round(v * 10) / 10).replace(".", ","));
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const funilTexto = (f) => (!f ? "—" : f.diagnostico?.titulo || f.texto || (f.status === "pronto" ? `✓ ok (CTR ${PCT(f.ctr)} · conversão ${PCT(f.conversao)})` : "—"));
const PESO = { resolver: 0, atencao: 1, oportunidade: 2, decisao: 3, info: 4 };

function lerSel() {
  try {
    return JSON.parse(sessionStorage.getItem(SEL_KEY) || "null");
  } catch {
    return null;
  }
}

// Pedidos (linhas enriquecidas) deste anúncio.
function pedidosDoAnuncio(pedidos, l) {
  const pid = l.tipo === "produto" ? l.itemId.slice(2) : null;
  return (pedidos || []).filter((p) => {
    if (!p.valido || p.canal_id !== l.canal.id) return false;
    if (l.tipo === "grupo") return p.grupo?.id === l.grupo.id;
    return !p.grupo && (p.id_item === l.itemId || (pid && p.item?.produtoId === pid));
  });
}

export default function PainelAnuncio({ onToast }) {
  const esc = useEscada();
  const cres = useCrescimento();
  const hoje = hojeSP();
  const [sel, setSel] = useState(lerSel);
  const [aba, setAba] = useState("resumo");
  const [dias, setDias] = useState(30);

  // Pedido vindo de qualquer tela (abrirAnuncio em lib/anuncios.js).
  useEffect(() => {
    const aplicar = (p) => {
      if (!p?.itemId) return;
      setSel({ itemId: p.itemId, canalId: p.canalId || null });
      setAba(p.aba || "resumo");
    };
    aplicar(pegarPedido("anuncio"));
    const ouvir = (e) => e.detail.aba === "anuncio" && aplicar(pegarPedido("anuncio"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);
  useEffect(() => {
    try {
      if (sel) sessionStorage.setItem(SEL_KEY, JSON.stringify(sel));
    } catch {
      // sem sessionStorage — só não lembra
    }
  }, [sel]);

  const linhas = useMemo(() => montarAnuncios({ esc, cres, pedidos: cres.pedidosValidos, hoje }), [esc, cres, hoje]);
  const doItem = sel ? linhas.filter((x) => x.itemId === sel.itemId) : [];
  const l = doItem.find((x) => x.canal.id === sel?.canalId) || doItem[0] || null;

  if (!l)
    return (
      <div className="panel">
        <div className="empty">
          {sel ? "Este item não tem preço salvo em nenhum canal ainda." : "Escolha um anúncio na lista."}{" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("anuncios")}>
            Ver todos os anúncios →
          </button>
        </div>
      </div>
    );

  const ehGrupo = l.tipo === "grupo";
  const abas = ABAS.filter((a) => !ehGrupo || ABAS_GRUPO.includes(a.k));
  const abaV = abas.some((a) => a.k === aba) ? aba : "resumo";
  const ped = pedidosDoAnuncio(cres.pedidosValidos, l);
  const de = somarDias(hoje, -dias);
  const pedP = ped.filter((p) => String(p.data) > de);
  const pedAnt = ped.filter((p) => String(p.data) > somarDias(de, -dias) && String(p.data) <= de);
  const soma = (ls, k) => ls.reduce((t, p) => t + num(p[k]), 0);
  const v = { un: soma(pedP, "q"), fat: soma(pedP, "pago"), lucro: soma(pedP, "lucro") };
  const vAnt = { un: soma(pedAnt, "q"), fat: soma(pedAnt, "pago"), lucro: soma(pedAnt, "lucro") };
  const adsJ = l.ads ? adsNaJanela(l.ads.periodos, l.ads.semanas, de, hoje) : { gasto: 0, vendas: 0 };
  // O mesmo item também vende por anúncio(s) com vários itens: essas vendas ficam no
  // painel daquele anúncio (Ads/funil são dele), mas avisamos aqui pra não parecer parado.
  const pidV = l.tipo === "produto" ? l.itemId.slice(2) : null;
  const viaG = new Map();
  if (!ehGrupo)
    for (const p of cres.pedidosValidos || []) {
      if (!p.valido || !p.grupo || p.canal_id !== l.canal.id || String(p.data) <= de) continue;
      if (p.id_item !== l.itemId && !(pidV && p.item?.produtoId === pidV)) continue;
      const g = viaG.get(p.grupo.id) || { id: p.grupo.id, nome: p.grupo.nome, un: 0 };
      g.un += num(p.q);
      viaG.set(p.grupo.id, g);
    }
  const lojaCfg = esc.cfgLoja;
  const marcas = marcasDasAbas(l);

  return (
    <div className="painel-anuncio">
      <div className="pa-cab">
        <div className="pa-titulo">
          <div className="pa-trilha">
            <button type="button" className="link-btn" onClick={() => irParaAba("anuncios")}>← Anúncios</button>
            {!ehGrupo && (
              <>
                {" · "}
                <button type="button" className="link-btn" onClick={() => abrirProduto(l.tipo === "produto" ? l.itemId : l.itemId)}>
                  página do {l.tipo === "kit" ? "kit" : "produto"} ↗
                </button>
              </>
            )}
          </div>
          <h2>
            {l.nome} <CanalTag canal={l.canal} />
          </h2>
          <div className="pa-chips">
            {l.sku && <span className="muted-cel">{l.sku}</span>}
            {l.emRampa && l.rampa && <Estado tipo="decisao" icone={null}>em rampa · degrau {l.rampa.est.i + 1} de {l.rampa.est.degraus.length}</Estado>}
            {l.estado && <Estado tipo={l.estado.tipo} title={l.estado.motivo}>{String(l.estado.motivo || ROTULO_ESTADO[l.estado.tipo]).split(" · ")[0]}</Estado>}
            {l.variacoes?.length > 0 && <span className="muted-cel">no mesmo anúncio: {l.variacoes.map((x) => x.nomeVariacao || x.nome).join(" · ")}</span>}
          </div>
        </div>
        {l.agora && (
          <div className="kpi pa-preco">
            <div className="l">{l.emRampa ? "Preço agora → alvo" : ehGrupo ? "Ticket médio" : "Preço salvo"}</div>
            <div className="v">
              {BRL(l.agora.preco)} {l.emRampa && l.alvo && <small>→ {BRL(l.alvo.preco)}</small>}
            </div>
            <div className="s">
              lucro {BRL(l.agora.lucro)}
              {l.emRampa && l.alvo ? ` → ${BRL(l.alvo.lucro)}` : ""} por venda
            </div>
          </div>
        )}
      </div>

      {/* Troca de canal: o canal sempre ao lado do nome; aqui pula pro mesmo produto em outro canal. */}
      <div className="pa-canais">
        <span className="muted-cel">Canal:</span>
        {esc.canais.map((c) => {
          const tem = doItem.some((x) => x.canal.id === c.id);
          if (tem)
            return (
              <button key={c.id} type="button" className={`pa-canal${c.id === l.canal.id ? " on" : ""}`} onClick={() => setSel({ itemId: l.itemId, canalId: c.id })}>
                <CanalTag canal={c} />
              </button>
            );
          if (ehGrupo) return null;
          return (
            <button
              key={c.id}
              type="button"
              className="pa-canal pa-canal-vazio"
              title={`Sem preço salvo em ${c.nome} — abre o 1º Avulso com este item e canal`}
              onClick={() => {
                pedirPasso("avulso", l.itemId, c.id);
                irParaAba("avulso");
              }}
            >
              + lançar em {c.nome}
            </button>
          );
        })}
        <span className="pa-periodo">
          <span className="muted-cel">Período:</span>
          {PERIODOS.map((p) => (
            <button key={p.d} type="button" className={`chip-periodo${dias === p.d ? " on" : ""}`} onClick={() => setDias(p.d)}>
              {p.rot}
            </button>
          ))}
        </span>
      </div>

      {viaG.size > 0 && (
        <div className="aviso-cel" style={{ margin: "0 0 8px" }}>
          Este item também vendeu{" "}
          {[...viaG.values()].map((g, i) => (
            <span key={g.id}>
              {i > 0 && " e "}
              <b>{g.un} un.</b> pelo{" "}
              <button type="button" className="link-btn" onClick={() => abrirAnuncio(`g:${g.id}`, l.canal.id)}>
                anúncio {g.nome}
              </button>
            </span>
          ))}{" "}
          nos últimos {dias} dias — fora destes números (o Ads e o funil são daquele anúncio). A página do produto soma tudo.
        </div>
      )}
      <div className="pa-abas" role="tablist">
        {abas.map((a) => (
          <button key={a.k} type="button" role="tab" className={abaV === a.k ? "ativo" : ""} onClick={() => setAba(a.k)}>
            {a.rot}
            {marcas[a.k] && <i className={`pa-marca st-${marcas[a.k]}`} aria-hidden="true" />}
          </button>
        ))}
      </div>

      {abaV === "resumo" && <AbaResumo l={l} v={v} vAnt={vAnt} adsJ={adsJ} pedP={pedP} de={de} hoje={hoje} dias={dias} irAba={setAba} />}
      {abaV === "vendas" && <AbaVendas l={l} v={v} vAnt={vAnt} pedP={pedP} de={de} hoje={hoje} dias={dias} esc={esc} />}
      {abaV === "preco" && <AbaPreco l={l} esc={esc} />}
      {abaV === "rampa" && <AbaRampa l={l} cfgLoja={lojaCfg} />}
      {abaV === "ads" && <AbaAds l={l} hoje={hoje} ped={ped} />}
      {abaV === "anuncio" && <AbaAnuncio l={l} esc={esc} cres={cres} />}
      {abaV === "custo" && <AbaCusto l={l} />}
      {abaV === "acoes" && <HistoricoAcoes l={l} hoje={hoje} pedidos={cres.pedidosValidos} cres={cres} onToast={onToast} />}
    </div>
  );
}

// Bolinha na aba que pede ação (mesma regra única de cores).
function marcasDasAbas(l) {
  const m = {};
  const pior = (k, t) => {
    if (!t || t === "info" || t === "ok") return;
    if (!m[k] || PESO[t] < PESO[m[k]]) m[k] = t;
  };
  pior("preco", estadoDoAlerta(l.alerta)?.tipo);
  if (l.rampa) {
    const a = acaoDaRampa(l.rampa.est, { grupo: l.tipo === "grupo" });
    pior("rampa", a.tipo);
  }
  pior("ads", l.ads?.av?.estado);
  for (const k of Object.keys(m)) pior("resumo", m[k]);
  return m;
}

// Lista do que pede ação neste anúncio (preço, rampa, Ads) — a pior primeiro.
function acoesDoAnuncio(l) {
  const out = [];
  const ePreco = estadoDoAlerta(l.alerta);
  if (ePreco && (ePreco.tipo === "resolver" || ePreco.tipo === "atencao"))
    out.push({
      area: "Preço",
      tipo: ePreco.tipo,
      titulo: l.alerta.tipo === "prejuizo" ? "Preço com prejuízo" : l.alerta.tipo === "abaixo-minimo" ? "Preço abaixo do seu mínimo" : ePreco.motivo,
      porque: l.agora ? `Lucro agora ${BRL(l.agora.lucro)} por venda${l.alerta.minimo ? ` · mínimo aceitável ${BRL(l.alerta.minimo)}` : ""}.` : "",
      botao: "Ver o preço",
      ir: { aba: "preco" },
    });
  if (l.rampa) {
    const a = acaoDaRampa(l.rampa.est, { canal: l.canal.nome, grupo: l.tipo === "grupo", checklist: l.rampa.r?.checklist || {} });
    out.push({ area: "Rampa", tipo: a.tipo, titulo: a.titulo, porque: a.porque, botao: a.botao ? `${a.botao} (na Rampa)` : "Abrir na Rampa", ir: { fora: () => irParaAba("crescimento", { sub: "rampa", rampaId: l.rampa.r.id }) } });
  }
  if (l.ads?.av) {
    const av = l.ads.av;
    out.push({ area: "Ads", tipo: av.estado === "ok" ? "info" : av.estado, titulo: av.titulo, porque: av.texto, botao: "Abrir no Ads", ir: { fora: () => irParaAba("crescimento", { sub: "ads", adsChave: l.ads.chave }) } });
  }
  // Diagnóstico comercial (lib/diagnostico.js): o principal que pede ação.
  const dg = (l.diagnosticos || []).find((d) => d.estado !== "info");
  if (dg) out.push({ area: "Diagnóstico", tipo: dg.estado, titulo: dg.titulo, porque: `${dg.evidencia.filter(Boolean).slice(0, 2).join(" · ")}. ${dg.acao}`, botao: dg.rotulo, ir: dg.ir.aba === "anuncio" ? { aba: dg.ir.pedido.aba } : { fora: () => irParaAba(dg.ir.aba, dg.ir.pedido) } });
  return out.sort((a, b) => (PESO[a.tipo] ?? 9) - (PESO[b.tipo] ?? 9));
}

// Botão de um diagnóstico: dentro do Painel troca de aba; fora, abre a tela.
const irDiag = (ir, irAba) => (ir.aba === "anuncio" ? irAba(ir.pedido?.aba || "resumo") : irParaAba(ir.aba, ir.pedido));

function irPara(ir, irAba) {
  if (ir.fora) ir.fora();
  else if (ir.aba) irAba(ir.aba);
}

function AbaResumo({ l, v, vAnt, adsJ, pedP, de, hoje, dias, irAba }) {
  const acoes = acoesDoAnuncio(l);
  const top = acoes.find((a) => a.tipo !== "info") || acoes[0] || null;
  const var_ = (a, b) => (b > 0 ? (a - b) / b : null);
  const dv = var_(v.un, vAnt.un);
  const pub = l.anunciado;
  const est = l.rampa?.est;
  return (
    <>
      {top ? (
        <div className={`pa-agora st-borda-${top.tipo}`}>
          <Estado tipo={top.tipo}>{`${top.area} · ${ROTULO_ESTADO[top.tipo]}`}</Estado>
          <h4>{top.titulo}</h4>
          {top.porque && <p>{top.porque}</p>}
          <button type="button" className="btn btn-mini primary" onClick={() => irPara(top.ir, irAba)}>
            {top.botao}
          </button>
        </div>
      ) : (
        <div className="pa-agora">
          <Estado tipo="info" icone={null}>✓ Nada pedindo ação agora</Estado>
          <p>Preço, rampa e Ads deste anúncio estão em dia.</p>
        </div>
      )}
      {l.ads?.efeito && <SurtiuEfeito ef={l.ads.efeito} />}
      <div className="pa-grid2">
        <div className="panel">
          <h3>Tudo que o app está olhando neste anúncio</h3>
          <table className="pa-olhando">
            <tbody>
              {acoes.map((a) => (
                <tr key={a.area} className="linha-clicavel" onClick={() => irPara(a.ir, irAba)}>
                  <td>{a.area}</td>
                  <td>{a.tipo === "info" ? <span className="muted-cel">{a.titulo}</span> : <Estado tipo={a.tipo}>{a.titulo}</Estado>}</td>
                </tr>
              ))}
              {!acoes.some((a) => a.area === "Preço") && (
                <tr className="linha-clicavel" onClick={() => irAba("preco")}>
                  <td>Preço</td>
                  <td className="muted-cel">✓ {l.agora?.margem != null ? `margem ${PCT(l.agora.margem)}` : "ok"}</td>
                </tr>
              )}
              {!l.rampa && l.tipo !== "grupo" && (
                <tr>
                  <td>Rampa</td>
                  <td className="muted-cel">fora de rampa neste canal</td>
                </tr>
              )}
              {!l.ads && (
                <tr>
                  <td>Ads</td>
                  <td className="muted-cel">{canalDireto(l.canal) ? "venda direta — sem Ads" : "sem Ads"}</td>
                </tr>
              )}
              <tr className="linha-clicavel" onClick={() => irAba("anuncio")}>
                <td>Anúncio no canal</td>
                <td className="muted-cel">{l.tipo === "grupo" ? "ver o que digitar por opção" : pub ? "✓ marcado como anunciado (preço original fixo)" : "ainda não marcado como anunciado"}</td>
              </tr>
              {est?.funil && (
                <tr>
                  <td>Funil</td>
                  <td className="muted-cel">{funilTexto(est.funil)}</td>
                </tr>
              )}
              {est && est.nota != null && (
                <tr>
                  <td>Avaliações</td>
                  <td className="muted-cel">
                    {est.avaliacoesTotal ?? "—"} · nota {String(est.nota).replace(".", ",")}
                  </td>
                </tr>
              )}
              {est && (
                <tr>
                  <td>Próxima conferência</td>
                  <td className="muted-cel">{proximaConferencia(est)?.texto || "—"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>
            Últimos {dias} dias <span className="dir">pedidos importados</span>
          </h3>
          <div className="pa-mini-kpis">
            <div>
              <small>Vendas</small>
              <b>{v.un} un.</b>
              {dv != null && <span className={dv >= 0 ? "pos" : "neg"}>{dv >= 0 ? "↑" : "↓"} {Math.abs(Math.round(dv * 100))}% vs antes</span>}
            </div>
            <div>
              <small>Faturamento</small>
              <b>{BRL(v.fat)}</b>
            </div>
            <div>
              <small>Lucro antes do Ads</small>
              <b>{BRL(v.lucro)}</b>
            </div>
            <div>
              <small>Lucro depois do Ads</small>
              <b className={v.lucro - adsJ.gasto < 0 ? "neg" : ""}>{BRL(v.lucro - adsJ.gasto)}</b>
              <span>Ads {BRL(adsJ.gasto)}</span>
            </div>
          </div>
          <GraficoDiario pedidos={pedP} de={de} ate={hoje} altura={110} />
        </div>
      </div>
      <div className="panel">
        <h3>
          Diagnóstico comercial{" "}
          <Ajuda texto="Junta o funil do Desempenho da Shopee (impressão → clique → carrinho → pagou), o lucro de agora, o Ads e as vendas reais deste anúncio. Problema = os números mostram; hipótese = vale investigar; dados insuficientes = ainda não dá pra concluir. As referências são a metade da média da loja (com 5+ anúncios) ou valores gerais. Nada muda sozinho." />
        </h3>
        <div className="pa-corpo">
          {l.funil && <FunilQuatro funil={l.funil} d={l.desempenho} referencia={l.refFunil} />}
          {(l.diagnosticos || []).length ? (
            (l.diagnosticos || []).map((d, i) => <CartaoDiagnostico key={d.chave} d={d} aberto={i === 0 && d.estado !== "info"} onIr={(ir) => irDiag(ir, irAba)} />)
          ) : (
            <span className="muted-cel">{l.canal?.tipo === "shopee" ? "✓ Nada fora do esperado no funil, no lucro e no Ads." : `Funil não disponível em ${l.canal?.nome} (só os pedidos) — o diagnóstico usa lucro e Ads.`}</span>
          )}
        </div>
      </div>
    </>
  );
}

// Barras = unidades por dia; linha = lucro do dia (antes do Ads).
function GraficoDiario({ pedidos, de, ate, altura = 180, lucro = false }) {
  const diasL = [];
  for (let d = somarDias(de, 1); d <= ate; d = somarDias(d, 1)) diasL.push(d);
  if (diasL.length > 120) {
    // período longo: agrupa por semana
    const sem = [];
    for (let i = 0; i < diasL.length; i += 7) sem.push(diasL.slice(i, i + 7));
    return <Grafico grupos={sem} pedidos={pedidos} altura={altura} lucro={lucro} />;
  }
  return <Grafico grupos={diasL.map((d) => [d])} pedidos={pedidos} altura={altura} lucro={lucro} />;
}
function Grafico({ grupos, pedidos, altura, lucro }) {
  const porDia = new Map();
  for (const p of pedidos) {
    const k = String(p.data).slice(0, 10);
    const x = porDia.get(k) || { un: 0, lucro: 0 };
    x.un += num(p.q);
    x.lucro += num(p.lucro);
    porDia.set(k, x);
  }
  const pts = grupos.map((g) => g.reduce((t, d) => ({ un: t.un + (porDia.get(d)?.un || 0), lucro: t.lucro + (porDia.get(d)?.lucro || 0) }), { un: 0, lucro: 0 }));
  const W = 900;
  const H = altura;
  const pad = { l: 28, r: 6, t: 8, b: 18 };
  const max = Math.max(1, ...pts.map((p) => p.un));
  const bw = (W - pad.l - pad.r) / Math.max(1, pts.length);
  const y = (n) => H - pad.b - (n / max) * (H - pad.t - pad.b);
  const maxL = Math.max(0.01, ...pts.map((p) => Math.abs(p.lucro)));
  const yL = (n) => H - pad.b - (Math.max(0, n) / maxL) * (H - pad.t - pad.b);
  const passoRot = Math.max(1, Math.ceil(pts.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pa-grafico" role="img" aria-label="Vendas por dia">
      {[0, Math.ceil(max / 2), max].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="pa-grade" />
          <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" className="pa-eixo">{t}</text>
        </g>
      ))}
      {pts.map((p, i) => (
        <rect key={i} x={pad.l + i * bw + bw * 0.15} y={y(p.un)} width={Math.max(1, bw * 0.7)} height={H - pad.b - y(p.un)} rx="2" className="pa-barra">
          <title>{`${dm(grupos[i][0])}${grupos[i].length > 1 ? `–${dm(grupos[i][grupos[i].length - 1])}` : ""}: ${p.un} un. · lucro ${BRL(p.lucro)}`}</title>
        </rect>
      ))}
      {lucro && pts.length > 1 && <polyline points={pts.map((p, i) => `${pad.l + i * bw + bw / 2},${yL(p.lucro)}`).join(" ")} className="pa-linha-lucro" />}
      {pts.map((p, i) => (i % passoRot === 0 ? <text key={`t${i}`} x={pad.l + i * bw + bw / 2} y={H - 4} textAnchor="middle" className="pa-eixo">{dm(grupos[i][0])}</text> : null))}
    </svg>
  );
}

function AbaVendas({ l, v, vAnt, pedP, de, hoje, dias, esc }) {
  const porItem = new Map();
  for (const p of pedP) {
    const k = l.tipo === "grupo" ? p.grupo?.rotulo || p.item?.nome || p.sku : p.item?.nomeVariacao || (p.id_item === l.itemId ? "1 unidade" : p.item?.nome || p.sku);
    const x = porItem.get(k) || { un: 0, fat: 0, lucro: 0, pedidos: 0 };
    x.un += num(p.q);
    x.fat += num(p.pago);
    x.lucro += num(p.lucro);
    x.pedidos++;
    porItem.set(k, x);
  }
  const ticket = pedP.length ? v.fat / new Set(pedP.map((p) => p.pedido)).size : null;
  const taxas = pedP.reduce((t, p) => t + Math.max(0, num(p.taxas ?? num(p.pago) - num(p.recebe))), 0);
  const repor = pedP.reduce((t, p) => t + num(p.custo), 0);
  const seta = (a, b) => (b > 0 ? `${a >= b ? "↑" : "↓"} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs ${dias} dias antes` : "sem base pra comparar");
  return (
    <>
      <Kpis
        itens={[
          { label: "Unidades", valor: `${v.un}`, sub: seta(v.un, vAnt.un) },
          { label: "Faturamento", valor: BRL(v.fat), sub: ticket ? `ticket médio ${BRL(ticket)}` : null },
          { label: `Taxas ${esc.canais.find((c) => c.id === l.canal.id)?.nome || ""}`, valor: BRL(taxas), sub: v.fat > 0 ? `${PCT(taxas / v.fat)} do faturamento` : null },
          { label: "Repor (custo)", valor: BRL(repor) },
          { label: "Lucro", valor: BRL(v.lucro), tom: v.lucro > 0 ? "good" : v.lucro < 0 ? "bad" : undefined, sub: v.fat > 0 ? `${PCT(v.lucro / v.fat)} · ${seta(v.lucro, vAnt.lucro)}` : null },
        ]}
      />
      <div className="panel">
        <h3>
          Vendas por dia <span className="dir">barras = unidades · linha = lucro (antes do Ads) · pedidos importados</span>
        </h3>
        <div className="pa-grafico-wrap">
          <GraficoDiario pedidos={pedP} de={de} ate={hoje} altura={200} lucro />
        </div>
      </div>
      <div className="panel">
        <h3>{l.tipo === "grupo" ? "Por opção do anúncio" : "Por quantidade"}</h3>
        {porItem.size ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l.tipo === "grupo" ? "Opção" : "Item"}</th>
                  <th className="num">Unidades</th>
                  <th className="num">Faturamento</th>
                  <th className="num">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {[...porItem.entries()]
                  .sort((a, b) => b[1].un - a[1].un)
                  .map(([k, x]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{x.un}</td>
                      <td className="num">{BRL(x.fat)}</td>
                      <td className="num">{BRL(x.lucro)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Sem venda nesse período — importe os pedidos em Atualizar dados se faltar algum.</div>
        )}
      </div>
    </>
  );
}

// Régua de preço × concorrência (do vídeo): menor e maior que você vê na
// busca do canal, digitados à mão — guardados em preferencias_loja (por loja,
// sem SQL), chave "anuncios:regua" → { "<itemId>|<canalId>": { min, max, em } }.
function ReguaConcorrencia({ l }) {
  const [regua, setRegua] = usePreferencia("anuncios:regua", {});
  const chave = `${l.itemId}|${l.canal.id}`;
  const r = regua?.[chave] || {};
  const [ed, setEd] = useState(null);
  const voce = l.agora?.preco;
  const min = num(r.min);
  const max = num(r.max);
  const tem = min > 0 && max > min;
  const pos = (x) => `${Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100))}%`;
  const media = tem ? (min + max) / 2 : null;
  const salvar = () => {
    const n = (s) => Number(String(s || "").replace(",", ".")) || null;
    setRegua({ ...(regua || {}), [chave]: { min: n(ed.min), max: n(ed.max), em: hojeSP() } });
    setEd(null);
  };
  return (
    <div className="panel">
      <h3>
        Régua de preço × concorrência
        <Ajuda texto="Digite o MENOR e o MAIOR preço que você vê na busca do canal pra este produto (o que o cliente compara). O app mostra onde o seu preço de agora fica nessa faixa. Só referência: nada muda no preço." />
        <span className="dir">
          {r.em ? `atualizado ${dm(r.em)} · ` : ""}
          <button type="button" className="link-btn" onClick={() => setEd({ min: r.min ?? "", max: r.max ?? "" })}>
            {tem ? "✎ atualizar" : "+ informar a faixa da busca"}
          </button>
        </span>
      </h3>
      {ed && (
        <div className="pa-regua-form">
          <label>
            Menor preço na busca
            <input type="text" inputMode="decimal" value={ed.min} onChange={(e) => setEd({ ...ed, min: e.target.value })} placeholder="ex.: 9,90" />
          </label>
          <label>
            Maior preço na busca
            <input type="text" inputMode="decimal" value={ed.max} onChange={(e) => setEd({ ...ed, max: e.target.value })} placeholder="ex.: 19,90" />
          </label>
          <button type="button" className="btn btn-mini primary" onClick={salvar}>Salvar</button>
          <button type="button" className="btn btn-mini" onClick={() => setEd(null)}>Cancelar</button>
        </div>
      )}
      {tem && voce ? (
        <div className="pa-regua-wrap">
          <div className="pa-regua">
            <span className="pa-regua-p min" style={{ left: "0%" }}>menor {BRL(min)}</span>
            <span className="pa-regua-p max" style={{ left: "100%" }}>maior {BRL(max)}</span>
            <span className="pa-regua-t" style={{ left: pos(voce) }} />
            <span className="pa-regua-p voce" style={{ left: pos(voce) }}>você {BRL(voce)}</span>
            <span className="pa-regua-m" style={{ left: pos(media) }}>média {BRL(media)}</span>
          </div>
          <p className="muted-cel">
            {voce < min ? "Abaixo do menor preço da busca — dá espaço pra subir." : voce > max ? "Acima do maior preço da busca — confira se o anúncio justifica (fotos, avaliações, kit)." : voce <= media ? "Abaixo da média da busca." : "Acima da média da busca."}
            {l.emRampa && l.alvo ? ` Alvo ${BRL(l.alvo.preco)} ${l.alvo.preco <= max ? "cabe na faixa" : "passa do maior da busca"}.` : ""}
          </p>
        </div>
      ) : (
        !ed && <div className="empty">Informe a faixa de preço da busca pra ver onde você está.</div>
      )}
    </div>
  );
}

function AbaPreco({ l, esc }) {
  const pid = l.tipo === "produto" ? l.itemId.slice(2) : null;
  const d = pid ? esc.escada(pid, l.canal) : null;
  const linhasE = (d?.escada?.linhas || []).filter((x) => x.cadastrada !== false || x.salvo);
  const aa = l.agora ? { alvo: l.alvo, agora: l.agora, emRampa: l.emRampa, difPreco: l.alvo ? l.alvo.preco - l.agora.preco : null, difLucro: l.alvo ? l.alvo.lucro - l.agora.lucro : null } : null;
  const abrir = (passo) => {
    pedirPasso(passo, l.itemId, l.canal.id);
    irParaAba(passo);
  };
  return (
    <>
      <div className="pa-grid2">
        <div className="panel">
          <h3>Preço alvo e preço agora</h3>
          <div className="pa-corpo">
            <div className="detalhe-kv-grid">
              <CartoesAlvoAgora aa={aa} pecas={l.item?.pecas || 1} />
            </div>
            <DiferencaAlvoAgora aa={aa} />
            {l.alerta?.minimo != null && <p className="muted-cel">Mínimo aceitável neste canal: {BRL(l.alerta.minimo)}.</p>}
            {l.alerta?.tipo && <p><Estado tipo={estadoDoAlerta(l.alerta)?.tipo || "info"}>{estadoDoAlerta(l.alerta)?.motivo || l.alerta.tipo}</Estado></p>}
            {(() => {
              // Cupom ativo da loja (Configuração → Regras): lucro de 1 un. no preço de agora.
              const faixas = cuponsAtivos(esc.cfgLoja, l.canal.id);
              if (!faixas.length || !l.agora?.preco || !l.item) return null;
              const cfg = esc.cfgDoProduto(l.item.produtoId || (l.itemId.startsWith("p:") ? l.itemId.slice(2) : null));
              const c = comCupomAtivo({ canal: l.canal, preco: l.agora.preco, custo: Number(l.item.custoTotal) || 0, peso: Number(l.item.peso) || 0, cfg }, faixas);
              if (!c) return null;
              return (
                <p className="muted-cel">
                  Cupom da loja ({faixas.map(textoFaixa).join(" · ")}):{" "}
                  {c.faixa ? (
                    <>
                      numa compra de 1 un. o cliente paga {BRL(c.clientePaga)} e você lucra <b style={{ color: c.estado === "prejuizo" ? "var(--bad)" : undefined }}>{BRL(c.lucro)}</b>
                      {c.estado === "prejuizo" ? " — ! prejuízo" : c.estado === "abaixo" ? " — ⚠ abaixo do mínimo" : ""}
                    </>
                  ) : (
                    "1 unidade não alcança o pedido mínimo do cupom"
                  )}
                  .
                </p>
              );
            })()}
            <div className="pa-botoes">
              <button type="button" className="btn btn-mini primary" onClick={() => irParaAba("historico", { busca: l.item?.nome || l.nome })}>✎ Editar preço salvo</button>
              <button type="button" className="btn btn-mini" onClick={() => abrir("avulso")}>Calculadora (1º Avulso)</button>
              {pid && <button type="button" className="btn btn-mini" onClick={() => abrir("quantidade")}>Por quantidade (2º)</button>}
            </div>
          </div>
        </div>
        <ReguaConcorrencia l={l} />
      </div>
      {pid && linhasE.length > 0 && (
        <div className="panel">
          <h3>
            Por quantidade <span className="dir">a curva da escada · editar no 2º Por quantidade</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kit</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Salvo</th>
                  <th className="num">Agora</th>
                  <th className="num">Lucro agora</th>
                  <th>Cliente economiza</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const base = l.item;
                  const rows = [{ n: 1, nome: "1 unidade", sugerido: d.p1, salvo: d.salvo1, item: base }];
                  for (const x of linhasE) rows.push({ ...x, item: esc.itens.find((i) => i.id.startsWith("v:") && i.produtoId === pid && Number(i.pecas || i.quantidade) === x.n) });
                  return rows.map((x) => {
                    const ag = x.item ? esc.agoraDe(x.item, l.canal) : null;
                    const anunc = x.item ? esc.cobraNoCanal(x.item, l.canal) : false;
                    return (
                      <tr key={x.n} className={anunc ? "" : "muted-cel"}>
                        <td>
                          {x.nome || `Kit ${x.n}`}
                          {!anunc && x.n > 1 && <div className="sub-num">não anunciado neste canal</div>}
                        </td>
                        <td className="num">{x.sugerido ? BRL(x.sugerido) : "—"}</td>
                        <td className="num">{x.salvo ? BRL(x.salvo) : "—"}</td>
                        <td className="num">{ag?.agora ? BRL(ag.agora.preco) : "—"}</td>
                        <td className="num">{ag?.agora ? BRL(ag.agora.lucro) : "—"}</td>
                        <td>{x.n > 1 && x.economiaPct ? `${PCT(x.economiaPct)} (${BRL(x.economia)})` : "—"}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function AbaRampa({ l, cfgLoja }) {
  const rp = l.rampa;
  if (!rp) {
    const semRampa = !rampaNoCanal(l.canal, cfgLoja);
    return (
      <div className="panel">
        <div className="empty">
          {canalDireto(l.canal)
            ? "Venda direta: preço fixo, sem rampa."
            : semRampa
              ? `${l.canal.nome} não usa rampa (Configuração → Canais). Anuncie no preço salvo.`
              : "Este anúncio não está em rampa neste canal."}{" "}
          {!semRampa && !canalDireto(l.canal) && (
            <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { sub: "rampa" })}>
              Iniciar uma rampa em Vender mais → Rampa →
            </button>
          )}
        </div>
      </div>
    );
  }
  const est = rp.est;
  const grupo = l.tipo === "grupo";
  const a = acaoDaRampa(est, { canal: l.canal.nome, grupo, checklist: rp.r?.checklist || {} });
  const prox = proximaConferencia(est);
  const fmt = (x) => (grupo ? `${um(x)}` : BRL(x));
  return (
    <>
      <div className={`pa-agora st-borda-${a.tipo}`}>
        <Estado tipo={a.tipo}>{a.rotulo}</Estado>
        <h4>{a.titulo}</h4>
        {a.porque && <p>{a.porque}</p>}
        <button type="button" className="btn btn-mini primary" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: rp.r.id })}>
          {a.botao ? `${a.botao} — abrir na Rampa` : "Abrir na Rampa"}
        </button>
        {prox?.texto && <span className="muted-cel"> · próxima conferência: {prox.texto}</span>}
      </div>
      {!grupo && (
        <div className="panel">
          <h3>Degraus</h3>
          <div className="pa-degraus">
            {est.degraus.map((x, i) => (
              <span key={i} className={`pa-dg${i === est.i ? " at" : ""}${i < est.i ? " ok" : ""}${i === est.degraus.length - 1 ? " alvo" : ""}`}>
                {fmt(x)}
                {i === est.i ? " · agora" : ""}
                {i === est.degraus.length - 1 ? " · alvo" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="panel">
        <h3>Portões pra subir</h3>
        <table>
          <tbody>
            {(est.portoes || []).map((p) => (
              <tr key={p.chave}>
                <td>{p.rotulo}</td>
                <td className="num">{p.ok ? <Estado tipo="oportunidade">{`✓ ${p.valor}`}</Estado> : <span className="muted-cel">{p.valor}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Medidor do Ads (do vídeo): faixas pelo RETORNO (ROAS ÷ equilíbrio) com as
// mesmas regras do lib/ads.js — prejuízo < ½ · abaixo do equilíbrio < 1 · se
// paga até 1,2 (manter) · bom até 2 (+20%) · ótimo ≥ 2 (+30%).
function Medidor({ pontos }) {
  const e = REGRAS_ADS.escada;
  const lim = [REGRAS_ADS.prejuizoRetorno, 1, e.manterAte, e.dobroAte[0]];
  const MAX = 3;
  const pos = (r) => `${(Math.max(0, Math.min(MAX, r)) / MAX) * 100}%`;
  const faixas = [
    { de: 0, ate: lim[0], cls: "f-prej", rot: "Prejuízo", sub: "< ½ equilíbrio" },
    { de: lim[0], ate: lim[1], cls: "f-abaixo", rot: "Abaixo do equilíbrio", sub: "volta 1 degrau" },
    { de: lim[1], ate: lim[2], cls: "f-paga", rot: "Se paga", sub: "manter" },
    { de: lim[2], ate: lim[3], cls: "f-bom", rot: "Bom", sub: "+20% no orçamento" },
    { de: lim[3], ate: MAX, cls: "f-otimo", rot: "Ótimo", sub: "+30% no orçamento" },
  ];
  return (
    <div className="pa-medidor">
      <div className="pa-medidor-barra">
        {faixas.map((f) => (
          <span key={f.cls} className={f.cls} style={{ left: pos(f.de), width: `calc(${pos(f.ate)} - ${pos(f.de)})` }} />
        ))}
        {pontos.filter((p) => p.r != null).map((p) => (
          <span key={p.rot} className={`pa-medidor-pt${p.ruim ? " ruim" : ""}`} style={{ left: pos(p.r) }}>
            {p.rot} {um(p.r)}×
          </span>
        ))}
        <span className="pa-medidor-eq" style={{ left: pos(1) }} title="ROAS de equilíbrio (retorno 1×)" />
        {pontos.filter((p) => p.r != null).map((p) => (
          <span key={`d${p.rot}`} className={`pa-medidor-dot${p.ruim ? " ruim" : ""}`} style={{ left: pos(p.r) }} title={`${p.rot}: retorno ${um(p.r)}×`} />
        ))}
      </div>
      <div className="pa-medidor-leg">
        {faixas.map((f) => (
          <span key={f.cls} style={{ left: `calc((${pos(f.de)} + ${pos(f.ate)}) / 2)` }}>
            {f.rot}
            <small>{f.sub}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function AbaAds({ l, hoje, ped }) {
  const ads = l.ads;
  if (!ads)
    return (
      <div className="panel">
        <div className="empty">{canalDireto(l.canal) ? "Venda direta: sem Ads." : "Sem Ads neste anúncio."}</div>
      </div>
    );
  const av = ads.av;
  const n = l.adsNum;
  const empate = av.empate;
  const j7 = adsNaJanela(ads.periodos, ads.semanas, somarDias(hoje, -7), hoje);
  const precoAds = ads.precoAds ?? ads.preco;
  const ret7 = j7.gasto > 0 && empate ? (j7.vendas * precoAds) / j7.gasto / empate : null;
  const abrir = () => irParaAba("crescimento", { sub: "ads", adsChave: ads.chave });
  const historico = [...(ads.periodos || [])].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
  // % das vendas que vieram do Ads, no mesmo período do Ads ligado.
  const unPeriodo = n && av.ativo ? ped.filter((p) => String(p.data) >= String(av.ativo.inicio).slice(0, 10) && (!n.ate || String(p.data) <= n.ate)).reduce((t, p) => t + num(p.q), 0) : 0;
  // ROAS ajustado (01/11/2026): vendas via Ads limitadas às PAGAS do anúncio;
  // lucro por venda = a média REAL dos pedidos pagos do período (promo, cupom).
  const aj = av.ativo?.parcial?.ajuste || null;
  const lucroVenda = num(ads.lucroAds ?? ads.lucro);
  const roasShopee = aj && n?.gasto > 0 ? (aj.shopee * precoAds) / n.gasto : null;
  const lucroAntes = n ? n.vendas * lucroVenda : null;
  const lucroDepois = n ? lucroAntes - n.gasto : null;
  const tipo = av.estado === "ok" ? "info" : av.estado;
  return (
    <>
      <div className={`pa-agora st-borda-${tipo}`}>
        <Estado tipo={tipo}>{`Ads · ${ROTULO_ESTADO[tipo] || "situação"}`}</Estado>
        <h4>{av.titulo}</h4>
        {av.texto && <p>{av.texto}</p>}
        <ComoMediuOrcamento uso={av.numeros?.usoOrcamento} />
        <div className="pa-agora-acoes">
          <button type="button" className="btn btn-mini primary" onClick={abrir}>Abrir no Ads (ajustar, pausar, novo período)</button>
          {av.ativo && <ChaveTeto chave={l.ads?.chave} />}
          {av.ativo && <CrescerProposito chave={l.ads?.chave} crescer={l.ads?.crescer} ads={l.ads?.av?.numeros} />}
        </div>
      </div>
      {av.ativo && n ? (
        <>
          <div className="panel">
            <h3>
              Medidor do Ads
              <Ajuda texto="Retorno = ROAS ÷ ROAS de equilíbrio. 1× = o Ads se pagou (lucro zero depois do Ads). As faixas são as mesmas regras do Ads: abaixo do equilíbrio volta 1 degrau no orçamento; 1,2–2× sobe 20%; 2× ou mais sobe 30% (uma vez por semana, com a Shopee gastando ≥ 80%)." />
              <span className="dir">
                período desde {dm(String(av.ativo.inicio).slice(0, 10))}
                {n.ate ? ` · CSV até ${dm(n.ate)}` : ""}
              </span>
            </h3>
            <div className="pa-corpo">
              <Medidor pontos={[{ rot: "período", r: n.retorno }, { rot: "7 dias", r: ret7, ruim: ret7 != null && ret7 < 1 }]} />
              {aj && (aj.estado === "insuficiente" || aj.shopee !== n.vendas) && <p className={`hint${aj.estado === "insuficiente" ? " atencao-txt" : ""}`} style={{ margin: "4px 0 8px" }}>{textoAjusteAds(aj, roasShopee)}</p>}
              {aj?.mudanca && <p className="hint" style={{ margin: "4px 0 8px" }}>{textoMudancaPreco(aj)}</p>}
              <Kpis
                itens={[
                  { label: "ROAS de equilíbrio", valor: um(empate), sub: ads.economiaReal ? `ticket real ${BRL(ads.economiaReal.preco)} ÷ lucro real ${BRL(ads.economiaReal.lucro)}` : "preço ÷ lucro antes do Ads" },
                  { label: aj && aj.estado !== "insuficiente" ? "ROAS ajustado" : "ROAS do período", valor: um(n.roas), sub: aj && aj.estado !== "insuficiente" && roasShopee != null && Math.abs(roasShopee - n.roas) >= 0.05 ? `Shopee diz ${um(roasShopee)}${aj.estado === "provisorio" ? " · provisório" : ""}` : aj?.estado === "provisorio" ? "provisório" : null },
                  { label: "Retorno", valor: n.retorno != null ? `${um(n.retorno)}×` : "—", tom: n.retorno >= 1 ? "good" : n.retorno != null ? "bad" : undefined, sub: n.retorno != null ? `cada R$ 1 voltou R$ ${um(n.retorno)} de lucro` : null },
                  { label: "Últimos 7 dias", valor: ret7 != null ? `${um(ret7)}×` : "—", tom: ret7 != null && ret7 < 1 ? "bad" : undefined, sub: `gasto ${BRL(j7.gasto)}` },
                ]}
              />
            </div>
          </div>
          <div className="panel">
            <h3>
              Métricas do período <span className="dir">CSV do Shopee Ads + pedidos · {n.fonte === "andamento" ? "andamento do CSV" : "semanas"}</span>
            </h3>
            <div className="pa-grade-metricas">
              <Metrica rot="Investimento" v={BRL(n.gasto)} />
              <Metrica rot="Vendido via Ads" v={BRL(n.receita)} />
              <Metrica rot="Vendas via Ads" v={um(n.vendas)} e={aj && aj.shopee !== n.vendas ? `pagas · Shopee: ${aj.shopee}` : null} />
              <Metrica rot="Cliques" v={n.cliques || "—"} />
              <Metrica rot="CPC" v={n.cliques ? BRL(n.gasto / n.cliques) : "—"} e="gasto ÷ cliques" />
              <Metrica rot="Conversão" v={n.cliques ? PCT(n.vendas / n.cliques) : "—"} e="vendas ÷ cliques" />
              <Metrica rot="Custo por venda" v={n.custoPorVenda != null ? BRL(n.custoPorVenda) : "—"} />
              <Metrica rot="ACOS" v={n.receita > 0 ? PCT(n.gasto / n.receita) : "—"} e="gasto ÷ vendido" />
              <Metrica rot="Lucro por venda" v={BRL(lucroVenda)} e={ads.economiaReal ? `antes do Ads · média de ${ads.economiaReal.pagas} pedidos pagos (hoje: ${BRL(ads.economiaReal.lucroHoje)})` : "antes do Ads · preço de hoje"} />
              <Metrica rot="% vendas via Ads" v={unPeriodo > 0 ? `${aj && aj.estado !== "insuficiente" ? "até " : ""}${PCT(Math.min(1, n.vendas / unPeriodo))}` : "—"} e={aj && aj.estado !== "insuficiente" ? "no máximo — os pedidos não dizem quais vieram do Ads" : "das unidades do período"} />
              <Metrica rot="Lucro antes do Ads" v={BRL(lucroAntes)} />
              <Metrica rot="Lucro depois do Ads" v={BRL(lucroDepois + 0)} cls={lucroDepois < 0 ? "neg" : lucroDepois > 0 ? "pos" : ""} />
              <Metrica rot="ROI" v={n.gasto > 0 ? PCT(lucroDepois / n.gasto) : "—"} cls={lucroDepois < 0 ? "neg" : "pos"} e="lucro depois ÷ investido" />
              <Metrica rot="Orçamento" v={n.orcamento ? `${BRL(n.orcamento)}/dia` : "—"} />
              <Metrica rot="Meta de ROAS" v={n.meta ? um(n.meta) : "automático"} />
            </div>
          </div>
        </>
      ) : (
        <div className="panel">
          <div className="empty">Nenhum período de Ads ligado agora.</div>
        </div>
      )}
      {historico.length > 0 && (
        <div className="panel">
          <h3>Histórico de períodos</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="num">Gasto</th>
                  <th className="num">Vendas</th>
                  <th className="num">Retorno</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((p) => {
                  const r = p.id === av.ativo?.id && n ? n : numerosDoPeriodo(p, ads.semanas, precoAds, empate);
                  return (
                    <tr key={p.id}>
                      <td>
                        {dm(String(p.inicio).slice(0, 10))} → {p.fim ? dm(String(p.fim).slice(0, 10)) : "ligado"}
                        {p.tipo === "teste" ? " · teste de lançamento" : ""}
                      </td>
                      <td className="num">{BRL(r.gasto)}</td>
                      <td className="num">{um(r.vendas)}</td>
                      <td className="num">{r.retorno != null ? `${um(r.retorno)}×` : "—"}</td>
                      <td>{r.resultado ? <Estado tipo={r.resultado.chave === "valeu" ? "oportunidade" : r.resultado.chave === "caro" || r.resultado.chave === "revisar" ? "atencao" : "info"}>{r.resultado.texto}</Estado> : <span className="muted-cel">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
function Metrica({ rot, v, e, cls = "" }) {
  return (
    <div className="pa-metrica">
      <small>{rot}</small>
      <b className={cls}>{v}</b>
      {e && <span>{e}</span>}
    </div>
  );
}

function AbaAnuncio({ l, esc, cres }) {
  const abrir = (passo, id = l.itemId) => {
    pedirPasso(passo, id, l.canal.id);
    irParaAba(passo);
  };
  if (l.tipo === "grupo")
    return (
      <div className="panel">
        <div className="empty">
          Anúncio com {l.opcoes} opções.{" "}
          <button type="button" className="link-btn" onClick={() => abrir("ficha", `g:${l.grupo.id}`)}>Ver a ficha (o que digitar por opção) →</button>{" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("publicar")}>Anunciar (↻ / ✓ feito) →</button>
        </div>
      </div>
    );
  const itens = [l.item, ...(l.variacoes || [])].filter((it) => it && (it.id === l.itemId || esc.cobraNoCanal(it, l.canal)));
  const rows = itens.map((it) => {
    const tipo = { p: "produto", v: "variacao", k: "kit" }[it.id[0]];
    const salvo = esc.precos.find((p) => p.item_tipo === tipo && p.item_id === it.id.slice(2) && p.canal_id === l.canal.id);
    const rampa = esc.mapaRampa.get(`${it.id}|${l.canal.id}`);
    const { desconto } = descontoDoItem(it.id, l.canal, { itens: esc.itens, produtos: esc.produtos, kits: esc.kits });
    const an = rampa || (salvo ? anuncioDoItem({ itemId: it.id, canal: l.canal, real: num(salvo.preco), desconto, publicacoes: esc.publicacoesCanal }) : null);
    const pub = (esc.publicacoesCanal || []).find((x) => x.item_id === it.id.slice(2) && x.canal_id === l.canal.id);
    return { it, an, pub, rampa: !!rampa };
  });
  const est = l.rampa?.est;
  const avs = (cres.avalH?.registros || []).filter((a) => a.item_id === l.itemId.slice(2) && a.canal_id === l.canal.id).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const ult = avs[0];
  return (
    <>
      <div className="panel">
        <h3>
          O que digitar em {l.canal.nome}
          <span className="dir">o preço original fica fixo depois de anunciado; só a promo muda</span>
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Preço original</th>
                <th className="num">Promo</th>
                <th className="num">Cliente paga</th>
                <th>No canal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ it, an, pub, rampa }) => {
                const mudou = pub && an && (Math.abs(num(pub.promo) - num(an.promo)) > 0.4 || Math.abs(num(pub.cliente_paga) - num(an.clientePaga)) > 0.009);
                return (
                  <tr key={it.id}>
                    <td>
                      {it.id === l.itemId ? (l.tipo === "kit" ? it.nome : "1 unidade") : it.nomeVariacao || it.nome}
                      {rampa && <div className="sub-num">pela Rampa (degrau de agora)</div>}
                    </td>
                    <td className="num">{an ? BRL(an.original) : "—"}</td>
                    <td className="num">{an ? `${an.promo}%` : "—"}</td>
                    <td className="num">{an ? BRL(an.clientePaga) : "—"}</td>
                    <td>{!pub ? <span className="muted-cel">ainda não marcado</span> : mudou ? <Estado tipo="atencao">↻ atualizar a promo</Estado> : <span className="muted-cel">✓ em dia</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pa-botoes pa-corpo">
          <button type="button" className="btn btn-mini primary" onClick={() => abrir("publicar")}>Anunciar (↻ / ✓ feito)</button>
          <button type="button" className="btn btn-mini" onClick={() => abrir("ficha")}>Ficha do anúncio (SKU, cores)</button>
          {l.rampa && <button type="button" className="btn btn-mini" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: l.rampa.r.id })}>Checklist do anúncio (Rampa)</button>}
        </div>
      </div>
      <div className="pa-grid2">
        <div className="panel">
          <h3>Funil (Desempenho)</h3>
          <div className="pa-corpo">
            {l.funil ? (
              <FunilQuatro funil={l.funil} d={l.desempenho} referencia={l.refFunil} />
            ) : est?.funil && est.funil.status !== "sem-dados" ? (
              <div className="kv-lista">
                <span>Impressões</span>
                <b>{est.funil.visualizacoes ?? "—"}</b>
                <span>Cliques (CTR)</span>
                <b>
                  {est.funil.visitas ?? "—"}
                  {est.funil.ctr != null ? ` · ${PCT(est.funil.ctr)}` : ""}
                </b>
                <span>Conversão</span>
                <b>{est.funil.conversao != null ? PCT(est.funil.conversao) : "—"}</b>
                <span>Diagnóstico</span>
                <b>{funilTexto(est.funil)}</b>
              </div>
            ) : (
              <span className="muted-cel">{l.canal?.tipo === "shopee" ? "Envie o Desempenho do produto em Atualizar dados." : "Funil só existe na Shopee (Desempenho do produto)."}</span>
            )}
          </div>
        </div>
        <div className="panel">
          <h3>
            Avaliações{" "}
            <span className="dir">
              <button type="button" className="link-btn" onClick={() => irParaAba("importar")}>atualizar →</button>
            </span>
          </h3>
          <div className="pa-corpo">
            {ult ? (
              <div className="kv-lista">
                <span>Total</span>
                <b>
                  {ult.total ?? "—"}
                  {ult.nota != null ? ` · nota ${String(ult.nota).replace(".", ",")}` : ""}
                </b>
                <span>Última conferência</span>
                <b>{dm(String(ult.data).slice(0, 10))}</b>
                <span>1–2★ novas</span>
                <b>{ult.ruins_novas ?? 0}</b>
              </div>
            ) : (
              <span className="muted-cel">Sem avaliação registrada neste canal.</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function AbaCusto({ l }) {
  const it = l.item;
  const preco = l.agora?.preco || 0;
  const tx = preco > 0 ? resolverTaxasNoPreco(l.canal.tipo, preco, null, "classico", it?.peso || null) : null;
  const taxa = tx ? preco * num(tx.comissaoPct) + num(tx.taxaFixa) : null;
  return (
    <div className="panel">
      <h3>
        Custo neste canal <span className="dir">custo de hoje · por venda</span>
      </h3>
      <div className="pa-corpo">
        <div className="kv-lista">
          <span>Fabricação</span>
          <b>{BRL(it?.custoProducao)}</b>
          <span>Embalagem</span>
          <b>{BRL(it?.embalagem)}</b>
          <span>Frete (seu)</span>
          <b>{BRL(it?.frete)}</b>
          <span>
            <b>Repor (total)</b>
          </span>
          <b>{BRL(it?.custoTotal)}</b>
          {tx && (
            <>
              <span>Taxa {l.canal.nome} no preço de agora</span>
              <b>
                {BRL(taxa)} ({PCT(tx.comissaoPct)}
                {num(tx.taxaFixa) ? ` + ${BRL(tx.taxaFixa)}` : ""})
              </b>
            </>
          )}
          {l.agora && (
            <>
              <span>Sobra (lucro)</span>
              <b>{BRL(l.agora.lucro)}</b>
            </>
          )}
        </div>
        <p className="muted-cel">
          A composição completa (material, máquina, energia, falhas…) e a simulação ficam na{" "}
          <button type="button" className="link-btn" onClick={() => abrirProduto(l.itemId, "custo")}>
            página do {l.tipo === "kit" ? "kit" : "produto"} → Custo
          </button>
          .
        </p>
      </div>
    </div>
  );
}
