import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Histórico de manutenção das impressoras (schema v50, tabela manutencoes) com realtime.
// Sem a tabela (SQL não rodado), `disponivel` = false e a lista fica vazia.
export function useManutencoes() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ registros: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("manutencoes").select("*").order("feita_em", { ascending: false });
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        if (r.error) setEstado({ registros: [], disponivel: false, carregando: false });
        else setEstado({ registros: r.data || [], disponivel: true, carregando: false });
      } catch {
        if (ativo) setEstado((p) => ({ ...p, carregando: false }));
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`manutencoes-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "manutencoes" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
    };
  }, [lojaId]);

  return estado;
}
