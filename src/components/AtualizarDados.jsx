import { useMemo } from "react";
import { useOpcaoDoSku } from "../hooks/useVendasReais.js";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { usePedidos } from "../hooks/usePedidos.js";
import { enriquecer } from "../lib/pedidos.js";
import { hojeSP } from "../lib/datas.js";
import CentralImportacao from "./CentralImportacao.jsx";
import { abrirEstoque } from "../lib/estoqueNav.js";

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
  return (
    <>
      <CentralImportacao esc={esc} ped={ped} linhas={linhas} linhasAds={cres.linhasAds} cres={cres} hoje={hoje} onToast={onToast} />
      <div className="panel">
        <h3>Nota de compra (XML ou PDF) — revenda</h3>
        <p className="hint" style={{ marginBottom: 8 }}>
          Comprou mercadoria pronta pra revender? Suba o XML da nota (ou o PDF/DANFE, se não tiver o XML): entra no estoque, atualiza o custo médio e lança as parcelas no Caixa.
        </p>
        <button type="button" className="btn" onClick={() => abrirEstoque("notas")}>
          📄 Importar nota de compra →
        </button>
      </div>
    </>
  );
}
