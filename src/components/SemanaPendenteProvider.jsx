import { useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { useRampas } from "../hooks/useRampas.js";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { useLembretes } from "../hooks/useLembretes.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { SemanaPendenteContext } from "../hooks/useSemanaPendente.js";
import { adiadoAte, semanasPendentes } from "../lib/semanaPendente.js";
import { hojeISO } from "../lib/fluxoCaixa.js";

// Calcula a semana pendente uma vez (estado único: registros + lembretes do
// banco) e entrega pra bolinha do menu, Início e Crescimento.
export default function SemanaPendenteProvider({ children, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, precos } = useRankingData();
  const { rampas, registros } = useRampas({ comRegistros: true });
  const af = useAfiliados();
  const { lembretes, disponivel } = useLembretes();
  const { periodos: adsPeriodos } = useAdsPeriodos();
  const hoje = hojeISO();
  const toastRef = useRef(onToast);
  useEffect(() => {
    toastRef.current = onToast;
  });

  const valor = useMemo(() => {
    const r = semanasPendentes({ rampas, rampaRegistros: registros, afConfig: af.config, afRegistros: af.registros, adsPeriodos, itens, canais, precos, lembretes, hoje });
    const porChave = new Map(r.itens.map((x) => [x.chave, x]));
    // "pular" = não registrar esta semana; "amanha" = lembrar amanhã. Só grava o lembrete.
    async function adiar(chave, tipo) {
      if (!supabase) return false;
      const { error } = await supabase
        .from("lembretes")
        .upsert({ loja_id: lojaId || null, chave, adiado_ate: adiadoAte(tipo, hoje), tipo }, { onConflict: "loja_id,chave" });
      if (error) {
        toastRef.current?.(/lembretes|schema cache|does not exist/.test(error.message) ? "Falta rodar o supabase/schema_v40.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
        return false;
      }
      window.dispatchEvent(new Event("ohra:lembretes"));
      toastRef.current?.(tipo === "amanha" ? "Ok — lembro amanhã" : "Ok — não registrar esta semana (o período continua em aberto)");
      return true;
    }
    async function desfazer(chave) {
      if (!supabase) return false;
      let q = supabase.from("lembretes").delete().eq("chave", chave);
      q = lojaId ? q.eq("loja_id", lojaId) : q.is("loja_id", null);
      const { error } = await q;
      if (error) return false;
      window.dispatchEvent(new Event("ohra:lembretes"));
      return true;
    }
    return { ...r, porChave, adiar, desfazer, disponivel, hoje };
  }, [rampas, registros, af.config, af.registros, adsPeriodos, itens, canais, precos, lembretes, hoje, lojaId, disponivel]);

  return <SemanaPendenteContext.Provider value={valor}>{children}</SemanaPendenteContext.Provider>;
}
