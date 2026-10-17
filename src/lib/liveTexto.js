import { nomeEstrategia } from "./live.js";
import { BRL } from "./format.js";

// Textos e rótulos da aba Live (fora dos componentes por causa do fast refresh).
export const SUBABAS_LIVE = ["planejar", "aovivo", "resultados"];
export const PLATAFORMAS_LIVE = ["tiktok", "shopee"];

export const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaSemana = (iso) => (iso ? DIAS_SEMANA[new Date(`${iso}T12:00:00`).getDay()] : "");
export const rotuloLive = (l, canais) => {
  const c = (canais || []).find((x) => x.id === l.canal_id);
  return `${diaSemana(l.data)} ${dm(l.data)} · ${l.nome || "Live"}${c ? ` · ${c.nome}` : ""}${l.status === "aovivo" ? " · ao vivo" : l.status === "plano" ? " · planejada" : ""}`;
};
export const minParaTexto = (m) => {
  const t = Math.round(m || 0);
  return t >= 60 ? `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}` : `${t} min`;
};
export const resumoEstrategia = (e) => {
  if (!e) return "—";
  if (e.tipo === "escada") return `${nomeEstrategia(e.tipo)}: ${BRL(e.piso)} → ${BRL(e.alvo)}, +${BRL(e.passo)} ${e.subirPor === "tempo" ? `a cada ${e.minutos} min` : e.subirPor === "ambos" ? `a cada ${e.aCada} vendas ou ${e.minutos} min` : `a cada ${e.aCada} vendas`}`;
  if (e.tipo === "primeiros") return `${nomeEstrategia(e.tipo)}: ${e.n} a ${BRL(e.preco)}, depois ${BRL(e.normal)}`;
  if (e.tipo === "relampago") return `${nomeEstrategia(e.tipo)}: ${BRL(e.preco)} por ${e.minutos} min (normal ${BRL(e.normal)})`;
  if (e.tipo === "brinde") return `${nomeEstrategia(e.tipo)}: ${BRL(e.preco)} + ${e.brindeNome || "brinde"} (${BRL(e.brindeCusto)})`;
  return `${nomeEstrategia(e.tipo)}: ${BRL(e.preco)}`;
};

