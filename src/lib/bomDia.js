// "Bom dia" do consultor (24/10/2026): o dia de ONTEM num cartão só, no Início
// e no consultor da Sede. Pedido do Gustavo: primeiro confere se os arquivos de
// ontem foram enviados (tudo sai das importações) — o que depende de arquivo
// que falta aparece como "aguardando arquivo", nunca como um zero enganoso.
// SÓ INFORMA: nenhuma decisão sai de um dia só (Rampa e Ads seguem as janelas
// deles); o que pede ação já está no Pra fazer.
import { adsNoPeriodo, lucroDaLinha } from "./resumoLoja.js";
import { periodoLigado } from "./ads.js";
import { ateDoEnvioPedidos } from "./pedidos.js";

const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const ultimoAte = (lista, teste, ateDe = (i) => i.periodo_ate) =>
  (lista || [])
    .filter((i) => i.ok && teste(String(i.relatorio || "")))
    .map(ateDe)
    .filter(Boolean)
    .sort()
    .pop() || null;

/**
 * → { ontem, faltando: [{chave, texto}], pedidos: {n, vendas, lucro, mediaVendas, mediaLucro} | null,
 *     ads: {gasto, orcamento} | null, contas: {hoje, atrasadas, total} }
 */
export function bomDia({ importacoes = [], pedidos = [], linhasAds = null, periodosAds = [], aPagar = null, hoje, erp = "Olist" }) {
  const ontem = somarDias(hoje, -1);
  const faltando = [];
  // pedidos (Olist) cobrindo ontem
  // pedidos: o envio cobre até a véspera do dia em que subiu (dia sem venda não falta)
  const ateP = ultimoAte(importacoes, (r) => r.startsWith("pedidos:"), ateDoEnvioPedidos);
  const pedidosOk = !erp || (!!ateP && ateP >= ontem);
  if (!pedidosOk) faltando.push({ chave: "pedidos", texto: ateP ? `pedidos da ${erp} (último até ${ateP.slice(8, 10)}/${ateP.slice(5, 7)})` : `pedidos da ${erp}` });
  // CSV do Ads de ontem (só com Ads ligado)
  const ligados = (periodosAds || []).filter((p) => periodoLigado(p, hoje));
  const ateA = ultimoAte(importacoes, (r) => r === "shopee:ads");
  const adsOk = !ligados.length || (!!ateA && ateA >= ontem);
  if (!adsOk) faltando.push({ chave: "ads", texto: "CSV do Shopee Ads de ontem (atalho “Ontem”)" });

  let resumoPedidos = null;
  if (pedidosOk) {
    const dia = (d) => (pedidos || []).filter((p) => p.valido && String(p.data).slice(0, 10) === d);
    const soma = (ls) => ({ n: new Set(ls.map((p) => p.pedido)).size, vendas: ls.reduce((s, p) => s + num(p.pago), 0), lucro: ls.reduce((s, p) => s + lucroDaLinha(p), 0) });
    const o = soma(dia(ontem));
    let mv = 0;
    let ml = 0;
    for (let k = 2; k <= 15; k++) {
      const x = soma(dia(somarDias(hoje, -k)));
      mv += x.vendas;
      ml += x.lucro;
    }
    resumoPedidos = { ...o, mediaVendas: mv / 14, mediaLucro: ml / 14 };
  }
  const ads = ligados.length && adsOk ? { gasto: adsNoPeriodo(linhasAds, ontem, ontem), orcamento: ligados.reduce((s, p) => s + num(p.orcamento_diario), 0) } : null;
  const contas = (aPagar || []).filter((c) => c.data && c.data <= hoje);
  return {
    ontem,
    faltando,
    pedidos: resumoPedidos,
    ads,
    contas: { hoje: contas.filter((c) => c.data === hoje).length, atrasadas: contas.filter((c) => c.data < hoje).length, total: contas.reduce((s, c) => s + num(c.valor), 0) },
  };
}
