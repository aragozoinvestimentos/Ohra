import { useCallback, useRef, useState } from "react";

// Mostra um indicador de "✓ salvo" por um instante depois que um campo com
// salvamento automático (sem botão de confirmar) termina de gravar — feedback
// rápido de que a alteração já foi aplicada, sem precisar de um popup.
export function useSalvoFlash(duracaoMs = 1000) {
  const [visivel, setVisivel] = useState(false);
  const timer = useRef(null);

  const disparar = useCallback(() => {
    setVisivel(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisivel(false), duracaoMs);
  }, [duracaoMs]);

  return [visivel, disparar];
}
