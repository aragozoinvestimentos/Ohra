import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { IconeLoja } from "./LojaSwitcher.jsx";
import PinPrompt from "./PinPrompt.jsx";
import Lojas from "./Lojas.jsx";
import logo from "../assets/logo.png";

// Bloqueia o app inteiro — nenhuma aba monta, nenhum dado é buscado — até
// uma loja ser escolhida e, se ela tiver PIN, o PIN ser digitado certo.
//
// Existe porque a loja selecionada por padrão ao abrir o app (inclusive
// numa aba/janela anônima, sem nada salvo em localStorage/sessionStorage)
// podia ser uma loja protegida por PIN — e como todas as abas já buscam
// os dados da loja atual assim que montam, o conteúdo aparecia antes de
// qualquer verificação. Este componente é renderizado NO LUGAR do resto
// do app (não por cima) sempre que isso puder acontecer.
export default function LojaGate({ onToast }) {
  const { lojas, carregando, selecionar, precisaPin, desbloquear } = useLoja();
  const [pinAlvo, setPinAlvo] = useState(null);

  if (carregando) {
    return (
      <div className="loja-gate">
        <div className="loja-gate-card">Carregando…</div>
      </div>
    );
  }

  if (lojas.length === 0) {
    return (
      <div className="loja-gate">
        <div className="loja-gate-card loja-gate-card-larga">
          <div className="loja-gate-brand">
            <img src={logo} alt="Ohra" />
            <div>
              <div className="word">OHRA</div>
              <div className="tagline">Precificador</div>
            </div>
          </div>
          <h3>Nenhuma loja cadastrada ainda</h3>
          <Lojas onToast={onToast} />
        </div>
      </div>
    );
  }

  function escolher(loja) {
    if (precisaPin(loja.id)) {
      setPinAlvo(loja);
    } else {
      selecionar(loja.id);
    }
  }

  return (
    <div className="loja-gate">
      <div className="loja-gate-card">
        <div className="loja-gate-brand">
          <img src={logo} alt="Ohra" />
          <div>
            <div className="word">OHRA</div>
            <div className="tagline">Precificador</div>
          </div>
        </div>
        <h3>Escolha uma loja</h3>
        <div className="loja-gate-lista">
          {lojas.map((l) => (
            <button type="button" key={l.id} className="loja-opcao" onClick={() => escolher(l)}>
              <IconeLoja loja={l} tamanho={26} />
              <span className="loja-opcao-nome">{l.nome}</span>
              {l.pin && <span className="loja-opcao-cadeado" title="Protegida por PIN">🔒</span>}
            </button>
          ))}
        </div>
      </div>

      {pinAlvo && (
        <PinPrompt
          titulo={`PIN da loja "${pinAlvo.nome}"`}
          subtitulo="Essa loja é protegida por PIN — digite os 4 números pra entrar."
          confirmarLabel="Entrar"
          onSubmit={async (pin) => desbloquear(pinAlvo.id, pin)}
          onCancel={() => setPinAlvo(null)}
        />
      )}
    </div>
  );
}
