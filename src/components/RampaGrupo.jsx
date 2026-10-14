import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { canalDireto } from "../lib/canais.js";
import { EVENTO_INICIAR_GRUPO, opcoesNoCanal, PASSO_GRUPO, PCT_INICIO_GRUPO, precosDoDegrau, sugerirDegrausGrupo } from "../lib/grupoRampa.js";
import { estadoSugestaoRampa } from "../lib/estados.js";
import { irParaAba } from "../lib/navegar.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import Estado from "./Estado.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";

// Crescimento → Rampa: rampa do ANÚNCIO com vários itens (plano 14/10/2026,
// schema v54). Degraus em % do preço salvo de cada opção; todas sobem juntas,
// só pela promo (riscado fixo). A conta é de lib/grupoRampa.js (que usa a
// mesma estadoRampa dos produtos); aqui só mostra e grava quando o Gustavo clica.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const pctTxt = (v) => `${String(Math.round(num(v) * 10) / 10).replace(".", ",")}%`;
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Sugestão da rampa do anúncio (testar acima do alvo é só por produto).
const sugestaoDe = (e) => (e.sugestao?.chave === "testar-acima" ? { chave: "alvo", tom: "good", rotulo: "No alvo" } : e.sugestao);

export default function RampaGrupo({ linhasGrupo, dados, hoje, onToast, selId, setSelId, linhasAds, onVerAds }) {
  const { lojaId } = useLoja();
  const [iniciar, setIniciar] = useState(false);
  const [mudar, setMudar] = useState(null); // { l, novo (índice), tipo }
  const [encerrar, setEncerrar] = useState(null);
  const [salvando, setSalvando] = useState(false);
  // "+ Iniciar rampa" (topo) e o diálogo da rampa de produto abrem este diálogo.
  useEffect(() => {
    const abrir = () => setIniciar(true);
    window.addEventListener(EVENTO_INICIAR_GRUPO, abrir);
    return () => window.removeEventListener(EVENTO_INICIAR_GRUPO, abrir);
  }, []);
  const aberta = linhasGrupo.find((l) => l.r.id === selId) || null;
  const grupos = dados.gruposAnuncio || [];
  if (!grupos.length && !linhasGrupo.length) return null;

  async function aplicarMudanca() {
    const { l, novoIdx, novoPct, tipo, obs } = mudar;
    setSalvando(true);
    let degraus = (l.r.degraus || []).map(num);
    let idx = novoIdx;
    if (novoPct != null) {
      degraus = [...new Set([...degraus, novoPct])].sort((a, b) => a - b);
      idx = degraus.indexOf(novoPct);
    }
    const { error } = await supabase
      .from("rampas_preco")
      .update({ degraus, degrau_atual: idx, desde: hoje, base_avaliacoes: l.est.avaliacoesTotal, atualizado_em: new Date().toISOString() })
      .eq("id", l.r.id);
    if (!error) await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: l.r.id, tipo, data: hoje, degrau: idx, preco: degraus[idx], ...(obs ? { observacao: obs } : {}) });
    setSalvando(false);
    setMudar(null);
    if (error) return onToast?.(`Não foi possível mudar o degrau: ${error.message}`);
    window.dispatchEvent(new Event("focus"));
    onToast?.(`${l.produto.nome}: agora ${pctTxt(degraus[idx])} do preço salvo em ${l.canal.nome} — troque a promo de cada opção na plataforma e marque ✓ na 5º Anunciar`);
  }

  async function encerrarRampa() {
    const l = encerrar;
    setEncerrar(null);
    const { error } = await supabase.from("rampas_preco").delete().eq("id", l.r.id);
    if (error) return onToast?.(`Não foi possível encerrar: ${error.message}`);
    window.dispatchEvent(new Event("focus"));
    onToast?.(`Rampa de ${l.produto.nome} encerrada — as opções voltam ao preço salvo (marque ✓ na Anunciar depois de trocar a promo)`);
  }

  const previa = mudar ? precosDoDegrau({ ops: mudar.l.g.ops, pct: mudar.novoPct ?? num(mudar.l.r.degraus[mudar.novoIdx]), canal: mudar.l.canal, itens: dados.itens, produtos: dados.produtos, kits: dados.kits, publicacoes: dados.publicacoesCanal }) : null;

  return (
    <div className="panel">
      <h3 className="section-title">
        Anúncios com vários itens em rampa
        <Ajuda
          texto={
            <>
              O anúncio inteiro sobe junto: cada degrau é um % do <b>preço salvo de cada opção</b> (ex.: 90% → 95% → 100%). Só a promo muda — o preço original (riscado) fica fixo — e a opção mais barata
              nunca fica abaixo do que a regra de 4× da Shopee permite. Os portões (vendas, avaliações, nota, dias, lucro) usam o anúncio inteiro, registrado no Registrar semana (a importação da
              Shopee preenche). Produto “só na época de…” segue o cronograma da temporada. Itens que só existem dentro do anúncio saem dos avisos de rampa e da lista de Ads individuais.
            </>
          }
        />
        <button type="button" className="btn btn-mini" style={{ marginLeft: "auto" }} onClick={() => setIniciar(true)}>
          + Rampa do anúncio inteiro
        </button>
      </h3>
      {!linhasGrupo.length ? (
        <div className="empty">Nenhum anúncio com vários itens em rampa. Use “+ Rampa do anúncio inteiro”.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Anúncio</th>
                <th>Fase</th>
                <th className="num">Agora</th>
                <th className="num">Lucro médio/venda</th>
                <th>Sugestão</th>
              </tr>
            </thead>
            <tbody>
              {linhasGrupo.map((l) => {
                const e = l.est;
                const sg = sugestaoDe(e);
                const tipo = estadoSugestaoRampa({ ...e, sugestao: sg });
                return (
                  <Fragment key={l.r.id}>
                    <tr className={`linha-clicavel${aberta?.r.id === l.r.id ? " linha-atual" : ""}`} onClick={() => setSelId(aberta?.r.id === l.r.id ? null : l.r.id)}>
                      <td>
                        <b>{l.produto.nome}</b> <CanalTag canal={l.canal} />
                        <div className="muted-cel">{l.g.ops.length} opções{l.g.mix ? ` · mix de ${l.g.mix.total} vendas (30 dias)` : " · sem vendas ainda: opções com o mesmo peso"}</div>
                      </td>
                      <td>
                        {e.fase.rotulo}
                        <span className="muted-cel"> · {e.i + 1} de {e.degraus.length}</span>
                      </td>
                      <td className="num">
                        <b>{pctTxt(l.g.pctAtual)}</b>
                        <div className="sub-num">do preço salvo</div>
                      </td>
                      <td className="num">
                        {e.lucroAtual != null ? BRL(e.lucroAtual) : "—"}
                        <div className="sub-num">no alvo {e.lucroAlvo != null ? BRL(e.lucroAlvo) : "—"}</div>
                      </td>
                      <td>{tipo ? <Estado tipo={tipo}>{sg.rotulo}</Estado> : <span className="muted-cel">{sg.rotulo}</span>}</td>
                    </tr>
                    {aberta?.r.id === l.r.id && (
                      <tr className="linha-detalhe">
                        <td colSpan={5}>
                          <DetalheGrupo
                            l={l}
                            linhaAds={linhasAds?.linhas.find((x) => x.chave === `grupo|${l.grupo.id}|${l.canal.id}`) || null}
                            onVerAds={onVerAds}
                            onMudar={(m) => setMudar({ l, ...m })}
                            onEncerrar={() => setEncerrar(l)}
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

      {mudar && (
        <ConfirmDialog
          titulo={mudar.tipo === "subida" ? "Subir o anúncio inteiro?" : "Descer o anúncio inteiro?"}
          larga
          mensagem={
            <>
              <p style={{ marginTop: 0 }}>
                {mudar.l.produto.nome} em {mudar.l.canal.nome}: <b>{pctTxt(mudar.l.g.pctAtual)}</b> → <b>{pctTxt(mudar.novoPct ?? mudar.l.r.degraus[mudar.novoIdx])}</b> do preço salvo. Troque só a promo de cada opção:
              </p>
              <table className="tabela-ads">
                <tbody>
                  {(previa || []).map((x) => (
                    <tr key={x.idx}>
                      <td>{x.rotulo}</td>
                      <td className="num">{x.an ? `${BRL(x.an.original)} · promo ${x.an.promo}% → ${BRL(x.an.clientePaga)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          }
          confirmarLabel={salvando ? "Salvando…" : "Confirmar"}
          onConfirm={aplicarMudanca}
          onCancel={() => setMudar(null)}
        />
      )}
      {encerrar && (
        <ConfirmDialog
          titulo="Encerrar a rampa do anúncio?"
          mensagem={`Encerrar a rampa de "${encerrar.produto.nome}" em ${encerrar.canal.nome}? Os registros semanais dela são apagados. Os preços salvos das opções continuam os mesmos.`}
          confirmarLabel="Encerrar rampa"
          perigo
          onConfirm={encerrarRampa}
          onCancel={() => setEncerrar(null)}
        />
      )}
      {iniciar && <IniciarRampaGrupo dados={dados} linhasGrupo={linhasGrupo} hoje={hoje} onToast={onToast} onClose={(id) => (setIniciar(false), id && setSelId(id))} />}
    </div>
  );
}

function DetalheGrupo({ l, linhaAds, onVerAds, onMudar, onEncerrar }) {
  const e = l.est;
  const sg = sugestaoDe(e);
  const degraus = (l.r.degraus || []).map(num);
  const i = e.i;
  const z = e.sazonal;
  const proxIdx = sg?.chave === "subir" ? Math.min(degraus.length - 1, i + (sg.saltos || 1)) : i < degraus.length - 1 ? i + 1 : null;
  const pctDescer = z?.fase === "entressafra" && sg?.chave === "descer" ? Math.max(50, Math.round(l.g.pctAtual - 8)) : null;
  const um1 = (v) => String(Math.round(num(v) * 10) / 10).replace(".", ",");
  const inicio = e.registros.find((g) => g.tipo === "inicio")?.data || l.r.desde;
  const tipoSug = estadoSugestaoRampa({ ...e, sugestao: sg });
  const proximo = z && z.fase !== "entressafra" && z.proximaData
    ? { titulo: proxIdx != null ? `${pctTxt(degraus[proxIdx])} em ${dm(z.proximaData)}` : "No alvo", sub: `cronograma de ${z.nome} · no alvo até ${dm(z.limite)}` }
    : { titulo: sg.rotulo, sub: z ? `${z.nome}` : e.portoesOk ? "todos os portões ok" : `${e.portoes.filter((p) => !p.ok).length} portão(ões) faltando` };
  return (
    <div className="detalhe-cel gr-det">
      <div className="gr-topo">
        <ol className="gr-steps" aria-label="Degraus da rampa">
          {degraus.map((d, k) => (
            <li key={k} className={k < i ? "feito" : k === i ? "atual" : ""}>
              <span className="gr-step-bola">{k < i ? "✓" : k + 1}</span>
              <span className="gr-step-pct">{pctTxt(d)}</span>
              {k === degraus.length - 1 && <span className="gr-step-alvo">alvo</span>}
            </li>
          ))}
        </ol>
        <span className="muted-cel">
          desde {dm(inicio)} · {e.dias} dia{e.dias === 1 ? "" : "s"} neste degrau
        </span>
      </div>

      {e.anuncio && (
        <div className="alerta alerta-warn" style={{ margin: 0 }}>
          <b>{e.anuncio.titulo}</b>
          {e.anuncio.texto} Comece por: {e.anuncio.porOnde}.
        </div>
      )}

      <div className="gr-cards">
        <div className="gr-card">
          <span className="gr-card-rot">Preço agora</span>
          <b className="gr-card-num">{pctTxt(l.g.pctAtual)}</b>
          <span className="gr-card-sub">do preço salvo · ticket médio {BRL(e.preco)}</span>
        </div>
        <div className="gr-card">
          <span className="gr-card-rot">Lucro médio por venda</span>
          <b className="gr-card-num" style={{ color: e.lucroAtual != null && e.lucroAtual < 0 ? "var(--bad)" : undefined }}>{e.lucroAtual != null ? BRL(e.lucroAtual) : "—"}</b>
          <span className="gr-card-sub">no alvo {e.lucroAlvo != null ? BRL(e.lucroAlvo) : "—"}</span>
        </div>
        <div className={`gr-card${tipoSug ? ` gr-card-${tipoSug}` : ""}`}>
          <span className="gr-card-rot">Próximo passo</span>
          <b className="gr-card-num gr-card-txt">{proximo.titulo}</b>
          <span className="gr-card-sub">{proximo.sub}</span>
        </div>
        <div className="gr-card">
          <span className="gr-card-rot">Desde o degrau</span>
          <b className="gr-card-num">{e.vendasDesde} venda{e.vendasDesde === 1 ? "" : "s"}</b>
          <span className="gr-card-sub">+{e.avaliacoesDesde} avaliações · nota {e.nota != null ? um1(e.nota) : "—"}</span>
        </div>
        {linhaAds && (
          <div className="gr-card">
            <span className="gr-card-rot">Ads do anúncio</span>
            <b className="gr-card-num gr-card-txt">{linhaAds.av.titulo}</b>
            <span className="gr-card-sub">
              {linhaAds.av.empate ? `equilíbrio ${um1(linhaAds.av.empate)} · ` : ""}
              <button type="button" className="link-btn" onClick={onVerAds}>ver no Ads</button>
            </span>
          </div>
        )}
      </div>

      {!z && (
        <div className="portoes-linha">
          {e.portoes.map((p) => (
            <span key={p.chave} className={`portao${p.ok ? " ok" : ""}`} title={p.rotulo}>
              {p.ok ? "✓" : "·"} {p.curto}: {p.valor}
            </span>
          ))}
        </div>
      )}

      <div className="gr-tabela-cartao">
        <div className="gr-tabela-cab">
          <b>O que digitar no canal</b>
          <span className="chip-cel decisao">{pctTxt(l.g.pctAtual)} do preço salvo</span>
          <span className="muted-cel gr-tabela-dica">só a promo muda — o preço original fica fixo</span>
        </div>
        <div className="table-wrap">
          <table className="gr-tabela">
            <thead>
              <tr>
                <th>Opção</th>
                <th className="num">Preço salvo</th>
                <th className="num">Preço original</th>
                <th className="num">Promo</th>
                <th className="num">Cliente paga</th>
                <th className="num">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {l.g.linhas.map((x) => (
                <tr key={x.idx}>
                  <td>
                    <span className="gr-opcao">{x.rotulo}</span>
                    <span className="gr-tags">
                      {x.vitrine && <span className="chip-cel info" title="Preço só deste anúncio (vitrine)">vitrine</span>}
                      {x.pelo4x && <span className="chip-cel atencao" title="Subiu pra caber na regra de 4× da Shopee">regra 4×</span>}
                    </span>
                  </td>
                  <td className="num muted-num">{BRL(x.base)}</td>
                  <td className="num">
                    {x.an ? BRL(x.an.original) : "—"}
                    {x.fixo ? <span className="gr-fixo" title="Já anunciado: o preço original não muda">🔒</span> : null}
                  </td>
                  <td className="num">{x.an ? <span className="pill-promo">{x.an.promo}%</span> : "—"}</td>
                  <td className="num"><b className="gr-paga">{x.an ? BRL(x.an.clientePaga) : "—"}</b></td>
                  <td className="num" style={{ color: x.lucro != null && x.lucro < 0 ? "var(--bad)" : undefined }}>{x.lucro != null ? BRL(x.lucro) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="gr-rodape">
        <div className="acoes-ads" style={{ margin: 0 }}>
          {proxIdx != null && proxIdx > i && (
            <button type="button" className={`btn btn-mini${sg?.chave === "subir" ? " primary" : ""}`} onClick={() => onMudar({ novoIdx: proxIdx, tipo: "subida" })}>
              ↑ Subir pra {pctTxt(degraus[proxIdx])}
            </button>
          )}
          {i > 0 && (
            <button type="button" className={`btn btn-mini${sg?.chave === "voltar" ? " primary" : ""}`} onClick={() => onMudar({ novoIdx: i - 1, tipo: "descida" })}>
              ↓ Voltar pra {pctTxt(degraus[i - 1])}
            </button>
          )}
          {pctDescer != null && (
            <button type="button" className="btn btn-mini primary" onClick={() => onMudar({ novoPct: pctDescer, tipo: "descida", obs: "entressafra" })}>
              ↓ Descer pra {pctTxt(pctDescer)} (entressafra)
            </button>
          )}
          <button type="button" className="btn btn-mini" onClick={onEncerrar}>
            × Encerrar rampa
          </button>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          Trocou a promo na plataforma? Marque ✓ em{" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("publicar")}>
            5º Anunciar
          </button>
          .
        </span>
      </div>
    </div>
  );
}

function IniciarRampaGrupo({ dados, linhasGrupo, hoje, onToast, onClose }) {
  const { lojaId } = useLoja();
  const { gruposAnuncio: grupos = [], canais, itens, precos, cfgDoProduto } = dados;
  const pares = useMemo(() => {
    const out = [];
    for (const g of grupos)
      for (const c of canais) {
        if (canalDireto(c)) continue;
        if (linhasGrupo.some((l) => l.grupo.id === g.id && l.canal.id === c.id)) continue;
        if (opcoesNoCanal({ grupo: g, canal: c, itens, precos, cfgDoProduto }).length) out.push({ g, c, chave: `${g.id}|${c.id}` });
      }
    return out;
  }, [grupos, canais, itens, precos, cfgDoProduto, linhasGrupo]);
  const [par, setPar] = useState(() => (pares.find((p) => p.c.tipo === "shopee") || pares[0])?.chave || "");
  const [inicio, setInicio] = useState(String(PCT_INICIO_GRUPO));
  const [aval, setAval] = useState("");
  const [nota, setNota] = useState("");
  const [vendas, setVendas] = useState("");
  const [salvando, setSalvando] = useState(false);
  const p = pares.find((x) => x.chave === par) || null;
  const degraus = sugerirDegrausGrupo(num(inicio) || PCT_INICIO_GRUPO, PASSO_GRUPO);
  const ops = p ? opcoesNoCanal({ grupo: p.g, canal: p.c, itens, precos, cfgDoProduto }) : [];
  const previa = p ? precosDoDegrau({ ops, pct: degraus[0], canal: p.c, itens, produtos: dados.produtos, kits: dados.kits, publicacoes: dados.publicacoesCanal }) : [];

  async function salvar() {
    if (!p) return onToast?.("Escolha o anúncio");
    setSalvando(true);
    const { data, error } = await supabase
      .from("rampas_preco")
      .insert({ loja_id: lojaId || null, grupo_id: p.g.id, canal_id: p.c.id, degraus, degrau_atual: 0, desde: hoje, base_avaliacoes: Math.round(num(aval)), vendas_iniciais: Math.round(num(vendas)) })
      .select()
      .single();
    if (error) {
      setSalvando(false);
      return onToast?.(/grupo_id|produto_id|null value/.test(error.message) ? "Falta rodar o supabase/schema_v54.sql no Supabase (rampa do anúncio inteiro)" : `Não foi possível iniciar: ${error.message}`);
    }
    await supabase.from("rampa_registros").insert({ loja_id: lojaId || null, rampa_id: data.id, tipo: "inicio", data: hoje, degrau: 0, preco: degraus[0], avaliacoes: Math.round(num(aval)), nota: nota === "" ? null : num(nota) });
    setSalvando(false);
    window.dispatchEvent(new Event("focus"));
    onToast?.(`Rampa do anúncio iniciada: ${p.g.nome} a ${pctTxt(degraus[0])} do preço salvo — troque a promo das opções e marque ✓ na 5º Anunciar`);
    onClose(data.id);
  }

  return (
    <EditarDialog titulo="Rampa do anúncio inteiro" salvando={salvando} onSalvar={salvar} onCancelar={() => onClose(null)} salvarLabel="Iniciar rampa" classe="modal-box-md">
      {!pares.length ? (
        <div className="empty">Nenhum anúncio com vários itens com preço salvo nas opções (ou todos já estão em rampa).</div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Todas as opções começam no mesmo % do preço salvo delas e sobem juntas até 100% (o alvo). Se algum produto do anúncio estava numa rampa própria, encerre a rampa dele (× no Detalhe) — o
            anúncio passa a decidir.
          </p>
          <div className="grid-auto">
            <div className="field">
              <label>Anúncio</label>
              <select value={par} onChange={(e) => setPar(e.target.value)}>
                {pares.map((x) => (
                  <option key={x.chave} value={x.chave}>
                    {x.g.nome} · {x.c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Começar em (% do preço salvo)</label>
              <input type="number" min="50" max="100" step="1" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="field"><label>Vendas até hoje</label><input type="number" min="0" value={vendas} onChange={(e) => setVendas(e.target.value)} /></div>
            <div className="field"><label>Avaliações hoje</label><input type="number" min="0" value={aval} onChange={(e) => setAval(e.target.value)} /></div>
            <div className="field"><label>Nota hoje</label><input type="text" inputMode="decimal" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
          </div>
          <p className="hint">Degraus: {degraus.map(pctTxt).join(" → ")}</p>
          {previa.length > 0 && (
            <table className="tabela-ads">
              <tbody>
                {previa.map((x) => (
                  <tr key={x.idx}>
                    <td>{x.rotulo}{x.vitrine ? " · vitrine" : ""}</td>
                    <td className="num">salvo {BRL(x.base)}</td>
                    <td className="num">{x.an ? `${BRL(x.an.original)} · promo ${x.an.promo}% → ${BRL(x.an.clientePaga)}` : "—"}{x.pelo4x ? " (regra de 4×)" : ""}</td>
                    <td className="num" style={{ color: x.lucro != null && x.lucro < 0 ? "var(--bad)" : undefined }}>lucro {x.lucro != null ? BRL(x.lucro) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </EditarDialog>
  );
}
