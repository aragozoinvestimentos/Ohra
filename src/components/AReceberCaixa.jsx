import { useMemo } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { PLATAFORMAS, caixaDosPedidos } from "../lib/pedidos.js";
import { BRL } from "../lib/format.js";
import Ajuda from "./Ajuda.jsx";

// Caixa → "A receber das plataformas" (26/10/2026, pedido do Gustavo pra
// comparar com o "Pendente" da Minha Renda da Shopee): pedidos importados
// pagos e ainda não entregues, pelo repasse (pago − comissão − taxa fixa).
// Fora do saldo e da projeção — só mostra. Mesma conta de Atualizar dados.
export default function AReceberCaixa() {
  const { pedidosValidos } = useCrescimento();
  const porPlat = useMemo(() => {
    const m = new Map();
    for (const x of caixaDosPedidos(pedidosValidos || []).aReceber) m.set(x.plataforma, (m.get(x.plataforma) || 0) + x.valor);
    return [...m].filter(([, v]) => v > 0.004);
  }, [pedidosValidos]);
  if (!porPlat.length) return null;
  const nome = (p) => PLATAFORMAS.find((x) => x.id === p)?.nome || p;
  return (
    <div className="areceber-caixa">
      <b>A receber das plataformas</b>
      <Ajuda texto="Pedidos importados da Olist já pagos e ainda não entregues — o que a plataforma vai repassar (pago − comissão − taxa fixa). Fica fora do saldo e da projeção até virar Entregue. Na Shopee, compare com o “Pendente” da Minha Renda (lá também entram os entregues que ela ainda não liberou)." />
      {porPlat.map(([p, v]) => (
        <span key={p}>
          {nome(p)} <b>{BRL(v)}</b>
        </span>
      ))}
      <span className="faint">pagos, ainda não entregues · fora do saldo</span>
    </div>
  );
}
