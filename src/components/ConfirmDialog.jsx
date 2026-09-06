// Modal genérico de confirmação — usado antes de excluir ou editar algo que
// já estava salvo (loja, material, produto, canal, cartão, histórico), pra
// evitar clique acidental em ação que não tem volta.
export default function ConfirmDialog({
  titulo,
  mensagem,
  confirmarLabel = "Confirmar",
  cancelarLabel = "Cancelar",
  perigo = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{titulo}</h3>
        {mensagem && <p className="modal-msg">{mensagem}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>{cancelarLabel}</button>
          <button className={`btn ${perigo ? "danger" : "primary"}`} onClick={onConfirm}>{confirmarLabel}</button>
        </div>
      </div>
    </div>
  );
}
