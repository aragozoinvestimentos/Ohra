import { useEffect, useRef, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import PinPrompt from "./PinPrompt.jsx";

function IconeLoja({ loja, tamanho = 22 }) {
  if (loja?.icone_url) {
    return (
      <img
        src={loja.icone_url}
        alt=""
        className="loja-icone-img"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }
  const letra = (loja?.nome || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="loja-icone-letra" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.48 }}>
      {letra}
    </span>
  );
}

// Fica escondido até "lojas" existir no banco (schema_v3.sql) — até lá o
// app continua igual, sem seletor e sem filtrar nada por loja.
export default function LojaSwitcher({ onGerenciar }) {
  const { lojas, lojaId, disponivel, carregando, selecionar, precisaPin, desbloquear } = useLoja();
  const [aberto, setAberto] = useState(false);
  const [pinAlvo, setPinAlvo] = useState(null); // loja aguardando PIN pra trocar
  const ref = useRef(null);

  useEffect(() => {
    function aoClicarFora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  if (!disponivel || carregando) return null;

  const lojaAtual = lojas.find((l) => l.id === lojaId) || null;

  function escolher(loja) {
    setAberto(false);
    if (loja.id === lojaId) return;
    if (precisaPin(loja.id)) {
      setPinAlvo(loja);
    } else {
      selecionar(loja.id);
    }
  }

  return (
    <div className="loja-switcher" ref={ref}>
      <button type="button" className="loja-atual" onClick={() => setAberto((v) => !v)}>
        <IconeLoja loja={lojaAtual} />
        <span className="loja-atual-nome">{lojaAtual?.nome || "Escolher loja"}</span>
        <span className="loja-atual-caret">▾</span>
      </button>

      {aberto && (
        <div className="loja-dropdown">
          {lojas.map((l) => (
            <button
              type="button"
              key={l.id}
              className={`loja-opcao${l.id === lojaId ? " ativa" : ""}`}
              onClick={() => escolher(l)}
            >
              <IconeLoja loja={l} tamanho={20} />
              <span className="loja-opcao-nome">{l.nome}</span>
              {l.pin && <span className="loja-opcao-cadeado" title="Protegida por PIN">🔒</span>}
            </button>
          ))}
          <button
            type="button"
            className="loja-opcao loja-gerenciar"
            onClick={() => {
              setAberto(false);
              onGerenciar?.();
            }}
          >
            ⚙ Gerenciar lojas
          </button>
        </div>
      )}

      {pinAlvo && (
        <PinPrompt
          titulo={`PIN da loja "${pinAlvo.nome}"`}
          subtitulo="Essa loja é protegida por PIN — digite os 4 números pra entrar."
          confirmarLabel="Entrar"
          onSubmit={async (pin) => {
            const ok = desbloquear(pinAlvo.id, pin);
            if (ok) setPinAlvo(null);
            return ok;
          }}
          onCancel={() => setPinAlvo(null)}
        />
      )}
    </div>
  );
}
