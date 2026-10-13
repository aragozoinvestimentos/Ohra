import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Mudanças da farm que pioraram o custo (schema v47, tabela farm_alteracoes) com realtime.
// Sem a tabela (SQL não rodado), `disponivel` = false e a lista fica vazia.
export function useFarmAlteracoes() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ alteracoes: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("farm_alteracoes").select("*").order("created_at", { ascending: false });
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        if (r.error) setEstado({ alteracoes: [], disponivel: false, carregando: false });
        else setEstado({ alteracoes: r.data || [], disponivel: true, carregando: false });
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
      .channel(`farm-alteracoes-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "farm_alteracoes" }, agendar)
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
