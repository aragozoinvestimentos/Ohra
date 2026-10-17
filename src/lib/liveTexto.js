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


const reais = (v) => BRL(v);
/** O plano do produto em português, pra saber o que vai acontecer na live. */
export function planoEmTexto(e, ref) {
  if (!e) return "";
  const n = (x) => Number(x) || 0;
  if (e.tipo === "escada") {
    if (!(n(e.piso) > 0) || !(n(e.alvo) > 0)) return "Preencha o piso e o alvo.";
    const passo = n(e.passo) || 0.5;
    const degraus = Math.max(0, Math.ceil((n(e.alvo) - n(e.piso)) / passo - 1e-9));
    if (!degraus) return `Piso e alvo iguais (${reais(e.alvo)}): sem espaço pra escada — o preço salvo já é o mínimo com lucro. Prefira "Preço fixo" ou outro produto pra abrir a live.`;
    const quando = e.subirPor === "tempo" ? `a cada ${n(e.minutos) || 5} min` : e.subirPor === "ambos" ? `a cada ${n(e.aCada) || 3} vendas ou ${n(e.minutos) || 5} min (o que vier primeiro)` : `a cada ${n(e.aCada) || 3} vendas`;
    const total =
      e.subirPor === "tempo"
        ? ` — chega no alvo em ~${degraus * (n(e.minutos) || 5)} min`
        : e.subirPor === "vendas"
          ? ` — chega no alvo depois de ~${degraus * (n(e.aCada) || 3)} vendas`
          : "";
    return `Abre em ${reais(e.piso)} e sobe ${reais(passo)} ${quando} até ${reais(e.alvo)} (${degraus} degrau${degraus === 1 ? "" : "s"})${total}. Sem venda por 5 min, o app sugere segurar ou voltar um degrau.`;
  }
  if (e.tipo === "primeiros") return `Os ${n(e.n) || 10} primeiros pagam ${reais(e.preco)}; depois o app sugere voltar pra ${reais(e.normal || ref)}. Bom pra abrir a live e puxar os primeiros pedidos.`;
  if (e.tipo === "relampago") return `Fica em ${reais(e.normal || ref)}; quando você soltar, vai pra ${reais(e.preco)} por ${n(e.minutos) || 5} min e o app avisa a hora de voltar. Bom pra reacender a live no meio.`;
  if (e.tipo === "brinde") return `Vende a ${reais(e.preco)} com ${e.brindeNome || "um brinde"} junto — o custo do brinde (${reais(e.brindeCusto || 0)}) sai do lucro de cada venda.`;
  return `Um preço só a live toda: ${reais(e.preco)}. Serve pro kit da live (escolha um kit cadastrado).`;
}
