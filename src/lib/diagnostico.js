// Diagnóstico comercial por ANÚNCIO (24/10/2026, aprovado com o Gustavo —
// docs/decisoes-pendentes.md). Vale pra TODOS os anúncios (não só os em rampa).
// SÓ LÊ o que as outras contas já decidem — lucro de agora (useEscada), Ads
// (avaliarAds/numerosDoPeriodo), vendas reais (pedidos) — e o relatório de
// Desempenho da Shopee (impressão → clique → carrinho → pagamento). As regras
// de decisão de preço, rampa e Ads continuam nas abas delas; aqui só vira
// diagnóstico com evidência, ação, quando reavaliar e o que acompanhar.
//
// Cada diagnóstico: { chave, tipo: "problema"|"hipotese"|"oportunidade"|"insuficiente",
//   estado: resolver|atencao|oportunidade|info, titulo, evidencia: [..], impacto,
//   acao, como: [..], ir: { aba, pedido }, rotulo, reavaliar, sucesso }
import { lucroMinimoAceitavel } from "./escada.js";

const num = (v) => Number(v) || 0;
const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`;
const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const dias = (de, ate) => Math.max(1, Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 864e5) + 1);

// Referências fixas (Shopee) quando a loja ainda não tem 5 anúncios com dados.
export const REGRAS_DIAG = {
  impMin: 300, // impressões no período pra opinar sobre a vitrine
  visitMin: 50, // visitantes pra opinar sobre a página
  carrinhoMin: 15, // visitantes que puseram no carrinho pra opinar sobre o pagamento
  ctrRef: 0.02, // CTR de referência (o mesmo funilCtrMin da Rampa)
  carrinhoRef: 0.08, // visitantes → carrinho
  pagamentoRef: 0.15, // carrinho → pagou
  convBoa: 0.03, // pedidos ÷ visitantes pra "converte bem"
  pouco7: 2000, // impressões por 7 dias abaixo disso = pouca exposição
  volumeMin: 10, // vendas em 30 dias pra "vende muito"
  sazonalCresce: 1.5, // vendas 7 dias ≥ 1,5× os 7 antes
  variacaoParte: 0.5, // uma opção com ≥ 50% dos carrinhos
  variacaoMin: 10,
};

const mediana = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Taxas do funil a partir da linha do Desempenho (null quando a coluna não veio). */
export function taxasDoFunil(it) {
  if (!it) return null;
  const imp = it.impressoes;
  const cli = it.cliques;
  const vis = it.visitantes ?? cli;
  const car = it.carrinho;
  const ped = it.pedidos;
  return {
    impressoes: imp,
    cliques: cli,
    visitantes: vis,
    carrinho: car,
    pedidos: ped,
    compradores: it.compradores ?? null,
    ctr: imp ? num(cli) / imp : null,
    taxaCarrinho: vis && car != null ? car / vis : null,
    taxaPagamento: car ? num(ped) / car : null,
    conversao: vis ? num(ped) / vis : null,
    rejeicao: vis && it.sairam != null ? it.sairam / vis : null,
    busca: cli && it.cliquesBusca != null ? it.cliquesBusca / cli : null,
    recompra: it.recompra ?? null,
  };
}

/** Mediana da loja (≥ 5 anúncios com dados) → referências relativas; senão as fixas. */
export function referenciaDaLoja(funis, R = REGRAS_DIAG) {
  const ok = (funis || []).filter((f) => f && f.impressoes >= R.impMin);
  if (ok.length < 5) return { ctr: R.ctrRef, carrinho: R.carrinhoRef, pagamento: R.pagamentoRef, conversao: null, origem: "referência geral" };
  const m = (k) => mediana(ok.map((f) => f[k]));
  return {
    ctr: Math.min(R.ctrRef, (m("ctr") ?? R.ctrRef * 2) * 0.5),
    carrinho: Math.min(R.carrinhoRef, (m("taxaCarrinho") ?? R.carrinhoRef * 2) * 0.5),
    pagamento: Math.min(R.pagamentoRef, (m("taxaPagamento") ?? R.pagamentoRef * 2) * 0.5),
    conversao: m("conversao"),
    origem: `metade da média da loja (${ok.length} anúncios)`,
  };
}

const ORDEM = { resolver: 0, atencao: 1, oportunidade: 2, info: 3 };

/**
 * l = linha de montarAnuncios; d = { de, ate, item } (Desempenho mais recente);
 * ref = referenciaDaLoja; cfg = cfgDoProduto; sazonal = infoSazonal; v7 / v7antes = vendas.
 * → lista ordenada (o 1º é o principal).
 */
export function diagnosticoDoAnuncio({ l, d, ref, cfg, sazonal = null, v7 = 0, v7antes = 0, R = REGRAS_DIAG }) {
  const out = [];
  const shopee = l.canal?.tipo === "shopee";
  const lucro = l.agora?.lucro ?? l.ads?.lucro ?? null;
  const preco = l.agora?.preco ?? l.ads?.preco ?? null;
  const vendas30 = num(l.vendas?.unidades);
  const irAnuncio = { aba: "anuncio", pedido: { itemId: l.itemId, canalId: l.canal?.id, aba: "anuncio" } };
  const irPreco = { aba: "anuncio", pedido: { itemId: l.itemId, canalId: l.canal?.id, aba: "preco" } };
  const irAds = { aba: "anuncio", pedido: { itemId: l.itemId, canalId: l.canal?.id, aba: "ads" } };
  const f = d ? taxasDoFunil(d.item) : null;
  const per = d ? `Desempenho ${dm(d.de)}–${dm(d.ate)}` : null;
  const nDias = d ? dias(d.de, d.ate) : 7;
  const ganho = (pedidosAMais) => (lucro != null && lucro > 0 && Math.round(pedidosAMais) >= 1 ? `≈ ${Math.round(pedidosAMais)} venda${Math.round(pedidosAMais) === 1 ? "" : "s"} a mais no mesmo período (${brl(pedidosAMais * lucro)} de lucro) — estimativa, não garantia` : null);

  // ---- Funil (só Shopee, com Desempenho) ----
  if (shopee && f) {
    const imp7 = num(f.impressoes) * (7 / nDias);
    if (num(f.impressoes) < R.impMin && !vendas30) {
      out.push({
        chave: "poucos-dados",
        tipo: "insuficiente",
        estado: "info",
        titulo: "Poucos dados pra concluir",
        evidencia: [`${num(f.impressoes)} impressões e ${num(f.cliques)} cliques (${per})`, "nenhuma venda em 30 dias"],
        impacto: "Com tão pouca exposição, qualquer conclusão sobre o anúncio seria chute.",
        acao: "Acompanhe; só mexa se houver problema objetivo (foto ruim, preço fora, variação confusa).",
        como: ["Confira se o anúncio aparece na busca pelo nome principal", "Confira a foto de capa e o preço frente aos concorrentes"],
        ir: irAnuncio,
        rotulo: "Abrir o anúncio",
        reavaliar: `quando passar de ${R.impMin} impressões`,
        sucesso: "impressões e cliques subindo",
      });
    } else {
      // Vitrine: aparece e pouca gente clica.
      if (num(f.impressoes) >= R.impMin && f.ctr != null && f.ctr < ref.ctr) {
        const extra = f.conversao != null ? num(f.impressoes) * (ref.ctr - f.ctr) * f.conversao : 0;
        out.push({
          chave: "vitrine",
          tipo: "problema",
          estado: "atencao",
          titulo: "Aparece, mas pouca gente clica",
          evidencia: [`${num(f.impressoes).toLocaleString("pt-BR")} impressões → ${num(f.cliques)} cliques (CTR ${pct(f.ctr)})`, `referência: ${pct(ref.ctr)} (${ref.origem})`, per],
          impacto: ganho(extra) || "Cada impressão sem clique é exposição perdida.",
          acao: "Revise a vitrine: foto de capa, título e o preço que aparece na busca.",
          como: ["Foto de capa limpa, produto grande, fundo claro", "Título com as palavras que o cliente busca", "Compare o preço exibido com os 3 concorrentes mais próximos"],
          ir: irAnuncio,
          rotulo: "Abrir o anúncio",
          reavaliar: "7 dias depois de trocar a capa/título (com ≥ 300 impressões novas)",
          sucesso: "CTR acima da referência",
        });
      }
      // Página: clica e não põe no carrinho.
      if (num(f.visitantes) >= R.visitMin && f.taxaCarrinho != null && f.taxaCarrinho < ref.carrinho) {
        const extra = f.taxaPagamento != null ? num(f.visitantes) * (ref.carrinho - f.taxaCarrinho) * f.taxaPagamento : 0;
        out.push({
          chave: "pagina",
          tipo: "problema",
          estado: "atencao",
          titulo: "Muitos cliques e pouca gente põe no carrinho",
          evidencia: [`${num(f.visitantes)} visitantes → ${num(f.carrinho)} no carrinho (${pct(f.taxaCarrinho)})`, `referência: ${pct(ref.carrinho)} (${ref.origem})`, ...(f.rejeicao != null ? [`${pct(f.rejeicao)} saíram da página`] : []), per],
          impacto: ganho(extra) || "O anúncio atrai, mas a página não convence.",
          acao: "Revise a página: fotos secundárias, medidas e se as variações estão claras.",
          como: ["Foto com o produto em uso e com medida (régua/mão)", "Descrição com medidas, material e o que vem no pacote", "Nome das variações claro (cor, quantidade)", "Compare a proposta com o concorrente (preço por peça, kit)"],
          ir: irAnuncio,
          rotulo: "Abrir o anúncio",
          reavaliar: "7 dias depois da mudança (com ≥ 50 visitantes novos)",
          sucesso: "taxa de carrinho acima da referência",
        });
      }
      // Pagamento: põe no carrinho e não paga (hipótese — carrinho sem compra no
      // mesmo período não é abandono confirmado).
      if (num(f.carrinho) >= R.carrinhoMin && f.taxaPagamento != null && f.taxaPagamento < ref.pagamento) {
        const extra = num(f.carrinho) * (ref.pagamento - f.taxaPagamento);
        out.push({
          chave: "pagamento",
          tipo: "hipotese",
          estado: "atencao",
          titulo: "Põem no carrinho e pouca gente paga",
          evidencia: [`${num(f.carrinho)} foram ao carrinho → ${num(f.pedidos)} ${num(f.pedidos) === 1 ? "pagou" : "pagaram"} (${pct(f.taxaPagamento)})`, `referência: ${pct(ref.pagamento)} (${ref.origem})`, per],
          impacto: ganho(extra) || "O cliente quer, mas desiste no fim.",
          acao: "Investigue o fim da compra: frete, prazo, preço final e cupom.",
          como: ["Simule a compra como cliente (frete e prazo pro seu CEP e pra outro estado)", "Confira se o preço final passa do frete grátis (R$ 10 na Shopee)", "Veja se há cupom da loja ativo e se o concorrente tem frete mais barato", "Responda as perguntas do anúncio"],
          ir: irAnuncio,
          rotulo: "Abrir o anúncio",
          reavaliar: "7 dias depois (com ≥ 15 carrinhos novos)",
          sucesso: "taxa de pagamento acima da referência",
          nota: "Carrinho sem compra no mesmo período não é abandono confirmado — o cliente pode comprar depois.",
        });
      }
      // Boa conversão e pouco tráfego.
      if (num(f.visitantes) >= 20 && num(f.pedidos) >= 2 && f.conversao != null && f.conversao >= Math.max(R.convBoa, (ref.conversao || 0) * 2) && imp7 < R.pouco7) {
        out.push({
          chave: "pouco-trafego",
          tipo: "oportunidade",
          estado: "oportunidade",
          titulo: "Converte bem, mas aparece pouco",
          evidencia: [`${pct(f.conversao)} dos visitantes compram`, `só ~${Math.round(imp7).toLocaleString("pt-BR")} impressões por semana`, per],
          impacto: lucro != null ? `Cada venda deixa ${brl(lucro)} — mais exposição tende a virar venda.` : "Mais exposição tende a virar venda.",
          acao: "Amplie a exposição: título com mais palavras de busca, campanhas da plataforma e, se houver margem, um teste controlado de Ads.",
          como: ["Inclua no título as palavras que o cliente usa", "Participe das campanhas da Shopee se o preço couber", "Ads: comece pequeno (R$ 10/dia) e confira o ROAS de equilíbrio"],
          ir: irAds,
          rotulo: "Ver Ads do anúncio",
          reavaliar: "7 dias",
          sucesso: "impressões e vendas subindo com o lucro mantido",
        });
      }
    }
    // Variação preferida (carrinhos por variação do Desempenho).
    const vs = (d.item.variacoes || []).filter((v) => v.carrinho != null);
    const totCar = vs.reduce((t, v) => t + num(v.carrinho), 0);
    if (vs.length >= 2 && totCar >= R.variacaoMin) {
      const top = [...vs].sort((a, b) => num(b.carrinho) - num(a.carrinho))[0];
      const parte = num(top.carrinho) / totCar;
      if (parte >= R.variacaoParte)
        out.push({
          chave: "variacao",
          tipo: "oportunidade",
          estado: "info",
          titulo: `"${String(top.nome).replace(",", " · ")}" é a preferida`,
          evidencia: [`${pct(parte)} dos carrinhos (${num(top.carrinho)} de ${totCar})`, per],
          impacto: "Destacar o que o cliente já escolhe facilita a decisão.",
          acao: "Use essa opção na foto de capa, planeje a produção dela e confira a margem dela.",
          como: ["Capa mostrando essa variação", "Tenha peças prontas dela (Análise → Curva XYZ)", "Confira o lucro dela em Preços salvos"],
          ir: irPreco,
          rotulo: "Ver preço",
          reavaliar: "no próximo Desempenho",
          sucesso: "carrinho e vendas da variação",
        });
    }
  } else if (shopee && !d) {
    out.push({
      chave: "sem-desempenho",
      tipo: "insuficiente",
      estado: "info",
      titulo: "Sem o Desempenho deste anúncio",
      evidencia: ["nenhum relatório de Desempenho da Shopee com o SKU dele"],
      impacto: "Sem impressões, cliques e carrinho não dá pra dizer onde o cliente desiste.",
      acao: "Envie o Desempenho do produto em Atualizar dados (confira se o SKU principal na Shopee é o mesmo do app).",
      como: ["Shopee → Dados → Produto → Performance do produto → Exportar"],
      ir: { aba: "importar" },
      rotulo: "Atualizar dados",
      reavaliar: "depois do envio",
      sucesso: "funil aparecendo aqui",
    });
  }

  // ---- Ads: ROAS acima do equilíbrio, mas lucro depois do Ads abaixo do mínimo ----
  const n = l.adsNum;
  if (n && n.roas != null && n.vendas > 0 && lucro != null && preco) {
    const eq = l.ads?.av?.empate ?? null;
    const porVenda = n.gasto / n.vendas;
    const sobra = lucro - porVenda;
    const min = lucroMinimoAceitavel(preco, cfg);
    if (eq != null && n.roas >= eq && sobra < min)
      out.push({
        chave: "roas-lucro",
        tipo: "problema",
        estado: "atencao",
        titulo: "Ads se paga, mas o lucro que sobra é pouco",
        evidencia: [`ROAS ${n.roas.toFixed(1).replace(".", ",")} (equilíbrio ${eq.toFixed(1).replace(".", ",")})`, `lucro ${brl(lucro)} − Ads ${brl(porVenda)} por venda = ${brl(sobra)}`, `mínimo aceitável: ${brl(min)}`],
        impacto: "Faturamento sobe, mas cada venda via Ads deixa menos que o seu mínimo.",
        acao: "Priorize o lucro: suba a meta de ROAS ou revise preço, custo e descontos acumulados.",
        como: ["Ads: suba a meta de ROAS (a Shopee entrega com custo por venda menor)", "Confira se promo + cupom não estão somando demais", "Revise o custo (filamento, embalagem)"],
        ir: irAds,
        rotulo: "Ver Ads do anúncio",
        reavaliar: "7 dias depois do ajuste",
        sucesso: `lucro depois do Ads ≥ ${brl(min)} por venda`,
      });
  }

  // ---- Vende muito e lucra pouco ----
  if (vendas30 >= R.volumeMin && lucro != null && preco && cfg) {
    const marg = lucro / preco;
    if (marg < num(cfg.margemDesejada) && lucro >= 0)
      out.push({
        chave: "volume-pouco-lucro",
        tipo: "problema",
        estado: "atencao",
        titulo: "Vende bastante, mas lucra pouco por venda",
        evidencia: [`${vendas30} vendas em 30 dias`, `margem ${pct(marg)} no preço de agora (desejada ${pct(num(cfg.margemDesejada))})`],
        impacto: `Subir R$ 1 de lucro por venda daria ≈ ${brl(vendas30)} a mais por mês nesse ritmo.`,
        acao: "Revise custo e preço, e ofereça kit pra subir o valor do pedido.",
        como: ["Confira o custo (filamento mais barato? Estoque e compras → Materiais)", "Veja se o preço salvo ainda está certo (Preços salvos)", "Kit 2/kit 3 no 2º Por quantidade"],
        ir: irPreco,
        rotulo: "Ver preço",
        reavaliar: "30 dias",
        sucesso: "margem perto da desejada com as vendas mantidas",
      });
  }

  // ---- Sazonal em crescimento ----
  if (sazonal && (sazonal.fase === "subindo" || sazonal.fase === "pico") && v7 >= 3 && v7 >= v7antes * R.sazonalCresce)
    out.push({
      chave: "sazonal",
      tipo: "oportunidade",
      estado: "oportunidade",
      titulo: `Temporada esquentando (${sazonal.nome || "época"})`,
      evidencia: [`${v7} vendas nos últimos 7 dias (antes ${v7antes})`, `data: ${dm(sazonal.evento)} · data-limite ${dm(sazonal.limite)}`],
      impacto: "É a janela de vender mais — falta de peça pronta perde venda.",
      acao: "Garanta produção e estoque, revise o orçamento de Ads pela margem e planeje reduzir depois da data.",
      como: ["Análise → Curva XYZ: estoque sugerido", "Ads: escada de aumento (só com retorno ≥ 1,2×)", "Anote a data de reduzir a exposição"],
      ir: irAds,
      rotulo: "Ver Ads do anúncio",
      reavaliar: "toda semana até a data",
      sucesso: "vendas subindo sem faltar peça",
    });

  return out.sort((a, b) => (ORDEM[a.estado] ?? 9) - (ORDEM[b.estado] ?? 9));
}
