import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

let seq = 0;
const TABELAS = ["fornecedores", "fornecedor_itens", "compras_revenda", "compras_revenda_itens", "estoque_movimentos"];
const VAZIO = { fornecedores: [], fornecedorItens: [], compras: [], comprasItens: [], movimentos: [] };

// Revenda (schema v66): fornecedores, de-para dos itens, notas de compra,
// itens das notas e movimentos de estoque da loja, com realtime. Sem as
// tabelas, `disponivel` = false (as telas pedem o SQL).
export function useRevenda() {
  const { lojaId } = useLoja();
  const [estado, setEstado] = useState({ ...VAZIO, disponivel: true, carregando: true });

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      try {
        const q = (t) => {
          let x = supabase.from(t).select("*");
          if (lojaId) x = x.eq("loja_id", lojaId);
          return x;
        };
        const [rf, rfi, rc, rci, rm] = await Promise.all(TABELAS.map(q));
        if (!ativo) return;
        if (rc.error || rm.error) {
          setEstado({ ...VAZIO, disponivel: false, carregando: false });
          return;
        }
        const compras = rc.data || [];
        const porCompra = new Map(compras.map((c) => [c.id, c]));
        setEstado({
          fornecedores: rf.data || [],
          fornecedorItens: rfi.data || [],
          compras,
          // cada item já leva a data e o "conta na média" da nota
          comprasItens: (rci.data || []).map((i) => ({ ...i, emissao: porCompra.get(i.compra_id)?.emissao, contar_media: porCompra.get(i.compra_id)?.contar_media })),
          movimentos: rm.data || [],
          disponivel: true,
          carregando: false,
        });
      } catch {
        // rede: mantém o que tinha
      }
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    let ch = supabase.channel(`revenda-realtime-${++seq}`);
    for (const t of TABELAS) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, agendar);
    ch.subscribe();
    const aoVoltar = () => document.visibilityState === "visible" && agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", agendar);
    window.addEventListener("ohra:revenda", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", agendar);
      window.removeEventListener("ohra:revenda", agendar);
    };
  }, [lojaId]);

  return estado;
}

// Depois de gravar: recarrega já (não espera o realtime).
export const recarregarRevenda = () => window.dispatchEvent(new Event("ohra:revenda"));
