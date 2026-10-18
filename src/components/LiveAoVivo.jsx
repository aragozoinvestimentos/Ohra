import { useEffect, useState } from "react";
import CanalTag from "./CanalTag.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import LiveLista from "./LiveLista.jsx";
import { SeletorLive } from "./LivePlanejar.jsx";
import { BRL } from "../lib/format.js";
import { estrategiasDoModo, cruzarPedidos, estadoProduto, estrategiaPadrao, lucroNaLive, nomeEstrategia, precoInicial, resumoLive } from "../lib/live.js";
import { excluirLive, registrarEvento, salvarLive } from "../lib/liveAcoes.js";
import { resumoEstrategia } from "../lib/liveTexto.js";
import PromoAviso from "./PromoAviso.jsx";
import { CupomAoVivo } from "./LiveCupom.jsx";

// Live → 2 · Ao vivo: cronômetro, produto da vez em destaque (preço agora +
// o que digitar), +1 venda grande (e −1), próximo degrau com "subir agora",
// troca de estratégia no meio, lucro e unidades somando ao vivo. Pensado pro
// computador (2 telas), funciona no celular. Encerrar → Lista da live.
const relogio = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const v2 = (x) => String(Math.round(Number(x) * 100) / 100).replace(".", ",");
const lerNum = (t) => {
  const s = String(t ?? "").trim();
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return isFinite(x) && x > 0 ? x : null;
};

function Diferente({ live, onToast, onDepois }) {
  const [txt, setTxt] = useState(live.diferente || "");
  return (
    <div className="panel">
      <h3>O que você fez diferente nesta live?</h3>
      <textarea rows={3} style={{ width: "100%" }} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="horário, ordem dos produtos, brinde, a foto com os produtos, cupom…" />
      <div className="acoes-form">
        {onDepois && (
          <button type="button" className="btn" onClick={onDepois}>
            Depois — ir pras métricas
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const r = await salvarLive(live.id, { diferente: txt.trim() || null });
            onToast(r.ok ? "Anotado" : r.msg);
          }}
        >
          Registrar agora
        </button>
      </div>
    </div>
  );
}

export { Diferente };

export default function LiveAoVivo({ esc, lv, atual, setAtualId, ctxDaLive, linhasPedidos, onToast, irPara }) {
  const [agora, setAgora] = useState(() => Date.now());
  const [focoKey, setFocoKey] = useState(null);
  const [precoTxt, setPrecoTxt] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const live = atual;
  const aoVivo = live?.status === "aovivo";
  useEffect(() => {
    if (!aoVivo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aoVivo]);

  const seletor = <SeletorLive lv={lv} esc={esc} atual={live} setAtualId={setAtualId} />;
  if (!live)
    return (
      <>
        {lv.lives.length > 0 && seletor}
        <div className="panel">
          <div className="empty">
            Nenhuma live escolhida.{" "}
            <button type="button" className="link-btn" onClick={() => irPara("planejar")}>
              Planejar uma live →
            </button>
          </div>
        </div>
      </>
    );
  const canal = esc.canais.find((c) => c.id === live.canal_id) || null;
  const ctx = { ...ctxDaLive(live), taxaExtra: live.taxa_extra };
  const produtos = [...(live.produtos || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const eventos = lv.eventos.filter((e) => e.live_id === live.id);

  if (live.status === "plano")
    return (
      <>
        {seletor}
        <div className="panel">
          <div className="empty">
            Esta live ainda não começou ({produtos.length} produto{produtos.length === 1 ? "" : "s"} no plano).{" "}
            <button
              type="button"
              className="btn primary"
              disabled={!produtos.length}
              onClick={async () => {
                const r = await salvarLive(live.id, { status: "aovivo", inicio: new Date().toISOString() });
                if (!r.ok) onToast(r.msg);
              }}
            >
              ● Começar a live
            </button>
          </div>
        </div>
      </>
    );

  if (live.status === "encerrada") {
    const cruz = cruzarPedidos(live, lv.eventos, linhasPedidos);
    return (
      <>
        {seletor}
        <LiveLista live={live} eventos={lv.eventos} canal={canal} cruz={cruz} esc={esc} ctx={ctx} onToast={onToast} />
        {!live.diferente && <Diferente live={live} onToast={onToast} onDepois={() => irPara("resultados")} />}
        {live.diferente && (
          <div className="acoes-form">
            <button type="button" className="btn" onClick={() => irPara("resultados")}>
              Ver os resultados →
            </button>
          </div>
        )}
      </>
    );
  }

  const resumo = resumoLive(live, lv.eventos, ctx);
  const estados = new Map(produtos.map((p) => [p.key, estadoProduto(p, eventos, agora, live.inicio)]));
  const foco = produtos.find((p) => p.key === focoKey) || produtos[0];
  const ef = foco ? estados.get(foco.key) : null;
  const venda = (p, q) => registrarEvento(live, { tipo: "venda", produto_key: p.key, quantidade: q, preco: estados.get(p.key).preco }).then((r) => !r.ok && onToast(r.msg));
  const mudarPreco = (p, preco, info = null) => registrarEvento(live, { tipo: "preco", produto_key: p.key, preco, info }).then((r) => (r.ok ? setPrecoTxt("") : onToast(r.msg)));
  async function trocarEstrategia(p, tipo) {
    const nova = estrategiaPadrao(tipo, p, ctx);
    const lista = (live.produtos || []).map((x) => (x.key === p.key ? { ...x, estrategia: nova } : x));
    const r = await salvarLive(live.id, { produtos: lista });
    if (!r.ok) return onToast(r.msg);
    await registrarEvento(live, { tipo: "estrategia", produto_key: p.key, preco: precoInicial({ ...p, estrategia: nova }), info: { tipo } });
  }
  const copiar = (t) => navigator.clipboard?.writeText(String(t)).then(() => onToast(`Copiado: ${t}`));
  const lucroFoco = ef ? lucroNaLive(foco, ef.preco, ctx) : null;
  const sug = ef?.sugestao;

  return (
    <>
      {seletor}
      <div className="live-topo">
        <span className="live-rec">● AO VIVO</span>
        <span className="live-relogio">{relogio(agora - new Date(live.inicio).getTime())}</span>
        <CanalTag canal={canal} />
        <span className="live-topo-num">
          <b>{resumo.qtd}</b> vendas
        </span>
        <span className="live-topo-num">
          lucro <b>{BRL(resumo.lucro)}</b>
          {resumo.descontoCupom > 0 && <span className="faint"> (já sem {BRL(resumo.descontoCupom)} de cupom)</span>}
        </span>
        <CupomAoVivo
          cupom={resumo.cupom}
          onUsados={async (n) => {
            const r = await salvarLive(live.id, { pedidos: { ...(live.pedidos || {}), _cupom: { ...live.pedidos._cupom, usados: n } } });
            if (!r.ok) onToast(r.msg);
          }}
        />
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setConfirmar(true)}>
          Encerrar a live
        </button>
        <button type="button" className="btn danger" onClick={() => setExcluir(true)} title="Apaga esta live inteira (ex.: era só um teste)">
          × Excluir live
        </button>
      </div>

      <div className="live-palco">
        {foco && ef && (
          <div className="live-foco">
            <div className="live-foco-nome">
              {foco.nome} {foco.sku && <span className="faint">· {foco.sku}</span>}
            </div>
            <div className="faint">{resumoEstrategia(foco.estrategia)}</div>
            <div className="live-preco">{BRL(ef.preco)}</div>
            {ctx.modo === "fixo" ? (
              <div className="live-digitar faint">Preço da loja — nada pra mudar no anúncio; o desconto é o cupom.</div>
            ) : ef.anuncio ? (
              <div className="live-digitar">
                Digitar: promo{" "}
                <button type="button" className="live-copiar" title="copiar" onClick={() => copiar(ef.anuncio.promo)}>
                  {ef.anuncio.promo}%
                </button>{" "}
                sobre o original {BRL(ef.anuncio.original)} → cliente paga {BRL(ef.anuncio.clientePaga)}
                {ef.anuncio.acimaDoRiscado && <span className="warn"> · acima do riscado</span>}
                <PromoAviso canal={canal} promo={ef.anuncio.promo} texto />
              </div>
            ) : (
              <div className="live-digitar">
                Digitar: preço{" "}
                <button type="button" className="live-copiar" onClick={() => copiar(v2(ef.preco))}>
                  {v2(ef.preco)}
                </button>
              </div>
            )}
            <div className="faint">
              lucro por venda {lucroFoco != null ? BRL(lucroFoco) : "—"} · {ef.vendas} vendida{ef.vendas === 1 ? "" : "s"} · {ef.vendasNoPreco} neste preço
            </div>
            <div className="live-botoes">
              <button type="button" className="btn live-mais" onClick={() => venda(foco, 1)}>
                +1 venda
              </button>
              <button type="button" className="btn live-menos" disabled={ef.vendas <= 0} onClick={() => venda(foco, -1)}>
                −1
              </button>
            </div>
            {sug && (
              <div className={`live-sug live-sug-${sug.tipo}`}>
                <span>{sug.texto}</span>
                {sug.preco != null && ["subir", "segurar", "voltar", "soltar"].includes(sug.tipo) && (
                  <button type="button" className="btn btn-sm primary" onClick={() => mudarPreco(foco, sug.preco, sug.relampago ? { relampago: true } : null)}>
                    {sug.tipo === "segurar" ? `Voltar pra ${BRL(sug.preco)}` : sug.tipo === "soltar" ? "Soltar agora" : "Feito"}
                  </button>
                )}
              </div>
            )}
            <div className="live-ajustes">
              <input value={precoTxt} onChange={(e) => setPrecoTxt(e.target.value)} placeholder="outro preço" inputMode="decimal" style={{ width: 100 }} />
              <button type="button" className="btn btn-sm" disabled={!lerNum(precoTxt)} onClick={() => mudarPreco(foco, lerNum(precoTxt))}>
                Mudar preço
              </button>
              <select value="" onChange={(e) => e.target.value && trocarEstrategia(foco, e.target.value)}>
                <option value="">Trocar estratégia…</option>
                {estrategiasDoModo(ctx.modo).filter((x) => x.id !== foco.estrategia?.tipo).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="live-outros">
          {produtos.map((p) => {
            const e = estados.get(p.key);
            return (
              <div key={p.key} className={`live-card${p.key === foco?.key ? " ativo" : ""}`} onClick={() => setFocoKey(p.key)}>
                <div className="live-card-nome">{p.nome}</div>
                <div className="live-card-linha">
                  <b>{BRL(e.preco)}</b>
                  <span className="faint">{nomeEstrategia(p.estrategia?.tipo)}</span>
                </div>
                <div className="live-card-linha">
                  <span>
                    {e.vendas} vendida{e.vendas === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      venda(p, 1);
                    }}
                  >
                    +1
                  </button>
                </div>
                {e.sugestao && ["subir", "voltar", "segurar"].includes(e.sugestao.tipo) && <div className="live-card-sug">{e.sugestao.texto}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {excluir && (
        <ConfirmDialog
          titulo="Excluir esta live?"
          mensagem="Apaga a live inteira — plano e vendas marcadas. Use quando era só um teste. Nada fora da aba Live muda."
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setExcluir(false)}
          onConfirm={async () => {
            setExcluir(false);
            const r = await excluirLive(live.id);
            if (!r.ok) return onToast(r.msg);
            setAtualId("");
            onToast("Live excluída");
          }}
        />
      )}
      {confirmar && (
        <ConfirmDialog
          titulo="Encerrar a live?"
          mensagem={`${resumo.qtd} vendas marcadas · lucro ${BRL(resumo.lucro)}. Depois aparece a Lista da live (o que separar e o prazo de envio). Lembre de voltar os preços na plataforma.`}
          confirmarLabel="Encerrar"
          onCancel={() => setConfirmar(false)}
          onConfirm={async () => {
            setConfirmar(false);
            const r = await salvarLive(live.id, { status: "encerrada", fim: new Date().toISOString() });
            onToast(r.ok ? "Live encerrada" : r.msg);
          }}
        />
      )}
    </>
  );
}
