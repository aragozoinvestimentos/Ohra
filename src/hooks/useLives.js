import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Aba Live (schema v61): lives + live_eventos da loja, com realtime — marcar
// +1 no celular aparece no computador na hora. Sem as tabelas (SQL não
// rodado), `disponivel` = false.
export function useLives() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ lives: [], eventos: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q1 = supabase.from("lives").select("*").order("data", { ascending: false });
        let q2 = supabase.from("live_eventos").select("*").order("em", { ascending: true });
        if (lojaId) {
          q1 = q1.eq("loja_id", lojaId);
          q2 = q2.eq("loja_id", lojaId);
        }
        const [a, b] = await Promise.all([q1, q2]);
        if (!ativo) return;
        if (a.error) setEstado({ lives: [], eventos: [], disponivel: false, carregando: false });
        else setEstado({ lives: a.data || [], eventos: b.error ? [] : b.data || [], disponivel: true, carregando: false });
      } catch {
        if (ativo) setEstado((p) => ({ ...p, carregando: false }));
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 120);
    };
    carregar();
    const ch = supabase
      .channel(`lives-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lives" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_eventos" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    window.addEventListener("ohra:lives", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
      window.removeEventListener("ohra:lives", agendar);
    };
  }, [lojaId]);

  return estado;
}

// Depois de gravar: recarrega já (sem esperar o realtime).
export function recarregarLives() {
  window.dispatchEvent(new Event("ohra:lives"));
}
