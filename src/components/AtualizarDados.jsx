import { useMemo } from "react";
import { useOpcaoDoSku } from "../hooks/useVendasReais.js";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { enriquecer } from "../lib/pedidos.js";
import { hojeSP } from "../lib/datas.js";
import CentralImportacao from "./CentralImportacao.jsx";

// "Atualizar dados" (remap 21/10/2026): a antiga Atualizar dados
// promovida a item do menu — é o que se faz toda semana. Mesmo componente,
// mesmas contas (CentralImportacao).
export default function AtualizarDados({ onToast }) {
  const esc = useEscada();
  const cres = useCrescimento();
  const ped = usePedidos();
  const hoje = hojeSP();
  const opcaoDoSku = useOpcaoDoSku(esc.itens, esc.precos);
  const linhas = useMemo(() => enriquecer(ped.pedidos, { itens: esc.itens, canais: esc.canais, cfgDoProduto: esc.cfgDoProduto, opcaoDoSku }), [ped.pedidos, esc.itens, esc.canais, esc.cfgDoProduto, opcaoDoSku]);
  return <CentralImportacao esc={esc} ped={ped} linhas={linhas} linhasAds={cres.linhasAds} cres={cres} hoje={hoje} onToast={onToast} />;
}
