import { useEffect, useMemo } from "react";
import { useOpcaoDoSku } from "../hooks/useVendasReais.js";
import { trocarSubAba, useSubAba } from "../lib/subAbas.js";
import { pegarPedido } from "../lib/navegar.js";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { enriquecer } from "../lib/pedidos.js";
import { hojeSP } from "../lib/datas.js";
import AnaliseABC from "./AnaliseABC.jsx";
import AnaliseEvolucao from "./AnaliseEvolucao.jsx";

// Aba Análise (schema v55): Curva ABC | Curva XYZ | Evolução e métricas (a
// importação virou o item "Atualizar dados" no remap de 21/10/2026). As vendas vêm SÓ dos pedidos importados (Olist, um arquivo por
// plataforma) + vendas físicas — `enriquecer` calcula pago/lucro com o custo e
// as taxas de HOJE (ao vivo). A sub-aba fica no cabeçalho (ohra:analise-sub).
const SUBABAS_ANALISE = ["abc", "xyz", "evolucao"];

export default function Analise({ onToast }) {
  const [sub] = useSubAba("ohra:analise-sub", "abc", SUBABAS_ANALISE);
  const esc = useEscada();
  const cres = useCrescimento();
  const ped = usePedidos();
  const { farmConfig } = useCatalogo();
  const hoje = hojeSP();
  // Pedidos vindos do Início (lib/navegar.js): { sub }.
  useEffect(() => {
    const aplicar = (p) => p?.sub && trocarSubAba("ohra:analise-sub", p.sub);
    aplicar(pegarPedido("analise"));
    const ouvir = (e) => e.detail.aba === "analise" && aplicar(pegarPedido("analise"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);
  const opcaoDoSku = useOpcaoDoSku(esc.itens, esc.precos);
  const linhas = useMemo(() => enriquecer(ped.pedidos, { itens: esc.itens, canais: esc.canais, cfgDoProduto: esc.cfgDoProduto, opcaoDoSku }), [ped.pedidos, esc.itens, esc.canais, esc.cfgDoProduto, opcaoDoSku]);

  if (!ped.disponivel)
    return (
      <div className="panel">
        <div className="empty">
          Falta rodar o <b>supabase/schema_v55.sql</b> no SQL Editor do Supabase (tabelas da aba Análise).
        </div>
      </div>
    );
  if (!linhas.length)
    return (
      <div className="panel">
        <div className="empty">Ainda não há vendas pra analisar. Importe os pedidos da Olist (ou registre uma venda física) em Atualizar dados.</div>
      </div>
    );
  if (sub === "abc" || sub === "xyz") return <AnaliseABC esc={esc} cres={cres} linhas={linhas} hoje={hoje} farmConfig={farmConfig} onToast={onToast} parte={sub} />;
  return <AnaliseEvolucao esc={esc} cres={cres} linhas={linhas} hoje={hoje} />;
}
