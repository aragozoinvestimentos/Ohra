import { useEffect, useRef, useState } from "react";
import MarcaApp from "./MarcaApp.jsx";
import { BRL } from "../lib/format.js";
import { versiculoDoDia } from "../data/versiculosDoDia.js";
import { calcularRanking } from "../hooks/useRankingData.js";
import { useEscada } from "../hooks/useEscada.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useMargemDesejada } from "../hooks/useMargemDesejada.js";
import { pedirTelaSede } from "../lib/sedeTela.js";

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
//    Ranking) — só some com o botão "Amém", de propósito (ver useEffect
//    abaixo: antes qualquer clique fechava, e isso incluía digitar o PIN
//    de loja pra entrar no app de manhã — a tela nem chegava a aparecer
//    de verdade, sumia junto com o clique que confirmava o PIN).
// 2) A qualquer momento, depois de 5 minutos sem nenhuma interação: abre a
//    Sede da loja em tela cheia (24/10/2026, pedido do Gustavo — substituiu
//    a versão leve com o versículo); some ao primeiro mexer do mouse e volta
//    pra tela de antes.
export default function TelaDescanso() {
  const margemLoja = useMargemDesejada();
  // null | "cheia" — primeira abertura do dia já nasce "cheia".
  const [modo, setModo] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_ULTIMA_DATA) !== hojeStr() ? "cheia" : null;
    } catch {
      return null;
    }
  });
  const [versiculo] = useState(() => versiculoDoDia());
  const modoRef = useRef(null);
  const ultimaAtividadeRef = useRef(null);
  const { itens, canais, precos, contagemProdutos, contagemKits, agoraDe } = useEscada();
  const { lojas, lojaId } = useLoja();
  const lojaAtual = lojas.find((l) => l.id === lojaId) || null;
  const logoAtual = lojaAtual?.icone_url || null;

  useEffect(() => {
    modoRef.current = modo;
  }, [modo]);

  // Marca o dia como visto (a tela cheia só aparece na 1ª abertura do dia).
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_ULTIMA_DATA, hojeStr());
    } catch {
      // sem localStorage disponível — a tela cheia só não vai "lembrar" o
      // dia, sem problema nenhum além disso
    }
  }, []);

  // Rastreia atividade globalmente (o app inteiro, não só esta tela) e,
  // depois de 5 minutos sem nada, abre a Sede em tela cheia (se a tela do
  // dia não estiver aberta).
  useEffect(() => {
    ultimaAtividadeRef.current = Date.now();
    function registrar() {
      ultimaAtividadeRef.current = Date.now();
    }
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((ev) => window.addEventListener(ev, registrar, { passive: true }));
    const intervalo = setInterval(() => {
      if (modoRef.current == null && Date.now() - ultimaAtividadeRef.current > LIMITE_INATIVIDADE_MS) {
        ultimaAtividadeRef.current = Date.now();
        pedirTelaSede("descanso");
      }
    }, 15000);
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, registrar));
      clearInterval(intervalo);
    };
  }, []);

  if (!modo) return null;

  const top3 = calcularRanking(itens, canais, { canalFiltro: "melhor", tipoFiltro: "todos", precos, margemPct: margemLoja, agoraDe }).slice(0, 3);

  return (
    <div className="tela-descanso">
      {logoAtual ? <img className="td-logo" src={logoAtual} alt="" /> : <MarcaApp tamanho={72} className="td-logo" />}

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

      <div className="td-dica">clique em "Amém" pra começar</div>
    </div>
  );
}
