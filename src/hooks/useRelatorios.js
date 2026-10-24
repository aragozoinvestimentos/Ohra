import { usePreferencia } from "./usePreferencia.js";
import { baixarCsvRelatorio, imprimirRelatorio, montarRelatorio, periodoPadrao, relatoriosDevidos } from "../lib/relatorios.js";
import { hojeSP } from "../lib/datas.js";

// Relatórios do consultor: o que está devido e o "Gerar" (PDF/CSV). A data do
// que foi gerado fica em preferencias_loja `relatorios:gerados`.
export function useRelatorios({ ctx, nomeLoja, onToast }) {
  const [gerados, setGerados] = usePreferencia("relatorios:gerados", {});
  const hoje = hojeSP();
  const devidos = relatoriosDevidos(gerados, hoje);
  function gerar(k, periodo, formato = "pdf") {
    try {
      const rel = montarRelatorio(k, { ...ctx, hoje }, periodo);
      if (formato === "csv") baixarCsvRelatorio(rel, `${k}-${periodo}.csv`);
      else imprimirRelatorio(rel, nomeLoja);
      if (periodo === periodoPadrao(k, hoje)) setGerados({ ...(gerados || {}), [k]: periodo });
      onToast?.(formato === "csv" ? "CSV baixado" : "Na janela que abriu, escolha “Salvar como PDF”");
    } catch (e) {
      onToast?.(`Não consegui gerar: ${e.message}`);
    }
  }
  return { gerados, devidos, gerar, hoje };
}

