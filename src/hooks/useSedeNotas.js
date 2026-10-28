import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Histórico das notas por setor da Sede (schema v68, tabela sede_notas) da loja, com realtime.
// Sem a tabela, `disponivel` = false (a Sede mostra a nota ao vivo, sem a seta da semana passada).
export function useSedeNotas() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ historico: [], disponivel: true, carregando: true });

  useEffect(() => {
    if (!supabase || !lojaId) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const r = await supabase.from("sede_notas").select("*").eq("loja_id", lojaId).order("semana", { ascending: false }).limit(200);
        if (!ativo) return;
        setEstado(r.error ? { historico: [], disponivel: false, carregando: false } : { historico: r.data || [], disponivel: true, carregando: false });
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
      .channel(`sede-notas-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sede_notas" }, agendar)
      .subscribe();
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [lojaId]);

  return estado;
}
