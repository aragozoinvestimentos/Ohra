import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Tarefas manuais do Início (schema v42), com realtime — o mesmo estado em todos os
// aparelhos. Sem a tabela, `disponivel` = false e a lista fica vazia.
export function useTarefas() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ tarefas: [], disponivel: true, carregando: true });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("tarefas").select("*");
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        setEstado(r.error ? { tarefas: [], disponivel: false, carregando: false } : { tarefas: r.data || [], disponivel: true, carregando: false });
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
      .channel(`tarefas-realtime-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    window.addEventListener("ohra:tarefas", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
      window.removeEventListener("ohra:tarefas", agendar);
    };
  }, [lojaId]);

  return estado;
}

// Depois de gravar: recarrega já (não espera o realtime).
export const recarregarTarefas = () => window.dispatchEvent(new Event("ohra:tarefas"));
