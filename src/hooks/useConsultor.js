import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Registros do consultor da Sede (schema v65) da loja, com realtime.
// Sem a tabela, `disponivel` = false.
export function useConsultor() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ registros: [], disponivel: true, carregando: true });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("consultor_registros").select("*").order("criado_em", { ascending: false });
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        setEstado(r.error ? { registros: [], disponivel: false, carregando: false } : { registros: r.data || [], disponivel: true, carregando: false });
      } catch {
        // rede: mantém o que tinha
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 300);
    };
    carregar();
    const ch = supabase
      .channel(`consultor-realtime-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "consultor_registros" }, agendar)
      .subscribe();
    window.addEventListener("ohra:consultor", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      window.removeEventListener("ohra:consultor", agendar);
    };
  }, [lojaId]);

  return estado;
}

export const recarregarConsultor = () => window.dispatchEvent(new Event("ohra:consultor"));
