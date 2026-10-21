import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Avaliações (schema v58, tabela avaliacoes_produto) com realtime — o total
// por estrela que a plataforma mostra em cada atualização do bloco Avaliações
// (Atualizar dados). lib/semanasAuto.js transforma em registros
// "avaliacao" pros portões da Rampa.
// Sem a tabela (SQL não rodado), `disponivel` = false e a lista fica vazia.
export function useAvaliacoes() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ registros: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let q = supabase.from("avaliacoes_produto").select("*").order("data", { ascending: true });
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
      .channel(`avaliacoes-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "avaliacoes_produto" }, agendar)
      .subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    window.addEventListener("ohra:avaliacoes", agendar);
    return () => {
      window.removeEventListener("ohra:avaliacoes", agendar);
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
    };
  }, [lojaId]);

  return estado;
}

// Depois de gravar: recarrega já (sem esperar o realtime).
export function recarregarAvaliacoes() {
  window.dispatchEvent(new Event("ohra:avaliacoes"));
}
