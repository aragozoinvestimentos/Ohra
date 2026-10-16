import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { SEM_COLUNA_V56, colunaFaltandoV56, limparItensEmbalagem, salvarEmbalagemOrganico } from "../lib/embalagemCanalAcoes.js";
import { BRL } from "../lib/format.js";
import { configOrganicoDoItem, nomesReceita, receitaDoCanal, totalReceita } from "../lib/embalagemCanal.js";
import EditarDialog from "./EditarDialog.jsx";

// Embalagem do canal orgânico (venda na loja, schema v56) — telas: editor de
// itens, janela do CANAL (Configuração → Canais) e janela do PRODUTO/KIT
// (Cadastros, 1º Avulso, venda física). A conta fica em lib/embalagemCanal.js.


/** Lista de itens [{embalagem_id, quantidade}] com select + quantidade + ×. */
export function ItensEmbalagem({ itens, onChange, embalagens }) {
  const lista = itens || [];
  const mudar = (i, campo, v) => onChange(lista.map((r, k) => (k === i ? { ...r, [campo]: v } : r)));
  return (
    <div className="emb-org-itens">
      {lista.map((r, i) => {
        const e = embalagens.find((x) => x.id === r.embalagem_id);
        return (
          <div key={i} className="emb-org-item">
            <select value={r.embalagem_id || ""} onChange={(ev) => mudar(i, "embalagem_id", ev.target.value)} aria-label="Item de embalagem">
              <option value="">— escolha —</option>
              {embalagens.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
            <input type="number" min="0" step="1" value={r.quantidade ?? 1} onChange={(ev) => mudar(i, "quantidade", ev.target.value === "" ? "" : Number(ev.target.value))} aria-label="Quantidade" />
            <span className="num">{BRL((Number(e?.preco) || 0) * (Number(r.quantidade) || 0))}</span>
            <button type="button" className="btn-icone" title="Tirar" onClick={() => onChange(lista.filter((_, k) => k !== i))}>
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="link-btn" onClick={() => onChange([...lista, { embalagem_id: embalagens[0]?.id || "", quantidade: 1 }])} disabled={!embalagens.length}>
        + item
      </button>
      {!embalagens.length && <div className="hint">Cadastre os itens (sacola, laço…) em Cadastros → Embalagens.</div>}
      <div className="emb-org-total">
        total por venda: <b>{BRL(totalReceita(lista, embalagens))}</b>
      </div>
    </div>
  );
}


/** Configuração → Canais: embalagem geral do canal próprio. */
export function EmbalagemCanalDialog({ canal, embalagens, onClose, onToast }) {
  const atual = canal.embalagem_canal || null;
  const [modo, setModo] = useState(atual ? atual.modo : "produto");
  const [itens, setItens] = useState(atual?.modo === "itens" ? atual.itens || [] : [{ embalagem_id: "", quantidade: 1 }]);
  const [freteZero, setFreteZero] = useState(atual ? atual.freteZero !== false : true);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    const valor = modo === "produto" ? null : modo === "sem" ? { modo: "sem", freteZero } : { modo: "itens", itens: limparItensEmbalagem(itens), freteZero };
    setSalvando(true);
    const { error } = await supabase.from("canais").update({ embalagem_canal: valor }).eq("id", canal.id);
    setSalvando(false);
    if (error) return onToast?.(colunaFaltandoV56(error) ? SEM_COLUNA_V56 : `Não foi possível salvar: ${error.message}`);
    recarregarCatalogo();
    onToast?.(`Embalagem do ${canal.nome} salva`);
    onClose();
  }
  return (
    <EditarDialog titulo={`Embalagem no canal ${canal.nome}`} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Salvar">
      <div className="emb-org-radio">
        <label className={modo === "produto" ? "on" : ""}>
          <input type="radio" checked={modo === "produto"} onChange={() => setModo("produto")} />
          <div>
            <b>A do produto</b>
            <small>igual aos marketplaces (como era antes)</small>
          </div>
        </label>
        <label className={modo === "sem" ? "on" : ""}>
          <input type="radio" checked={modo === "sem"} onChange={() => setModo("sem")} />
          <div>
            <b>Sem embalagem</b>
            <small>R$ 0 — entrega na mão</small>
          </div>
        </label>
        <label className={modo === "itens" ? "on" : ""}>
          <input type="radio" checked={modo === "itens"} onChange={() => setModo("itens")} />
          <div style={{ flex: 1 }}>
            <b>Embalagem própria deste canal</b>
            <small>vale pra todo produto que não tiver a sua</small>
            {modo === "itens" && <ItensEmbalagem itens={itens} onChange={setItens} embalagens={embalagens} />}
          </div>
        </label>
      </div>
      {modo !== "produto" && (
        <label className="check-inline" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={freteZero} onChange={(e) => setFreteZero(e.target.checked)} /> Frete neste canal = R$ 0 (a pessoa leva na hora)
        </label>
      )}
      <p className="hint" style={{ margin: "8px 0 0" }}>
        Shopee, Mercado Livre, TikTok e Shein não mudam. Produto com tamanho diferente pode ter a embalagem dele (Cadastros → Produtos/Kits, 1º Avulso ou na hora de lançar a venda).
      </p>
    </EditarDialog>
  );
}

/** Editor do produto/kit (usado no cadastro e na janela): "a do canal" | "sem" | itens. */
export function EditorEmbalagemOrganico({ config, onChange, embalagens, canal }) {
  const rc = receitaDoCanal(canal);
  const modo = config?.modo || "canal";
  return (
    <div className="emb-org-radio">
      <label className={modo === "canal" ? "on" : ""}>
        <input type="radio" checked={modo === "canal"} onChange={() => onChange({ modo: "canal" })} />
        <div>
          <b>A do canal</b>
          <small>{rc ? `${rc.sem ? "sem embalagem" : nomesReceita(rc.itens, embalagens)} · ${BRL(totalReceita(rc.itens, embalagens))}` : "o canal usa a embalagem do produto"}</small>
        </div>
      </label>
      <label className={modo === "sem" ? "on" : ""}>
        <input type="radio" checked={modo === "sem"} onChange={() => onChange({ modo: "sem" })} />
        <div>
          <b>Sem embalagem</b>
          <small>R$ 0</small>
        </div>
      </label>
      <label className={modo === "itens" ? "on" : ""}>
        <input type="radio" checked={modo === "itens"} onChange={() => onChange({ modo: "itens", itens: config?.itens?.length ? config.itens : [{ embalagem_id: "", quantidade: 1 }] })} />
        <div style={{ flex: 1 }}>
          <b>Própria deste produto</b>
          <small>tamanho certo, enfeite…</small>
          {modo === "itens" && <ItensEmbalagem itens={config.itens} onChange={(it) => onChange({ modo: "itens", itens: it })} embalagens={embalagens} />}
        </div>
      </label>
    </div>
  );
}

/** Janela do produto/kit (1º Avulso, Produtos precificados, venda física). */
export function EmbalagemOrganicoDialog({ dono, config, canal, embalagens, onClose, onToast, onSalvo }) {
  const [cfg, setCfg] = useState(config || { modo: "canal" });
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    const r = await salvarEmbalagemOrganico(dono, cfg);
    setSalvando(false);
    if (r.erro) return onToast?.(r.erro);
    onToast?.(`${dono.nome}: embalagem no ${canal?.nome || "orgânico"} salva`);
    onSalvo?.();
    onClose();
  }
  return (
    <EditarDialog titulo={`Embalagem de ${dono.nome} no ${canal?.nome || "orgânico"}`} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Salvar">
      <EditorEmbalagemOrganico config={cfg} onChange={setCfg} embalagens={embalagens} canal={canal} />
      <p className="hint" style={{ margin: "8px 0 0" }}>
        Fica gravado no {dono.tipo === "kit" ? "kit" : "produto"} (o mesmo bloco “Embalagem no orgânico” do cadastro).{dono.tipo === "kit" ? "" : " As variações (kit 2, kit 3…) seguem esta escolha."} Nos marketplaces nada muda.
      </p>
    </EditarDialog>
  );
}

/** Bloco do cadastro (Produtos/Kits em edição): grava direto no produto/kit. */
export function EmbalagemOrganicoBloco({ dono, config, canais, embalagens, onToast }) {
  const canal = (canais || []).find((c) => receitaDoCanal(c)) || null;
  const [cfg, setCfg] = useState(config || { modo: "canal" });
  const [salvando, setSalvando] = useState(false);
  if (!canal)
    return (
      <p className="hint" style={{ margin: 0 }}>
        Nenhum canal próprio com embalagem própria ainda. Pra a venda na loja usar outra embalagem (sacola, laço…), configure em Configuração → Canais → Embalagem.
      </p>
    );
  async function salvar() {
    setSalvando(true);
    const r = await salvarEmbalagemOrganico(dono, cfg);
    setSalvando(false);
    onToast?.(r.erro || `${dono.nome}: embalagem no ${canal.nome} salva`);
  }
  return (
    <div>
      <EditorEmbalagemOrganico config={cfg} onChange={setCfg} embalagens={embalagens} canal={canal} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-mini" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : `Salvar embalagem no ${canal.nome}`}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {config ? "" : "ainda não definida — usando a do canal (o app avisa ao lançar a venda). "}
          {dono.tipo === "kit" ? "" : "Variações seguem esta escolha. "}Marketplaces continuam com a embalagem acima.
        </span>
      </div>
    </div>
  );
}

/**
 * Na hora de lançar a venda (venda física / venda orgânica): mostra a embalagem
 * do orgânico do item e, se o produto ainda não confirmou a dele, AVISA com
 * "Usar a do canal" (grava {modo:"canal"}) e "Editar" — uma vez só por produto.
 */
export function EmbalagemOrganicoVenda({ item, canal, itemNoCanal, produtos, kits, embalagens, onToast }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  if (!item || !canal || !receitaDoCanal(canal)) return null;
  const it = itemNoCanal(item, canal);
  const e = it?.embalagemCanal;
  if (!e?.dono) return null;
  const config = configOrganicoDoItem(item, { produtos, kits }).config;
  const qual = e.dono.tipo === "kit" ? "kit" : "produto";
  async function usarCanal() {
    setSalvando(true);
    const r = await salvarEmbalagemOrganico(e.dono, { modo: "canal" });
    setSalvando(false);
    onToast?.(r.erro || `${e.dono.nome}: embalagem do ${canal.nome} confirmada`);
  }
  return (
    <>
      {e.definido ? (
        <div className="emb-org-linha">
          <span>
            Embalagem no {canal.nome}: <b>{e.nomes}</b> ({BRL(e.valor)}) · custo do item <b>{BRL(it.custoTotal)}</b>
          </span>
          <button type="button" className="link-btn" onClick={() => setAberto(true)}>
            trocar
          </button>
        </div>
      ) : (
        <div className="alerta alerta-warn emb-org-aviso">
          <b>Confira a embalagem deste {qual} no {canal.nome}</b>
          Ainda não foi definida pra {e.dono.nome}: o custo está usando a do canal ({e.nomes}, {BRL(e.valor)}) → custo do item {BRL(it.custoTotal)}. Se for outra, edite agora — fica gravado e não pergunta mais.
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-mini" disabled={salvando} onClick={usarCanal}>
              {salvando ? "Salvando…" : "Usar a do canal"}
            </button>
            <button type="button" className="btn btn-mini primary" onClick={() => setAberto(true)}>
              Editar a embalagem
            </button>
          </div>
        </div>
      )}
      {aberto && <EmbalagemOrganicoDialog dono={e.dono} config={config} canal={canal} embalagens={embalagens} onClose={() => setAberto(false)} onToast={onToast} />}
    </>
  );
}
