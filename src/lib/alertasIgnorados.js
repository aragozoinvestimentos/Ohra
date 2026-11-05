// "Ignorar este alerta" (05/11/2026, pedido do Gustavo: "coloque em todos os alertas,
// que aí eu mesmo ignoro"). Guardado por loja em preferencias_loja
// `alertas:ignorados` = { id do alerta: { sig, em } }. O alerta volta sozinho
// quando a SITUAÇÃO muda: a assinatura é o título sem os números (o "dia 2 de 7"
// que avança, valores e datas não fazem ele voltar; uma situação nova faz).
// PURO — a gravação é pelo hook usePreferencia (useAlertasIgnorados).
import { usePreferencia } from "../hooks/usePreferencia.js";
import { hojeSP } from "./datas.js";

export const assinaturaAlerta = (titulo) =>
  String(typeof titulo === "string" ? titulo : "")
    .toLowerCase()
    .replace(/r\$\s*[\d.,]+/g, "")
    .replace(/[\d.,/:%×x]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function estaIgnorado(mapa, id, titulo) {
  const r = mapa?.[id];
  return !!r && r.sig === assinaturaAlerta(titulo);
}

export function useAlertasIgnorados() {
  const [mapa, setMapa] = usePreferencia("alertas:ignorados", {});
  const ignorados = mapa && typeof mapa === "object" ? mapa : {};
  return {
    ignorados,
    eIgnorado: (id, titulo) => estaIgnorado(ignorados, id, titulo),
    ignorar: (id, titulo) => setMapa({ ...ignorados, [id]: { sig: assinaturaAlerta(titulo), em: hojeSP(), titulo: typeof titulo === "string" ? titulo : "" } }),
    voltar: (id) => {
      const n = { ...ignorados };
      delete n[id];
      setMapa(n);
    },
  };
}
