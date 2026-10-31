import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "./useRankingData.js";
import { saldoFilamentos } from "../lib/saldoFilamento.js";
import { hojeSP } from "../lib/datas.js";

let seq = 0;

// Saldo de filamento (schema v73): contagens + compras de material + registros
// de impressão da loja → lib/saldoFilamento.js. Sem a tabela, disponivel = false.
export function useSaldoFilamento() {
  const { lojaId } = useLoja();
  const { produtos, materiais, itens } = useRankingData();
  const [d, setD] = useState({ contagens: [], compras: [], registros: [], disponivel: true, carregando: !!supabase });

  useEffect(() => {
    if (!supabase || !lojaId) return;
    let ativo = true;
    let timer = null;
    async function carregar() {
      const [c, cm, ri] = await Promise.all([
        supabase.from("insumos_contagem").select("*").eq("loja_id", lojaId).order("data", { ascending: false }),
        supabase.from("compras_material").select("material_id,data,quantidade").eq("loja_id", lojaId),
        supabase.from("registros_impressao").select("produto_id,produto_nome,quantidade_lote,status,falha_pct,criado_em").eq("loja_id", lojaId),
      ]);
      if (!ativo) return;
      setD({ contagens: c.error ? [] : c.data || [], compras: cm.data || [], registros: ri.data || [], disponivel: !c.error, carregando: false });
    }
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(carregar, 150);
    };
    carregar();
    const ch = supabase
      .channel(`saldo-filamento-${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "insumos_contagem" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_material" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "registros_impressao" }, agendar)
      .subscribe();
    window.addEventListener("ohra:insumos", agendar);
    window.addEventListener("focus", agendar);
    return () => {
      ativo = false;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      window.removeEventListener("ohra:insumos", agendar);
      window.removeEventListener("focus", agendar);
    };
  }, [lojaId]);

  const hoje = hojeSP();
  const kits = useMemo(() => (itens || []).filter((i) => i.id.startsWith("k:")).map((i) => ({ nome: i.nome, componentes: i.componentes || [] })), [itens]);
  const linhas = useMemo(
    () => saldoFilamentos({ materiais: materiais || [], contagens: d.contagens, compras: d.compras, registros: d.registros, produtos: produtos || [], kits, hoje }),
    [materiais, d.contagens, d.compras, d.registros, produtos, kits, hoje]
  );
  return { linhas, disponivel: d.disponivel, carregando: d.carregando, contagens: d.contagens };
}

export function recarregarInsumos() {
  window.dispatchEvent(new Event("ohra:insumos"));
}
