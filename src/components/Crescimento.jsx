import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useRampas } from "../hooks/useRampas.js";
import { BRL, PCT } from "../lib/format.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { descontoDoItem, escadaDoProduto, sugestaoKit, lucroNoPreco } from "../lib/escada.js";
import { CHECKLIST_ANUNCIO, REGRAS_PADRAO, estadoRampa, normalizarDegraus, regrasDaLoja, sugerirDegraus, zeroAZero } from "../lib/rampa.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import BuscaItem from "./BuscaItem.jsx";
import GraficoRampa from "./GraficoRampa.jsx";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const cent = (v) => Math.round(v * 100) / 100;
const centavoAcima = (x) => Math.ceil(x * 100 - 1e-6) / 100;
const virgula = (v, casas = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

// Riscado FIXO (do alvo) e promo do degrau: o cliente vê o mesmo "de R$ X" o
// tempo todo, só o desconto diminui conforme o preço sobe.
function anuncioFixo(real, alvo, desconto) {
  if (!(real > 0)) return null;
  if (!(desconto > 0.005) || !(alvo > 0)) return { original: real, promo: 0, clientePaga: real, real };
  const original = centavoAcima(Math.max(alvo, real) / (1 - desconto));
  const promo = Math.max(0, Math.floor((1 - real / original) * 100 + 1e-9));
  return { original, promo, clientePaga: cent(original * (1 - promo / 100)), real };
}

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

export default function Crescimento({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const dados = useEscada();
  const { itens, produtos, kits, canais, precos, concorrentes, cfgDoProduto, cfgLoja } = dados;
  const { rampas, registros, disponivel, carregando } = useRampas({ comRegistros: true });
  const regras = useMemo(() => regrasDaLoja(cfgLoja), [cfgLoja]);
  const hoje = hojeISO();
  const [selId, setSelId] = useState(null);
  const [iniciar, setIniciar] = useState(null); // {} novo | { rampa } editar degraus
  const [semanaAberta, setSemanaAberta] = useState(false);
  const [mudar, setMudar] = useState(null); // { linha, dir: 1 | -1 }
  const [encerrar, setEncerrar] = useState(null);
  const [verRegras, setVerRegras] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Uma linha por rampa, com tudo calculado ao vivo.
  const linhas = useMemo(() => {
    return rampas
      .map((r) => {
        const produto = produtos.find((p) => p.id === r.produto_id);
        const canal = canais.find((c) => c.id === r.canal_id);
        const item = itens.find((i) => i.id === `p:${r.produto_id}`);
        if (!produto || !canal || !item) return null;
        const cfg = cfgDoProduto(r.produto_id);
        const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg };
        const regs = registros.filter((g) => g.rampa_id === r.id);
        const est = estadoRampa(r, regs, regras, ctx, hoje);
        return { r, produto, canal, item, cfg, ctx, est };
      })
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, registros, produtos, canais, itens, cfgDoProduto, regras, hoje]);

  const sel = linhas.find((l) => l.r.id === selId) || linhas[0] || null;

  // Preços "vendendo agora" de todos os produtos em rampa (por canal) — os
  // kits de produtos diferentes usam o degrau de cada peça.
  const precosRampa = useMemo(() => {
    const mapa = new Map(linhas.map((l) => [`${l.r.produto_id}|${l.r.canal_id}`, l.est.preco]));
    return precos.map((p) => (p.item_tipo === "produto" && mapa.has(`${p.item_id}|${p.canal_id}`) ? { ...p, preco: mapa.get(`${p.item_id}|${p.canal_id}`) } : p));
  }, [precos, linhas]);

  // O que digitar no canal pro produto selecionado (avulso, variações, kits).
  const anuncio = useMemo(() => {
    if (!sel) return null;
    const { canal, est, cfg, r } = sel;
    const desc = descontoDoItem(`p:${r.produto_id}`, canal, { itens, produtos, kits }).desconto;
    const out = [];
    const av = anuncioFixo(est.preco, est.alvo, desc);
    if (av) out.push({ id: "avulso", nome: "Avulso (1 un.)", ...av, lucro: est.lucroAtual });
    const noDegrau = escadaDoProduto({ produtoId: r.produto_id, canal, itens, precos: precosRampa, concorrentes, cfg, p1Override: est.preco });
    const noAlvo = escadaDoProduto({ produtoId: r.produto_id, canal, itens, precos, concorrentes, cfg, p1Override: est.alvo });
    for (const l of noDegrau?.escada?.linhas || []) {
      if (l.base || !l.cadastrada) continue;
      const la = noAlvo?.escada?.linhas.find((x) => x.n === l.n);
      const alvoV = l.salvo ?? la?.sugerido ?? l.sugerido;
      const a = anuncioFixo(Math.min(l.sugerido, alvoV), alvoV, desc);
      if (a) out.push({ id: l.itemId, nome: l.nome || `Kit ${l.n}`, ...a, lucro: lucroNoPreco(canal, a.real, l.custo, l.peso, cfg), naoCompensa: l.naoCompensa });
    }
    const cfgKit = cfgDoProduto(null);
    for (const k of itens.filter((i) => i.tipo === "Kit" && (i.componentes || []).some((c) => c.produtoId === r.produto_id))) {
      const sg = sugestaoKit({ canal, kitItem: k, itens, precos: precosRampa, cfg: cfgKit });
      if (!sg) continue;
      const salvoK = precos.find((p) => p.item_tipo === "kit" && p.item_id === k.id.slice(2) && p.canal_id === canal.id);
      const alvoK = salvoK ? num(salvoK.preco) : sugestaoKit({ canal, kitItem: k, itens, precos, cfg: cfgKit })?.sugerido ?? sg.sugerido;
      const dk = descontoDoItem(k.id, canal, { itens, produtos, kits }).desconto;
      const a = anuncioFixo(Math.min(sg.sugerido, alvoK), alvoK, dk);
      if (a) out.push({ id: k.id, nome: k.nome, ...a, lucro: lucroNoPreco(canal, a.real, sg.custo, sg.peso, cfgKit), kit: true, naoCompensa: sg.naoCompensa });
    }
    return { linhas: out, desconto: desc };
  }, [sel, itens, produtos, kits, precos, precosRampa, concorrentes, cfgDoProduto]);

  // --- KPIs ---
  const prontos = linhas.filter((l) => l.est.sugestao.chave === "subir");
  const segurando = linhas.filter((l) => ["segurar", "revisar", "voltar"].includes(l.est.sugestao.chave));
  const lucroSemana = linhas.reduce((s, l) => s + (l.est.lucroSemana || 0), 0);
  const lucroSemanaAds = linhas.reduce((s, l) => s + (l.est.lucroSemanaAds ?? l.est.lucroSemana ?? 0), 0);
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
        <button type="button" className="btn primary" onClick={() => setSemanaAberta(true)} disabled={!linhas.length}>
          Registrar semana
        </button>
      </TopbarAcoes>

      <Kpis
        itens={[
          { label: "Em rampa", valor: String(linhas.length), sub: linhas.length ? `${new Set(linhas.map((l) => l.canal.id)).size} canal(is)` : "nenhum produto ainda" },
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
            sub: temSemana ? `${BRL(lucroSemanaAds)} depois de Ads · no alvo seria ${BRL(lucroSemanaAlvo)}` : "registre a semana pra ver",
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
                      </td>
                      <td>
                        {e.fase.rotulo} · {e.i + 1} de {e.degraus.length}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && <Detalhe l={sel} anuncio={anuncio} regras={regras} onMudar={(dir) => setMudar({ linha: sel, dir })} onEditar={() => setIniciar({ rampa: sel.r })} onEncerrar={() => setEncerrar(sel)} onChecklist={marcarChecklist} />}

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
      {semanaAberta && <RegistrarSemanaDialog linhas={linhas} onToast={onToast} onClose={() => setSemanaAberta(false)} />}
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

function Detalhe({ l, anuncio, regras, onMudar, onEditar, onEncerrar, onChecklist }) {
  const e = l.est;
  const noAlvo = e.fase.chave === "alvo";
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
          <button type="button" className={`btn btn-mini${e.sugestao.chave === "subir" && e.sugestao.saltos !== 2 ? " primary" : ""}`} onClick={() => onMudar(1)} disabled={noAlvo}>
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
              <div key={k} className={`deg${k < e.i ? " ok" : k === e.i ? " at" : ""}${k === e.degraus.length - 1 ? " alvo" : ""}`}>
                <div className="bar" style={{ height: alt(d) }} />
                <b>{virgula(d)}</b>
                <span className="lu">{k === e.degraus.length - 1 ? "alvo · " : ""}{BRL(e.lucroEm(d))}</span>
              </div>
            ))}
          </div>
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

          {e.check && (
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
          <div className={`alerta alerta-${{ good: "good", warn: "warn", bad: "bad" }[ads.tom] || "neutro"}`}>
            <b>{ads.titulo}</b>
            {ads.texto}
            {ads.chave === "inviavel" && e.viavelEm && e.viavelEm.preco !== e.preco ? ` Ads passa a ser viável a partir de ${BRL(e.viavelEm.preco)} (ROAS mínimo ${virgula(e.viavelEm.roasMin, 1)}).` : ""}
          </div>
          <p className="hint" style={{ margin: 0 }}>Lembrete: não suba de degrau e mexa no Ads na mesma semana.</p>
        </div>
      </div>

      <div className="secao-rampa">
        <h4 className="sub-h">Evolução <span className="muted-cel">· preço vendido, vendas por semana e avaliações</span></h4>
        <GraficoRampa est={e} />
      </div>

      <div className={`secao-rampa${e.revisar ? " destaque-revisar" : ""}`}>
        <h4 className="sub-h">
          Revisar anúncio
          {e.revisar ? <span className="badge bad" style={{ marginLeft: 8 }}>recomendado</span> : <span className="muted-cel"> · checklist de conversão</span>}
        </h4>
        {e.revisar && (
          <div className="alerta alerta-bad">
            <b>Antes de baixar preço ou colocar Ads, melhore a conversão</b>
            {e.revisarPorLancamento
              ? `${e.dias} dias no lançamento e só ${e.vendasDesde} vendas: o preço já está perto do 0 a 0, então o problema provavelmente não é preço.`
              : "ROAS abaixo do mínimo por 2 semanas: o anúncio recebe clique mas não converte."}
          </div>
        )}
        <div className="checklist-anuncio">
          {CHECKLIST_ANUNCIO.map(([k, rotulo, dica]) => (
            <label key={k}>
              <input type="checkbox" checked={!!l.r.checklist?.[k]} onChange={(ev) => onChecklist(l, k, ev.target.checked)} />
              <span>
                {rotulo}
                <small>{dica}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>As marcações ficam salvas por produto. Depois de mexer nas fotos, espere 7 dias antes de tirar conclusões.</p>
      </div>
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
                  <span key={`${d}-${k}`} className={`chip-degrau${atual ? " at" : ""}${ultimo ? " alvo" : ""}`}>
                    <button
                      type="button"
                      className="chip-degrau-valor"
                      disabled={!!editar || ultimo}
                      title={editar ? undefined : ultimo ? "Alvo (preço salvo)" : "Estou vendendo neste preço hoje"}
                      onClick={() => setPrecoHoje(virgula(d))}
                    >
                      {virgula(d)}
                      {ultimo ? " alvo" : ""}
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

function RegistrarSemanaDialog({ linhas, onToast, onClose }) {
  const { lojaId } = useLoja();
  const [data, setData] = useState(hojeISO());
  const [f, setF] = useState(() => Object.fromEntries(linhas.map((l) => [l.r.id, { vendas: "", avaliacoes: "", nota: "", ruins: "", gasto: "", adsVendas: "" }])));
  const [salvando, setSalvando] = useState(false);
  const set = (id, k) => (e) => setF((p) => ({ ...p, [id]: { ...p[id], [k]: e.target.value } }));
  async function salvar() {
    const linhasSalvar = linhas
      .filter((l) => Object.values(f[l.r.id]).some((v) => v !== ""))
      .map((l) => {
        const v = f[l.r.id];
        return {
          loja_id: lojaId || null,
          rampa_id: l.r.id,
          tipo: "semana",
          data,
          degrau: l.est.i,
          preco: l.est.preco,
          vendas: v.vendas === "" ? 0 : Math.round(num(v.vendas)),
          avaliacoes: v.avaliacoes === "" ? null : Math.round(num(v.avaliacoes)),
          nota: v.nota === "" ? null : num(v.nota),
          avaliacoes_ruins: Math.round(num(v.ruins)),
          ads_gasto: v.gasto === "" ? null : num(v.gasto),
          ads_vendas: v.adsVendas === "" ? null : Math.round(num(v.adsVendas)),
        };
      });
    if (!linhasSalvar.length) return onToast?.("Preencha pelo menos um produto");
    setSalvando(true);
    const { error } = await supabase.from("rampa_registros").insert(linhasSalvar);
    setSalvando(false);
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    onToast?.(`Semana registrada (${linhasSalvar.length} produto${linhasSalvar.length > 1 ? "s" : ""})`);
    onClose();
  }
  return (
    <EditarDialog titulo="Registrar semana" salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Registrar" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>
        Do painel do canal: vendas da semana (unidades vendidas do anúncio), o total de avaliações que aparece no anúncio, a nota, quantas avaliações de 1–2★
        chegaram na semana e, se usou Ads, o gasto e as vendas via Ads. Deixe em branco o produto que não quiser registrar.
      </p>
      <div className="field" style={{ maxWidth: 200 }}>
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      {linhas.map((l) => (
        <div key={l.r.id} className="bloco-semana">
          <div className="bloco-semana-titulo">
            <b>{l.produto.nome}</b> <CanalTag canal={l.canal} /> <span className="muted-cel">vendendo {BRL(l.est.preco)} · {l.est.avaliacoesTotal} avaliações até agora</span>
          </div>
          <div className="grid-semana">
            <div className="field"><label>Vendas na semana</label><input type="number" min="0" value={f[l.r.id].vendas} onChange={set(l.r.id, "vendas")} /></div>
            <div className="field"><label>Avaliações (total)</label><input type="number" min="0" value={f[l.r.id].avaliacoes} onChange={set(l.r.id, "avaliacoes")} /></div>
            <div className="field"><label>Nota</label><input type="text" inputMode="decimal" value={f[l.r.id].nota} onChange={set(l.r.id, "nota")} /></div>
            <div className="field"><label>1–2★ na semana</label><input type="number" min="0" value={f[l.r.id].ruins} onChange={set(l.r.id, "ruins")} /></div>
            <div className="field"><label>Ads: gasto (R$)</label><input type="text" inputMode="decimal" value={f[l.r.id].gasto} onChange={set(l.r.id, "gasto")} /></div>
            <div className="field"><label>Ads: vendas</label><input type="number" min="0" value={f[l.r.id].adsVendas} onChange={set(l.r.id, "adsVendas")} /></div>
          </div>
        </div>
      ))}
    </EditarDialog>
  );
}
