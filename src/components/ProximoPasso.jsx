import { PASSOS, pedirPasso } from "../lib/passosPreco.js";

// Rodapé dos passos 1º a 5º: "← anterior · Próximo: <passo> →", levando o
// produto e o canal escolhidos.
export default function ProximoPasso({ atual, itemId, canalId, onSub, extra = null }) {
  const i = PASSOS.findIndex((p) => p.key === atual);
  if (i < 0) return null;
  const ant = PASSOS[i - 1];
  const prox = PASSOS[i + 1];
  const ir = (p) => {
    pedirPasso(p.key, itemId || null, canalId || null);
    onSub?.(p.key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="proximo-passo">
      {ant ? (
        <button type="button" className="btn btn-sm" onClick={() => ir(ant)}>
          ← {ant.ordem} {ant.label}
        </button>
      ) : (
        <span />
      )}
      {extra}
      {prox && (
        <button type="button" className="btn btn-sm primary" onClick={() => ir(prox)}>
          Próximo: {prox.ordem} {prox.label} →
        </button>
      )}
    </div>
  );
}
