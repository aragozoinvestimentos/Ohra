import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;

// Afiliados da loja (schema v35): comissão (padrão por canal + itens),
// parceiros e registros semanais, com realtime. Sem as tabelas (SQL não
// rodado), `disponivel` = false e as listas ficam vazias.
export function useAfiliados() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ config: [], parceiros: [], registros: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const q = (t, ordem) => {
          let x = supabase.from(t).select("*");
          if (lojaId) x = x.eq("loja_id", lojaId);
          return ordem ? x.order(ordem, { ascending: true }) : x;
        };
        const [rc, rp, rg] = await Promise.all([q("afiliado_config"), q("afiliados", "criado_em"), q("afiliado_registros", "data")]);
        if (!ativo) return;
        if (rc.error || rp.error || rg.error) setEstado({ config: [], parceiros: [], registros: [], disponivel: false, carregando: false });
        else setEstado({ config: rc.data || [], parceiros: rp.data || [], registros: rg.data || [], disponivel: true, carregando: false });
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
      .channel(`afiliados-realtime-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "afiliado_config" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "afiliados" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "afiliado_registros" }, agendar)
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
