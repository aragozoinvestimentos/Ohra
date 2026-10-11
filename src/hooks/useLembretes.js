import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Lembretes adiados (schema v40), com realtime — o mesmo estado em todos os
// aparelhos. Sem a tabela, `disponivel` = false e a lista fica vazia.
export function useLembretes() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ lembretes: [], disponivel: true });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("lembretes").select("*");
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        setEstado(r.error ? { lembretes: [], disponivel: false } : { lembretes: r.data || [], disponivel: true });
      } catch {
        // rede: mantém o que tinha
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`lembretes-realtime-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lembretes" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    window.addEventListener("ohra:lembretes", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
      window.removeEventListener("ohra:lembretes", agendar);
    };
  }, [lojaId]);

  return estado;
}
