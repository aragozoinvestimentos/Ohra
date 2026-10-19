import { useCallback, useMemo } from "react";
import { useOpcaoDoSku } from "../hooks/useVendasReais.js";
import { useSubAba, trocarSubAba } from "../lib/subAbas.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { useLives } from "../hooks/useLives.js";
import { enriquecer } from "../lib/pedidos.js";
import { calcularAnuncio, descontoDoItem } from "../lib/escada.js";
import { riscadoFixoDe } from "../lib/rampaAnuncio.js";
import { SUBABAS_LIVE, PLATAFORMAS_LIVE } from "../lib/liveTexto.js";
import LivePlanejar from "./LivePlanejar.jsx";
import LiveAoVivo from "./LiveAoVivo.jsx";
import LiveResultados from "./LiveResultados.jsx";
import { modoDaLive } from "../lib/live.js";

// Aba Live (schema v61): 1 · Planejar | 2 · Ao vivo | 3 · Resultados (sub-aba
// no cabeçalho, ohra:live-sub). A live é PARALELA: guarda uma cópia dos
// produtos (preço salvo, custo, riscado do dia) e nada daqui grava fora das
// tabelas lives/live_eventos. Plataformas: TikTok e Shopee no começo.
export default function Live({ onToast }) {
  const { lojaId } = useLoja();
  const [sub] = useSubAba("ohra:live-sub", "planejar", SUBABAS_LIVE);
  const [atualId, setAtualId] = useSubAba(`ohra:live-atual:${lojaId || "sem"}`, "");
  const esc = useEscada();
  const ped = usePedidos();
  const lv = useLives();
  const canaisLive = useMemo(() => (esc.canais || []).filter((c) => PLATAFORMAS_LIVE.includes(c.tipo)), [esc.canais]);
  const opcaoDoSku = useOpcaoDoSku(esc.itens, esc.precos);
  const linhasPedidos = useMemo(() => enriquecer(ped.pedidos, { itens: esc.itens, canais: esc.canais, cfgDoProduto: esc.cfgDoProduto, opcaoDoSku }), [ped.pedidos, esc.itens, esc.canais, esc.cfgDoProduto, opcaoDoSku]);

  const cfgDe = useCallback(
    (p) => {
      const id = String(p.item_id || "");
      const item = esc.itens.find((i) => i.id === id);
      return esc.cfgDoProduto(id.startsWith("p:") ? id.slice(2) : item?.produtoId || null);
    },
    [esc]
  );
  const ctxDaLive = useCallback(
    (live) => {
      const canal = (esc.canais || []).find((c) => c.id === live.canal_id) || null;
      return { canal, cfgDe, modo: modoDaLive(live, canal) };
    },
    [esc.canais, cfgDe]
  );
  // Riscado da cópia: o já anunciado (fixo) ou o que o Anunciar sugeriria no preço salvo.
  const riscadoDe = useCallback(
    (canal) => (item, salvo) => {
      const fixo = riscadoFixoDe(item.id, canal.id, esc.publicacoesCanal);
      if (fixo) return fixo;
      const { desconto } = descontoDoItem(item.id, canal, { itens: esc.itens, produtos: esc.produtos, kits: esc.kits });
      const an = calcularAnuncio(salvo, desconto);
      return an && an.promo > 0 ? an.original : null;
    },
    [esc]
  );

  if (!lv.disponivel)
    return (
      <div className="panel">
        <div className="empty">
          Falta rodar o <b>supabase/schema_v61.sql</b> no SQL Editor do Supabase (tabelas da aba Live).
        </div>
      </div>
    );

  const atual = lv.lives.find((l) => l.id === atualId) || lv.lives.find((l) => l.status === "aovivo") || null;
  const props = { esc, lv, atual, setAtualId, canaisLive, ctxDaLive, riscadoDe, linhasPedidos, onToast, irPara: (s) => trocarSubAba("ohra:live-sub", s), lojaId };
  if (sub === "aovivo") return <LiveAoVivo {...props} />;
  if (sub === "resultados") return <LiveResultados {...props} />;
  return <LivePlanejar {...props} />;
}
