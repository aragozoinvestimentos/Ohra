import { useMemo, useState } from "react";
import { alertaPreco } from "../lib/estrategia.js";
import { menorFinalComFreteGratis } from "../lib/freteGratis.js";
import FreteAviso from "./FreteAviso.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useRampas } from "../hooks/useRampas.js";
import { BRL, PCT } from "../lib/format.js";
import { hojeISO } from "../lib/fluxoCaixa.js";

// "2026-10-03" → "03/10" (sem passar por Date, que no fuso do Brasil voltaria um dia).
// Frete grátis (v38) de um preço no canal — aviso único via alertaPreco.
const freteDe = (valor, canal) => (canal && valor > 0 ? alertaPreco({ preco: valor, canal }).frete : null);
const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");
import { anuncioDaRampa } from "../lib/rampaAnuncio.js";
import { gravarPrecoNovo } from "../lib/estrategia.js";
import { CHECKLIST_ANUNCIO, REGRAS_PADRAO, estadoRampa, finalAcima, metricasFunil, normalizarDegraus, referenciaFunilLoja, regrasDaLoja, sugerirDegraus, zeroAZero } from "../lib/rampa.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import BuscaItem from "./BuscaItem.jsx";
import GraficoRampa from "./GraficoRampa.jsx";
import Afiliados from "./Afiliados.jsx";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const virgula = (v, casas = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");


function Copiavel({ valor, texto }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="copiavel"
      title="Copiar"
      onClick={() => {
        try {
          navigator.clipboard?.writeText(texto);
        } catch {
          // sem área de transferência — só mostra
        }
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {valor}
      {ok && <span className="salvo-check">✓</span>}
    </button>
  );
}

const SUBABAS_CRESC = [
  { key: "rampa", label: "Rampa de preço" },
  { key: "afiliados", label: "Afiliados" },
];
const lerSub = () => {
  try {
    return localStorage.getItem("ohra:crescimento-sub") === "afiliados" ? "afiliados" : "rampa";
  } catch {
    return "rampa";
  }
};

export default function Crescimento({ onToast }) {
  const dados = useEscada();
  const { itens, produtos, canais, precos, cfgDoProduto, cfgLoja } = dados;
  const rampasH = useRampas({ comRegistros: true });
  const { rampas, registros } = rampasH;
  const af = useAfiliados();
  const regras = useMemo(() => regrasDaLoja(cfgLoja), [cfgLoja]);
  const hoje = hojeISO();
  const [sub, setSub] = useState(lerSub);
  const [semanaAberta, setSemanaAberta] = useState(false);

  // Referência do funil: mediana de CTR e conversão dos produtos da loja
  // (só com 5+ produtos com funil calculável; senão, referência geral).
  const funilLoja = useMemo(
    () => referenciaFunilLoja(rampas.map((r) => metricasFunil(r, registros.filter((g) => g.rampa_id === r.id), regras, hoje))),
    [rampas, registros, regras, hoje]
  );

  // Uma linha por rampa, com tudo calculado ao vivo.
  const linhas = useMemo(() => {
    return rampas
      .map((r) => {
        const produto = produtos.find((p) => p.id === r.produto_id);
        const canal = canais.find((c) => c.id === r.canal_id);
        const item = itens.find((i) => i.id === `p:${r.produto_id}`);
        if (!produto || !canal || !item) return null;
        const cfg = cfgDoProduto(r.produto_id);
        const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
        const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo: salvo ? num(salvo.preco) : null, funilLoja };
        const regs = registros.filter((g) => g.rampa_id === r.id);
        const est = estadoRampa(r, regs, regras, ctx, hoje);
        return { r, produto, canal, item, cfg, ctx, est };
      })
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, registros, produtos, canais, itens, precos, cfgDoProduto, regras, hoje, funilLoja]);

  // Comissão de afiliado por item × canal (ao vivo).
  const linhasAf = useMemo(
    () => linhasComissao({ itens, canais, precos, cfgDoProduto, config: af.config, linhasRampa: linhas }),
    [itens, canais, precos, cfgDoProduto, af.config, linhas]
  );
  const mapaAf = useMemo(() => new Map(linhasAf.map((l) => [l.chave, l])), [linhasAf]);
  const semanaAf = useMemo(
    () => resumoSemana({ afRegistros: af.registros, rampaRegistros: registros, rampas, mapaLinhas: mapaAf, linhasRampa: linhas, hoje }),
    [af.registros, registros, rampas, mapaAf, linhas, hoje]
  );

  function trocarSub(k) {
    setSub(k);
    try {
      localStorage.setItem("ohra:crescimento-sub", k);
    } catch {
      // sem localStorage — só não lembra
    }
  }

  const podeRegistrar = linhas.length > 0 || linhasAf.some((l) => l.conf.ativo);

  return (
    <>
      <div className="subabas">
        {SUBABAS_CRESC.map((s) => (
          <button key={s.key} type="button" data-sub={s.key} className={`btn${sub === s.key ? " primary" : ""}`} onClick={() => trocarSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === "rampa" ? (
        <RampaPreco
          dados={dados}
          rampasH={rampasH}
          regras={regras}
          linhas={linhas}
          hoje={hoje}
          comissaoSemana={semanaAf.comissaoRampa}
          podeRegistrar={podeRegistrar}
          onRegistrar={() => setSemanaAberta(true)}
          onToast={onToast}
        />
      ) : (
        <Afiliados
          dados={dados}
          af={af}
          rampasH={rampasH}
          regras={regras}
          linhasAf={linhasAf}
          mapaAf={mapaAf}
          semana={semanaAf}
          hoje={hoje}
          podeRegistrar={podeRegistrar}
          onRegistrar={() => setSemanaAberta(true)}
          onToast={onToast}
        />
      )}
      {semanaAberta && (
        <RegistrarSemanaDialog linhas={linhas} linhasAf={linhasAf} af={af} onToast={onToast} onClose={() => setSemanaAberta(false)} />
      )}
    </>
  );
}

function RampaPreco({ dados, rampasH, regras, linhas, hoje, comissaoSemana, podeRegistrar, onRegistrar, onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const { itens, produtos, kits, precos, concorrentes, cfgDoProduto } = dados;
  const { rampas, disponivel, carregando } = rampasH;
  const [selId, setSelId] = useState(null);
  const [iniciar, setIniciar] = useState(null); // {} novo | { rampa } editar degraus
  const [mudar, setMudar] = useState(null); // { linha, dir: 1 | -1 }
  const [encerrar, setEncerrar] = useState(null);
  const [verRegras, setVerRegras] = useState(false);
  const [acimaConfirma, setAcimaConfirma] = useState(null); // { tipo: "testar"|"voltar"|"aprovar", linha, preco }
  const [salvando, setSalvando] = useState(false);

  const sel = linhas.find((l) => l.r.id === selId) || linhas[0] || null;

  // Preços "vendendo agora" de todos os produtos em rampa (por canal) — os
  // kits de produtos diferentes usam o degrau de cada peça.
  const precosRampa = useMemo(() => {
    const mapa = new Map(linhas.map((l) => [`${l.r.produto_id}|${l.r.canal_id}`, l.est.preco]));
    return precos.map((p) => (p.item_tipo === "produto" && mapa.has(`${p.item_id}|${p.canal_id}`) ? { ...p, preco: mapa.get(`${p.item_id}|${p.canal_id}`) } : p));
  }, [precos, linhas]);

  // O que digitar no canal pro produto selecionado (avulso, variações, kits)
  // — conta compartilhada com a Anunciar e a Ficha (lib/rampaAnuncio.js).
  const anuncio = useMemo(() => {
    if (!sel) return null;
    const { canal, est, cfg, r } = sel;
    const res = anuncioDaRampa({ produtoId: r.produto_id, canal, preco: est.preco, alvo: est.alvo, cfg, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto });
    // Lucro do avulso = o da rampa (mesmo custo/taxas ao vivo).
    return { ...res, linhas: res.linhas.map((l) => (l.id === "avulso" ? { ...l, lucro: est.lucroAtual } : l)) };
  }, [sel, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto]);

  // --- KPIs ---
  const prontos = linhas.filter((l) => l.est.sugestao.chave === "subir");
  const segurando = linhas.filter((l) => ["segurar", "revisar", "voltar"].includes(l.est.sugestao.chave));
  const lucroSemana = linhas.reduce((s, l) => s + (l.est.lucroSemana || 0), 0) - (comissaoSemana || 0);
  const lucroSemanaAds = linhas.reduce((s, l) => s + (l.est.lucroSemanaAds ?? l.est.lucroSemana ?? 0), 0) - (comissaoSemana || 0);
  const lucroSemanaAlvo = linhas.reduce((s, l) => s + (l.est.lucroSemanaAlvo || 0), 0);
  const temSemana = linhas.some((l) => l.est.lucroSemana != null);

  async function aplicarMudanca() {
    const { linha, dir } = mudar;
    const { r, est } = linha;
    const novo = Math.max(0, Math.min(est.degraus.length - 1, est.i + dir));
    setSalvando(true);
    const { error } = await supabase
      .from("rampas_preco")
      .update({ degrau_atual: novo, desde: hoje, base_avaliacoes: est.avaliacoesTotal, atualizado_em: new Date().toISOString() })
      .eq("id", r.id);
    if (!error)
      await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: r.id, tipo: dir > 0 ? "subida" : "descida", data: hoje, degrau: novo, preco: est.degraus[novo] });
    setSalvando(false);
    setMudar(null);
    if (error) return onToast?.(`Não foi possível mudar o degrau: ${error.message}`);
    onToast?.(`${linha.produto.nome}: agora vendendo ${BRL(est.degraus[novo])} em ${linha.canal.nome} — atualize o anúncio (preço original e promo abaixo)`);
  }

  async function encerrarRampa() {
    const l = encerrar;
    setEncerrar(null);
    const { error } = await supabase.from("rampas_preco").delete().eq("id", l.r.id);
    if (error) return onToast?.(`Não foi possível encerrar: ${error.message}`);
    onToast?.(`Rampa de ${l.produto.nome} encerrada (o preço salvo continua o mesmo)`);
  }

  async function atualizarRampa(l, campos, msg) {
    const { error } = await supabase.from("rampas_preco").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", l.r.id);
    if (error) {
      onToast?.(/teste_/.test(error.message) ? "Falta rodar o supabase/schema_v34.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
      return false;
    }
    if (msg) onToast?.(msg);
    return true;
  }

  const acoesTeste = {
    iniciar: (l, orc) =>
      atualizarRampa(
        l,
        { teste_status: "iniciado", teste_inicio: hoje, teste_fim: null, teste_orcamento: orc, teste_dias: regras.testeDias, teste_meta: regras.testeMeta },
        `Teste de lançamento iniciado: ${BRL(orc)} em ${regras.testeDias} dias (≈ ${BRL(orc / regras.testeDias)}/dia). Registre gasto, cliques e vendas via Ads.`
      ),
    pular: (l) => atualizarRampa(l, { teste_status: "pulado" }, "Teste de lançamento pulado"),
    concluir: (l) => atualizarRampa(l, { teste_status: "concluido", teste_fim: hoje }, "Teste concluído — desligue o Ads na plataforma"),
    reabrir: (l) => atualizarRampa(l, { teste_status: null, teste_inicio: null, teste_fim: null }, "Teste de lançamento reaberto"),
  };

  async function testarAcima(l, preco) {
    const lista = normalizarDegraus([...l.est.degraus, preco]);
    const idx = lista.findIndex((d) => Math.abs(d - preco) < 0.005);
    setSalvando(true);
    const ok = await atualizarRampa(l, { degraus: lista, degrau_atual: idx, desde: hoje, base_avaliacoes: l.est.avaliacoesTotal });
    if (ok) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo: "subida", data: hoje, degrau: idx, preco, observacao: "acima do alvo" });
    setSalvando(false);
    setAcimaConfirma(null);
    if (ok) onToast?.(`Testando ${BRL(preco)} (acima do alvo) por ${regras.acimaDias} dias — atualize o anúncio`);
  }

  async function voltarAoAlvo(l) {
    const idx = l.est.degraus.findIndex((d) => Math.abs(d - l.est.alvo) < 0.005);
    const novo = idx >= 0 ? idx : Math.max(0, l.est.i - 1);
    const bloq = new Date(`${hoje}T12:00:00`);
    bloq.setDate(bloq.getDate() + regras.acimaBloqueioDias);
    setSalvando(true);
    const ok = await atualizarRampa(l, {
      degrau_atual: novo,
      desde: hoje,
      base_avaliacoes: l.est.avaliacoesTotal,
      checklist: { ...(l.r.checklist || {}), acimaBloqueadoAte: bloq.toISOString().slice(0, 10) },
    });
    if (ok) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo: "descida", data: hoje, degrau: novo, preco: l.est.degraus[novo], observacao: "volta ao alvo" });
    setSalvando(false);
    setAcimaConfirma(null);
    if (ok) onToast?.(`De volta ao alvo (${BRL(l.est.degraus[novo])}). Novo teste acima só daqui a ${regras.acimaBloqueioDias} dias.`);
  }

  // Teste acima aprovado: o preço salvo (alvo) passa a ser o preço testado — só com confirmação.
  async function aprovarAcima(l) {
    const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === l.r.produto_id && p.canal_id === l.r.canal_id);
    if (!salvo) return onToast?.("Preço salvo não encontrado");
    const preco = l.est.preco;
    const lucro = l.est.lucroEm(preco);
    setSalvando(true);
    // Preço novo = decisão nova: zera a estratégia (estrategia.js).
    const { error } = await gravarPrecoNovo((extra) =>
      supabase
        .from("precos_canal")
        .update({ preco, custo_total: l.ctx.custo, lucro, margem: preco > 0 ? lucro / preco : null, atualizado_em: new Date().toISOString(), ...extra })
        .eq("id", salvo.id)
    );
    setSalvando(false);
    setAcimaConfirma(null);
    if (error) return onToast?.(`Não foi possível atualizar o preço salvo: ${error.message}`);
    onToast?.(`Preço salvo de ${l.produto.nome} em ${l.canal.nome} atualizado para ${BRL(preco)} — é o novo alvo`);
  }

  async function marcarChecklist(l, chave, valor) {
    const novo = { ...(l.r.checklist || {}), [chave]: valor };
    const { error } = await supabase.from("rampas_preco").update({ checklist: novo }).eq("id", l.r.id);
    if (error) onToast?.(`Não foi possível salvar: ${error.message}`);
  }

  if (!supabase)
    return (
      <div className="panel">
        <div className="empty">Configure o Supabase pra usar a aba Crescimento.</div>
      </div>
    );
  if (!disponivel)
    return (
      <div className="panel">
        <h3>Crescimento</h3>
        <div className="empty">
          Falta criar as tabelas da rampa no banco — rode o <strong>supabase/schema_v33.sql</strong> no SQL Editor do Supabase e recarregue a página.
        </div>
      </div>
    );

  return (
    <>
      <TopbarAcoes aba="crescimento">
        <button type="button" className="btn" onClick={() => setIniciar({})}>
          + Iniciar rampa
        </button>
        <button type="button" className="btn primary" onClick={onRegistrar} disabled={!podeRegistrar}>
          Registrar semana
        </button>
      </TopbarAcoes>

      <Kpis
        itens={[
          {
            label: "Em rampa",
            valor: String(linhas.length),
            sub: !linhas.length
              ? "nenhum produto ainda"
              : linhas.filter((l) => l.est.teste.status === "recomendado").length
                ? `${linhas.filter((l) => l.est.teste.status === "recomendado").length} com teste de lançamento recomendado`
                : `${new Set(linhas.map((l) => l.canal.id)).size} canal(is)`,
            tom: linhas.some((l) => l.est.teste.status === "recomendado") ? "warn" : undefined,
          },
          { label: "Prontos pra subir", valor: String(prontos.length), tom: prontos.length ? "good" : undefined, sub: prontos.map((l) => l.produto.nome).join(", ") || "—" },
          {
            label: "Segurando / revisar",
            valor: String(segurando.length),
            tom: segurando.length ? "warn" : undefined,
            sub: segurando.length ? `${segurando.filter((l) => l.est.sugestao.chave === "revisar").length} revisar anúncio · ${segurando.filter((l) => l.est.sugestao.chave === "voltar").length} voltar` : "—",
          },
          {
            label: "Lucro da semana",
            valor: temSemana ? BRL(lucroSemana) : "—",
            sub: temSemana
              ? `${BRL(lucroSemanaAds)} depois de Ads${comissaoSemana > 0 ? ` · já sem ${BRL(comissaoSemana)} de comissão` : ""} · no alvo seria ${BRL(lucroSemanaAlvo)}`
              : "registre a semana pra ver",
          },
        ]}
      />

      <div className="panel">
        <h3 className="section-title">
          <span>
            Produtos em rampa
            <Ajuda texto="Rampa de preço: o produto entra perto do 0 a 0 pra ganhar vendas e avaliações no orgânico e sobe em degraus pequenos (até ~5%, finais ,49/,99) até o PREÇO ALVO — o preço salvo em Produtos precificados, que não muda. Sobe só quando passa em todos os portões. Clique numa linha pra ver o detalhe embaixo. Nada aqui muda o cadastro." />
          </span>
          <span className="h3-contagem">semana de {dataBR(hoje)}</span>
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : !linhas.length ? (
          <div className="empty">
            Nenhum produto em rampa. Use “+ Iniciar rampa” no topo: escolha o produto, o canal e o preço em que ele já está vendendo.
          </div>
        ) : (
          <div className="table-wrap lista-rampa">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Fase</th>
                  <th className="num">0 a 0</th>
                  <th className="num">Vendendo</th>
                  <th className="num">Alvo</th>
                  <th>Próximo degrau</th>
                  <th>Portões</th>
                  <th>Sugestão</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const e = l.est;
                  return (
                    <tr key={l.r.id} className={`linha-clicavel${sel?.r.id === l.r.id ? " linha-atual" : ""}`} onClick={() => setSelId(l.r.id)}>
                      <td>
                        <b>{l.produto.nome}</b>
                        <div className="sub-linha">
                          <CanalTag canal={l.canal} /> · {e.avaliacoesTotal} avaliações{e.nota != null ? ` · nota ${virgula(e.nota, 1)}` : ""}
                        </div>
                        {l.r.checklist?.pronto ? (
                          <span className="badge good tag-pronto" title={`Você marcou como pronto em ${diaMes(l.r.checklist.pronto)}: agora é só acompanhar e registrar a semana`}>
                            ✓ pronto
                          </span>
                        ) : (
                          <span className="badge neutro tag-pronto" title="Ainda não marcado como pronto (botão no fim do painel do produto, em Revisar anúncio)">
                            preparando
                          </span>
                        )}
                        <TagTeste teste={e.teste} />
                      </td>
                      <td>
                        {e.fase.rotulo}
                        {e.fase.chave !== "acima" ? ` · ${e.i + 1} de ${e.degraus.length}` : ` · ${BRL(e.preco)}`}
                        <div className="degrau-dots">
                          {e.degraus.map((d, k) => (
                            <i key={k} className={k < e.i ? "ok" : k === e.i ? "at" : ""} />
                          ))}
                        </div>
                      </td>
                      <td className="num">{BRL(e.zero)}</td>
                      <td className="num">
                        <b>{BRL(e.preco)}</b>
                        <div className="sub-num">lucro {BRL(e.lucroAtual)}</div>
                      </td>
                      <td className="num">
                        {BRL(e.alvo)}
                        <div className="sub-num">lucro {BRL(e.lucroAlvo)}</div>
                      </td>
                      <td>{e.proximo ? <>{BRL(e.proximo)} <span className="muted-cel">(+{PCT(e.proximo / e.preco - 1)})</span></> : "—"}</td>
                      <td>
                        {e.fase.chave === "alvo" ? (
                          <span className="muted-cel">—</span>
                        ) : (
                          <div className="chips-portoes">
                            {e.portoes.map((p) => (
                              <span key={p.chave} className={`chip-portao ${p.ok ? "ok" : "no"}`} title={`${p.rotulo}: ${p.valor}`}>
                                {p.ok ? p.curto : p.falta ? `faltam ${p.falta} ${p.curto}` : p.curto}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${{ good: "good", warn: "warn", bad: "bad" }[e.sugestao.tom] || "neutro"}`}>{e.sugestao.rotulo}</span>
                        {e.sugestao.chave === "revisar" && e.anuncio && (
                          <div className="sub-num" title={`${e.anuncio.titulo} — por onde começar`}>começar por: {e.anuncio.porOnde.toLowerCase()}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && (
        <Detalhe
          l={sel}
          anuncio={anuncio}
          regras={regras}
          onMudar={(dir) => setMudar({ linha: sel, dir })}
          onEditar={() => setIniciar({ rampa: sel.r })}
          onEncerrar={() => setEncerrar(sel)}
          onChecklist={marcarChecklist}
          acoesTeste={acoesTeste}
          onAcima={(tipo, preco) => setAcimaConfirma({ tipo, linha: sel, preco })}
        />
      )}
      {acimaConfirma && (
        <ConfirmDialog
          titulo={{ testar: "Testar acima do alvo", voltar: "Voltar ao alvo", aprovar: "Atualizar o preço salvo" }[acimaConfirma.tipo]}
          confirmarLabel={salvando ? "Salvando…" : { testar: "Testar", voltar: "Voltar", aprovar: "Atualizar preço salvo" }[acimaConfirma.tipo]}
          onConfirm={() =>
            acimaConfirma.tipo === "testar"
              ? testarAcima(acimaConfirma.linha, acimaConfirma.preco)
              : acimaConfirma.tipo === "voltar"
                ? voltarAoAlvo(acimaConfirma.linha)
                : aprovarAcima(acimaConfirma.linha)
          }
          onCancel={() => setAcimaConfirma(null)}
        >
          <p className="modal-msg">
            {acimaConfirma.tipo === "testar" &&
              `${acimaConfirma.linha.produto.nome}: ${BRL(acimaConfirma.linha.est.alvo)} → ${BRL(acimaConfirma.preco)} por ${regras.acimaDias} dias. O preço salvo continua ${BRL(acimaConfirma.linha.est.alvo)} até você aprovar. Atualize o anúncio com o preço original e a promo da tela.`}
            {acimaConfirma.tipo === "voltar" &&
              `Volta pra ${BRL(acimaConfirma.linha.est.alvo)}. Um novo teste acima do alvo só é sugerido daqui a ${regras.acimaBloqueioDias} dias.`}
            {acimaConfirma.tipo === "aprovar" &&
              `O preço salvo de ${acimaConfirma.linha.produto.nome} em ${acimaConfirma.linha.canal.nome} muda de ${BRL(acimaConfirma.linha.est.alvo)} para ${BRL(acimaConfirma.linha.est.preco)} — vira o novo alvo e aparece em Produtos precificados, Anunciar e no resto do app.`}
          </p>
        </ConfirmDialog>
      )}

      <div className={`panel${verRegras ? "" : " panel-recolhido"}`}>
        <h3 className="section-title">
          <button type="button" className={`variacoes-toggle${verRegras ? " aberto" : ""}`} onClick={() => setVerRegras((v) => !v)}>
            <span className="seta">▸</span> Regras dos portões
          </button>
          <span className="h3-contagem">
            {regras.avaliacoes} avaliações · {regras.vendas} vendas · nota {virgula(regras.nota, 1)} · {regras.dias} dias por degrau
          </span>
        </h3>
        {verRegras && <RegrasPortoes regras={regras} loja={lojas.find((l) => l.id === lojaId)} atualizar={atualizar} onToast={onToast} />}
      </div>

      {iniciar && (
        <IniciarRampaDialog
          dados={dados}
          rampas={rampas}
          regras={regras}
          editar={iniciar.rampa || null}
          onToast={onToast}
          onClose={(id) => {
            setIniciar(null);
            if (id) setSelId(id);
          }}
        />
      )}
      {mudar && (
        <ConfirmDialog
          titulo={mudar.dir > 1 ? "Subir 2 degraus" : mudar.dir > 0 ? "Subir degrau" : "Voltar degrau"}
          confirmarLabel={salvando ? "Salvando…" : mudar.dir > 0 ? "Subir" : "Voltar"}
          onConfirm={aplicarMudanca}
          onCancel={() => setMudar(null)}
        >
          {(() => {
            const e = mudar.linha.est;
            const novo = e.degraus[Math.max(0, Math.min(e.degraus.length - 1, e.i + mudar.dir))];
            const lNovo = e.lucroEm(novo);
            return (
              <p className="modal-msg">
                {mudar.linha.produto.nome} em {mudar.linha.canal.nome}: <b>{BRL(e.preco)}</b> → <b>{BRL(novo)}</b> (lucro {BRL(e.lucroAtual)} → {BRL(lNovo)}).
                Os kits e o preço original/promo são recalculados na tela pra você atualizar o anúncio. O preço salvo (alvo) não muda.
                {mudar.dir > 0 && !e.portoesOk ? " Atenção: nem todos os portões estão ✓." : ""}
                {e.dias < e.diasMin ? ` Mudança recente: o preço mudou há ${e.dias} dia${e.dias === 1 ? "" : "s"} — o ideal é esperar ${e.diasMin} pra não mexer no preço o tempo todo.` : ""}
                {mudar.dir > 0 && e.campanhaPerto ? ` Campanha em ${e.diasAteCampanha} dia(s): aumentar agora pode barrar a entrada na campanha ou parecer preço inflado.` : ""}
              </p>
            );
          })()}
        </ConfirmDialog>
      )}
      {encerrar && (
        <ConfirmDialog
          titulo="Encerrar rampa"
          mensagem={`Encerrar a rampa de "${encerrar.produto.nome}" em ${encerrar.canal.nome}? Os registros semanais dela são apagados. O preço salvo continua o mesmo.`}
          confirmarLabel="Encerrar"
          perigo
          onConfirm={encerrarRampa}
          onCancel={() => setEncerrar(null)}
        />
      )}
    </>
  );
}

const TESTE_TAG = {
  observando: ["neutro", (t) => `observando orgânico · dia ${t.dia} de ${t.de}`],
  recomendado: ["warn", () => "teste de lançamento recomendado"],
  andamento: ["acc", (t) => `teste em andamento · ${t.diasRestantes}d`],
  concluido: ["good", (t) => `teste concluído${t.resultado ? ` · ${t.resultado.titulo.toLowerCase()}` : ""}`],
};
function TagTeste({ teste }) {
  const c = TESTE_TAG[teste?.status];
  if (!c) return null;
  return <span className={`tag-teste tag-${c[0]}`}>{c[1](teste)}</span>;
}

function Detalhe({ l, anuncio, regras, onMudar, onEditar, onEncerrar, onChecklist, acoesTeste, onAcima }) {
  const e = l.est;
  const noAlvo = e.noAlvo;
  const [orcEdit, setOrcEdit] = useState("");
  const t = e.teste;
  const checklistIncompleto = ["foto", "uso", "titulo"].filter((k) => !l.r.checklist?.[k]);
  const maxD = Math.max(...e.degraus, 1);
  const minD = Math.min(...e.degraus, maxD);
  const alt = (d) => 26 + ((d - minD) / Math.max(0.01, maxD - minD)) * 84;
  const faltam = e.portoes.filter((p) => !p.ok);
  const ads = e.ads;
  const roasPos = (v) => Math.max(2, Math.min(98, (v / Math.max(e.roasMin * 2, (e.roas || 0) * 1.2, 1)) * 100));

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          {l.produto.nome} <CanalTag canal={l.canal} />
          <span className="h3-contagem">
            degrau {e.i + 1} de {e.degraus.length} desde {dataBR(l.r.desde)} ({e.dias} dia{e.dias === 1 ? "" : "s"}) · {e.vendasTotal} vendas no total
          </span>
        </span>
        <span className="acoes-detalhe">
          <button type="button" className="btn btn-mini" onClick={onEditar}>Editar degraus</button>
          <button type="button" className="btn btn-mini" onClick={() => onMudar(-1)} disabled={e.i === 0}>↓ Voltar degrau</button>
          <button type="button" className={`btn btn-mini${e.sugestao.chave === "subir" && e.sugestao.saltos !== 2 ? " primary" : ""}`} onClick={() => onMudar(1)} disabled={noAlvo || !e.proximo}>
            ↑ Subir{e.proximo ? ` para ${BRL(e.proximo)}` : ""}
          </button>
          {e.sugestao.saltos === 2 && (
            <button type="button" className="btn btn-mini primary" onClick={() => onMudar(2)}>
              ↑↑ Subir 2 (para {BRL(e.degraus[e.i + 2])})
            </button>
          )}
          <button type="button" className="del" title="Encerrar rampa" onClick={onEncerrar}>×</button>
        </span>
      </h3>

      <div className="grid-rampa">
        <div>
          <h4 className="sub-h">Plano de preço</h4>
          <div className="ladder">
            {e.degraus.map((d, k) => (
              <div key={k} className={`deg${k < e.i ? " ok" : k === e.i ? " at" : ""}${Math.abs(d - e.alvo) < 0.005 ? " alvo" : ""}${d > e.alvo + 0.004 ? " acima" : ""}`}>
                <div className="bar" style={{ height: alt(d) }} />
                <b>{virgula(d)}</b>
                <span className="lu">{Math.abs(d - e.alvo) < 0.005 ? "alvo · " : d > e.alvo + 0.004 ? "teste · " : ""}{BRL(e.lucroEm(d))}</span>
                {freteDe(d, l.canal) && <span className="lu-frete" title={freteDe(d, l.canal).texto}>paga frete</span>}
              </div>
            ))}
          </div>
          {e.degraus.some((d) => freteDe(d, l.canal)) && (
            <FreteAviso frete={freteDe(Math.min(...e.degraus), l.canal)} dica={`degraus abaixo de ${BRL(freteDe(Math.min(...e.degraus), l.canal).min)} ficam sem frete grátis — o 1º degrau sugerido já parte de ${BRL(menorFinalComFreteGratis(l.canal, finalAcima))}`} />
          )}
          <p className="hint" style={{ margin: "6px 0 0" }}>
            0 a 0 hoje: {BRL(e.zero)} (custo e taxas atuais). O lucro de cada degrau acompanha o custo ao vivo.
          </p>

          {!noAlvo && (
            <>
              <h4 className="sub-h">Portões para subir <span className="muted-cel">(todos precisam estar ✓)</span></h4>
              <div className="campanha-linha">
                <label>
                  Próxima campanha da plataforma <span className="muted-cel">(opcional)</span>
                </label>
                <input type="date" value={l.r.checklist?.campanha || ""} onChange={(ev) => onChecklist(l, "campanha", ev.target.value || null)} />
                {e.campanhaPerto && <span className="badge warn">não subir até a campanha</span>}
              </div>
              <ul className="lista-portoes">
                {e.portoes.map((p) => (
                  <li key={p.chave} className={p.ok ? "ok" : "no"}>
                    <span className="ic">{p.ok ? "✓" : "✗"}</span>
                    {p.rotulo}
                    <span className="val">{p.valor}</span>
                  </li>
                ))}
              </ul>
              {e.alertaNota && (
                <div className="alerta alerta-bad">
                  <b>Nota abaixo de {virgula(regras.notaAlerta, 1)}</b>Revise o produto/anúncio antes de subir — avaliação ruim costuma ser sobre o produto ou a entrega, não o preço.
                </div>
              )}
              {e.sugestao.chave === "subir" ? (
                <div className="alerta alerta-good">
                  {e.sugestao.saltos === 2 ? (
                    <>
                      <b>Vendendo muito: dá pra subir 2 degraus, para {BRL(e.degraus[e.i + 2])}</b>
                      {e.vendasDesde} vendas desde o degrau (2× o portão). Com essa procura, um aumento maior compensa: vende um pouco menos, mas o lucro total se mantém. Depois do salto, o app pede {regras.diasAposSalto} dias parado. Não mexa no Ads na mesma semana.
                    </>
                  ) : (
                    <>
                      <b>Pronto pra subir para {BRL(e.proximo)}</b>Não mexa no Ads na mesma semana — senão não dá pra saber o que mudou as vendas.
                    </>
                  )}
                </div>
              ) : e.sugestao.chave === "segurar" && faltam.length ? (
                <div className="alerta alerta-warn">
                  <b>Segurar: {faltam.map((p) => (p.falta ? `faltam ${p.falta} ${p.curto}` : p.curto)).join(" · ")}</b>
                  {faltam.some((p) => p.chave === "avaliacoes") ? "Dica: peça avaliação com foto no pacote (cartãozinho) — avaliação com foto pesa mais na conversão." : "Aguarde os portões fecharem."}
                </div>
              ) : null}
            </>
          )}

          {e.acima && !e.acima.ativo && (
            <>
              <h4 className="sub-h">Acima do alvo <span className="muted-cel">(teste controlado, até +{Math.round(regras.acimaMax * 100)}%)</span></h4>
              <ul className="lista-portoes">
                {e.acima.criterios.map((c) => (
                  <li key={c.rotulo} className={c.ok ? "ok" : "no"}>
                    <span className="ic">{c.ok ? "✓" : "✗"}</span>
                    {c.rotulo}
                    <span className="val">{c.valor}</span>
                  </li>
                ))}
              </ul>
              {e.acima.prox ? (
                <div className={`alerta ${e.acima.pronto ? "alerta-good" : "alerta-neutro"}`}>
                  <b>
                    {e.acima.pronto ? "Vale testar" : "Quando os critérios fecharem"}: {BRL(e.alvo)} → {BRL(e.acima.prox)}
                  </b>
                  Lucro por venda {BRL(e.acima.lucroAgora)} → {BRL(e.acima.lucroProx)}.
                  {e.acima.podePerder != null && ` Dá pra perder até ${Math.floor(e.acima.podePerder * 100)}% das vendas e ainda lucrar o mesmo no total.`} O teste dura {regras.acimaDias} dias e o preço salvo só muda se você aprovar.
                  {e.acima.pronto && (
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn-mini primary" onClick={() => onAcima("testar", e.acima.prox)}>
                        Testar {BRL(e.acima.prox)}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>Já está no teto de +{Math.round(regras.acimaMax * 100)}% acima do alvo.</p>
              )}
            </>
          )}
          {e.acima?.ativo && (
            <>
              <h4 className="sub-h">Teste acima do alvo ({BRL(e.alvo)} → {BRL(e.preco)})</h4>
              <ul className="lista-portoes">
                <li className={e.acima.diasFaltam === 0 ? "ok" : "no"}>
                  <span className="ic">{e.acima.diasFaltam === 0 ? "✓" : "…"}</span>
                  {regras.acimaDias} dias de teste
                  <span className="val">{e.acima.diasFaltam === 0 ? "completo" : `faltam ${e.acima.diasFaltam}`}</span>
                </li>
                <li className={e.acima.lucroDepois != null && e.acima.lucroAntes != null && e.acima.lucroDepois >= e.acima.lucroAntes ? "ok" : "no"}>
                  <span className="ic">{e.acima.lucroDepois != null && e.acima.lucroAntes != null && e.acima.lucroDepois >= e.acima.lucroAntes ? "✓" : "✗"}</span>
                  Lucro médio por semana ≥ no alvo
                  <span className="val">
                    {e.acima.lucroDepois != null ? BRL(e.acima.lucroDepois) : "—"} vs {e.acima.lucroAntes != null ? BRL(e.acima.lucroAntes) : "—"}
                  </span>
                </li>
              </ul>
              {e.acima.aprovado ? (
                <div className="alerta alerta-good">
                  <b>Aprovado: {BRL(e.preco)} lucra mais que o alvo</b>
                  Atualize o preço salvo pra {BRL(e.preco)} (vira o novo alvo){e.acima.proximo ? ` — depois o app pode sugerir testar ${BRL(e.acima.proximo)}` : ""}.
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-mini primary" onClick={() => onAcima("aprovar")}>Atualizar preço salvo para {BRL(e.preco)}</button>
                    <button type="button" className="btn btn-mini" onClick={() => onAcima("voltar")}>Voltar ao alvo</button>
                  </div>
                </div>
              ) : e.acima.reprovado ? (
                <div className="alerta alerta-bad">
                  <b>Lucrou menos que no alvo: voltar</b>O preço mais alto derrubou as vendas mais do que compensou. Volte pra {BRL(e.alvo)}; novo teste só daqui a {regras.acimaBloqueioDias} dias.
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-mini primary" onClick={() => onAcima("voltar")}>Voltar ao alvo</button>
                  </div>
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  Registre as semanas normalmente. Em {e.acima.diasFaltam} dia(s) o app compara o lucro com o do alvo.{" "}
                  <button type="button" className="link-btn" onClick={() => onAcima("voltar")}>voltar agora</button>
                </p>
              )}
            </>
          )}

          {e.check && !e.acimaAtivo && (
            <>
              <h4 className="sub-h">Check da última subida ({virgula(e.check.de)} → {virgula(e.check.para)})</h4>
              {e.check.pendente ? (
                <p className="hint" style={{ margin: 0 }}>Registre a próxima semana pra conferir se a subida segurou as vendas.</p>
              ) : (
                <>
                  <ul className="lista-portoes">
                    <li className={e.check.lucroOk ? "ok" : "no"}>
                      <span className="ic">{e.check.lucroOk ? "✓" : "✗"}</span>Lucro da semana ≥ semana antes
                      <span className="val">{BRL(e.check.lucroDepois)} vs {BRL(e.check.lucroAntes)}</span>
                    </li>
                    <li className={e.check.vendasOk ? "ok" : "no"}>
                      <span className="ic">{e.check.vendasOk ? "✓" : "✗"}</span>Vendas ≥ {Math.round(regras.pisoVendas * 100)}% da semana antes
                      <span className="val">
                        {e.check.vendasDepois} vs {e.check.vendasAntes}
                        {e.check.vendasAntes ? ` (${Math.round((e.check.vendasDepois / e.check.vendasAntes) * 100)}%)` : ""}
                      </span>
                    </li>
                  </ul>
                  {e.check.falhasSeguidas >= 2 ? (
                    <div className="alerta alerta-bad">
                      <b>2 semanas seguidas abaixo: voltar um degrau</b>O preço novo derrubou as vendas. Volte pra {BRL(e.degraus[Math.max(0, e.i - 1)])} e tente de novo depois.
                    </div>
                  ) : e.check.falhasSeguidas === 1 ? (
                    <div className="alerta alerta-warn">
                      <b>1 semana abaixo: segurar</b>Espere mais 7 dias antes de decidir — uma semana fraca pode ser só variação.
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>

        <div>
          {["observando", "recomendado", "andamento", "concluido"].includes(t.status) && (
            <div className={`teste-card teste-${t.status}`}>
              <h4 className="sub-h">
                Teste de lançamento <TagTeste teste={t} />
              </h4>
              {(t.status === "observando" || t.status === "recomendado") && (
                <>
                  <p className="teste-texto">
                    {t.status === "observando"
                      ? `Anúncio novo, sem vendas: os primeiros ${t.de} dias são só orgânico — use o Impulsionar nos horários de pico e o tráfego de item novo. Se chegar a ${regras.testeDispensaVendas} vendas, o teste nem é preciso.`
                      : `Passaram ${regras.testeObservarDias} dias com menos de ${regras.testeDispensaVendas} vendas. Um Ads com orçamento fechado compra as primeiras vendas e avaliações — é investimento, não lucro.`}
                  </p>
                  <div className="teste-linha">
                    <div className="field" style={{ margin: 0 }}>
                      <label>Orçamento (R$)</label>
                      <input type="number" min="0" step="5" value={orcEdit || t.orcSugerido} onChange={(ev) => setOrcEdit(ev.target.value)} style={{ width: 110 }} />
                    </div>
                    <span className="muted-cel">
                      Na plataforma: <b>{BRL((num(orcEdit) || t.orcSugerido) / regras.testeDias)}/dia por {regras.testeDias} dias</b>
                      <br />
                      sugerido {BRL(t.orcSugerido)}
                      {t.orcInfo?.porMinimo
                        ? ` = mínimo da plataforma (${BRL(regras.testeMinDiario)}/dia × ${regras.testeDias} dias; pela conta seria ${BRL(t.orcInfo.base)} = ${regras.testeMeta} vendas × lucro no alvo ${BRL(e.lucroAlvo)})`
                        : ` = ${regras.testeMeta} vendas × lucro no alvo (${BRL(e.lucroAlvo)})`}
                    </span>
                  </div>
                  {t.orcInfo?.acimaMax && (
                    <div className="alerta alerta-warn" style={{ marginTop: 8 }}>
                      <b>A Shopee exige no mínimo {BRL(regras.testeMinDiario)}/dia — o teste fica em {BRL(t.orcInfo.minimo)} em {regras.testeDias} dias</b>
                      Passa do orçamento máximo das regras ({BRL(regras.testeMax)}). Se preferir gastar menos, diminua os dias do teste nas Regras dos portões.
                    </div>
                  )}
                  {(num(orcEdit) || t.orcSugerido) / regras.testeDias < num(regras.testeMinDiario) - 0.004 && (
                    <div className="alerta alerta-bad" style={{ marginTop: 8 }}>
                      <b>Abaixo do mínimo diário da plataforma</b>
                      {BRL((num(orcEdit) || t.orcSugerido) / regras.testeDias)}/dia é menos que {BRL(regras.testeMinDiario)}/dia — a Shopee não aceita. Use pelo menos {BRL(num(regras.testeMinDiario) * regras.testeDias)} em {regras.testeDias} dias.
                    </div>
                  )}
                  {checklistIncompleto.length > 0 && (
                    <div className="alerta alerta-warn" style={{ marginTop: 8 }}>
                      <b>Anúncio incompleto</b>
                      Falta {checklistIncompleto.map((k) => CHECKLIST_ANUNCIO.find((c) => c[0] === k)?.[1].toLowerCase()).join(", ")} (itens do checklist em Revisar anúncio, abaixo). Você pagaria pra mandar gente pra um anúncio que ainda não convence.
                    </div>
                  )}
                  <div className="teste-botoes">
                    <button type="button" className={`btn btn-mini${t.status === "recomendado" ? " primary" : ""}`} onClick={() => acoesTeste.iniciar(l, num(orcEdit) || t.orcSugerido)}>
                      {t.status === "observando" ? "Iniciar teste agora" : "Iniciar teste"}
                    </button>
                    <button type="button" className="btn btn-mini" onClick={() => acoesTeste.pular(l)}>Pular</button>
                  </div>
                </>
              )}
              {(t.status === "andamento" || t.status === "concluido") && (
                <>
                  <div className="teste-metricas">
                    <div>
                      <small>Investido</small>
                      <b>{BRL(t.gasto)}</b>
                      <span className="muted-cel"> de {BRL(t.orc)} ({BRL(t.orc / Math.max(1, t.prazo))}/dia)</span>
                      <div className="barra-progresso"><i style={{ width: `${Math.min(100, (t.gasto / Math.max(1, t.orc)) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <small>Vendas via Ads</small>
                      <b>{t.vendasAds}</b>
                      <span className="muted-cel"> de {t.meta}</span>
                      <div className="barra-progresso"><i style={{ width: `${Math.min(100, (t.vendasAds / Math.max(1, t.meta)) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <small>Cliques</small>
                      <b>{t.cliques}</b>
                    </div>
                    <div>
                      <small>Custo por venda</small>
                      <b style={{ color: t.custoVenda == null ? undefined : e.lucroAlvo > 0 && t.custoVenda <= e.lucroAlvo ? "var(--good)" : "var(--bad)" }}>{t.custoVenda != null ? BRL(t.custoVenda) : "—"}</b>
                      <span className="muted-cel"> (lucro no alvo {BRL(e.lucroAlvo)})</span>
                    </div>
                  </div>
                  {t.status === "andamento" ? (
                    <p className="teste-texto">
                      {t.diasRestantes} dia(s) restante(s) · registre gasto, cliques e vendas via Ads no “Registrar semana” (pode ser todo dia). O teste acaba sozinho ao bater {t.meta} vendas, gastar o orçamento, passar {t.prazo} dias ou chegar a {regras.testeCliquesSemVenda} cliques sem venda.
                    </p>
                  ) : (
                    t.resultado &&
                    (t.resultado.chave === "revisar" ? (
                      <div className="alerta alerta-bad">
                        <b>{t.cliques} cliques e nenhuma venda</b>
                        {e.anuncio ? `Veja o aviso em Revisar anúncio, abaixo${e.anuncio.motivo === "teste" ? "" : ` (${e.anuncio.titulo.toLowerCase()})`} — por onde começar: ${e.anuncio.porOnde.toLowerCase()}.` : "Já houve venda depois do teste — o aviso de revisar saiu."}
                      </div>
                    ) : (
                      <div className={`alerta alerta-${{ good: "good", warn: "warn", bad: "bad" }[t.resultado.tom]}`}>
                        <b>{t.resultado.titulo}</b>
                        {t.resultado.texto}
                      </div>
                    ))
                  )}
                  <div className="teste-botoes">
                    {t.status === "concluido" && !t.salvoConcluido && (
                      <button type="button" className="btn btn-mini primary" onClick={() => acoesTeste.concluir(l)}>Concluir e desligar o Ads</button>
                    )}
                    {t.status === "andamento" && (
                      <button type="button" className="btn btn-mini" onClick={() => acoesTeste.concluir(l)}>Encerrar teste agora</button>
                    )}
                    <button type="button" className="link-btn" onClick={() => acoesTeste.reabrir(l)}>refazer</button>
                  </div>
                </>
              )}
            </div>
          )}

          <h4 className="sub-h">
            O que digitar em {l.canal.nome} <span className="muted-cel">({anuncio?.desconto > 0.005 ? `riscado fixo do alvo, desconto ${Math.round(anuncio.desconto * 100)}% — só a promo muda` : "canal sem desconto configurado"})</span>
          </h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Preço original</th>
                  <th className="num">Promo</th>
                  <th className="num">Cliente paga</th>
                  <th className="num">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {(anuncio?.linhas || []).map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.nome}
                      {a.naoCompensa && <div className="sub-num" style={{ color: "var(--warn)" }}>abaixo do mínimo aceitável</div>}
                    </td>
                    <td className="num"><Copiavel valor={virgula(a.original)} texto={virgula(a.original)} /></td>
                    <td className="num">{a.promo ? <Copiavel valor={`${a.promo}%`} texto={String(a.promo)} /> : "—"}</td>
                    <td className="num">
                      {virgula(a.clientePaga)}
                      {a.clientePaga - a.real >= 0.005 && <span className="muted-cel"> +{Math.round((a.clientePaga - a.real) * 100)}¢</span>}
                      {freteDe(a.clientePaga, l.canal) && (
                        <div>
                          <FreteAviso frete={freteDe(a.clientePaga, l.canal)} compacto />
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ color: a.lucro < 0 ? "var(--bad)" : undefined }}>{BRL(a.lucro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Variações e kits recalculados pelo avulso deste degrau (cliente economiza ≥{Math.round((l.cfg.vantagemMin || 0.05) * 100)}% vs separado). Clique no valor pra copiar.
          </p>

          <h4 className="sub-h">Ads {e.ultAds ? <span className="muted-cel">· semana de {dataBR(e.ultAds.data)}</span> : null}</h4>
          <div className="mini3">
            <div>
              <small>ROAS real</small>
              <b style={{ color: e.roas == null ? undefined : e.roas >= (e.roasMin || Infinity) ? "var(--good)" : "var(--bad)" }}>{e.roas != null ? virgula(e.roas, 1) : "—"}</b>
            </div>
            <div>
              <small>ROAS mínimo (empate)</small>
              <b>{e.roasMin != null ? virgula(e.roasMin, 1) : "—"}</b>
            </div>
            <div>
              <small>Vendas orgânicas</small>
              <b style={{ color: "var(--good)" }}>{e.organico != null ? `${Math.round(e.organico * 100)}%` : "—"}</b>
              {e.organico != null && e.organicoAntes != null && <span className="muted-cel"> {e.organico >= e.organicoAntes ? "↑" : "↓"} de {Math.round(e.organicoAntes * 100)}%</span>}
            </div>
          </div>
          {e.roasMin != null && (
            <div className="roas-regua">
              <div className="trilho">
                <span className="zona z-bad" style={{ width: `${roasPos(e.roasMin * 0.8)}%` }} />
                <span className="zona z-warn" style={{ left: `${roasPos(e.roasMin * 0.8)}%`, width: `${roasPos(e.roasMin * 1.5) - roasPos(e.roasMin * 0.8)}%` }} />
                <span className="zona z-good" style={{ left: `${roasPos(e.roasMin * 1.5)}%`, right: 0 }} />
                <span className="marca" style={{ left: `${roasPos(e.roasMin)}%` }}>
                  <em>mínimo {virgula(e.roasMin, 1)}</em>
                </span>
                {e.roas != null && <span className="eu" style={{ left: `${roasPos(e.roas)}%` }} title={`ROAS real ${virgula(e.roas, 1)}`} />}
              </div>
              <div className="leg">
                <span>pausar</span>
                <span>reduzir · manter</span>
                <span>pode aumentar (≥ {virgula(e.roasMin * 1.5, 1)})</span>
              </div>
            </div>
          )}
          {t.status === "andamento" ? (
            <div className="alerta alerta-neutro">
              <b>Teste de lançamento em andamento</b>Durante o teste vale o orçamento fechado acima, não a régua do ROAS. Depois dele, a régua volta a valer.
            </div>
          ) : (
          <div className={`alerta alerta-${{ good: "good", warn: "warn", bad: "bad" }[ads.tom] || "neutro"}`}>
            <b>{ads.titulo}</b>
            {ads.texto}
            {ads.chave === "inviavel" && e.viavelEm && e.viavelEm.preco !== e.preco ? ` Ads passa a ser viável a partir de ${BRL(e.viavelEm.preco)} (ROAS mínimo ${virgula(e.viavelEm.roasMin, 1)}).` : ""}
            {ads.chave === "inviavel" && (t.status === "observando" || t.status === "recomendado") ? " A exceção é o teste de lançamento acima: orçamento fechado pra comprar as primeiras vendas." : ""}
          </div>
          )}
          <p className="hint" style={{ margin: 0 }}>Lembrete: não suba de degrau e mexa no Ads na mesma semana.</p>
        </div>
      </div>

      <FunilAnuncio funil={e.funil} />

      <div className="secao-rampa">
        <h4 className="sub-h">Evolução <span className="muted-cel">· preço vendido, vendas por semana e avaliações</span></h4>
        <GraficoRampa est={e} />
      </div>

      <div className={`secao-rampa${e.revisar ? " destaque-revisar" : ""}`}>
        <h4 className="sub-h">
          Revisar anúncio
          {e.revisar ? <span className="badge bad" style={{ marginLeft: 8 }}>recomendado</span> : <span className="muted-cel"> · checklist de conversão</span>}
        </h4>
        {e.anuncio && (
          <div className="alerta alerta-bad">
            <b>{e.anuncio.titulo}</b>
            {e.anuncio.texto}
            <div style={{ marginTop: 4 }}>
              <span style={{ fontWeight: 700 }}>Por onde começar:</span> {e.anuncio.porOnde.toLowerCase()} — itens destacados abaixo.
              {e.anuncio.tambem.length > 0 && <span className="muted-cel"> Também indica: {e.anuncio.tambem.map((x) => x.titulo).join(", ")}.</span>}
            </div>
          </div>
        )}
        <div className="checklist-anuncio">
          {CHECKLIST_ANUNCIO.map(([k, rotulo, dica]) => {
            const destaque = (e.anuncio?.itens || []).includes(k);
            return (
              <label key={k} className={destaque ? "item-funil" : ""}>
                <input type="checkbox" checked={!!l.r.checklist?.[k]} onChange={(ev) => onChecklist(l, k, ev.target.checked)} />
                <span>
                  {rotulo}
                  {destaque && <em className="comece"> ← comece por aqui</em>}
                  <small>{dica}</small>
                </span>
              </label>
            );
          })}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>As marcações ficam salvas por produto. Depois de mexer nas fotos, espere 7 dias antes de tirar conclusões.</p>
        <div className="pronto-linha">
          {l.r.checklist?.pronto ? (
            <>
              <span className="badge good">✓ Pronto desde {diaMes(l.r.checklist.pronto)}</span>
              <button type="button" className="link-btn" onClick={() => onChecklist(l, "pronto", null)}>
                desfazer
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => onChecklist(l, "pronto", hojeISO())}>
                ✓ Marcar como pronto
              </button>
              <span className="muted-cel">já fiz tudo o que ia fazer neste anúncio — daqui em diante é só acompanhar (não precisa marcar todo o checklist)</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// "1,5%" / "12%"
const pctF = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`);

// Funil do anúncio (2 semanas no preço atual): Impressões de Produto →
// Cliques Por Produto (CTR) → Pedidos (Taxa de Conversão de Pedidos), com o
// diagnóstico de onde o anúncio trava. Só leitura.
function FunilAnuncio({ funil }) {
  if (!funil) return null;
  const d = funil.diagnostico;
  const rotuloVendas = funil.usaPedidos ? "Pedidos" : "Vendas";
  return (
    <div className="secao-rampa">
      <h4 className="sub-h">
        Funil do anúncio <span className="muted-cel">· 2 semanas no preço atual</span>
        <Ajuda texto="Do painel de desempenho do produto na Shopee, informado no Registrar semana (+ impressões, cliques e pedidos). CTR = Cliques ÷ Impressões; Taxa de Conversão de Pedidos = Pedidos ÷ Cliques (sem pedidos informados, usa as vendas). Usa as 2 últimas semanas no preço atual, de preferência sem Ads (o Ads infla as impressões). Diagnóstico na ordem: pouca exibição → pouca gente clica → clicam mas não compram. Com 5+ produtos com funil, a referência é a média (mediana) da loja: abaixo da metade dela é problema. Os limites ficam em Regras dos portões." />
      </h4>
      {funil.status === "sem-dados" ? (
        <div className="empty">Informe visualizações e visitas no Registrar semana pra ver onde o anúncio trava (Impressões de Produto e Cliques Por Produto, do painel da Shopee).</div>
      ) : (
        <>
          <div className="funil-anuncio">
            <div className="funil-etapa">
              <span className="funil-rot">Impressões de Produto</span>
              <b>{funil.visualizacoes.toLocaleString("pt-BR")}</b>
            </div>
            <div className="funil-seta">
              → <span>CTR {pctF(funil.ctr)}</span>
            </div>
            <div className="funil-etapa">
              <span className="funil-rot">Cliques Por Produto</span>
              <b>{funil.visitas.toLocaleString("pt-BR")}</b>
            </div>
            <div className="funil-seta">
              → <span>conversão {pctF(funil.conversao)}</span>
            </div>
            <div className="funil-etapa">
              <span className="funil-rot">{rotuloVendas}</span>
              <b>{funil.vendas.toLocaleString("pt-BR")}</b>
            </div>
          </div>
          {funil.status === "coletando" ? (
            <div className="alerta alerta-neutro">
              <b>{funil.texto}</b>O diagnóstico aparece com {funil.semanas < 2 ? "2 semanas registradas neste preço" : "o tempo mínimo de rampa"}.
            </div>
          ) : d ? (
            <div className={`alerta alerta-${d.tom}`}>
              <b>{d.titulo}</b>
              {d.texto}
            </div>
          ) : null}
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Referência: <b>{funil.referencia}</b> (CTR mínimo {pctF(funil.limiteCtr)} · conversão mínima {pctF(funil.limiteConversao)})
            {!funil.usaPedidos && funil.semanas > 0 ? " · conversão pelas vendas (pedidos não informados)" : ""}
          </p>
          {funil.comAds && (
            <p className="hint neg" style={{ margin: "4px 0 0" }}>
              Com Ads: não há 2 semanas sem Ads neste preço, então os números incluem o tráfego pago — o Ads aumenta as impressões e distorce o CTR.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RegrasPortoes({ regras, loja, atualizar, onToast }) {
  const campos = [
    ["avaliacoes", "Avaliações por degrau", 1],
    ["vendas", "Vendas por degrau", 1],
    ["nota", "Nota mínima", 0.1],
    ["dias", "Dias mínimos no degrau", 1],
    ["pisoVendas", "Vendas após subir (piso, %)", 1, true],
    ["passo", "Tamanho máximo do degrau (%)", 0.5, true],
    ["lucroEntrada", "Lucro no 1º degrau (R$)", 0.1],
    ["notaAlerta", "Nota que gera alerta", 0.1],
    ["roasInviavel", "Ads inviável com ROAS mínimo acima de", 0.5],
    ["revisarDias", "Dias no lançamento até sugerir revisar", 1],
    ["maxDegraus", "Máximo de degraus até o alvo", 1],
    ["saltoVendas", "Salto de 2 degraus com vendas ≥ (× o portão)", 0.5],
    ["diasAposSalto", "Dias parado depois de salto ou de voltar", 1],
    ["diasCampanha", "Não subir nos dias antes de campanha", 1],
    ["testeObservarDias", "Teste: dias só no orgânico antes de recomendar", 1],
    ["testeDispensaVendas", "Teste: vendas que dispensam o teste", 1],
    ["testeMeta", "Teste: meta de vendas", 1],
    ["testeMin", "Teste: orçamento mínimo (R$)", 5],
    ["testeMax", "Teste: orçamento máximo (R$)", 5],
    ["testeDias", "Teste: prazo (dias)", 1],
    ["testeMinDiario", "Teste: orçamento mínimo por dia na plataforma (R$)", 1],
    ["testeCliquesSemVenda", "Teste: cliques sem venda = revisar anúncio", 5],
    ["acimaDias", "Acima do alvo: dias no alvo / duração do teste", 1],
    ["acimaSemanas", "Acima do alvo: semanas de vendas estáveis", 1],
    ["acimaMax", "Acima do alvo: máximo acima (%)", 1, true],
    ["acimaBloqueioDias", "Acima do alvo: espera se falhar (dias)", 1],
    ["funilDiasMin", "Funil: dias de rampa antes de diagnosticar", 1],
    ["funilVisMin", "Funil: impressões mínimas em 2 semanas", 10],
    ["funilCtrMin", "Funil: CTR mínimo (%, referência geral)", 0.1, true],
    ["funilConvMin", "Funil: conversão de pedidos mínima (%, referência geral)", 0.1, true],
    ["funilVisitasMin", "Funil: cliques mínimos pra julgar a conversão", 5],
  ];
  const [f, setF] = useState(() => Object.fromEntries(campos.map(([k, , , pct]) => [k, String(pct ? Math.round(regras[k] * 1000) / 10 : regras[k])])));
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (!loja) return;
    const novo = {};
    for (const [k, , , pct] of campos) {
      const v = num(f[k]);
      novo[k] = pct ? v / 100 : v;
    }
    setSalvando(true);
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), crescimento: novo } });
    setSalvando(false);
    onToast?.(r.ok ? "Regras dos portões salvas pra loja" : `Não foi possível salvar: ${r.error}`);
  }
  return (
    <div className="pad-painel">
      <div className="grid-auto">
        {campos.map(([k, rotulo, passo]) => (
          <div className="field" key={k}>
            <label>{rotulo}</label>
            <input type="number" step={passo} min="0" value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
      <button type="button" className="btn primary" onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar regras"}
      </button>{" "}
      <button type="button" className="btn" onClick={() => setF(Object.fromEntries(campos.map(([k, , , pct]) => [k, String(pct ? REGRAS_PADRAO[k] * 100 : REGRAS_PADRAO[k])])))}>
        Voltar ao padrão
      </button>
    </div>
  );
}

function IniciarRampaDialog({ dados, rampas, regras, editar, onToast, onClose }) {
  const { lojaId } = useLoja();
  const { itens, produtos, canais, precos, cfgDoProduto } = dados;
  const hoje = hojeISO();
  const salvoDe = (pid, cid) => precos.find((p) => p.item_tipo === "produto" && p.item_id === pid && p.canal_id === cid) || null;
  const [produtoId, setProdutoId] = useState(editar?.produto_id || "");
  const canaisDoProduto = produtoId ? canais.filter((c) => salvoDe(produtoId, c.id) && (editar ? c.id === editar.canal_id : !rampas.some((r) => r.produto_id === produtoId && r.canal_id === c.id))) : [];
  const [canalId, setCanalId] = useState(editar?.canal_id || "");
  const canal = canais.find((c) => c.id === (canalId || canaisDoProduto[0]?.id)) || null;
  const item = itens.find((i) => i.id === `p:${produtoId}`);
  const cfg = produtoId ? cfgDoProduto(produtoId) : null;
  const alvo = produtoId && canal ? num(salvoDe(produtoId, canal.id)?.preco) : 0;
  const zero = item && canal ? zeroAZero(canal, num(item.custoTotal), num(item.peso), cfg) : null;
  const sugestao = useMemo(
    () => (item && canal && alvo > 0 ? sugerirDegraus({ canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo, regras }) : []),
    [item, canal, alvo, cfg, regras]
  );
  const [degrausEdit, setDegrausEdit] = useState(editar ? editar.degraus.map((d) => virgula(num(d))) : null);
  const degrausTxt = degrausEdit ?? sugestao.map((d) => virgula(d));
  const [novoDegrau, setNovoDegrau] = useState("");
  const [precoHoje, setPrecoHoje] = useState(editar ? virgula(num(editar.degraus[editar.degrau_atual])) : "");
  const [aval, setAval] = useState("");
  const [nota, setNota] = useState("");
  const [vendas, setVendas] = useState("");
  const [salvando, setSalvando] = useState(false);

  const opcoesProduto = useMemo(() => {
    const comPreco = produtos.filter((p) => canais.some((c) => salvoDe(p.id, c.id) && !rampas.some((r) => r.produto_id === p.id && r.canal_id === c.id)));
    return [{ label: "Produtos", itens: comPreco.map((p) => ({ id: p.id, rotulo: `${p.nome}${p.sku ? ` · ${p.sku}` : ""}` })) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, canais, precos, rampas]);

  // Lista final: números válidos ≤ alvo, alvo no fim, e o preço de hoje incluído.
  function montarLista() {
    let lista = normalizarDegraus(degrausTxt).filter((d) => d < alvo - 0.004);
    const ph = cent(num(precoHoje));
    if (ph > 0 && ph < alvo - 0.004 && !lista.some((d) => Math.abs(d - ph) < 0.005)) lista = normalizarDegraus([...lista, ph]);
    lista.push(cent(alvo));
    return lista;
  }
  const listaFinal = alvo > 0 ? montarLista() : [];
  const ph = cent(num(precoHoje)) || listaFinal[0] || 0;

  function adicionarDegrau() {
    const v = cent(num(novoDegrau));
    if (!(v > 0)) return;
    if (v >= alvo - 0.004) return onToast?.("O degrau tem que ser menor que o alvo (o preço salvo)");
    setDegrausEdit([...listaFinal.slice(0, -1), v].sort((a, b) => a - b).map((x) => virgula(x)));
    setNovoDegrau("");
  }
  const idxHoje = listaFinal.length ? Math.max(0, listaFinal.findIndex((d) => d >= ph - 0.004)) : 0;

  async function salvar() {
    if (!produtoId || !canal) return onToast?.("Escolha o produto e o canal");
    if (!(alvo > 0)) return onToast?.("Esse produto não tem preço salvo neste canal — salve no 1º Avulso primeiro (ele é o alvo)");
    if (listaFinal.length < 1) return onToast?.("Informe os degraus");
    setSalvando(true);
    if (editar) {
      const atualAntes = num(editar.degraus[editar.degrau_atual]);
      let novoIdx = listaFinal.findIndex((d) => Math.abs(d - atualAntes) < 0.005);
      if (novoIdx < 0) novoIdx = Math.max(0, listaFinal.filter((d) => d < atualAntes).length - 1);
      const { error } = await supabase.from("rampas_preco").update({ degraus: listaFinal, degrau_atual: novoIdx, atualizado_em: new Date().toISOString() }).eq("id", editar.id);
      setSalvando(false);
      if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
      onToast?.("Degraus atualizados");
      return onClose(editar.id);
    }
    const { data, error } = await supabase
      .from("rampas_preco")
      .insert({
        loja_id: lojaId || null,
        produto_id: produtoId,
        canal_id: canal.id,
        degraus: listaFinal,
        degrau_atual: idxHoje,
        desde: hoje,
        base_avaliacoes: Math.round(num(aval)),
        vendas_iniciais: Math.round(num(vendas)),
      })
      .select()
      .single();
    if (error) {
      setSalvando(false);
      return onToast?.(/rampas_preco/.test(error.message) ? "Falta rodar o supabase/schema_v33.sql no Supabase" : `Não foi possível iniciar: ${error.message}`);
    }
    await supabase.from("rampa_registros").insert({
      loja_id: lojaId || null,
      rampa_id: data.id,
      tipo: "inicio",
      data: hoje,
      degrau: idxHoje,
      preco: listaFinal[idxHoje],
      avaliacoes: Math.round(num(aval)),
      nota: nota === "" ? null : num(nota),
    });
    setSalvando(false);
    onToast?.(`Rampa iniciada: ${item?.nome} vendendo ${BRL(listaFinal[idxHoje])} em ${canal.nome}`);
    onClose(data.id);
  }

  return (
    <EditarDialog
      titulo={editar ? "Editar degraus" : "Iniciar rampa de preço"}
      salvando={salvando}
      onSalvar={salvar}
      onCancelar={() => onClose(null)}
      salvarLabel={editar ? "Salvar degraus" : "Iniciar rampa"}
      classe="modal-box-md"
    >
      {!editar && (
        <>
          <div className="field">
            <label>Produto (só os que têm preço salvo em algum canal)</label>
            <BuscaItem
              grupos={opcoesProduto}
              value={produtoId}
              onChange={(id) => {
                setProdutoId(id);
                setCanalId("");
                setDegrausEdit(null);
                setPrecoHoje("");
              }}
            />
          </div>
          {produtoId && (
            <div className="field">
              <label>Canal (onde o produto tem preço salvo)</label>
              <select
                value={canal?.id || ""}
                onChange={(e) => {
                  setCanalId(e.target.value);
                  setDegrausEdit(null);
                }}
              >
                {canaisDoProduto.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      {produtoId && canal && alvo > 0 && (
        <>
          <div className="aviso-fluxo">
            0 a 0: <b>{BRL(zero)}</b> · alvo (preço salvo): <b>{BRL(alvo)}</b> — o salvo não muda.
          </div>
          {!editar && (
            <div className="row2">
              <div className="field">
                <label>Preço pra vender agora <span className="muted-cel">(vazio = 1º degrau; ou clique num degrau)</span></label>
                <input type="text" inputMode="decimal" placeholder={listaFinal[0] ? virgula(listaFinal[0]) : ""} value={precoHoje} onChange={(e) => setPrecoHoje(e.target.value)} />
              </div>
              <div className="field">
                <label>Vendas que o anúncio já tem</label>
                <input type="number" min="0" value={vendas} onChange={(e) => setVendas(e.target.value)} />
              </div>
              <div className="field">
                <label>Avaliações hoje</label>
                <input type="number" min="0" value={aval} onChange={(e) => setAval(e.target.value)} />
              </div>
              <div className="field">
                <label>Nota hoje (se tiver)</label>
                <input type="text" inputMode="decimal" placeholder="ex: 4,9" value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
            </div>
          )}
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              Degraus <span className="muted-cel">(até {Math.round(regras.passo * 100)}%, finais ,49/,99 · o alvo é sempre o último)</span>
            </label>
            <div className="previa-degraus editavel">
              {listaFinal.map((d, k) => {
                const ultimo = k === listaFinal.length - 1;
                const atual = editar ? Math.abs(d - num(editar.degraus[editar.degrau_atual])) < 0.005 : k === idxHoje;
                return (
                  <span key={`${d}-${k}`} className={`chip-degrau${atual ? " at" : ""}${ultimo ? " alvo" : ""}${freteDe(d, canal) ? " sem-frete" : ""}`}>
                    <button
                      type="button"
                      className="chip-degrau-valor"
                      disabled={!!editar || ultimo}
                      title={`${editar ? "" : ultimo ? "Alvo (preço salvo)" : "Estou vendendo neste preço hoje"}${freteDe(d, canal) ? `${editar || ultimo ? "" : " · "}${freteDe(d, canal).texto}` : ""}` || undefined}
                      onClick={() => setPrecoHoje(virgula(d))}
                    >
                      {virgula(d)}
                      {ultimo ? " alvo" : ""}
                      {freteDe(d, canal) ? " · paga frete" : ""}
                    </button>
                    {!ultimo && !atual && (
                      <button
                        type="button"
                        className="chip-degrau-x"
                        title="Tirar este degrau"
                        onClick={() => setDegrausEdit(listaFinal.slice(0, -1).filter((_, j) => j !== k).map((x) => virgula(x)))}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <div className="degraus-acoes">
              <input
                type="text"
                inputMode="decimal"
                placeholder="novo degrau, ex: 13,79"
                value={novoDegrau}
                onChange={(e) => setNovoDegrau(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionarDegrau();
                  }
                }}
              />
              <button type="button" className="btn btn-mini" onClick={adicionarDegrau} disabled={!(num(novoDegrau) > 0)}>
                + adicionar
              </button>
              <button type="button" className="link-btn" onClick={() => setDegrausEdit(null)}>
                sugerir de novo
              </button>
            </div>
          </div>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {!editar && <>Começa no degrau destacado ({BRL(listaFinal[idxHoje])}). Os portões contam a partir de hoje. </>}
            {(() => {
              const faltam = listaFinal.length - 1 - (editar ? editar.degrau_atual : idxHoje);
              return faltam > 0 ? `Faltam ${faltam} degrau${faltam > 1 ? "s" : ""} até o alvo — no mínimo ~${faltam * regras.dias} dias (${regras.dias} por degrau), na prática mais, pelos portões de vendas e avaliações.` : "Já está no alvo.";
            })()}
          </p>
        </>
      )}
      {produtoId && canal && !(alvo > 0) && <div className="alerta alerta-warn"><b>Sem preço salvo</b>Salve o preço final desejado no 1º Avulso — ele é o alvo da rampa.</div>}
      {!produtoId && !opcoesProduto[0].itens.length && <p className="hint">Nenhum produto com preço salvo disponível (ou todos já estão em rampa).</p>}
    </EditarDialog>
  );
}

const VAZIO_RAMPA = { vendas: "", avaliacoes: "", nota: "", ruins: "", gasto: "", cliques: "", adsVendas: "" };
const VAZIO_FUNIL = { impressoes: "", cliquesProduto: "", pedidos: "" };

const somaDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntreIso = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// Período a puxar no painel da Shopee pro registro na data `data`: um registro
// cobre até a véspera. Em dia = os 7 dias antes ("Últimos 7 dias"); atrasou =
// "Personalizado" começando no dia seguinte ao período anterior (sem pular
// nem repetir dias). Lacuna muito grande (> 13 dias) volta pros últimos 7.
function periodoFunil(registros, data) {
  const fim = somaDias(data, -1);
  const ant = [...(registros || [])].reverse().find((g) => g.tipo === "semana" && g.visualizacoes != null && g.data < data);
  let inicio = ant ? ant.data : somaDias(data, -7);
  if (diasEntreIso(inicio, fim) + 1 > 13 || inicio > fim) inicio = somaDias(data, -7);
  const dias = diasEntreIso(inicio, fim) + 1;
  return { inicio, fim, dias, modo: dias === 7 ? "Últimos 7 dias" : "Personalizado" };
}
const VAZIO_AF = { afVendas: "", afComissao: "", parceiro: "" };

// Cada "Registrar semana" conta como UMA semana nas contas (funil, ROAS, check
// da subida, acima do alvo, afiliados) — registrar antes de ~7 dias distorce.
// Devolve o aviso (ou null) pra data escolhida, a partir do último registro
// (ou do início da rampa). Teste em andamento: Ads pode ser diário.
const DIAS_MIN_SEMANA = 6;
function avisoIntervalo(datasAnteriores, data, { inicio = null, teste = false } = {}) {
  const antes = (datasAnteriores || []).filter((d) => d && d <= data).sort();
  const ult = antes[antes.length - 1] || null;
  const ref = ult || (inicio && inicio <= data ? inicio : null);
  if (!ref) return null;
  const dias = diasEntreIso(ref, data);
  if (dias >= DIAS_MIN_SEMANA) return null;
  const desde = ult ? `o último registro (${diaMes(ult)})` : `o início da rampa (${diaMes(ref)})`;
  const quando = diaMes(somaDias(ref, 7));
  if (teste)
    return { tom: "neutro", texto: `Teste em andamento: pode registrar o Ads (gasto, cliques, vendas via Ads) todo dia. Vendas, avaliações e impressões da semana, só a partir de ${quando}.` };
  return {
    tom: "warn",
    texto:
      dias === 0
        ? `Já existe registro neste dia (${diaMes(ref)}). Um novo registro conta como mais uma semana inteira.`
        : `Faz só ${dias} dia${dias === 1 ? "" : "s"} desde ${desde}: este registro vai contar como uma semana inteira (funil, ROAS, check da subida). Melhor registrar a partir de ${quando}. Dá pra registrar mesmo assim.`,
  };
}
const AvisoIntervalo = ({ aviso }) =>
  aviso ? <div className={`alerta alerta-${aviso.tom === "warn" ? "warn" : "neutro"} aviso-intervalo`}>{aviso.texto}</div> : null;

// Uma janela só pra semana: produtos em rampa (vendas, avaliações, nota, 1–2★,
// Ads) + bloco Afiliado nos itens com comissão ativa — e os itens com
// afiliado fora de rampa (kits, variações, produtos no alvo sem rampa).
function RegistrarSemanaDialog({ linhas, linhasAf, af, onToast, onClose }) {
  const { lojaId } = useLoja();
  const [data, setData] = useState(hojeISO());
  const afDe = (l) => linhasAf.find((x) => x.chave === `produto|${l.r.produto_id}|${l.r.canal_id}` && x.conf.ativo) || null;
  const foraRampa = linhasAf.filter((x) => x.conf.ativo && !x.rampa);
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(linhas.map((l) => [l.r.id, { ...VAZIO_RAMPA, ...VAZIO_FUNIL, ...VAZIO_AF }])),
    ...Object.fromEntries(foraRampa.map((x) => [x.chave, { ...VAZIO_RAMPA, ...VAZIO_AF }])),
  }));
  const [salvando, setSalvando] = useState(false);
  const [funilAberto, setFunilAberto] = useState(() => new Set());
  const alternarFunil = (id) =>
    setFunilAberto((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const set = (id, k) => (e) => setF((p) => ({ ...p, [id]: { ...p[id], [k]: e.target.value } }));
  const preenchido = (v, campos) => campos.some((k) => v[k] !== "");
  const intOuNull = (x) => (x === "" ? null : Math.round(num(x)));

  async function salvar() {
    const rampaSalvar = [];
    const afSalvar = [];
    for (const l of linhas) {
      const v = f[l.r.id];
      if (preenchido(v, [...Object.keys(VAZIO_RAMPA), ...Object.keys(VAZIO_FUNIL)]))
        rampaSalvar.push({
          loja_id: lojaId || null,
          rampa_id: l.r.id,
          tipo: "semana",
          data,
          degrau: l.est.i,
          preco: l.est.preco,
          vendas: v.vendas === "" ? 0 : Math.round(num(v.vendas)),
          avaliacoes: intOuNull(v.avaliacoes),
          nota: v.nota === "" ? null : num(v.nota),
          avaliacoes_ruins: Math.round(num(v.ruins)),
          ads_gasto: v.gasto === "" ? null : num(v.gasto),
          ads_vendas: intOuNull(v.adsVendas),
          ...(v.cliques !== "" ? { ads_cliques: Math.round(num(v.cliques)) } : {}),
          // Funil (schema v36): só vai pro banco quando preenchido — em branco = null, nunca 0.
          ...(v.impressoes !== "" ? { visualizacoes: Math.round(num(v.impressoes)) } : {}),
          ...(v.cliquesProduto !== "" ? { visitas: Math.round(num(v.cliquesProduto)) } : {}),
          ...(v.pedidos !== "" ? { pedidos: Math.round(num(v.pedidos)) } : {}),
        });
      const la = afDe(l);
      if (la && preenchido(v, ["afVendas", "afComissao"]))
        afSalvar.push({
          loja_id: lojaId || null,
          item_tipo: "produto",
          item_id: l.r.produto_id,
          canal_id: l.r.canal_id,
          data,
          preco: l.est.preco,
          vendas: Math.round(num(v.afVendas)),
          comissao: v.afComissao === "" ? cent(num(v.afVendas) * l.est.preco * la.conf.comissao) : num(v.afComissao),
          parceiro_id: v.parceiro || null,
        });
    }
    for (const x of foraRampa) {
      const v = f[x.chave];
      if (!preenchido(v, ["vendas", "gasto", "cliques", "adsVendas", "afVendas", "afComissao"])) continue;
      afSalvar.push({
        loja_id: lojaId || null,
        item_tipo: x.tipo,
        item_id: x.id,
        canal_id: x.canal.id,
        data,
        preco: x.preco,
        vendas: Math.round(num(v.afVendas)),
        comissao: v.afComissao === "" ? cent(num(v.afVendas) * x.preco * x.conf.comissao) : num(v.afComissao),
        vendas_total: v.vendas === "" ? null : Math.round(num(v.vendas)),
        ads_gasto: v.gasto === "" ? null : num(v.gasto),
        ads_cliques: intOuNull(v.cliques),
        ads_vendas: intOuNull(v.adsVendas),
        parceiro_id: v.parceiro || null,
      });
    }
    if (!rampaSalvar.length && !afSalvar.length) return onToast?.("Preencha pelo menos um item");
    const semAf = afSalvar.find((g) => g.vendas_total != null && g.vendas > g.vendas_total);
    if (semAf) return onToast?.("Vendas via afiliado não podem passar das vendas da semana");
    setSalvando(true);
    if (rampaSalvar.length) {
      const { error } = await supabase.from("rampa_registros").insert(rampaSalvar);
      if (error) {
        setSalvando(false);
        if (/visualizacoes|visitas|pedidos/.test(error.message)) return onToast?.("Falta rodar o supabase/schema_v36.sql no Supabase");
        return onToast?.(/ads_cliques/.test(error.message) ? "Falta rodar o supabase/schema_v34.sql no Supabase (coluna de cliques)" : `Não foi possível salvar: ${error.message}`);
      }
    }
    if (afSalvar.length) {
      const { error } = await supabase.from("afiliado_registros").insert(afSalvar);
      if (error) {
        setSalvando(false);
        return onToast?.(/afiliado_registros|schema cache|does not exist/.test(error.message) ? "Falta rodar o supabase/schema_v35.sql no Supabase (afiliados)" : `Não foi possível salvar o afiliado: ${error.message}`);
      }
    }
    setSalvando(false);
    const n = new Set([
      ...rampaSalvar.map((r) => {
        const l = linhas.find((x) => x.r.id === r.rampa_id);
        return `produto|${l.r.produto_id}|${l.r.canal_id}`;
      }),
      ...afSalvar.map((g) => `${g.item_tipo}|${g.item_id}|${g.canal_id}`),
    ]).size;
    onToast?.(`Semana registrada (${n} item${n > 1 ? "s" : ""})`);
    onClose();
  }

  const blocoAfiliado = (chave, la, preco) => {
    const v = f[chave];
    const parceiros = (af.parceiros || []).filter((p) => !p.canal_id || p.canal_id === la.canal.id);
    const estimada = num(v.afVendas) > 0 ? cent(num(v.afVendas) * preco * la.conf.comissao) : null;
    return (
      <div className="bloco-afiliado">
        <div className="bloco-afiliado-titulo">Afiliado · comissão {Math.round(la.conf.comissao * 100)}%</div>
        <div className="grid-semana">
          <div className="field"><label>Vendas via afiliado</label><input type="number" min="0" value={v.afVendas} onChange={set(chave, "afVendas")} /></div>
          <div className="field">
            <label>Comissão paga (R$)</label>
            <input type="text" inputMode="decimal" value={v.afComissao} placeholder={estimada != null ? virgula(estimada) : ""} onChange={set(chave, "afComissao")} />
          </div>
          <div className="field">
            <label>Parceiro (opcional)</label>
            <select value={v.parceiro} onChange={set(chave, "parceiro")}>
              <option value="">campanha aberta</option>
              {parceiros.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  return (
    <EditarDialog titulo="Registrar semana" salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Registrar" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>
        Do painel do canal: vendas da semana (unidades vendidas do anúncio), o total de avaliações que aparece no anúncio, a nota, quantas avaliações de 1–2★
        chegaram na semana e, se usou Ads, o gasto e as vendas via Ads. Itens com afiliado ganham o bloco Afiliado (vendas e comissão do painel de afiliados;
        comissão em branco = estimada pelo %). Deixe em branco o que não quiser registrar.
      </p>
      <div className="field" style={{ maxWidth: 200 }}>
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      {linhas.map((l) => {
        const la = afDe(l);
        return (
          <div key={l.r.id} className="bloco-semana">
            <div className="bloco-semana-titulo">
              <b>{l.produto.nome}</b> <CanalTag canal={l.canal} /> <span className="muted-cel">em rampa · vendendo {BRL(l.est.preco)} · {l.est.avaliacoesTotal} avaliações até agora</span>
            </div>
            <AvisoIntervalo
              aviso={avisoIntervalo(
                l.est.registros.filter((g) => g.tipo === "semana").map((g) => g.data),
                data,
                { inicio: l.est.registros.find((g) => g.tipo === "inicio")?.data || null, teste: l.est.teste.status === "andamento" }
              )}
            />
            <div className="grid-semana">
              <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={f[l.r.id].vendas} onChange={set(l.r.id, "vendas")} /></div>
              <div className="field"><label>Avaliações (total)</label><input type="number" min="0" value={f[l.r.id].avaliacoes} onChange={set(l.r.id, "avaliacoes")} /></div>
              <div className="field"><label>Nota</label><input type="text" inputMode="decimal" value={f[l.r.id].nota} onChange={set(l.r.id, "nota")} /></div>
              <div className="field"><label>1–2★ na semana</label><input type="number" min="0" value={f[l.r.id].ruins} onChange={set(l.r.id, "ruins")} /></div>
              <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={f[l.r.id].gasto} onChange={set(l.r.id, "gasto")} /></div>
              <div className="field"><label>Ads: cliques</label><input type="number" min="0" value={f[l.r.id].cliques} onChange={set(l.r.id, "cliques")} /></div>
              <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={f[l.r.id].adsVendas} onChange={set(l.r.id, "adsVendas")} /></div>
            </div>
            <button type="button" className={`variacoes-toggle${funilAberto.has(l.r.id) ? " aberto" : ""}`} onClick={() => alternarFunil(l.r.id)}>
              <span className="seta">▸</span> {funilAberto.has(l.r.id) ? "impressões, cliques e pedidos" : "+ impressões, cliques e pedidos"}
            </button>
            {funilAberto.has(l.r.id) && (
              <div className="bloco-funil">
                {(() => {
                  const per = periodoFunil(l.est.registros, data);
                  return (
                    <p className="hint" style={{ margin: "0 0 6px" }}>
                      Do painel de desempenho do produto na Shopee (Dados de Negócio → Produto → Ver detalhes). Período:{" "}
                      <b>
                        {per.modo} — {diaMes(per.inicio)} a {diaMes(per.fim)}
                      </b>
                      {per.modo === "Personalizado" ? ` (${per.dias} dias, emendando no registro anterior, sem pular dias)` : ""} — termina ontem porque o dia de hoje ainda não fechou na Shopee. Opcional — o que ficar em branco não é gravado.
                    </p>
                  );
                })()}
                <div className="grid-semana">
                  <div className="field"><label>Impressões de Produto</label><input type="number" min="0" value={f[l.r.id].impressoes} onChange={set(l.r.id, "impressoes")} /></div>
                  <div className="field"><label>Cliques Por Produto</label><input type="number" min="0" value={f[l.r.id].cliquesProduto} onChange={set(l.r.id, "cliquesProduto")} /></div>
                  <div className="field"><label>Pedidos</label><input type="number" min="0" value={f[l.r.id].pedidos} onChange={set(l.r.id, "pedidos")} /></div>
                </div>
              </div>
            )}
            {la && blocoAfiliado(l.r.id, la, l.est.preco)}
          </div>
        );
      })}
      {foraRampa.map((x) => (
        <div key={x.chave} className="bloco-semana">
          <div className="bloco-semana-titulo">
            <b>{x.item.nome}</b> <CanalTag canal={x.canal} /> <span className="muted-cel">fora de rampa · vendendo {BRL(x.preco)}</span>
          </div>
          <AvisoIntervalo
            aviso={avisoIntervalo(
              (af.registros || []).filter((g) => g.item_tipo === x.tipo && g.item_id === x.id && g.canal_id === x.canal.id).map((g) => g.data),
              data
            )}
          />
          <div className="grid-semana">
            <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={f[x.chave].vendas} onChange={set(x.chave, "vendas")} /></div>
            <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={f[x.chave].gasto} onChange={set(x.chave, "gasto")} /></div>
            <div className="field"><label>Ads: cliques</label><input type="number" min="0" value={f[x.chave].cliques} onChange={set(x.chave, "cliques")} /></div>
            <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={f[x.chave].adsVendas} onChange={set(x.chave, "adsVendas")} /></div>
          </div>
          {blocoAfiliado(x.chave, x, x.preco)}
        </div>
      ))}
    </EditarDialog>
  );
}
