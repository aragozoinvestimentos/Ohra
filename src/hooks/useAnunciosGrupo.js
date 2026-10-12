import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Anúncios com vários itens (schema v46, tabela anuncios_grupo — Ficha do anúncio etapa 2) com realtime.
// Sem a tabela (SQL não rodado), `disponivel` = false e a lista fica vazia.
export function useAnunciosGrupo() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ grupos: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("anuncios_grupo").select("*").order("criado_em", { ascending: true });
        if (lojaId) q = q.eq("loja_id", lojaId);
        const r = await q;
        if (!ativo) return;
        if (r.error) setEstado({ grupos: [], disponivel: false, carregando: false });
        else setEstado({ grupos: r.data || [], disponivel: true, carregando: false });
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
      .channel(`anuncios-grupo-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "anuncios_grupo" }, agendar)
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
