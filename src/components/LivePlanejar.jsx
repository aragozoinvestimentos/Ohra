import { useMemo, useState } from "react";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Ajuda from "./Ajuda.jsx";
import { BRL } from "../lib/format.js";
import { hojeSP } from "../lib/datas.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { horasDoItem } from "../lib/pedidos.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { ESTRATEGIAS, PRAZO_PADRAO, completarCopia, copiaDoItem, estrategiaPadrao, historicoDoItem, lucroNaLive, precoInicial, prazoEnvio } from "../lib/live.js";
import { anuncioNoRiscado } from "../lib/rampaAnuncio.js";
import { criarLive, excluirLive, salvarLive } from "../lib/liveAcoes.js";
import { dm, diaSemana, planoEmTexto, rotuloLive } from "../lib/liveTexto.js";
import PromoAviso from "./PromoAviso.jsx";
import CupomLivePlano from "./LiveCupom.jsx";

// Live → 1 · Planejar: criar a live (plataforma, data), escolher os produtos
// (cada um vira uma CÓPIA — preço salvo, custo e riscado de hoje), uma
// estratégia por produto, a ordem do roteiro, prazo de envio e taxa extra.
// "Repetir o plano" traz uma live anterior preenchida (dá pra editar tudo).
const num = (v) => {
  const t = String(v ?? "").trim();
  const x = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return isFinite(x) ? x : null;
};
const v2 = (x) => (x == null || x === "" ? "" : String(Math.round(Number(x) * 100) / 100).replace(".", ","));

function Num({ valor, onValor, largura = 80, passo = false, placeholder }) {
  return (
    <input
      key={String(valor ?? "")}
      defaultValue={passo ? String(valor ?? "") : v2(valor)}
      inputMode="decimal"
      placeholder={placeholder}
      style={{ width: largura }}
      onBlur={(e) => {
        const x = e.target.value.trim() === "" ? null : num(e.target.value);
        if (x !== valor) onValor(x);
      }}
    />
  );
}

export function NovaLive({ esc, lv, canaisLive, riscadoDe, ctxDaLive, setAtualId, onToast, lojaId, base = null, onFechar }) {
  const [f, setF] = useState(() => ({ nome: base ? base.nome || "Live" : "Live", canal_id: base?.canal_id || canaisLive[0]?.id || "", data: hojeSP(), repetir: base?.id || "" }));
  const [salvando, setSalvando] = useState(false);
  const anteriores = lv.lives.filter((l) => (l.produtos || []).length);
  async function criar() {
    const canal = canaisLive.find((c) => c.id === f.canal_id);
    if (!canal) return onToast("Escolha a plataforma da live (TikTok ou Shopee)");
    setSalvando(true);
    const src = lv.lives.find((l) => l.id === f.repetir);
    // Repetir: a cópia é refeita com os preços/custos de HOJE; a estratégia vem da live escolhida.
    const produtos = (src?.produtos || []).map((p, i) => {
      const item = esc.itens.find((x) => x.id === p.item_id);
      if (!item) return { ...p, ordem: i };
      const nova = copiaDoItem(item, { canal, precos: esc.precos, produtos: esc.produtos, riscadoDe: riscadoDe(canal), ctx: ctxDaLive({ canal_id: canal.id }) });
      return { ...nova, estrategia: { ...p.estrategia }, pronto: p.pronto ?? null, ordem: i };
    });
    const r = await criarLive({
      loja_id: lojaId || null,
      nome: f.nome.trim() || "Live",
      canal_id: canal.id,
      data: f.data || hojeSP(),
      status: "plano",
      prazo_dias: src?.prazo_dias ?? PRAZO_PADRAO[canal.tipo] ?? 2,
      taxa_extra: src?.taxa_extra ?? null,
      produtos,
      notas: src ? `Plano repetido da live de ${dm(src.data)}` : null,
    });
    setSalvando(false);
    if (!r.ok) return onToast(r.msg);
    setAtualId(r.live.id);
    onToast(src ? "Live criada com o plano anterior — ajuste o que quiser" : "Live criada — agora escolha os produtos");
    onFechar?.();
  }
  return (
    <div className="panel">
      <h3>Nova live</h3>
      <div className="grid-auto">
        <div className="field">
          <label>Nome</label>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="ex.: Live de Natal" />
        </div>
        <div className="field">
          <label>Plataforma</label>
          <select value={f.canal_id} onChange={(e) => setF({ ...f, canal_id: e.target.value })}>
            {!canaisLive.length && <option value="">— cadastre o canal TikTok ou Shopee —</option>}
            {canaisLive.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Data</label>
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="field">
          <label>
            Repetir o plano de
            <Ajuda texto="Traz os produtos e as estratégias de uma live anterior, com os preços e custos de hoje. Depois dá pra mudar tudo." />
          </label>
          <select value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })}>
            <option value="">— começar do zero —</option>
            {anteriores.map((l) => (
              <option key={l.id} value={l.id}>
                {rotuloLive(l, esc.canais)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="acoes-form">
        {onFechar && (
          <button type="button" className="btn" onClick={onFechar}>
            Cancelar
          </button>
        )}
        <button type="button" className="btn primary" disabled={salvando} onClick={criar}>
          {salvando ? "Criando…" : "Criar live"}
        </button>
      </div>
    </div>
  );
}

// Seletor de live (as 3 sub-abas usam o mesmo).
export function SeletorLive({ lv, esc, atual, setAtualId, filtro, extra }) {
  const lista = lv.lives.filter((l) => !filtro || filtro(l));
  return (
    <div className="toolbar live-seletor">
      <label className="faint">Live:</label>
      <select value={atual?.id || ""} onChange={(e) => setAtualId(e.target.value)}>
        <option value="">— escolha —</option>
        {lista.map((l) => (
          <option key={l.id} value={l.id}>
            {rotuloLive(l, esc.canais)}
          </option>
        ))}
      </select>
      {extra}
    </div>
  );
}

// Estratégia com os campos vazios preenchidos pela sugestão (dá pra editar).
function estrategiaCompleta(p, ctx) {
  const padrao = estrategiaPadrao(p.estrategia?.tipo || "escada", p, ctx);
  const e = { ...(p.estrategia || {}) };
  for (const [k, v] of Object.entries(padrao)) if (e[k] == null || e[k] === "") e[k] = v;
  return e;
}
const normalizar = (lista, ctx) => lista.map((p0) => {
  const p = completarCopia(p0, ctx);
  return { ...p, estrategia: estrategiaCompleta(p, ctx) };
});

function CamposEstrategia({ e, set }) {
  const campo = (rot, k, opts = {}) => (
    <label className="live-campo" key={k}>
      <span>{rot}</span>
      <Num valor={e[k]} onValor={(x) => set({ ...e, [k]: x })} {...opts} />
    </label>
  );
  if (e.tipo === "escada")
    return (
      <>
        {campo("Piso R$", "piso")}
        {campo("Alvo R$", "alvo")}
        {campo("Passo R$", "passo", { largura: 64 })}
        <label className="live-campo">
          <span>Sobe por</span>
          <select value={e.subirPor || "vendas"} onChange={(ev) => set({ ...e, subirPor: ev.target.value })}>
            <option value="vendas">vendas</option>
            <option value="tempo">tempo</option>
            <option value="ambos">o que vier primeiro</option>
          </select>
        </label>
        {e.subirPor !== "tempo" && campo("a cada (vendas)", "aCada", { largura: 56, passo: true })}
        {e.subirPor !== "vendas" && campo("a cada (min)", "minutos", { largura: 56, passo: true })}
      </>
    );
  if (e.tipo === "primeiros")
    return (
      <>
        {campo("Preço especial R$", "preco")}
        {campo("Primeiros (N)", "n", { largura: 56, passo: true })}
        {campo("Depois R$", "normal")}
      </>
    );
  if (e.tipo === "relampago")
    return (
      <>
        {campo("Relâmpago R$", "preco")}
        {campo("Por (min)", "minutos", { largura: 56, passo: true })}
        {campo("Normal R$", "normal")}
      </>
    );
  if (e.tipo === "brinde")
    return (
      <>
        {campo("Preço R$", "preco")}
        <label className="live-campo">
          <span>Brinde</span>
          <input defaultValue={e.brindeNome || ""} key={`bn-${e.brindeNome || ""}`} style={{ width: 140 }} placeholder="ex.: chaveiro" onBlur={(ev) => set({ ...e, brindeNome: ev.target.value })} />
        </label>
        {campo("Custo do brinde R$", "brindeCusto")}
      </>
    );
  return campo("Preço da live R$", "preco");
}

export default function LivePlanejar({ esc, lv, atual, setAtualId, canaisLive, ctxDaLive, riscadoDe, onToast, irPara, lojaId }) {
  const cat = useCatalogo();
  const [criando, setCriando] = useState(false);
  const [rascunho, setRascunho] = useState(null); // { id, ...campos editados }
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const [addItem, setAddItem] = useState("");
  const grupos = useMemo(() => gruposDoSeletor(esc.itens), [esc.itens]);

  const live = atual && rascunho?.id === atual.id ? { ...atual, ...rascunho } : atual;
  const canal = live ? esc.canais.find((c) => c.id === live.canal_id) || null : null;
  const ctx = live ? { ...ctxDaLive(live), taxaExtra: live.taxa_extra } : null;
  const sujo = !!(rascunho && atual && rascunho.id === atual.id && Object.keys(rascunho).length > 1);
  const editar = (patch) => setRascunho((r) => ({ ...(r?.id === atual.id ? r : { id: atual.id }), ...patch }));
  const produtos = [...(live?.produtos || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const setProdutos = (lista) => editar({ produtos: lista.map((p, i) => ({ ...p, ordem: i })) });
  const setProd = (key, patch) => setProdutos(produtos.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const seletor = (
    <SeletorLive
      lv={lv}
      esc={esc}
      atual={atual}
      setAtualId={(id) => {
        setRascunho(null);
        setCriando(false);
        setAtualId(id);
      }}
      extra={
        <button type="button" className="btn btn-sm" onClick={() => setCriando("zero")}>
          + Nova live
        </button>
      }
    />
  );
  if (criando || !atual)
    return (
      <>
        {lv.lives.length > 0 && seletor}
        <NovaLive key={criando === "repetir" && atual ? atual.id : "nova"} base={criando === "repetir" ? atual : null} esc={esc} lv={lv} canaisLive={canaisLive} riscadoDe={riscadoDe} ctxDaLive={ctxDaLive} setAtualId={(id) => { setCriando(false); setAtualId(id); }} onToast={onToast} lojaId={lojaId} onFechar={lv.lives.length ? () => setCriando(false) : null} />
      </>
    );

  const bloqueada = live.status !== "plano";
  async function salvar(extra = {}) {
    if (!rascunho && !Object.keys(extra).length) return true;
    setSalvando(true);
    const { id: _id, ...patch } = rascunho || {};
    if (patch.produtos) patch.produtos = normalizar(patch.produtos, ctx);
    if (patch.pedidos?._cupom) {
      const c = patch.pedidos._cupom;
      const n = (v) => {
        const x = Number(String(v ?? "").replace(",", "."));
        return isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null;
      };
      patch.pedidos = { ...patch.pedidos, _cupom: { ...c, valor: n(c.valor), minimo: n(c.minimo) } };
    }
    const r = await salvarLive(atual.id, { ...patch, ...extra });
    setSalvando(false);
    if (!r.ok) {
      onToast(r.msg);
      return false;
    }
    setRascunho(null);
    return true;
  }
  async function comecar() {
    if (!produtos.length) return onToast("Escolha pelo menos um produto pra live");
    const ok = await salvar({ status: "aovivo", inicio: new Date().toISOString(), produtos: normalizar(produtos, ctx).map((p, i) => ({ ...p, ordem: i })) });
    if (ok) {
      onToast("Live começou — boa live!");
      irPara("aovivo");
    }
  }
  function adicionar(id) {
    setAddItem("");
    const item = esc.itens.find((i) => i.id === id);
    if (!item || !canal) return;
    if (produtos.some((p) => p.item_id === id)) return onToast("Esse item já está na live");
    const c = copiaDoItem(item, { canal, precos: esc.precos, produtos: esc.produtos, riscadoDe: riscadoDe(canal), ctx });
    if (!c.salvo) onToast(`${item.nome} não tem preço salvo em ${canal.nome} — digite os preços da live`);
    setProdutos([...produtos, c]);
  }
  const mover = (i, d) => {
    const l = [...produtos];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setProdutos(l);
  };

  // Conferência de produção: o que você vai deixar pronto × o tempo de impressão.
  const horasPronto = produtos.reduce((t, p) => {
    const item = esc.itens.find((i) => i.id === p.item_id);
    const h = item ? horasDoItem(item, esc.produtos) : null;
    return t + (h || 0) * (Number(p.pronto) || 0);
  }, 0);
  const impAtivas = (cat.impressoras || []).filter((i) => i.ativa !== false).length || 1;
  const horasDia = Number(cat.farmConfig?.horas_dia_operacao) || 8;
  const envio = prazoEnvio(live.data, live.prazo_dias ?? PRAZO_PADRAO[canal?.tipo] ?? 2);

  return (
    <>
      {seletor}
      <div className="panel">
        <h3>
          {live.nome || "Live"} <CanalTag canal={canal} /> <span className="faint">· {diaSemana(live.data)} {dm(live.data)}</span>
          {bloqueada && <span className="st st-decisao" style={{ marginLeft: 8 }}>{live.status === "aovivo" ? "ao vivo" : "encerrada"}</span>}
          <button type="button" className="btn btn-sm danger live-excluir" onClick={() => setConfirmar("excluir")}>
            × Excluir live
          </button>
        </h3>
        {bloqueada && (
          <div className="alerta alerta-info">
            <b>{live.status === "aovivo" ? "Esta live está acontecendo" : "Esta live já acabou"}</b>
            O plano fica guardado como estava.{" "}
            <button type="button" className="link-btn" onClick={() => irPara(live.status === "aovivo" ? "aovivo" : "resultados")}>
              {live.status === "aovivo" ? "Ir pro Ao vivo →" : "Ver os resultados →"}
            </button>{" "}
            ·{" "}
            <button type="button" className="link-btn" onClick={() => setCriando("repetir")}>
              repetir este plano numa live nova
            </button>
          </div>
        )}
        <fieldset disabled={bloqueada} className="live-fieldset">
          <div className="grid-auto">
            <div className="field">
              <label>Nome</label>
              <input value={live.nome || ""} onChange={(e) => editar({ nome: e.target.value })} />
            </div>
            <div className="field">
              <label>Data</label>
              <input type="date" value={live.data} onChange={(e) => editar({ data: e.target.value })} />
            </div>
            <div className="field">
              <label>
                Prazo de envio (dias úteis)
                <Ajuda texto="Quanto tempo a plataforma dá pra deixar o pedido pronto/postar. TikTok: 1 dia útil; Shopee: 2 dias úteis (Logística Integrada). Confira o da sua conta no Seller Center e ajuste aqui." />
              </label>
              <Num valor={live.prazo_dias ?? PRAZO_PADRAO[canal?.tipo] ?? 2} onValor={(x) => editar({ prazo_dias: x == null ? null : Math.round(x) })} passo largura={70} />
              <div className="hint">enviar até {diaSemana(envio)} {dm(envio)}</div>
            </div>
            <div className="field">
              <label>
                Taxa extra da live (%)
                <Ajuda texto="Não achamos taxa exclusiva de live: a venda paga a mesma comissão do canal. Use este campo só se houver algo a mais (ex.: comissão de um criador que faz a live). Vazio = 0." />
              </label>
              <Num valor={live.taxa_extra != null ? Math.round(live.taxa_extra * 1000) / 10 : null} onValor={(x) => editar({ taxa_extra: x == null ? null : x / 100 })} largura={70} placeholder="0" />
            </div>
          </div>
          <div className="field">
            <label>Notas do plano</label>
            <input value={live.notas || ""} onChange={(e) => editar({ notas: e.target.value })} placeholder="roteiro, horário, o que vai falar…" />
          </div>
        </fieldset>
      </div>

      <div className="panel">
        <h3>
          Produtos da live ({produtos.length})
          <Ajuda texto="Cada produto vira uma cópia dentro da live (preço salvo, custo e riscado de hoje). Mexer aqui NÃO muda nada fora da aba Live." />
        </h3>
        {!bloqueada && (
          <div className="toolbar">
            <BuscaItem grupos={grupos} value={addItem} onChange={adicionar} vazio="+ Adicionar produto ou kit" />
          </div>
        )}
        {!produtos.length && <div className="empty">Nenhum produto ainda. Adicione os produtos (ou kits) que vai mostrar na live.</div>}
        <div className="live-plano-lista">
          {produtos.map((p0, i) => {
            const p = completarCopia(p0, ctx);
            const e = estrategiaCompleta(p, ctx);
            const ini = precoInicial({ ...p, estrategia: e });
            const lucroIni = ini ? lucroNaLive(p, ini, ctx) : null;
            const lucroSalvo = p.salvo ? lucroNaLive({ ...p, estrategia: null }, p.salvo, ctx) : null;
            const an = ini && p.riscado ? anuncioNoRiscado(ini, p.riscado) : null;
            const hist = historicoDoItem(p.item_id, lv.lives, lv.eventos, ctxDaLive, live.id);
            return (
              <div className="live-plano-item" key={p.key}>
                <div className="live-plano-cab">
                  <span className="live-ordem">{i + 1}</span>
                  <div className="live-plano-nome">
                    <b>{p.nome}</b> {p.sku && <span className="faint">· {p.sku}</span>}
                    <div className="faint">
                      {p.salvo ? (
                        <>
                          salvo {BRL(p.salvo)}
                          {lucroSalvo != null && ` · lucro ${BRL(lucroSalvo)}`}
                        </>
                      ) : p.sugerido ? (
                        <>sem preço salvo em {canal?.nome || "neste canal"} — sugerido {BRL(p.sugerido)} pela sua margem desejada</>
                      ) : (
                        <>sem preço salvo em {canal?.nome || "neste canal"}</>
                      )}{" "}
                      · custo {BRL(p.custo)}
                    </div>
                  </div>
                  {!bloqueada && (
                    <span className="live-plano-acoes">
                      <button type="button" className="btn-icone" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                        ↑
                      </button>
                      <button type="button" className="btn-icone" title="Descer" disabled={i === produtos.length - 1} onClick={() => mover(i, 1)}>
                        ↓
                      </button>
                      <button type="button" className="btn-icone" title="Tirar da live" onClick={() => setProdutos(produtos.filter((x) => x.key !== p.key))}>
                        ×
                      </button>
                    </span>
                  )}
                </div>
                <fieldset disabled={bloqueada} className="live-fieldset live-estrategia">
                  <label className="live-campo">
                    <span>Estratégia</span>
                    <select value={e.tipo} onChange={(ev) => setProd(p.key, { sugerido: p.sugerido ?? null, estrategia: estrategiaPadrao(ev.target.value, p, ctx) })}>
                      {ESTRATEGIAS.map((x) => (
                        <option key={x.id} value={x.id} title={x.desc}>
                          {x.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <CamposEstrategia e={e} set={(ne) => setProd(p.key, { sugerido: p.sugerido ?? null, estrategia: ne })} />
                  <label className="live-campo">
                    <span>Vou ter pronto</span>
                    <Num valor={p.pronto ?? null} onValor={(x) => setProd(p.key, { pronto: x == null ? null : Math.round(x) })} passo largura={56} placeholder={hist ? String(hist.pronto) : "—"} />
                  </label>
                </fieldset>
                <div className="live-plano-texto">
                  <b>Plano:</b> {planoEmTexto(e, p.salvo || p.sugerido)}{" "}
                  {!bloqueada && (
                    <button type="button" className="link-btn" onClick={() => setProd(p.key, { sugerido: p.sugerido ?? null, estrategia: estrategiaPadrao(e.tipo, p, ctx) })}>
                      voltar à sugestão
                    </button>
                  )}
                </div>
                <div className="live-plano-info">
                  <span>
                    Abre em <b>{ini ? BRL(ini) : "—"}</b>
                    {lucroIni != null && <span className={lucroIni < 0 ? "bad" : ""}> · lucro {BRL(lucroIni)}</span>}
                  </span>
                  {an && (
                    <span className="faint">
                      digitar: original {BRL(an.original)} · promo {an.promo}% → cliente paga {BRL(an.clientePaga)}
                      {an.acimaDoRiscado && " (acima do riscado)"}
                      <PromoAviso canal={canal} promo={an.promo} />
                    </span>
                  )}
                  {hist ? (
                    <span className="faint">
                      {hist.lives === 1 ? "Na última live" : `Nas últimas ${hist.lives} lives`}: média {Math.round(hist.media * 10) / 10} por live
                      {hist.ultima?.vendeuAte != null && ` · vendeu até ${BRL(hist.ultima.vendeuAte)}`} → tenha ~{hist.pronto} prontos
                    </span>
                  ) : (
                    <span className="faint">primeira live com este produto</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {horasPronto > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            Pra ter pronto o que você marcou: ~{Math.round(horasPronto * 10) / 10} h de impressão · sua farm faz ~{impAtivas * horasDia} h/dia ({impAtivas} impressora
            {impAtivas > 1 ? "s" : ""} × {horasDia} h)
            {horasPronto > impAtivas * horasDia * Math.max(1, live.prazo_dias ?? 1) && " — ⚠ não cabe no prazo de envio; imprima antes da live"}
          </div>
        )}
      </div>

      <CupomLivePlano
        produtos={produtos.map((p0) => {
          const p = completarCopia(p0, ctx);
          return { ...p, estrategia: estrategiaCompleta(p, ctx) };
        })}
        ctx={ctx}
        cupom={live.pedidos?._cupom || null}
        bloqueado={bloqueada}
        onCupom={(c) => {
          const ped = { ...(live.pedidos || {}) };
          if (c) ped._cupom = c;
          else delete ped._cupom;
          editar({ pedidos: ped });
        }}
      />

      {!bloqueada && (
        <div className="acoes-form live-acoes-fixas">
          <span style={{ flex: 1 }} />
          {sujo && <span className="faint">alterações não salvas</span>}
          <button type="button" className="btn" disabled={!sujo || salvando} onClick={() => salvar().then((ok) => ok && onToast("Plano salvo"))}>
            Salvar plano
          </button>
          <button type="button" className="btn primary" disabled={salvando} onClick={comecar}>
            ● Começar a live
          </button>
        </div>
      )}
      {confirmar === "excluir" && (
        <ConfirmDialog
          titulo="Excluir esta live?"
          mensagem="O plano e tudo o que foi marcado nela somem. Nada fora da aba Live muda."
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setConfirmar(null)}
          onConfirm={async () => {
            setConfirmar(null);
            const r = await excluirLive(atual.id);
            if (!r.ok) return onToast(r.msg);
            setRascunho(null);
            setAtualId("");
            onToast("Live excluída");
          }}
        />
      )}
    </>
  );
}
