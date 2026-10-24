import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { useLives } from "../hooks/useLives.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { assinarSede, lerSede } from "../lib/sedeDados.js";
import { ELENCO, SALAS_SEDE, avisosDaSede, ehOhra, nomesDaLoja, nomesPadrao, pessoaDoAviso } from "../lib/sede.js";
import { criarSede, TAMANHO_SEDE } from "../lib/sedeMotor.js";
import { periodoLigado } from "../lib/ads.js";
import { hojeSP } from "../lib/datas.js";
import { ehValido } from "../lib/pedidos.js";
import { irParaAba } from "../lib/navegar.js";
import { pedirTelaSede } from "../lib/sedeTela.js";
import { BRL } from "../lib/format.js";
import Estado from "./Estado.jsx";

// Sede da <loja> (24/10/2026): o escritório da loja em pixel art, ao vivo.
// SÓ MOSTRA — os avisos vêm do Início (sedeDados.js), as reações vêm do
// realtime das tabelas (produto novo, pedidos, live, Ads, conta paga, meta).
// Único dado gravado: os nomes dos personagens (preferencias_loja `sede:personagens`).
const ESTADO = { resolver: "resolver", rotina: "atencao", oportunidade: "oportunidade" };
const FAZENDO = { sentado: "trabalhando na mesa", trabalhando: "trabalhando", andando: "andando pela empresa", parado: "conversando", live: "fazendo live", fora: "foi pra casa" };
const agoraHora = () => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date());
const saudacao = () => {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date())) % 24;
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};
const lerVisita = (lojaId) => {
  try {
    return JSON.parse(localStorage.getItem(`ohra:sede:visita:${lojaId}`) || "null");
  } catch {
    return null;
  }
};
const gravarVisita = (lojaId, v) => {
  try {
    localStorage.setItem(`ohra:sede:visita:${lojaId}`, JSON.stringify(v));
  } catch {
    // sem localStorage — só não lembra
  }
};

export default function Sede({ onIrPara, ativo = true, tela = null, onSairTela }) {
  const { lojaId, lojas } = useLoja();
  const nomeLoja = (lojas || []).find((l) => l.id === lojaId)?.nome || "loja";
  const [salvos, setSalvos] = usePreferencia("sede:personagens", {});
  const nomes = useMemo(() => nomesDaLoja(nomeLoja, salvos), [nomeLoja, salvos]);
  const sede = useSyncExternalStore(assinarSede, lerSede, lerSede);
  const cat = useCatalogo();
  const ped = usePedidos();
  const { lives, carregando: carregandoLives } = useLives();
  const { periodos, carregando: carregandoAds } = useAdsPeriodos();
  const { lancamentos, carregando: carregandoCaixa } = useLancamentosCaixa();
  const hoje = hojeSP();

  const impressoras = (cat.impressoras || []).filter((i) => i.ativa !== false).length || 1;
  const av = useMemo(() => avisosDaSede(sede.pendencias), [sede.pendencias]);
  const live = (lives || []).some((l) => l.status === "aovivo");
  const adsLigados = useMemo(() => (periodos || []).filter((p) => periodoLigado(p, hoje)), [periodos, hoje]);

  // ---------- motor (canvas) ----------
  const canvasRef = useRef(null);
  const camadaRef = useRef(null);
  const motor = useRef(null);
  const [sel, setSel] = useState({ sala: "diretoria" });
  const [painelTela, setPainelTela] = useState(false);
  const chaveMotor = `${ehOhra(nomeLoja) ? "ohra" : "outra"}|${impressoras}|${ELENCO.map((e) => nomes[e.id]).join(",")}`;
  useEffect(() => {
    if (!canvasRef.current || !camadaRef.current) return undefined;
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const m = criarSede({
      canvas: canvasRef.current,
      camada: camadaRef.current,
      personagens: { estilo: chaveMotor.split("|")[0], nomes },
      impressoras,
      reduzir,
      onSala: (k) => {
        setSel({ sala: k });
        setPainelTela(true);
      },
    });
    motor.current = m;
    return () => {
      m.destruir();
      motor.current = null;
    };
    // nomes/impressoras já estão na chaveMotor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveMotor]);
  useEffect(() => motor.current?.ativo(ativo), [ativo, chaveMotor]);
  const producao = av.luz.producao === "r" || av.luz.producao === "a" ? av.luz.producao : null;
  useEffect(() => {
    motor.current?.dados({ luz: av.luz, porPessoa: av.porPessoa, metaPct: sede.kpis?.metaPct || 0, live, ads: adsLigados.length > 0, producao });
  }, [av, sede.kpis, live, adsLigados.length, producao, chaveMotor]);

  // ---------- "Acontecendo agora" e reações ao vivo ----------
  const [feed, setFeed] = useState(() => [{ hora: agoraHora(), txt: `👋 ${nomes.ceo1} e ${nomes.ceo2} chegaram na Sede` }]);
  const noFeed = (txt) => setFeed((f) => [{ hora: agoraHora(), txt }, ...f].slice(0, 8));
  const visto = useRef({});
  const reagir = (tipo, info, txt) => {
    motor.current?.evento(tipo, info);
    noFeed(txt);
  };
  // produto novo
  useEffect(() => {
    if (cat.carregando) return;
    const ids = new Set((cat.produtos || []).map((p) => p.id));
    const antes = visto.current.produtos;
    visto.current.produtos = ids;
    if (!antes) return;
    const novo = (cat.produtos || []).find((p) => !antes.has(p.id));
    if (novo) reagir("produto", { nome: novo.nome }, `🎁 Produto novo cadastrado: ${novo.nome}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.produtos, cat.carregando]);
  // pedidos importados
  const nPedidos = useMemo(() => new Set((ped.pedidos || []).filter(ehValido).map((l) => l.pedido)).size, [ped.pedidos]);
  useEffect(() => {
    if (ped.carregando) return;
    const antes = visto.current.pedidos;
    visto.current.pedidos = nPedidos;
    if (antes == null || nPedidos <= antes) return;
    reagir("pedidos", { n: nPedidos - antes }, `📦 ${nPedidos - antes} pedido${nPedidos - antes === 1 ? "" : "s"} importado${nPedidos - antes === 1 ? "" : "s"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nPedidos, ped.carregando]);
  // live começando / acabando
  useEffect(() => {
    if (carregandoLives) return;
    const antes = visto.current.live;
    visto.current.live = live;
    if (antes == null || antes === live) return;
    noFeed(live ? `🔴 Live começando — ${nomes.ceo2} no estúdio` : "⏹ Live encerrada");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, carregandoLives]);
  // Ads ligado
  const nomeDoItem = (tipo, id) => {
    if (tipo === "loja") return "GMV Max da Loja";
    const l = tipo === "kit" ? cat.kits : cat.produtos;
    return (l || []).find((x) => x.id === id)?.nome || "um anúncio";
  };
  useEffect(() => {
    if (carregandoAds) return;
    const ids = new Set(adsLigados.map((p) => p.id));
    const antes = visto.current.ads;
    visto.current.ads = ids;
    if (!antes) return;
    const novo = adsLigados.find((p) => !antes.has(p.id));
    if (novo) {
      const nome = nomeDoItem(novo.item_tipo, novo.item_id);
      reagir("ads", { nome }, `📣 Ads ligado: ${nome}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsLigados, carregandoAds]);
  // conta paga
  useEffect(() => {
    if (carregandoCaixa) return;
    const pagas = new Map((lancamentos || []).filter((l) => l.tipo === "saida" && l.data_realizada).map((l) => [l.id, l]));
    const antes = visto.current.pagas;
    visto.current.pagas = pagas;
    if (!antes) return;
    const nova = [...pagas.values()].find((l) => !antes.has(l.id));
    if (nova) reagir("pago", null, `✅ Conta paga: ${nova.descricao || "saída"} ${BRL(Number(nova.valor) || 0)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lancamentos, carregandoCaixa]);
  // meta batida
  const metaBatida = (sede.kpis?.metaPct || 0) >= 1;
  useEffect(() => {
    const antes = visto.current.meta;
    visto.current.meta = metaBatida;
    if (antes === false && metaBatida) reagir("meta", null, `🎉 Meta do mês batida! ${BRL(sede.kpis?.meta || 0)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaBatida]);

  // ---------- desde a última visita (neste aparelho) ----------
  const [boas, setBoas] = useState(null);
  useEffect(() => {
    if (boas || cat.carregando || ped.carregando || !sede.pronto || !lojaId) return;
    const v = lerVisita(lojaId);
    const nProd = (cat.produtos || []).length;
    const partes = [];
    if (v) {
      if (nProd > v.produtos) partes.push(`${nProd - v.produtos} produto${nProd - v.produtos === 1 ? "" : "s"} novo${nProd - v.produtos === 1 ? "" : "s"}`);
      if (nPedidos > v.pedidos) partes.push(`${nPedidos - v.pedidos} pedido${nPedidos - v.pedidos === 1 ? "" : "s"} importado${nPedidos - v.pedidos === 1 ? "" : "s"}`);
    }
    const decidir = av.porSala.diretoria.length;
    if (decidir) partes.push(`${decidir} decis${decidir === 1 ? "ão esperando" : "ões esperando"} vocês na Diretoria`);
    setBoas({ titulo: `${saudacao()}, ${nomes.ceo1} e ${nomes.ceo2}!`, texto: partes.length ? `${v ? "Desde a última visita: " : ""}${partes.join(", ")}.` : "Tudo em dia por aqui." });
    gravarVisita(lojaId, { em: hoje, produtos: nProd, pedidos: nPedidos });
  }, [boas, cat.carregando, cat.produtos, ped.carregando, sede.pronto, lojaId, nPedidos, av, nomes, hoje]);
  useEffect(() => {
    if (!boas) return undefined;
    const t = setTimeout(() => setBoas((b) => (b ? { ...b, saindo: true } : b)), 9000);
    return () => clearTimeout(t);
  }, [boas]);

  // ---------- clique ----------
  function clicar(e) {
    const b = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * TAMANHO_SEDE.largura;
    const y = ((e.clientY - b.top) / b.height) * TAMANHO_SEDE.altura;
    const q = motor.current?.quemEsta(x, y);
    if (!q) return;
    if (q.nome) setSel({ pessoa: q });
    else if (q.sala) setSel({ sala: q.sala });
    setPainelTela(true);
  }
  const abrir = (p) => {
    if (!p.ir?.aba) return;
    if (p.ir.pedido) irParaAba(p.ir.aba, p.ir.pedido);
    else onIrPara?.(p.ir.aba);
  };

  // ---------- tela cheia ----------
  // Manual: botão (pede tela cheia do navegador junto); sai pelo botão, Esc ou
  // quando o navegador sai da tela cheia. Descanso: sai ao primeiro movimento.
  const entrarTela = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    pedirTelaSede("manual");
  };
  const sairTela = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setPainelTela(false);
    onSairTela?.();
  };
  const sairTelaRef = useRef(sairTela);
  useEffect(() => {
    sairTelaRef.current = sairTela;
  });
  useEffect(() => {
    if (!tela) return undefined;
    const sair = () => sairTelaRef.current();
    const tecla = (e) => {
      if (e.key === "Escape") sair();
    };
    const fs = () => {
      if (!document.fullscreenElement && tela === "manual") sair();
    };
    let tirar = () => {};
    // descanso: espera 1 s antes de ouvir (o mesmo movimento que abriu não fecha)
    const t =
      tela === "descanso"
        ? setTimeout(() => {
            const ev = ["mousemove", "keydown", "pointerdown", "touchstart", "wheel"];
            ev.forEach((n) => window.addEventListener(n, sair, { passive: true }));
            tirar = () => ev.forEach((n) => window.removeEventListener(n, sair));
          }, 1000)
        : null;
    window.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", fs);
    return () => {
      clearTimeout(t);
      tirar();
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", fs);
    };
  }, [tela]);

  // ---------- nomes ----------
  const [editando, setEditando] = useState(null);
  const padrao = nomesPadrao(nomeLoja);

  const k = sede.kpis;
  const nDecidir = av.porSala.diretoria.length;
  const quemNaSala = (s) => {
    const ids = { diretoria: ["ceo1", "ceo2"], live: ["ceo2"], financeiro: ["bia"], comercial: ["rafa", "nina", "leo", "celia"], producao: ["teo"], estoque: ["duda", "ze"], beleza: [] }[s] || [];
    return ids.map((id) => `${nomes[id]} (${ELENCO.find((e) => e.id === id).funcao})`).join(" · ");
  };

  return (
    <div className={`sede${tela ? " sede-tela-cheia" : ""}`}>
      <div className="sede-topo">
        {tela === "descanso" ? (
          <span className="sede-dica-tela">mexa o mouse pra voltar</span>
        ) : tela ? (
          <button type="button" className="btn btn-sm" onClick={sairTela}>
            ✕ Sair da tela cheia <small>(Esc)</small>
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => onIrPara?.("inicio")}>
            ← Sair da Sede
          </button>
        )}
        <b className="sede-titulo">Sede da {nomeLoja}</b>
        <div className="sede-kpis">
          <span>
            Vendas do mês <b>{k?.temPedidos ? BRL(k.vendas) : "—"}</b>
          </span>
          <span>
            Lucro depois do Ads <b>{k?.temPedidos ? BRL(k.depoisAds) : "—"}</b>
          </span>
          <span>
            Caixa <b>{k?.caixa != null ? BRL(k.caixa) : "—"}</b>
          </span>
          <span>
            Pra decidir <b className={nDecidir ? "sede-ruim" : ""}>{nDecidir}</b>
          </span>
          {!tela && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setEditando(editando ? null : { ...nomes })}>
                ✎ Nomes
              </button>
              <button type="button" className="btn btn-sm" onClick={entrarTela} title="Abrir a Sede na tela inteira">
                ⛶ Tela cheia
              </button>
            </>
          )}
        </div>
      </div>

      {editando && !tela && (
        <div className="panel sede-nomes">
          <h3>Nomes dos personagens — só aqui na Sede</h3>
          <div className="sede-nomes-grade">
            {ELENCO.map((e) => (
              <label key={e.id} className="field">
                <span>{e.tipo === "bicho" ? `Bicho · ${e.funcao}` : e.funcao}</span>
                <input
                  value={editando[e.id] ?? ""}
                  maxLength={18}
                  placeholder={e.tipo === "bicho" ? "vazio = não aparece" : padrao[e.id]}
                  onChange={(ev) => setEditando((x) => ({ ...x, [e.id]: ev.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="sede-nomes-acoes">
            <button
              type="button"
              className="btn primary btn-sm"
              onClick={() => {
                const out = {};
                for (const e of ELENCO) {
                  const v = String(editando[e.id] ?? "").trim();
                  if (v !== (padrao[e.id] || "")) out[e.id] = v;
                }
                setSalvos(out);
                setEditando(null);
              }}
            >
              Salvar nomes
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditando({ ...padrao })}>
              Voltar ao padrão
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditando(null)}>
              Cancelar
            </button>
            <span className="hint">Vale só pra esta loja. Os nomes não mudam nada fora da Sede.</span>
          </div>
        </div>
      )}

      <div className="sede-grade">
        <div>
          <div className="sede-cena">
            <canvas ref={canvasRef} width={TAMANHO_SEDE.largura} height={TAMANHO_SEDE.altura} onClick={clicar} aria-label={`Sede da ${nomeLoja}: escritório animado`} />
            <div ref={camadaRef} className="sede-camada" />
            {boas && (
              <div className={`sede-boas ${boas.saindo ? "saindo" : ""}`} onClick={() => setBoas((b) => ({ ...b, saindo: true }))}>
                <b>{boas.titulo}</b>
                {boas.texto}
              </div>
            )}
          </div>
          <div className={`sede-agora${tela ? " sede-agora-flutua" : ""}`}>
            <b>Acontecendo agora</b>
            <ul>
              {(tela ? feed.slice(0, 3) : feed).map((f, i) => (
                <li key={`${f.hora}-${i}`}>
                  <span>{f.hora}</span>
                  {f.txt}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {(!tela || painelTela) && (
        <aside className="panel sede-painel">
          {tela && (
            <button type="button" className="btn btn-sm sede-painel-fechar" onClick={() => setPainelTela(false)} aria-label="Fechar">
              ✕
            </button>
          )}
          {sel.pessoa ? (
            <PainelPessoa q={sel.pessoa} nomes={nomes} av={av} pendencias={sede.pendencias} abrir={abrir} />
          ) : (
            <PainelSala k={sel.sala} quem={quemNaSala(sel.sala)} avisos={av.porSala[sel.sala] || []} abrir={abrir} onIrPara={onIrPara} />
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            Clique nas placas, nas salas e nas pessoas. A Sede só mostra — pra mudar algo, use o botão que leva pra tela certa.
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

function ListaAvisos({ avisos, abrir }) {
  if (!avisos.length) return <div className="sede-ok">✓ Tudo em dia por aqui</div>;
  return (
    <ul className="sede-avisos">
      {avisos.slice(0, 8).map((p) => (
        <li key={p.id}>
          <Estado tipo={ESTADO[p.grupo] || "atencao"}>{p.grupo === "resolver" ? "resolver" : p.grupo === "oportunidade" ? "oportunidade" : "atenção"}</Estado>
          <b>{p.titulo}</b>
          {p.texto && <div className="sede-aviso-txt">{p.texto}</div>}
          {p.ir?.aba && (
            <button type="button" className="btn btn-sm" onClick={() => abrir(p)}>
              {p.rotulo || "Abrir"} →
            </button>
          )}
        </li>
      ))}
      {avisos.length > 8 && <li className="hint">+ {avisos.length - 8} no Início</li>}
    </ul>
  );
}

function PainelSala({ k, quem, avisos, abrir, onIrPara }) {
  const s = SALAS_SEDE.find((x) => x.k === k);
  if (!s) return null;
  return (
    <>
      <h3>{s.nome}</h3>
      {quem && <div className="sede-quem">{quem}</div>}
      {k === "beleza" ? (
        <div className="sede-ok">Espaço reservado pra revenda de beleza — vai enchendo quando a revenda entrar no app (prateleiras, produtos e alguém cuidando).</div>
      ) : (
        <ListaAvisos avisos={avisos} abrir={abrir} />
      )}
      {k === "diretoria" && <div className="hint">Na Diretoria ficam os avisos urgentes de todas as salas — só vocês decidem.</div>}
      {s.aba && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onIrPara?.(s.aba)}>
          {s.rotulo} →
        </button>
      )}
    </>
  );
}

function PainelPessoa({ q, nomes, av, pendencias, abrir }) {
  if (q.bicho)
    return (
      <>
        <h3>{q.nome}</h3>
        <div className="sede-quem">{q.funcao} · mascote da Sede</div>
        <div className="sede-ok">Só passeia, ganha carinho e late quando chega coisa boa 🐾</div>
      </>
    );
  const meus = q.dono ? av.porSala.diretoria : (pendencias || []).filter((p) => pessoaDoAviso(p) === q.id);
  return (
    <>
      <h3>
        {nomes[q.id] || q.nome} · {q.funcao}
      </h3>
      <div className="sede-quem">agora: {FAZENDO[q.est] || q.est}</div>
      {q.dono && <div className="sede-quem">Decisões esperando vocês: {meus.length}</div>}
      <ListaAvisos avisos={meus} abrir={abrir} />
    </>
  );
}
