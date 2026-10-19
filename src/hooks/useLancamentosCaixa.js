import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

// Lançamentos do Fluxo de Caixa da loja (só leitura, com realtime) — pra
// telas fora do Caixa que precisam do dinheiro de verdade (Ads, Payoff).
export function useLancamentosCaixa() {
  const { lojaId } = useLoja();
  const [d, setD] = useState({ lancamentos: [], carregando: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      let q = supabase.from("lancamentos_caixa").select("*");
      if (lojaId) q = q.eq("loja_id", lojaId);
      const r = await q;
      if (ativo) setD({ lancamentos: r.error ? [] : r.data || [], carregando: false });
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`lanc-caixa-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lancamentos_caixa" }, agendar)
      .subscribe();
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [lojaId]);
  return d;
}
