import { useState } from "react";

// Modal de PIN de 4 números — usado tanto pra entrar numa loja protegida
// quanto pra autorizar excluir uma. onSubmit(pin) deve devolver true/false
// (ou uma Promise disso); se vier false, mostra erro e deixa tentar de novo.
export default function PinPrompt({
  titulo,
  subtitulo,
  confirmarLabel = "Entrar",
  perigo = false,
  onSubmit,
  onCancel,
}) {
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState(false);
  const [verificando, setVerificando] = useState(false);

  async function confirmar() {
    if (pin.length !== 4) {
      setErro(true);
      return;
    }
    setVerificando(true);
    const ok = await onSubmit(pin);
    setVerificando(false);
    if (!ok) {
      setErro(true);
      setPin("");
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{titulo}</h3>
        {subtitulo && <p className="modal-msg">{subtitulo}</p>}
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          className={`pin-input${erro ? " erro" : ""}`}
          value={pin}
          onChange={(e) => {
            setErro(false);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmar();
          }}
        />
        {erro && <div className="pin-erro">PIN incorreto — tente de novo.</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={verificando}>Cancelar</button>
          <button className={`btn ${perigo ? "danger" : "primary"}`} onClick={confirmar} disabled={verificando}>
            {verificando ? "Verificando…" : confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
