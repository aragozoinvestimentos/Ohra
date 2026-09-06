// Modal genérico pra editar um item já cadastrado (material, embalagem...).
// Diferente do ConfirmDialog (que só confirma uma ação), este carrega um
// formulário — os campos vêm de fora via children, o modal só cuida do
// overlay/título/botões. Fechar clicando fora tem o mesmo efeito de
// "Cancelar" (não salva nada), igual ao PinPrompt/ConfirmDialog.
export default function EditarDialog({ titulo, salvando, onSalvar, onCancelar, children }) {
  return (
    <div className="modal-overlay" onClick={onCancelar}>
      <div className="modal-box modal-box-larga" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{titulo}</h3>
        {children}
        <div className="modal-actions">
          <button className="btn" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </button>
          <button className="btn primary" onClick={onSalvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
