// Caixinha "Insumos" (01/11/2026, simplificado a pedido do Gustavo: "uma caixinha
// só pra comprar material e embalagem"). É a antiga Reserva de produção (tabela
// reserva_producao, v51) com outro nome: separação VIRTUAL do caixa da loja —
// o saldo da loja não muda, só mostra quanto já tem destino.
//   tipo 'separar' (guardou) | 'usar' (tirou). Linha sem `caixinha` (ou 'giro',
//   do v72) = Insumos. Outras caixinhas do v72 (se alguém chegou a distribuir)
//   aparecem só como "caixinhas antigas" pra liberar.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cent = (v) => Math.round(num(v) * 100) / 100;

export const ehInsumos = (r) => !r?.caixinha || r.caixinha === "giro";

/** { insumos, antigas: { caixinha: saldo } , total } */
export function saldosCaixinhas(registros = []) {
  let insumos = 0;
  const antigas = {};
  for (const r of registros) {
    const v = (r.tipo === "usar" ? -1 : 1) * num(r.valor);
    if (ehInsumos(r)) insumos += v;
    else antigas[r.caixinha] = (antigas[r.caixinha] || 0) + v;
  }
  for (const k of Object.keys(antigas)) {
    antigas[k] = cent(antigas[k]);
    if (Math.abs(antigas[k]) < 0.005) delete antigas[k];
  }
  insumos = cent(insumos);
  const total = cent(insumos + Object.values(antigas).reduce((t, v) => t + v, 0));
  return { insumos, antigas, total };
}
