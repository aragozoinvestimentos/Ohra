import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Rampas de preço da loja (schema v33) + registros, com realtime. Sem a
// tabela (SQL não rodado), `disponivel` = false e as listas ficam vazias —
// nenhuma tela quebra. `comRegistros` = também carrega rampa_registros (só a
// aba Crescimento precisa).
export function useRampas({ comRegistros = false } = {}) {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ rampas: [], registros: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        let qr = supabase.from("rampas_preco").select("*");
        if (lojaId) qr = qr.eq("loja_id", lojaId);
        const pedidos = [qr];
        if (comRegistros) {
          let qg = supabase.from("rampa_registros").select("*").order("data", { ascending: true });
          if (lojaId) qg = qg.eq("loja_id", lojaId);
          pedidos.push(qg);
        }
        const [rr, rg] = await Promise.all(pedidos);
        if (!ativo) return;
        if (rr.error) setEstado({ rampas: [], registros: [], disponivel: false, carregando: false });
        else setEstado({ rampas: rr.data || [], registros: rg && !rg.error ? rg.data || [] : [], disponivel: true, carregando: false });
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
      .channel(`rampas-realtime-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rampas_preco" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "rampa_registros" }, agendar)
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
  }, [lojaId, comRegistros]);

  return { ...estado, recarregar: () => window.dispatchEvent(new Event("focus")) };
}
