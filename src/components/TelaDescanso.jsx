import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import { BRL } from "../lib/format.js";
import { versiculoDoDia } from "../data/versiculosDoDia.js";
import { useRankingData, calcularRanking } from "../hooks/useRankingData.js";
import { useLoja } from "../lib/LojaContext.jsx";

const CHAVE_ULTIMA_DATA = "ohra:tela-descanso:ultima-data";
const LIMITE_INATIVIDADE_MS = 5 * 60 * 1000;
const MEDALHAS = ["🥇", "🥈", "🥉"];

function hojeStr() {
  return new Date().toDateString();
}

// Tela de descanso: aparece sozinha em dois momentos, cobrindo a tela toda
// (inclusive por cima da barra lateral) — como as duas versões somem com
// muito pouco esforço (um clique ou só mexer o mouse), cobrir tudo não
// atrapalha em nada.
//
// 1) Primeira vez do dia (ao abrir/atualizar a página): versão completa,
//    com logo, frase + versículo do dia, contagem de produtos/kits e o
//    top 3 do ranking (sempre "melhor canal, todos os itens", pra ser uma
//    foto neutra do dia, independente de filtro que esteja ativo em
//    Ranking) — some com o botão "Amém" ou qualquer clique.
// 2) A qualquer momento, depois de 5 minutos sem nenhuma interação:
//    versão leve, só frase + versículo — some ao primeiro mexer do mouse.
export default function TelaDescanso() {
  const [modo, setModo] = useState(null); // null | "cheia" | "leve"
  const [versiculo] = useState(() => versiculoDoDia());
  const modoRef = useRef(null);
  const ultimaAtividadeRef = useRef(null);
  const { itens, canais, precos, contagemProdutos, contagemKits } = useRankingData();
  const { lojas, lojaId } = useLoja();
  const lojaAtual = lojas.find((l) => l.id === lojaId) || null;
  const logoAtual = lojaAtual?.icone_url || logo;

  useEffect(() => {
    modoRef.current = modo;
  }, [modo]);

  // Primeira abertura/atualização do dia.
  useEffect(() => {
    let ultima = null;
    try {
      ultima = localStorage.getItem(CHAVE_ULTIMA_DATA);
    } catch {
      // sem localStorage disponível — a tela cheia só não vai "lembrar" o
      // dia, sem problema nenhum além disso
    }
    const hoje = hojeStr();
    if (ultima !== hoje) {
      setModo("cheia");
      try {
        localStorage.setItem(CHAVE_ULTIMA_DATA, hoje);
      } catch {
        // idem
      }
    }
  }, []);

  // Rastreia atividade globalmente (o app inteiro, não só esta tela) e,
  // depois de 5 minutos sem nada, dispara a versão leve — só se nenhuma
  // das duas já estiver na tela.
  useEffect(() => {
    ultimaAtividadeRef.current = Date.now();
    function registrar() {
      ultimaAtividadeRef.current = Date.now();
    }
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((ev) => window.addEventListener(ev, registrar, { passive: true }));
    const intervalo = setInterval(() => {
      if (modoRef.current == null && Date.now() - ultimaAtividadeRef.current > LIMITE_INATIVIDADE_MS) {
        setModo("leve");
      }
    }, 15000);
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, registrar));
      clearInterval(intervalo);
    };
  }, []);

  // Versão cheia some com qualquer clique (no botão "Amém" ou em qualquer
  // outro lugar, inclusive um item do menu lateral).
  useEffect(() => {
    if (modo !== "cheia") return;
    function sumir() {
      setModo(null);
    }
    window.addEventListener("click", sumir, { once: true });
    return () => window.removeEventListener("click", sumir);
  }, [modo]);

  // Versão leve some ao primeiro mexer do mouse — bem baixo atrito, de
  // propósito, pra nunca atrapalhar um trabalho em andamento.
  useEffect(() => {
    if (modo !== "leve") return;
    function sumir() {
      setModo(null);
    }
    window.addEventListener("mousemove", sumir, { once: true });
    return () => window.removeEventListener("mousemove", sumir);
  }, [modo]);

  if (!modo) return null;

  if (modo === "leve") {
    return (
      <div className="tela-descanso tela-descanso-leve">
        <img className="td-logo" src={logoAtual} alt="" />
        <div className="td-frase">{versiculo.frase}</div>
        <div className="td-versiculo">
          {versiculo.texto}
          <span className="ref">{versiculo.referencia}</span>
        </div>
      </div>
    );
  }

  const top3 = calcularRanking(itens, canais, { canalFiltro: "melhor", tipoFiltro: "todos", precos }).slice(0, 3);

  return (
    <div className="tela-descanso">
      <img className="td-logo" src={logoAtual} alt="" />

      <div className="td-frase">{versiculo.frase}</div>
      <div className="td-versiculo">
        {versiculo.texto}
        <span className="ref">{versiculo.referencia}</span>
      </div>

      <button type="button" className="btn primary td-amem" onClick={() => setModo(null)}>
        🙏 Amém
      </button>

      {(contagemProdutos > 0 || contagemKits > 0) && (
        <>
          <div className="td-divisor" />
          <div className="td-resumo">
            <span><span className="contagem">{contagemProdutos}</span> produtos cadastrados</span>
            {contagemKits > 0 && (
              <>
                <span>·</span>
                <span><span className="contagem">{contagemKits}</span> kits cadastrados</span>
              </>
            )}
          </div>
        </>
      )}

      {top3.length > 0 && (
        <div className="td-ranking">
          {top3.map((linha, idx) => (
            <div className="td-card" key={linha.item.id}>
              <span className="pos">{MEDALHAS[idx]} {idx + 1}º</span>
              <span className="nome">{linha.item.nome}</span>
              <span className="tipo">{linha.item.tipo}</span>
              <span className="lucro">{BRL(linha.lucro)} /un.</span>
            </div>
          ))}
        </div>
      )}

      <div className="td-dica">clique em qualquer lugar pra começar</div>
    </div>
  );
}
