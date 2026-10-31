import { useMemo } from "react";
import { useCrescimento } from "./useCrescimento.js";
import { useRankingData } from "./useRankingData.js";
import { usePreferencia } from "./usePreferencia.js";
import { cascataDoPeriodo, despesasFixasDoMes } from "../lib/resumoLoja.js";
import { maquinaDoItem } from "../lib/calc.js";
import { divisaoDaLoja, saldosCaixinhas, sugestaoDistribuicao } from "../lib/caixinhas.js";

// Caixinhas (01/11/2026): a MESMA conta pro Caixa (CaixinhasCaixa) e pra Saúde
// do dinheiro — saldos, divisão da loja e a sugestão do mês fechado.
export const mesAntes = (m, n = 1) => {
  const d = new Date(`${m}-15T12:00:00`);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
};
export const fimDoMes = (m) => {
  const d = new Date(`${m}-01T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
};

export function useCaixinhas({ registros = [], lancamentos = [], caixa = 0, hoje }) {
  const cres = useCrescimento();
  const { produtos, materiais } = useRankingData();
  const [pref, setPref] = usePreferencia("dinheiro:caixinhas", {});
  const divisao = useMemo(() => divisaoDaLoja(pref), [pref]);
  const sc = useMemo(() => saldosCaixinhas(registros), [registros]);
  const mes = mesAntes(hoje.slice(0, 7));
  const sug = useMemo(() => {
    const de = `${mes}-01`;
    const ate = fimDoMes(mes);
    const c = cascataDoPeriodo({ pedidos: cres.pedidosValidos || [], linhasAds: cres.linhasAds, lancamentos, de, ate }).total;
    let maquina = 0;
    for (const p of cres.pedidosValidos || []) {
      const d = String(p.data).slice(0, 10);
      if (!p.valido || d < de || d > ate || !p.item) continue;
      maquina += maquinaDoItem(p.item, produtos, materiais) * (Number(p.q) || 0);
    }
    return sugestaoDistribuicao({
      c,
      maquina: Math.round(maquina * 100) / 100,
      fixasProximo: despesasFixasDoMes(lancamentos, hoje.slice(0, 7)).total,
      fixasMes: despesasFixasDoMes(lancamentos, mes).total,
      saldos: sc.saldos,
      caixa,
      divisao,
    });
  }, [mes, cres.pedidosValidos, cres.linhasAds, lancamentos, produtos, materiais, sc.saldos, caixa, divisao, hoje]);
  return { mes, sug, divisao, pref, setPref, saldos: sc.saldos, total: sc.total };
}
