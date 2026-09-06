import { useState } from "react";

// Modal genérico de confirmação — usado antes de excluir ou editar algo que
// já estava salvo (loja, material, produto, canal, cartão, histórico), pra
// evitar clique acidental em ação que não tem volta. Quando `confirmarComTexto`
// é passado, o botão de confirmar só libera depois de digitar esse texto
// exatamente — usado em exclusões sem PIN, onde não há outra trava.
export default function ConfirmDialog({
  titulo,
  mensagem,
  confirmarLabel = "Confirmar",
  cancelarLabel = "Cancelar",
  perigo = false,
  confirmarComTexto,
  onConfirm,
  onCancel,
}) {
  const [texto, setTexto] = useState("");
  const bloqueado = confirmarComTexto != null && texto.trim() !== confirmarComTexto;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{titulo}</h3>
        {mensagem && <p className="modal-msg">{mensagem}</p>}
        {confirmarComTexto != null && (
          <div className="field" style={{ marginBottom: 16 }}>
            <label>{`Digite "${confirmarComTexto}" pra confirmar`}</label>
            <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>{cancelarLabel}</button>
          <button className={`btn ${perigo ? "danger" : "primary"}`} onClick={onConfirm} disabled={bloqueado}>
            {confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
