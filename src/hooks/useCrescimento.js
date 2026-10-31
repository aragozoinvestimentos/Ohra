import { createContext, createElement, useContext, useMemo } from "react";
import { useEscada } from "./useEscada.js";
import { useRampas } from "./useRampas.js";
import { useAfiliados } from "./useAfiliados.js";
import { estadoRampa, metricasFunil, referenciaFunilLoja, regrasDaLoja } from "../lib/rampa.js";
import { linhasComissao, resumoSemana } from "../lib/afiliados.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { useAdsPeriodos } from "./useAdsPeriodos.js";
import { periodoAjustado, economiaRealAds } from "../lib/ads.js";
import { lucroDaLinha } from "../lib/resumoLoja.js";
import { adsNaJanela, pausasDoPeriodo, valoresAtuais, avaliarAds, avaliarAdsLoja, capacidadeDoItem, faseAdsSazonal, periodoAtivo, periodosDoItem, regrasAds, roasEmpate, tetoDaLoja } from "../lib/ads.js";
import { useLembretes } from "./useLembretes.js";
import { usePreferencia } from "./usePreferencia.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { equilibrioDoGrupo, estadoRampaGrupo, itensSoNoGrupo, mixDoGrupo, opcoesNoCanal } from "../lib/grupoRampa.js";
import { gruposPorItem, idGrupo, idDoItemOpcao, opcoesDoGrupo } from "../lib/anunciosGrupo.js";
import { useCatalogo } from "./useCatalogo.js";
import { lucroNoPreco } from "../lib/escada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import { canalDireto } from "../lib/canais.js";
import { useVendasReais } from "./useVendasReais.js";
import { somarDias } from "../lib/pedidos.js";
import { useVendasOrganicas } from "./useVendasOrganicas.js";
import { configCalendario, infoSazonal, proximaCampanha, quandoVendeDe } from "../lib/calendario.js";
import { useAvaliacoes } from "./useAvaliacoes.js";
import { juntarRegistros, registrosDeAvaliacao, semanasAutomaticas } from "../lib/semanasAuto.js";
import { cruzarGrupos, normSku, relatorioDoGuardado } from "../lib/relatorioShopee.js";
import { fichaDoGrupo } from "../lib/anunciosGrupo.js";
import { PLATAFORMAS } from "../lib/pedidos.js";
import { furosDasJanelas, janelasDoPeriodo, produtosDaGmv } from "../lib/gmvLoja.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// Tudo da aba Crescimento calculado ao vivo (Rampa + Afiliados) — a MESMA
// conta pra aba Crescimento e pro Início (que só lê).
// Calculado UMA vez (CrescimentoProvider no App, 16/10/2026) e lido por todas
// as telas (Início, Crescimento, Análise, Ficha, Lançamento) — antes cada tela
// montada refazia a conta inteira.
const CrescimentoContext = createContext(null);
export function CrescimentoProvider({ children }) {
  const valor = useCalculoCrescimento();
  return createElement(CrescimentoContext.Provider, { value: valor }, children);
}
export function useCrescimento() {
  const v = useContext(CrescimentoContext);
  if (!v) throw new Error("useCrescimento fora do CrescimentoProvider");
  return v;
}

function useCalculoCrescimento() {
  const dados = useEscada();
  const { itens, produtos, kits, canais, precos, cfgDoProduto, cfgLoja, publicacoesCanal, gruposAnuncio: grupos } = dados;
  const rampasH = useRampas({ comRegistros: true });
  const { rampas, rampasGrupo, rampasKit = [], registros: registrosGravados } = rampasH;
  const { impressoras, farmConfig } = useCatalogo();
  // Itens que só existem dentro de um anúncio com vários itens: saem dos avisos
  // individuais de rampa e da lista de Ads (entram pelo anúncio inteiro).
  const soNoGrupo = useMemo(() => itensSoNoGrupo({ grupos, itens, precos }), [grupos, itens, precos]);
  // Períodos de Ads do anúncio com vários itens: os do anúncio + os das opções
  // que só existem nele. Período de opção com o MESMO andamento de um período
  // do anúncio (o CSV gravado nos dois) sai — senão o gasto conta 2×.
  const periodosDoAnuncio = (gid, canalId, idsSo) => {
    const doAnuncio = periodosDoItem(adsHv.periodos, "grupo", gid, canalId);
    const sig = (p) => (p.parcial?.ate ? `${p.parcial.ate}|${Number(p.parcial.gasto) || 0}` : null);
    const vistos = new Set(doAnuncio.map(sig).filter(Boolean));
    const dasOpcoes = idsSo.flatMap((id) => periodosDoItem(adsHv.periodos, itemTipoDoId(id), id.slice(2), canalId)).filter((p) => !sig(p) || !vistos.has(sig(p)));
    return { doAnuncio, dasOpcoes };
  };
  const af = useAfiliados();
  const regras = useMemo(() => regrasDaLoja(cfgLoja), [cfgLoja]);
  const hoje = hojeISO();
  // Períodos de Ads (lib/adsAcoes.js grava; ads.js decide): a Rampa só fica
  // sabendo que há Ads ligado no produto (teste "ads-ligado").
  const adsH = useAdsPeriodos();
  // Vendas orgânicas lançadas à mão (v52): entram no faturamento do teto de Ads.
  const organicasH = useVendasOrganicas();
  // Pedidos reais (aba Análise, v55): no teto do Ads, o faturamento dos dias
  // com pedidos importados vem deles (a estimativa das semanas sai).
  const reais = useVendasReais({ itens, canais, cfgDoProduto });
  // "Não usar Ads por enquanto" (16/10/2026): lembretes chave ads-nao|<chave da linha>.
  const lembretesH = useLembretes();
  const { lojaId } = useLoja();
  const avalH = useAvaliacoes();

  // ---------- Semanas AO VIVO (16/10/2026, lib/semanasAuto.js) ----------
  // Tudo que vem dos marketplaces sai da Atualizar dados: vendas =
  // pedidos, funil = Desempenho, Ads = CSV, avaliações = bloco Avaliações.
  // Nada é gravado: as semanas são montadas aqui e entram onde antes entravam
  // as do "Registrar semana" (que saiu). Registros gravados continuam valendo.
  const pedidosPorCanal = useMemo(() => {
    const m = new Map();
    for (const l of reais.linhas) {
      if (!l.valido || !l.canal_id) continue;
      if (!m.has(l.canal_id)) m.set(l.canal_id, []);
      m.get(l.canal_id).push(l);
    }
    return m;
  }, [reais.linhas]);
  // 1º dia com pedidos importados em cada plataforma.
  const inicioCobertura = useMemo(() => {
    const m = new Map();
    for (const i of reais.importacoes || []) {
      if (!i.ok || !String(i.relatorio || "").startsWith("pedidos:") || !i.periodo_de) continue;
      const plat = i.relatorio.slice(8);
      const d = String(i.periodo_de).slice(0, 10);
      if (!m.has(plat) || d < m.get(plat)) m.set(plat, d);
    }
    return (canal) => m.get(PLATAFORMAS.find((p) => p.tipo === canal?.tipo)?.id) || null;
  }, [reais.importacoes]);
  // SKUs de cada opção dos anúncios com vários itens (como a Ficha gera):
  // separa a venda feita DENTRO do anúncio da venda do item no anúncio próprio.
  const skuGrupo = useMemo(() => {
    const porCanal = new Map(); // canalId → Map(sku → { grupoId, item })
    const opcoesSku = new Map(); // `${grupoId}|${canalId}` → [{ idx, skus }]
    for (const g of grupos || []) {
      for (const c of canais) {
        if (canalDireto(c)) continue;
        const ficha = fichaDoGrupo({ grupo: g, canal: c, itens, precos, produtos, kits, mapaRampa: dados.mapaRampa, publicacoes: publicacoesCanal, clientePagaHoje: dados.clientePagaHoje });
        if (!ficha) continue;
        if (!porCanal.has(c.id)) porCanal.set(c.id, new Map());
        const mm = porCanal.get(c.id);
        const lista = [];
        ficha.opcoes.forEach((o, idx) => {
          const skus = [];
          for (const l of ficha.linhas.filter((x) => x.opcao === o)) {
            const k = normSku(l.sku);
            if (!k || !l.item) continue;
            skus.push(k);
            // SKU igual ao do item (sem sufixo): só conta como do anúncio se o item não tem anúncio próprio.
            if (k === normSku(l.item.sku) && !soNoGrupo.has(l.item.id)) continue;
            mm.set(k, { grupoId: g.id, item: l.item });
          }
          lista.push({ idx, skus });
        });
        opcoesSku.set(`${g.id}|${c.id}`, lista);
      }
    }
    return { porCanal, opcoesSku };
  }, [grupos, canais, itens, precos, produtos, kits, dados.mapaRampa, dados.clientePagaHoje, publicacoesCanal, soNoGrupo]);
  const grupoDoPedido = (l) => skuGrupo.porCanal.get(l.canal_id)?.get(normSku(l.sku)) || null;
  // Anúncio do pedido (avaliações são por anúncio): grupo, produto pai ou kit.
  const anuncioDoPedido = (l) => {
    const g = grupoDoPedido(l);
    if (g) return { tipo: "grupo", id: g.grupoId };
    const id = l.id_item;
    if (!id) return null;
    if (id.startsWith("v:")) return l.item?.produtoId ? { tipo: "produto", id: l.item.produtoId } : null;
    return { tipo: id.startsWith("k:") ? "kit" : "produto", id: id.slice(2) };
  };
  // ROAS ajustado (01/11/2026): cada período de Ads com as vendas via Ads
  // limitadas às unidades PAGAS do anúncio nos pedidos (o CSV da Shopee conta
  // não pago, cancelado e outros produtos). O número da Shopee fica em
  // parcialShopee / vendasShopee; as gravações usam o original (salvarAndamentoAds).
  const adsHv = useMemo(() => {
    const naoPagos = new Map();
    for (const l of reais.linhas || []) {
      if (!l.naoPago || !l.canal_id) continue;
      if (!naoPagos.has(l.canal_id)) naoPagos.set(l.canal_id, []);
      naoPagos.get(l.canal_id).push(l);
    }
    // Opção que só vende dentro de um anúncio com vários itens: o Ads dela é o do
    // anúncio inteiro (01/11/2026, Conjunto de Natal — o período estava na opção
    // Kit Completo e contava só as 6 vendas dela, não as 11 do anúncio).
    const grupoDoItem = new Map();
    for (const [id, lista] of gruposPorItem(grupos)) if (soNoGrupo.has(id) && lista[0]) grupoDoItem.set(id, lista[0].grupo.id);
    // Datas em que o preço mudou pela rampa (subida, descida, ajuste do degrau,
    // rampa refeita) por item × canal — o Ads lê (A/B/C, 31/10/2026).
    const regsPorRampa = new Map();
    for (const r of registrosGravados || []) {
      if (!regsPorRampa.has(r.rampa_id)) regsPorRampa.set(r.rampa_id, []);
      regsPorRampa.get(r.rampa_id).push(r);
    }
    const mudancasDaRampa = (rampa) => {
      if (!rampa) return [];
      const regs = regsPorRampa.get(rampa.id) || [];
      const inicios = regs.filter((r) => r.tipo === "inicio").map((r) => String(r.data).slice(0, 10)).sort();
      const ds = [...regs.filter((r) => r.tipo === "subida" || r.tipo === "descida").map((r) => String(r.data).slice(0, 10)), ...inicios.slice(1), ...(Array.isArray(rampa.checklist?.ajustesDegrau) ? rampa.checklist.ajustesDegrau.map((a) => String(a.data || "").slice(0, 10)).filter(Boolean) : [])];
      return [...new Set(ds)].sort();
    };
    const rampaDoPeriodo = (tipo, id, canalId) => {
      if (tipo === "grupo") return (rampasGrupo || []).find((r) => r.grupo_id === id && r.canal_id === canalId);
      if (tipo === "kit") return (rampasKit || []).find((r) => r.kit_id === id && r.canal_id === canalId);
      if (tipo === "produto") return (rampas || []).find((r) => r.produto_id === id && r.canal_id === canalId);
      return null;
    };
    const periodos = (adsH.periodos || []).map((p) => {
      if (!p?.parcial?.ate || p.item_tipo === "loja" || !p.item_id) return p;
      const canal = canais.find((c) => c.id === p.canal_id);
      if (!canal) return p;
      let casa;
      if (p.item_tipo === "grupo") casa = (l) => grupoDoPedido(l)?.grupoId === p.item_id;
      else {
        const pref = p.item_tipo === "kit" ? "k" : p.item_tipo === "variacao" ? "v" : "p";
        const ids = new Set([`${pref}:${p.item_id}`, ...(pref === "p" ? itens.filter((i) => i.id.startsWith("v:") && i.produtoId === p.item_id).map((i) => i.id) : [])]);
        const gid = grupoDoItem.get(`${pref}:${p.item_id}`);
        casa = gid ? (l) => grupoDoPedido(l)?.grupoId === gid || ids.has(l.id_item) : (l) => ids.has(l.id_item) && !grupoDoPedido(l);
      }
      const pagas = (de, ate) => {
        const t = { un: 0, pago: 0, lucro: 0 };
        for (const l of pedidosPorCanal.get(p.canal_id) || [])
          if (l.data >= de && l.data <= ate && casa(l)) {
            t.un += Number(l.q) || 0;
            t.pago += Number(l.pago) || 0;
            t.lucro += lucroDaLinha(l);
          }
        return t;
      };
      const pendentes = (de, ate) => (naoPagos.get(p.canal_id) || []).filter((l) => l.data >= de && l.data <= ate && casa(l)).reduce((t, l) => t + (Number(l.q) || 1), 0);
      const gidP = p.item_tipo === "grupo" ? p.item_id : grupoDoItem.get(`${p.item_tipo === "kit" ? "k" : p.item_tipo === "variacao" ? "v" : "p"}:${p.item_id}`);
      const rampaP = (gidP && rampaDoPeriodo("grupo", gidP, p.canal_id)) || rampaDoPeriodo(p.item_tipo, p.item_id, p.canal_id);
      return periodoAjustado(p, { pagas, pendentes, cobre: (de, ate) => reais.cobertura.cobre(canal, de, ate), mudancas: mudancasDaRampa(rampaP).filter((d) => d <= hoje) });
    });
    return { ...adsH, periodos };
  }, [adsH, reais.linhas, reais.cobertura, pedidosPorCanal, canais, itens, soNoGrupo, skuGrupo, grupos, registrosGravados, rampas, rampasGrupo, rampasKit, hoje]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendasDeItens = (canalId, ids) => (de, ate) => {
    let t = 0;
    for (const l of pedidosPorCanal.get(canalId) || []) if (l.data >= de && l.data <= ate && ids.has(l.id_item) && !grupoDoPedido(l)) t += l.q;
    return t;
  };
  const vendasDoGrupo = (canalId, gid) => (de, ate) => {
    let t = 0;
    for (const l of pedidosPorCanal.get(canalId) || []) if (l.data >= de && l.data <= ate && grupoDoPedido(l)?.grupoId === gid) t += l.q;
    return t;
  };
  // Vendas por opção do anúncio com vários itens, pelos pedidos (mix e "Qual
  // opção vende"): no formato das vendas_organicas (grupo_id). As lançadas à
  // mão nos dias com pedidos importados saem (o pedido é a venda real).
  const organicasVivas = useMemo(() => {
    const vivas = [];
    for (const [canalId, ls] of pedidosPorCanal)
      for (const l of ls) {
        const g = grupoDoPedido(l);
        if (!g) continue;
        vivas.push({ id: `ped|${l.chave || l.id}`, auto: true, grupo_id: g.grupoId, item_tipo: itemTipoDoId(g.item.id), item_id: g.item.id.slice(2), canal_id: canalId, data: l.data, unidades: l.q, preco: l.q ? l.pago / l.q : 0 });
      }
    const antigas = (organicasH.registros || []).filter((o) => !(o.grupo_id && reais.cobertura.cobre(canais.find((c) => c.id === o.canal_id), String(o.data).slice(0, 10))));
    return [...antigas, ...vivas];
  }, [pedidosPorCanal, skuGrupo, organicasH.registros, reais.cobertura, canais]); // eslint-disable-line react-hooks/exhaustive-deps
  // Relatórios de Desempenho guardados (o envio mais novo de cada período).
  const desempenhos = useMemo(() => {
    const m = new Map();
    for (const i of reais.importacoes || []) {
      if (!i.ok || i.relatorio !== "shopee:desempenho" || !i.dados || !i.periodo_de || !i.periodo_ate) continue;
      const k = `${String(i.periodo_de).slice(0, 10)}|${String(i.periodo_ate).slice(0, 10)}`;
      if (!m.has(k) || String(i.criado_em) > String(m.get(k).criado_em)) m.set(k, i);
    }
    return [...m.values()].map((i) => ({ de: String(i.periodo_de).slice(0, 10), ate: String(i.periodo_ate).slice(0, 10), r: relatorioDoGuardado(i.dados) })).filter((x) => x.r);
  }, [reais.importacoes]);
  const funisDoSku = (sku) => {
    const k = normSku(sku);
    if (!k) return [];
    return desempenhos.map((d) => {
      const it = (d.r.itens || []).find((x) => x.sku === k);
      return it ? { de: d.de, ate: d.ate, impressoes: it.impressoes, cliques: it.cliques, pedidos: it.pedidos } : null;
    }).filter(Boolean);
  };
  const funisDoGrupo = (gid, canalId) => {
    const ops = skuGrupo.opcoesSku.get(`${gid}|${canalId}`);
    if (!ops) return [];
    return desempenhos.map((d) => {
      const r = cruzarGrupos([d.r], [{ id: gid, nome: "", opcoes: ops }]).porGrupo[gid];
      return r ? { de: d.de, ate: d.ate, impressoes: r.impressoes, cliques: r.cliques, pedidos: r.pedidos } : null;
    }).filter(Boolean);
  };
  // Desempenho mais recente de um anúncio (diagnóstico comercial, 24/10/2026):
  // a linha do relatório com TODAS as colunas (carrinho, visitantes, compradores…).
  const desempenhoDoAnuncio = ({ sku, grupoId, canalId }) => {
    const ord = [...desempenhos].sort((a, b) => b.ate.localeCompare(a.ate) || b.de.localeCompare(a.de));
    for (const d of ord) {
      let it = null;
      if (grupoId) {
        const ops = skuGrupo.opcoesSku.get(`${grupoId}|${canalId}`);
        const id = ops ? cruzarGrupos([d.r], [{ id: grupoId, nome: "", opcoes: ops }]).porGrupo[grupoId]?.itemId : null;
        it = id ? (d.r.itens || []).find((x) => x.itemId === id) : null;
      } else if (sku) it = (d.r.itens || []).find((x) => x.sku === normSku(sku));
      if (it) return { de: d.de, ate: d.ate, item: it };
    }
    return null;
  };
  // Preço da semana: o do marco (início/subida/descida) em vigor; depois do último, o degrau de hoje.
  const precoDaRampa = (r, gravados) => {
    const marcos = gravados.filter((g) => ["inicio", "subida", "descida"].includes(g.tipo)).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const atual = (r.degraus || [])[r.degrau_atual] ?? null;
    return (dia) => {
      const k = marcos.reduce((m, g, i) => (String(g.data).slice(0, 10) <= dia ? i : m), -1);
      return k < 0 || k === marcos.length - 1 ? atual : marcos[k].preco ?? atual;
    };
  };
  const avaliacoesDe = (tipo, id, canalId) => registrosDeAvaliacao((avalH.registros || []).filter((a) => a.item_tipo === tipo && a.item_id === id && a.canal_id === canalId));
  // Registros de cada rampa (gravados + semanas automáticas + avaliações) e o parcial.
  const vivo = useMemo(() => {
    const regs = [];
    const parciais = new Map();
    const seteDias = new Map();
    const antes = new Map();
    const cobreDe = (canal) => (de, ate) => reais.cobertura.cobre(canal, de, ate);
    for (const r of [...rampas, ...(rampasGrupo || []), ...rampasKit]) {
      const canal = canais.find((c) => c.id === r.canal_id);
      const grav = registrosGravados.filter((g) => g.rampa_id === r.id);
      if (!canal) {
        regs.push(...grav);
        continue;
      }
      let vendasEm, funis, periodosR, aval;
      if (r.kit_id) {
        // Rampa de kit (v62): só as vendas do anúncio próprio do kit (SKU do kit).
        vendasEm = vendasDeItens(canal.id, new Set([`k:${r.kit_id}`]));
        const kit = kits.find((k) => k.id === r.kit_id);
        funis = canal.tipo === "shopee" ? funisDoSku(kit?.sku) : [];
        periodosR = periodosDoItem(adsHv.periodos, "kit", r.kit_id, canal.id);
        aval = avaliacoesDe("kit", r.kit_id, canal.id);
      } else if (r.grupo_id) {
        vendasEm = vendasDoGrupo(canal.id, r.grupo_id);
        funis = canal.tipo === "shopee" ? funisDoGrupo(r.grupo_id, canal.id) : [];
        // Ads do anúncio inteiro = os períodos do anúncio + os das opções que só
        // existem nele (a MESMA lista da linha do anúncio no Ads — 21/10/2026:
        // antes a Rampa via só os do anúncio e o ROAS/gasto não batia com o Ads).
        const grupo = (grupos || []).find((g) => g.id === r.grupo_id);
        const idsSo = grupo ? opcoesDoGrupo(grupo).map(idDoItemOpcao).filter((id) => id && soNoGrupo.has(id)) : [];
        const pa = periodosDoAnuncio(r.grupo_id, canal.id, idsSo);
        periodosR = [...pa.doAnuncio, ...pa.dasOpcoes];
        aval = avaliacoesDe("grupo", r.grupo_id, canal.id);
      } else {
        const ids = new Set([`p:${r.produto_id}`, ...itens.filter((i) => i.id.startsWith("v:") && i.produtoId === r.produto_id).map((i) => i.id)]);
        vendasEm = vendasDeItens(canal.id, ids);
        const prod = produtos.find((p) => p.id === r.produto_id);
        funis = canal.tipo === "shopee" ? funisDoSku(prod?.sku) : [];
        periodosR = periodosDoItem(adsHv.periodos, "produto", r.produto_id, canal.id);
        aval = avaliacoesDe("produto", r.produto_id, canal.id);
      }
      const { semanas, parcial } = semanasAutomaticas({ chave: r.id, gravados: grav, hoje, vendasEm, cobre: cobreDe(canal), precoEm: precoDaRampa(r, grav), periodos: periodosR, funis });
      regs.push(...grav, ...semanas.map((w) => ({ ...w, rampa_id: r.id })), ...aval.filter((a) => a.data >= String(r.criado_em ? r.criado_em : "").slice(0, 10)).map((a) => ({ ...a, rampa_id: r.id })));
      if (parcial) parciais.set(r.id, parcial);
      // Últimos 7 dias AO VIVO (23/10/2026): vendas pelos pedidos e Ads pelo
      // CSV até hoje — "Lucro da semana" não espera a semana fechar.
      seteDias.set(r.id, { vendas: vendasEm(somarDias(hoje, -6), hoje), ads: adsNaJanela(periodosR, [], somarDias(hoje, -7), hoje).gasto });
      // Vendas importadas ANTES do 1º marco da rampa (ficam fora da conta;
      // o Detalhe oferece somar em vendas_iniciais — 24/10/2026).
      const ini0 = grav.filter((g) => ["inicio", "subida", "descida", "semana"].includes(g.tipo)).map((g) => String(g.tipo === "semana" && g.periodo_inicio ? g.periodo_inicio : g.data).slice(0, 10)).sort()[0];
      if (ini0) antes.set(r.id, vendasEm("2000-01-01", somarDias(ini0, -1)));
    }
    return { registros: juntarRegistros(regs, []), parciais, seteDias, antes };
  }, [rampas, rampasGrupo, rampasKit, registrosGravados, canais, itens, produtos, kits, adsHv.periodos, avalH.registros, pedidosPorCanal, skuGrupo, desempenhos, reais.cobertura, hoje, grupos, soNoGrupo]); // eslint-disable-line react-hooks/exhaustive-deps
  const registros = vivo.registros;
  const rampasHV = useMemo(() => ({ ...rampasH, registros }), [rampasH, registros]);

  // Referência do funil: mediana de CTR e conversão dos produtos da loja
  // (só com 5+ produtos com funil calculável; senão, referência geral).
  const funilLoja = useMemo(
    () => referenciaFunilLoja(rampas.map((r) => metricasFunil(r, registros.filter((g) => g.rampa_id === r.id), regras, hoje))),
    [rampas, registros, regras, hoje]
  );

  // Uma linha por rampa, com tudo calculado ao vivo.
  // Calendário da loja (Configuração → Lojas): temporada do produto sazonal e
  // aviso da próxima campanha da plataforma.
  const calendario = useMemo(() => configCalendario(cfgLoja), [cfgLoja]);
  const campanha = useMemo(() => proximaCampanha(calendario, hoje), [calendario, hoje]);
  const linhas = useMemo(() => {
    return rampas
      .map((r) => {
        const produto = produtos.find((p) => p.id === r.produto_id);
        const canal = canais.find((c) => c.id === r.canal_id);
        const item = itens.find((i) => i.id === `p:${r.produto_id}`);
        if (!produto || !canal || !item) return null;
        const cfg = cfgDoProduto(r.produto_id);
        const salvo = precos.find((p) => p.item_tipo === "produto" && p.item_id === r.produto_id && p.canal_id === r.canal_id);
        const adsAtivo = periodoAtivo(periodosDoItem(adsHv.periodos, "produto", r.produto_id, r.canal_id), hoje);
        const sazonal = infoSazonal(quandoVendeDe(produto), calendario, hoje);
        const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo: salvo ? num(salvo.preco) : null, funilLoja, adsAtivo, sazonal, proximaCampanha: campanha, parcial: vivo.parciais.get(r.id) || null, seteDias: vivo.seteDias?.get(r.id) || null, antesDoInicio: vivo.antes?.get(r.id) || 0 };
        const regs = registros.filter((g) => g.rampa_id === r.id);
        const est = estadoRampa(r, regs, regras, ctx, hoje);
        return { r, produto, canal, item, cfg, ctx, est, soNoGrupo: soNoGrupo.has(item.id) };
      })
      .concat(
        // Rampa de KIT (v62): mesma estadoRampa, com o custo/peso/preço salvo do
        // kit. `produto` = { id: null, nome do kit } pra lista e os textos.
        rampasKit.map((r) => {
          const kit = kits.find((k) => k.id === r.kit_id);
          const canal = canais.find((c) => c.id === r.canal_id);
          const item = itens.find((i) => i.id === `k:${r.kit_id}`);
          if (!kit || !canal || !item) return null;
          const cfg = cfgDoProduto(null);
          const salvo = precos.find((p) => p.item_tipo === "kit" && p.item_id === r.kit_id && p.canal_id === r.canal_id);
          const adsAtivo = periodoAtivo(periodosDoItem(adsHv.periodos, "kit", r.kit_id, r.canal_id), hoje);
          // Sazonal: a 1ª peça "só na época de…".
          let sazonal = null;
          for (const c of item.componentes || []) {
            const sz = infoSazonal(quandoVendeDe(produtos.find((p) => p.id === c.produtoId)), calendario, hoje);
            if (sz && sz.tipo === "epoca") {
              sazonal = sz;
              break;
            }
          }
          const ctx = { canal, custo: num(item.custoTotal), peso: num(item.peso), cfg, alvo: salvo ? num(salvo.preco) : null, funilLoja, adsAtivo, sazonal, proximaCampanha: campanha, parcial: vivo.parciais.get(r.id) || null, seteDias: vivo.seteDias?.get(r.id) || null, antesDoInicio: vivo.antes?.get(r.id) || 0 };
          const est = estadoRampa(r, registros.filter((g) => g.rampa_id === r.id), regras, ctx, hoje);
          return { r, produto: { id: null, nome: kit.nome, sku: kit.sku || "" }, kit, ehKit: true, canal, item, cfg, ctx, est, soNoGrupo: soNoGrupo.has(item.id) };
        })
      )
      .filter(Boolean)
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.canal.nome.localeCompare(b.canal.nome));
  }, [rampas, rampasKit, kits, registros, produtos, canais, itens, precos, cfgDoProduto, regras, hoje, funilLoja, adsHv.periodos, calendario, campanha, soNoGrupo, vivo.parciais, vivo.seteDias, vivo.antes]);

  // Rampa do ANÚNCIO com vários itens (v54, grupoRampa.js): degraus em % do
  // preço salvo de cada opção; mesma estadoRampa por dentro.
  const linhasGrupo = useMemo(() => {
    const out = [];
    for (const r of rampasGrupo || []) {
      const grupo = (grupos || []).find((g) => g.id === r.grupo_id);
      const canal = canais.find((c) => c.id === r.canal_id);
      if (!grupo || !canal) continue;
      // Sazonal: o 1º produto das opções que é "só na época de…".
      let sazonal = null;
      for (const o of opcoesDoGrupo(grupo)) {
        const it = itens.find((i) => i.id === idDoItemOpcao(o));
        const pid = it ? (it.id.startsWith("p:") ? it.id.slice(2) : it.produtoId || (it.componentes || [])[0]?.produtoId) : null;
        const prod = pid ? produtos.find((p) => p.id === pid) : null;
        const sz = prod ? infoSazonal(quandoVendeDe(prod), calendario, hoje) : null;
        if (sz && sz.tipo === "epoca") {
          sazonal = sz;
          break;
        }
      }
      // Ads do anúncio inteiro OU de uma opção que só existe nele (é o mesmo
      // anúncio na Shopee — igual à linha do Ads).
      const idsSo = opcoesDoGrupo(grupo).map(idDoItemOpcao).filter((id) => id && soNoGrupo.has(id));
      const paR = periodosDoAnuncio(grupo.id, canal.id, idsSo);
      const adsAtivo = periodoAtivo([...paR.doAnuncio, ...paR.dasOpcoes], hoje);
      const regs = registros.filter((g) => g.rampa_id === r.id);
      const g = estadoRampaGrupo({ rampa: r, registros: regs, regras, grupo, canal, itens, produtos, kits, precos, publicacoes: publicacoesCanal, cfgDoProduto, organicas: organicasVivas, hoje, sazonal, funilLoja, adsAtivo, proximaCampanha: campanha, parcial: vivo.parciais.get(r.id) || null, seteDias: vivo.seteDias?.get(r.id) || null });
      if (!g) continue;
      out.push({ r, grupo, canal, produto: { id: null, nome: `Anúncio: ${grupo.nome}`, sku: "" }, item: null, ehGrupo: true, g, est: g.est, regs });
    }
    return out.sort((a, b) => a.grupo.nome.localeCompare(b.grupo.nome));
  }, [rampasGrupo, grupos, canais, itens, produtos, kits, precos, publicacoesCanal, cfgDoProduto, registros, regras, organicasVivas, vivo.parciais, vivo.seteDias, hoje, calendario, funilLoja, adsHv.periodos, campanha, soNoGrupo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Comissão de afiliado por item × canal (ao vivo).
  const linhasAf = useMemo(
    () => linhasComissao({ itens, canais, precos, cfgDoProduto, config: af.config, linhasRampa: linhas }),
    [itens, canais, precos, cfgDoProduto, af.config, linhas]
  );
  const mapaAf = useMemo(() => new Map(linhasAf.map((l) => [l.chave, l])), [linhasAf]);
  const semanaAf = useMemo(
    () => resumoSemana({ afRegistros: af.registros, rampaRegistros: registros, rampas: [...rampas, ...rampasKit], mapaLinhas: mapaAf, linhasRampa: linhas, hoje }),
    [af.registros, registros, rampas, rampasKit, mapaAf, linhas, hoje]
  );

  // Ads (schema v44, lib/ads.js): uma linha por produto/kit × canal com preço
  // salvo — situação da semana (usar? aumentar? pausar?). Semanas: as da rampa
  // do produto ou, fora de rampa, os registros semanais do item (afiliado_registros
  // com vendas_total, que também guardam os itens só com Ads).
  const regrasA = useMemo(() => regrasAds(cfgLoja), [cfgLoja]);
  // "Ignorar teto de Ads" por anúncio (22/10/2026): a chave liga/desliga na
  // tela do Ads; ligado = decide como se o teto da loja não existisse.
  const [ignorarTeto] = usePreferencia("ads:ignorar-teto", {});
  const linhasAds = useMemo(() => {
    // Fora de rampa: os registros semanais gravados antes + as semanas
    // automáticas (pedidos, Desempenho, CSV do Ads) desde o 1º dia com pedidos.
    const semanasVivas = ({ chave, gravadas, canal, vendasEm, preco, periodos, funis }) => {
      const ini = inicioCobertura(canal);
      if (!ini) return gravadas;
      const { semanas } = semanasAutomaticas({ chave, gravados: gravadas, inicioMin: ini, hoje, vendasEm, cobre: (de, ate) => reais.cobertura.cobre(canal, de, ate), precoEm: () => preco, periodos, funis });
      return juntarRegistros(gravadas, semanas.filter((w) => w.tipo === "semana" && w.data > ini));
    };
    const semanasDe = (tipo, id, canalId, rampa, canal, preco, periodos, it) => {
      if (rampa) return registros.filter((g) => g.rampa_id === rampa.r.id && g.tipo === "semana");
      const gravadas = (af.registros || [])
        .filter((g) => g.item_tipo === tipo && g.item_id === id && g.canal_id === canalId && g.vendas_total != null)
        .map((g) => ({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas }));
      const ids = new Set(tipo === "produto" ? [`p:${id}`, ...itens.filter((i) => i.id.startsWith("v:") && i.produtoId === id).map((i) => i.id)] : [it.id]);
      return semanasVivas({ chave: `${tipo}|${id}|${canalId}`, gravadas, canal, vendasEm: vendasDeItens(canalId, ids), preco, periodos, funis: canal.tipo === "shopee" ? funisDoSku(it.sku) : [] });
    };
    const base = [];
    for (const it of itens) {
      const tipo = itemTipoDoId(it.id);
      if (tipo === "variacao") continue; // o Ads é por anúncio (produto pai ou kit)
      if (soNoGrupo.has(it.id)) continue; // entra pela linha do anúncio com vários itens
      const id = it.id.slice(2);
      for (const canal of canais) {
        if (canalDireto(canal)) continue; // venda direta: sem Ads
        const salvo = precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canal.id);
        if (!salvo || !(num(salvo.preco) > 0)) continue;
        const rampa = linhas.find((l) => (tipo === "produto" ? l.r.produto_id === id : tipo === "kit" && l.r.kit_id === id) && l.r.canal_id === canal.id) || null;
        const cfg = cfgDoProduto(tipo === "produto" ? id : null);
        const preco = rampa ? num(rampa.est.preco) : num(salvo.preco);
        const lucroEm = (p) => lucroNoPreco(canal, p, it.custoTotal, it.peso, cfg);
        // Produto "só na época de…": fase do Ads sazonal (Aquecer/Ajustar/Alavancar/Corte).
        const produto = tipo === "produto" ? produtos.find((p) => p.id === id) : null;
        const sazonal = produto ? faseAdsSazonal(infoSazonal(quandoVendeDe(produto), calendario, hoje), hoje, regrasA) : null;
        base.push({ chave: `${tipo}|${id}|${canal.id}`, item: it, tipo, id, canal, rampa, preco, lucroEm, lucro: lucroEm(preco), semanas: semanasDe(tipo, id, canal.id, rampa, canal, preco, periodosDoItem(adsHv.periodos, tipo, id, canal.id), it), periodos: periodosDoItem(adsHv.periodos, tipo, id, canal.id), sazonal, capacidadeDia: capacidadeDoItem(it, produtos, impressoras, farmConfig) });
      }
    }
    // Anúncio com vários itens = UMA linha de Ads (plano 14/10/2026). Equilíbrio
    // pelo mix de vendas das opções (sem vendas: a opção mais exigente). Os
    // períodos e semanas de Ads das opções que só existem no anúncio aparecem aqui.
    for (const grupo of grupos || []) {
      for (const canal of canais) {
        if (canalDireto(canal)) continue;
        const ops = opcoesNoCanal({ grupo, canal, itens, precos, cfgDoProduto });
        if (!ops.length) continue;
        const rampaG = linhasGrupo.find((l) => l.grupo.id === grupo.id && l.canal.id === canal.id) || null;
        const pct = rampaG ? rampaG.g.pctAtual : 100;
        const mix = mixDoGrupo({ grupo, organicas: organicasVivas, itens, hoje, ops });
        const eq = equilibrioDoGrupo({ ops, pct, mix, canal, itens, produtos, kits, publicacoes: publicacoesCanal });
        if (!eq) continue;
        const ticket100 = rampaG?.g.ticket100 || eq.preco;
        const opsSo = ops.filter((o) => soNoGrupo.has(o.itemId));
        const semanas = rampaG
          ? rampaG.regs.filter((g) => g.tipo === "semana").map((g) => ({ ...g, preco: g.preco != null ? (Number(g.preco) / 100) * ticket100 : null }))
          : semanasVivas({
              chave: `grupo|${grupo.id}|${canal.id}`,
              gravadas: (af.registros || []).filter((g) => g.item_tipo === "grupo" && g.item_id === grupo.id && g.canal_id === canal.id && g.vendas_total != null).map((g) => ({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas })),
              canal,
              vendasEm: vendasDoGrupo(canal.id, grupo.id),
              preco: eq.preco,
              periodos: (() => { const pa = periodosDoAnuncio(grupo.id, canal.id, opsSo.map((o) => o.itemId)); return [...pa.doAnuncio, ...pa.dasOpcoes]; })(),
              funis: canal.tipo === "shopee" ? funisDoGrupo(grupo.id, canal.id) : [],
            });
        // histórico de Ads das opções (antes do anúncio virar uma linha só)
        for (const o of opsSo) {
          const t = itemTipoDoId(o.itemId);
          for (const g of af.registros || [])
            if (g.item_tipo === t && g.item_id === o.itemId.slice(2) && g.canal_id === canal.id && g.vendas_total != null && Number(g.ads_gasto) > 0 && !semanas.some((x) => String(x.data).slice(0, 10) === String(g.data).slice(0, 10)))
              semanas.push({ ...g, vendas: g.vendas_total, vendasAfiliado: g.vendas });
        }
        semanas.sort((a, b) => String(a.data).localeCompare(String(b.data)));
        // Os do próprio anúncio vêm primeiro; das opções, o que mais gastou (o
        // anúncio com Ads de verdade) antes — o 1º ligado é o "período atual".
        const gastoDe = (p) => Number(p.parcial?.gasto) || 0;
        const paL = periodosDoAnuncio(grupo.id, canal.id, opsSo.map((o) => o.itemId));
        const periodos = [...paL.doAnuncio, ...paL.dasOpcoes.sort((a, b) => gastoDe(b) - gastoDe(a) || String(b.inicio).localeCompare(String(a.inicio)))];
        const caps = ops.map((o) => capacidadeDoItem(o.item, produtos, impressoras, farmConfig));
        const item = { id: idGrupo(grupo.id), nome: `Anúncio: ${grupo.nome}`, sku: "", grupo: true };
        base.push({
          chave: `grupo|${grupo.id}|${canal.id}`,
          item,
          tipo: "grupo",
          id: grupo.id,
          canal,
          grupo,
          ops,
          mix,
          pior: eq.pior,
          rampa: null,
          rampaGrupo: rampaG,
          preco: eq.preco,
          lucroEm: eq.lucroEm,
          lucro: eq.lucro,
          semanas,
          periodos,
          sazonal: rampaG?.est.sazonal ? faseAdsSazonal(rampaG.est.sazonal, hoje, regrasA) : null,
          capacidadeDia: caps.every((c) => c != null) ? Math.min(...caps) : null,
          semFaturamento: true, // vendas do anúncio já entram pelas vendas_organicas (grupo_id)
        });
      }
    }
    // Janela da loja (16/10/2026, "tudo ao vivo"): faturamento/lucro/unidades
    // (pedidos importados nos dias cobertos; fora deles, semanas registradas e
    // vendas orgânicas à mão) e Ads (andamento do CSV ou semanas, o maior) nos
    // últimos N dias. Mesma conta pro teto (30) e pro "Ads na semana" (7).
    const PRE = { produto: "p", variacao: "v", kit: "k" };
    // Quanto do orçamento/dia a Shopee está gastando (período ligado, pelo andamento).
    const usoDoOrcamento = (periodos) => {
      const at = periodoAtivo(periodos, hoje);
      const par = at?.parcial;
      const { orcamento } = at ? valoresAtuais(at) : {};
      if (!par?.ate || !(orcamento > 0)) return null;
      const dias = Math.round((new Date(`${par.ate}T12:00:00`) - new Date(`${at.inicio}T12:00:00`)) / 86400000) + 1 - pausasDoPeriodo(at, par.ate).diasPausados;
      return dias >= 3 ? num(par.gasto) / dias / orcamento : null;
    };
    const janela = (dias) => {
      const desde = somarDias(hoje, -dias);
      const de = somarDias(desde, 1);
      let fat = 0;
      let lucro = 0;
      let unidades = 0;
      let gasto = 0;
      let vendasAds = 0;
      let ate = null;
      const porItem = [];
      for (const b of base) {
        for (const s of b.semanas) {
          if (!(String(s.data).slice(0, 10) > desde)) continue;
          if (b.semFaturamento || reais.cobertura.cobre(b.canal, somarDias(String(s.data).slice(0, 10), -1))) continue;
          const p = num(s.preco) || b.preco;
          fat += num(s.vendas) * p;
          lucro += num(s.vendas) * (b.lucroEm(p) ?? 0);
          unidades += num(s.vendas);
        }
        const a = adsNaJanela(b.periodos, b.semanas, de, hoje);
        gasto += a.gasto;
        vendasAds += a.vendas;
        if (a.ate && (!ate || a.ate > ate)) ate = a.ate;
        if (a.gasto > 0) porItem.push({ chave: b.chave, nome: b.item.nome, canal: b.canal, ...a, retorno: (() => { const lr = economiaRealAds(b.periodos, hoje, { preco: b.preco, lucro: b.lucro }).lucroAds; return lr > 0 ? (a.vendas * lr) / a.gasto : null; })(), orcamentoUso: usoDoOrcamento(b.periodos) });
      }
      for (const o of organicasH.registros || []) {
        if (!(String(o.data).slice(0, 10) > desde)) continue;
        const it = itens.find((i) => i.id === `${PRE[o.item_tipo] || "p"}:${o.item_id}`);
        const canal = canais.find((c) => c.id === o.canal_id);
        if (!it || !canal || reais.cobertura.cobre(canal, String(o.data).slice(0, 10))) continue;
        const un = num(o.unidades);
        const p = num(o.preco);
        fat += un * p;
        unidades += un;
        lucro += un * (lucroNoPreco(canal, p, it.custoTotal, it.peso, cfgDoProduto(it.produtoId || (o.item_tipo === "produto" ? o.item_id : null))) ?? 0);
      }
      for (const p of reais.linhas) {
        if (!p.valido || !(String(p.data) > desde) || String(p.data) > hoje) continue;
        fat += p.pago;
        lucro += p.lucro ?? 0;
        unidades += num(p.q);
      }
      return { desde, de, fat, lucro, unidades, gasto, vendasAds, ate, porItem };
    };
    const j7 = janela(7);
    const j30 = janela(30);
    const desde30 = j30.desde;
    const fat30 = j30.fat;
    const lucro30 = j30.lucro;
    let gasto30 = j30.gasto;
    // GMV Max da Loja (v57, item_tipo 'loja'): linha fixa no topo da aba Ads.
    // Equilíbrio da loja = faturamento ÷ lucro antes do Ads dos pedidos dos
    // últimos 30 dias (sem pedidos: mediana do equilíbrio das linhas).
    const canalLoja = canais.find((c) => c.tipo === "shopee") || null;
    let lojaLinha = null;
    if (canalLoja && lojaId) {
      let fatP = 0;
      let lucP = 0;
      for (const p of reais.linhas) {
        if (!p.valido || p.origem === "fisico" || !(String(p.data) > desde30) || String(p.data) > hoje) continue;
        fatP += p.pago;
        lucP += p.lucro ?? 0;
      }
      let equilibrio = roasEmpate(fatP, lucP);
      let origemEq = "pedidos dos últimos 30 dias";
      if (!equilibrio) {
        const eqs = base.map((b) => roasEmpate(b.preco, b.lucro)).filter((x) => x != null).sort((a, b) => a - b);
        equilibrio = eqs.length ? eqs[Math.floor(eqs.length / 2)] : null;
        origemEq = "média dos produtos (sem pedidos importados)";
      }
      const periodosL = periodosDoItem(adsHv.periodos, "loja", lojaId, canalLoja.id);
      const aL30 = adsNaJanela(periodosL, [], j30.de, hoje);
      const aL7 = adsNaJanela(periodosL, [], j7.de, hoje);
      gasto30 += aL30.gasto;
      j7.gasto += aL7.gasto;
      j7.vendasAds += aL7.vendas;
      const recL = num(periodoAtivo(periodosL, hoje)?.parcial?.receita);
      const nomeL = "Loja inteira · GMV Max da Loja";
      if (aL30.gasto > 0) j30.porItem.push({ chave: `loja|${lojaId}|${canalLoja.id}`, nome: nomeL, canal: canalLoja, loja: true, ...aL30, retorno: equilibrio && recL > 0 && num(periodoAtivo(periodosL, hoje)?.parcial?.gasto) > 0 ? recL / num(periodoAtivo(periodosL, hoje).parcial.gasto) / equilibrio : null, orcamentoUso: null });
      lojaLinha = { chave: `loja|${lojaId}|${canalLoja.id}`, tipo: "loja", id: lojaId, canal: canalLoja, item: { id: `loja:${lojaId}`, nome: "Loja inteira · GMV Max da Loja" }, periodos: periodosL, semanas: [], equilibrio, origemEq, av: avaliarAdsLoja({ periodos: periodosL, equilibrio, hoje, regras: regrasA }) };
    }
    const teto = { ...tetoDaLoja({ faturamento: fat30, lucro: lucro30, gasto: gasto30, regras: regrasA }), porItem: j30.porItem.sort((a, b) => b.gasto - a.gasto), ate: j30.porItem.reduce((m, x) => (x.ate && x.ate > m ? x.ate : m), "") || null };
    // "Ads na semana" e "Vendas via Ads" (7 dias, ao vivo): mesma conta do teto.
    // Vendas via Ads (CSV) ÷ unidades vendidas nos MESMOS dias (o CSV costuma ir só até ontem/anteontem).
    const ateAds = j7.porItem.reduce((m, x) => (x.ate && x.ate > m ? x.ate : m), "") || hoje;
    let unidAte = 0;
    for (const p of reais.linhas) if (p.valido && String(p.data) > j7.desde && String(p.data) <= ateAds) unidAte += num(p.q);
    const unidades7 = reais.linhas.some((p) => p.valido && String(p.data) > j7.desde) ? unidAte : j7.unidades;
    const loja = {
      gasto: Math.round(j7.gasto * 100) / 100,
      faturamento: j7.fat,
      pct: j7.fat > 0 ? j7.gasto / j7.fat : null,
      vendasAds: j7.vendasAds,
      vendas: unidades7,
      pctVendasAds: unidades7 > 0 ? Math.min(1, j7.vendasAds / unidades7) : null,
      dependente: unidades7 > 0 && j7.vendasAds / unidades7 > 0.5,
      ate: j7.porItem.reduce((m, x) => (x.ate && x.ate > m ? x.ate : m), "") || null,
      fonte: j7.porItem.some((x) => x.fonte === "csv") ? "csv" : j7.porItem.length ? "semanas" : null,
    };
    // Preço e lucro REAIS por venda (média dos pedidos pagos do período de Ads)
    // pras contas do Ads — mesma conta do Resumo; sem pedidos suficientes, os de hoje.
    const linhasA = base.map((b) => ({ ...b, ...economiaRealAds(b.periodos, hoje, { preco: b.preco, lucro: b.lucro }) })).map((b) => ({
      ...b,
      av: avaliarAds({ preco: b.precoAds, lucro: b.lucroAds, lucroEm: b.lucroEm, semanas: b.semanas, periodos: b.periodos, anuncio: (b.rampa || b.rampaGrupo)?.est.anuncio || null, hoje, regras: regrasA, tetoLoja: ignorarTeto?.[b.chave] ? null : teto, sazonal: b.sazonal, capacidadeDia: b.capacidadeDia }),
      tetoIgnorado: !!ignorarTeto?.[b.chave],
    }));
    // Lembretes de virada de fase do Ads sazonal (Início): na 1ª semana de cada fase.
    const sazonal = [];
    for (const l of linhasA) {
      const z = l.sazonal;
      if (!z || !z.inicio || !["aquecer", "ajustar", "alavancar", "corte"].includes(z.fase)) continue;
      const d = (new Date(`${hoje}T12:00:00`) - new Date(`${z.inicio}T12:00:00`)) / 86400000;
      if (d < 0 || d > 6) continue;
      const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
      sazonal.push({
        chave: l.chave,
        item: l.item,
        canal: l.canal,
        aviso: { id: z.fase, grupo: z.fase === "aquecer" ? "oportunidade" : "rotina", titulo: `Ads ${z.nome} — ${z.titulo}`, texto: `${z.texto}${z.fim ? ` (até ${dm(z.fim)})` : ""}` },
      });
    }
    // "Não usar Ads por enquanto": vai pra Sem Ads e sai de Oportunidade/Início.
    for (const l of linhasA) {
      const lb = (lembretesH.lembretes || []).find((x) => x.chave === `ads-nao|${l.chave}`);
      if (lb && !l.av.ativo) l.semAds = { desde: lb.adiado_ate || null };
    }
    // GMV Max da Loja — quebra por produto do arquivo próprio (só informação +
    // avisos "gasta sem vender" / "vale um Ads próprio?"). ID do item → SKU pelos
    // Desempenhos guardados.
    if (lojaLinha) {
      const imp = [...(reais.importacoes || [])].filter((i) => i.ok && i.relatorio === "shopee:gmv" && i.dados?.janelas).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))[0];
      const janelas = imp?.dados?.janelas || [];
      if (janelas.length) {
        const skuDoId = new Map();
        for (const d of desempenhos) for (const it of d.r?.itens || []) if (it.itemId && it.sku) skuDoId.set(String(it.itemId), normSku(it.sku));
        const ativoL = lojaLinha.av?.ativo || null;
        const doPer = ativoL ? janelasDoPeriodo(janelas, ativoL) : janelas;
        const ligar = (id) => {
          const sku = skuDoId.get(String(id));
          if (!sku) return null;
          const l = linhasA.find((x) => x.canal?.id === canalLoja.id && x.tipo !== "grupo" && normSku(x.item?.sku) === sku);
          return l ? { chave: l.chave, nome: l.item.nome, equilibrio: roasEmpate(l.preco, l.lucro), temAdsProprio: !!l.av?.ativo } : null;
        };
        lojaLinha.gmv = {
          janelas: doPer,
          furos: furosDasJanelas(doPer, ativoL?.inicio || null),
          produtos: produtosDaGmv(doPer, { hoje, ligar }),
          ate: doPer.reduce((m, j) => (j.ate > m ? j.ate : m), "") || null,
        };
      }
    }
    return { loja, teto, sazonal, linhas: linhasA, lojaLinha, lembretesOk: lembretesH.disponivel };
  }, [lembretesH, lojaId, itens, canais, precos, produtos, kits, linhas, linhasGrupo, grupos, soNoGrupo, cfgDoProduto, registros, af.registros, adsHv.periodos, regrasA, hoje, calendario, organicasH.registros, publicacoesCanal, impressoras, farmConfig, reais.linhas, reais.cobertura, reais.importacoes, inicioCobertura, pedidosPorCanal, skuGrupo, desempenhos, ignorarTeto]); // eslint-disable-line react-hooks/exhaustive-deps

  const pedidosValidos = reais.linhas;
  return useMemo(
    () => ({ dados, rampasH: rampasHV, af, regras, hoje, funilLoja, calendario, linhas, linhasGrupo, soNoGrupo, linhasAf, mapaAf, semanaAf, adsH: adsHv, regrasA, linhasAds, organicasH, organicasVivas, avalH, anuncioDoPedido, pedidosValidos, desempenhos, desempenhoDoAnuncio }),
    // anuncioDoPedido muda junto com skuGrupo (mesma render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dados, rampasHV, af, regras, hoje, funilLoja, calendario, linhas, linhasGrupo, soNoGrupo, linhasAf, mapaAf, semanaAf, adsHv, regrasA, linhasAds, organicasH, organicasVivas, avalH, skuGrupo, pedidosValidos, desempenhos]
  );
}
