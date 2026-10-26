// Testes das contas principais do app (24/10/2026, pedido do Gustavo: "é
// sempre bom garantir a funcionalidade das coisas"). Rodam com `npm test`
// antes de cada envio. Casos reais anotados no CLAUDE.md.
import { describe, expect, it } from "vitest";
import { resultadoNoPreco, resolverTaxasNoPreco } from "../src/lib/calc.js";
import { calcularAnuncio, calcularEscada, configEscada, lucroNoPreco, precoPorMarkup, r5090perto, r90perto, r90up } from "../src/lib/escada.js";
import { anuncioNoRiscado } from "../src/lib/rampaAnuncio.js";
import { quebraLucro } from "../src/lib/precoAgora.js";
import { degrauAnterior, passoDaEscada, tetoPorFaixas } from "../src/lib/ads.js";
import { BACKUP_DIAS, TABELAS_BACKUP, estadoBackup } from "../src/lib/backup.js";
import { revisoesPrecoDireto } from "../src/lib/revisarPreco.js";
import { ateDoEnvioPedidos } from "../src/lib/pedidos.js";
import { custoDosItens, custoMedioRevenda, estoqueDoProduto, lerNfe, limiteMei, situacaoEstoque, vendasPorProduto } from "../src/lib/revenda.js";

const semCusto = { custoProduto: 0, frete: 0, embalagem: 0 };
const perto = (v, alvo) => expect(Math.round(v * 100) / 100).toBe(alvo);

describe("taxas dos marketplaces", () => {
  it("TikTok: 1º pedido real de R$ 17,90 recebe R$ 11,04 (10% + SFP 6% + R$ 4)", () => {
    const r = resultadoNoPreco({ tipo: "tiktok" }, semCusto, 17.9);
    perto(r.lucro, 11.04);
  });
  it("Shopee até R$ 79,99: 20% + R$ 4,50", () => {
    perto(resultadoNoPreco({ tipo: "shopee" }, semCusto, 50).lucro, 35.5);
  });
  it("Shopee abaixo de R$ 9: o fixo é no máximo metade do preço", () => {
    const t = resolverTaxasNoPreco("shopee", 8);
    perto(t.taxaFixa, 4);
    perto(resultadoNoPreco({ tipo: "shopee" }, semCusto, 8).lucro, 2.4);
  });
  it("Shopee R$ 80–99,99: 14% + R$ 16 · R$ 100–199,99: 14% + R$ 20", () => {
    perto(resultadoNoPreco({ tipo: "shopee" }, semCusto, 90).lucro, 61.4);
    perto(resultadoNoPreco({ tipo: "shopee" }, semCusto, 100).lucro, 66);
  });
  it("Shein: 18% sem fixo", () => {
    perto(resultadoNoPreco({ tipo: "shein" }, semCusto, 100).lucro, 82);
  });
  it("Mercado Livre: sem taxa fixa, mas cobra o custo dos Envios", () => {
    const t = resolverTaxasNoPreco("ml", 50, undefined, "classico", 300);
    expect(t.taxaFixa).toBeGreaterThan(0);
  });
  it("o custo sai do lucro", () => {
    const r = resultadoNoPreco({ tipo: "shopee" }, { custoProduto: 3, frete: 0, embalagem: 1 }, 50);
    perto(r.lucro, 31.5);
  });
});

describe("recebe − repor = lucro", () => {
  it("recebe = lucro + custo", () => {
    const q = quebraLucro(50, 31.5, 4);
    perto(q.recebe, 35.5);
    perto(q.repor, 4);
  });
});

describe("anúncio (preço original e promo)", () => {
  it("R$ 11,90 com 30% → original R$ 17,00, promo 30%", () => {
    const a = calcularAnuncio(11.9, 0.3);
    perto(a.original, 17);
    expect(a.promo).toBe(30);
    perto(a.clientePaga, 11.9);
  });
  it("riscado fixo: só a promo muda", () => {
    const a = anuncioNoRiscado(12, 17);
    expect(a.promo).toBe(29);
    expect(a.clientePaga).toBeGreaterThanOrEqual(12);
  });
  it("preço acima do riscado nunca troca o riscado sozinho", () => {
    const a = anuncioNoRiscado(18, 17);
    expect(a.acimaDoRiscado).toBe(true);
    perto(a.original, 17);
  });
});

describe("arredondamentos", () => {
  it(",90 mais próximo e pra cima", () => {
    perto(r90perto(10.3), 9.9);
    perto(r90up(10.3), 10.9);
  });
  it("venda direta: ,50 ou ,90 mais próximo", () => {
    perto(r5090perto(7.62), 7.5);
    perto(r5090perto(7.75), 7.9);
    perto(r5090perto(14.6), 14.5);
  });
  it("markup: custo 3 × 2,5 = 7,50; custo 1,50 × 2,5 = 3,90", () => {
    perto(precoPorMarkup(3, 2.5), 7.5);
    perto(precoPorMarkup(1.5, 2.5), 3.9);
  });
});

describe("escada de kits (curva de desconto)", () => {
  const canal = { tipo: "shopee" };
  const cfg = configEscada({ descontoMax: 0.3, margemMin: 0, lucroMinimo: 0 });
  const esc = calcularEscada({
    canal,
    p1: 10.3,
    base1: { custo: 2, peso: 100 },
    kits: [2, 3, 4].map((n) => ({ n, custo: 2 * n, peso: 100 * n })),
    cfg,
  });
  const preco = (n) => esc.linhas.find((l) => l.n === n)?.sugerido;
  it("Shopee, avulso 10,30, 30% → kit 2 17,90 · kit 3 24,90 · kit 4 31,90", () => {
    perto(preco(2), 17.9);
    perto(preco(3), 24.9);
    perto(preco(4), 31.9);
  });
  it("o lucro do kit sempre sobe com a quantidade", () => {
    const lucros = [1, 2, 3, 4].map((n) => esc.linhas.find((l) => l.n === n).lucro);
    for (let i = 1; i < lucros.length; i++) expect(lucros[i]).toBeGreaterThan(lucros[i - 1]);
  });
  it("o preço por peça cai", () => {
    expect(preco(2) / 2).toBeLessThan(10.3);
    expect(preco(3) / 3).toBeLessThan(preco(2) / 2);
  });
  it("lucroNoPreco bate com a conta das taxas", () => {
    perto(lucroNoPreco(canal, 50, 0, 0, cfg), 35.5);
  });
});

describe("Ads", () => {
  it("escada do aumento: < 1,2× mantém · 1,2–2× +20% · ≥ 2× +30%", () => {
    expect(passoDaEscada(0.9)).toBe(0);
    expect(passoDaEscada(1.1)).toBe(0);
    expect(passoDaEscada(1.5)).toBe(0.2);
    expect(passoDaEscada(2.5)).toBe(0.3);
  });
  it("descer por nível: volta pro orçamento anterior, nunca abaixo de R$ 10", () => {
    expect(degrauAnterior({ orcamento_diario: 10, ajustes: [{ orcamento: 12 }] }, 12)).toBe(10);
    expect(degrauAnterior({ orcamento_diario: 20, ajustes: [] }, 20)).toBe(16);
    expect(degrauAnterior({ orcamento_diario: 11, ajustes: [] }, 11)).toBe(10);
  });
  it("teto da loja: R$ 150 fixo até 1 mil; acima, 12% só no pedaço", () => {
    expect(tetoPorFaixas(500)).toBe(150);
    expect(tetoPorFaixas(2000)).toBe(270);
  });
});

describe("backup", () => {
  it("lista todas as tabelas de dado e nenhuma apagada", () => {
    for (const t of ["pedidos_itens", "rampas_preco", "ads_periodos", "lives", "consultor_registros", "preferencias_loja"]) expect(TABELAS_BACKUP).toContain(t);
    for (const t of ["produtos", "kanban_cards", "publicacoes_olist"]) expect(TABELAS_BACKUP).not.toContain(t);
  });
  it(`lembra a cada ${BACKUP_DIAS} dias`, () => {
    expect(estadoBackup(null, "2026-10-24").vencido).toBe(true);
    expect(estadoBackup({ data: "2026-10-20" }, "2026-10-24").vencido).toBe(false);
    expect(estadoBackup({ data: "2026-10-09" }, "2026-10-24").vencido).toBe(true);
  });
});

describe("relatórios do consultor", async () => {
  const { semanaPassada, relatoriosDevidos, produtosParados, relatorioFechamento } = await import("../src/lib/relatorios.js");
  it("semana passada = segunda a domingo completos", () => {
    expect(semanaPassada("2026-10-24")).toBe("2026-10-12"); // sábado → semana de 12 a 18
    expect(semanaPassada("2026-10-26")).toBe("2026-10-19"); // segunda → a semana que acabou ontem
  });
  it("oferece fechamento/Ads do mês que fechou e a reunião da semana até gerar", () => {
    expect(relatoriosDevidos({}, "2026-11-01").map((d) => d.k)).toEqual(["fechamento", "ads", "semana"]);
    expect(relatoriosDevidos({ fechamento: "2026-10", ads: "2026-10", semana: "2026-10-19" }, "2026-11-01")).toEqual([]);
  });
  it("produto parado: tem preço salvo e não vende há 30 dias", () => {
    const pedidos = [{ valido: true, item: { id: "p:a" }, data: "2026-10-20", q: 1, pago: 10 }, { valido: true, item: { id: "p:b" }, data: "2026-08-01", q: 1, pago: 10 }];
    const precos = ["a", "b", "c"].map((id) => ({ item_tipo: "produto", item_id: id, preco: 10 }));
    const lista = produtosParados({ pedidos, produtos: [{ id: "a", nome: "A" }, { id: "b", nome: "B" }, { id: "c", nome: "C" }], precos, hoje: "2026-10-24" });
    expect(lista.map((x) => x.nome).sort()).toEqual(["B", "C"]);
  });
  it("fechamento: lucro líquido = lucro − Ads − contas fixas", () => {
    const pedidos = [{ valido: true, pedido: "1", item: { id: "p:a" }, data: "2026-09-10", q: 1, pago: 100, lucro: 40, recebe: 70, custo: 30 }];
    const lancamentos = [{ recorrencia: "mensal", tipo: "saida", categoria: "aluguel", valor: 15, data_prevista: "2026-01-05" }];
    const r = relatorioFechamento({ pedidos, linhasAds: null, lancamentos, hoje: "2026-10-24", nomeDe: () => "A" }, "2026-09");
    const kpi = (rot) => r.blocos[0].itens.find((i) => i.rotulo === rot).valor.replace(/\s/g, " ");
    expect(kpi("Lucro líquido")).toBe("R$ 25,00");
  });
});

describe("Vale revisar o preço? (Orgânico)", () => {
  // Caso real 24/10/2026: kit cadastrado só no Orgânico, salvo hoje com a
  // embalagem do Orgânico (R$ 6,00); o custo de marketplace (R$ 15,40, com
  // caixa/etiqueta/frete) fazia aparecer "custo subiu 157%".
  const canal = { id: "org", tipo: "custom", modo_preco: "markup", nome: "Orgânico" };
  const item = { id: "k:1", nome: "Kit Decoração", custoTotal: 15.4 };
  const precos = [{ id: "x", item_tipo: "kit", item_id: "1", canal_id: "org", preco: 15, custo_total: 6, atualizado_em: "2026-10-24T12:00:00Z" }];
  it("usa o custo do canal (embalagem do Orgânico)", () => {
    const itemNoCanal = (it) => ({ ...it, custoTotal: 6 });
    expect(revisoesPrecoDireto({ itens: [item], canais: [canal], precos, hoje: "2026-10-24", itemNoCanal })).toHaveLength(0);
  });
  it("avisa quando o custo do canal sobe 10%", () => {
    const itemNoCanal = (it) => ({ ...it, custoTotal: 6.7 });
    const r = revisoesPrecoDireto({ itens: [item], canais: [canal], precos, hoje: "2026-10-24", itemNoCanal });
    expect(r[0].motivos[0].texto).toBe("custo subiu 12% desde que salvou");
  });
});

describe("Pedidos da Olist: até onde o envio cobre", () => {
  // Caso real 24/10/2026: arquivo enviado hoje, último pedido de 22/10 —
  // o dia 23 não teve venda, mas está coberto.
  it("cobre até a véspera do envio", () => {
    expect(ateDoEnvioPedidos({ periodo_ate: "2026-10-22", criado_em: "2026-10-24T12:00:00Z" })).toBe("2026-10-23");
  });
  it("arquivo de período antigo não cobre a semana de hoje", () => {
    expect(ateDoEnvioPedidos({ periodo_ate: "2026-09-30", criado_em: "2026-10-24T12:00:00Z" })).toBe("2026-09-30");
  });
});

describe("Revenda: nota de compra (XML), custo e estoque", () => {
  // NF-e mínima no formato oficial (2 itens, frete na nota, ST no 1º, DIFAL possível no 2º)
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35261000000000000100550010000047301000047300" versao="4.00">
<ide><serie>1</serie><nNF>4730</nNF><dhEmi>2026-10-24T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000100</CNPJ><xNome>Distribuidora Beleza LTDA</xNome><enderEmit><UF>MG</UF></enderEmit></emit>
<dest><enderDest><UF>SP</UF></enderDest></dest>
<det nItem="1"><prod><cProd>10233</cProd><cEAN>7891234567895</cEAN><xProd>BATOM MATTE NUDE 3,5G</xProd><uCom>UN</uCom><qCom>24.0000</qCom><vUnCom>10.50</vUnCom><vProd>252.00</vProd><cEANTrib>7891234567895</cEANTrib></prod>
<imposto><ICMS><ICMS10><vICMS>30.24</vICMS><pICMS>12.00</pICMS><vICMSST>15.60</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>12.60</vIPI></IPITrib></IPI></imposto></det>
<det nItem="2"><prod><cProd>20410</cProd><cEAN>SEM GTIN</cEAN><xProd>MASCARA CILIOS CX12</xProd><uCom>CX</uCom><qCom>2</qCom><vUnCom>108.00</vUnCom><vProd>216.00</vProd></prod>
<imposto><ICMS><ICMS00><vICMS>25.92</vICMS><pICMS>12.00</pICMS></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vProd>468.00</vProd><vST>15.60</vST><vFrete>12.00</vFrete><vIPI>12.60</vIPI><vDesc>0</vDesc><vNF>508.20</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-24</dVenc><vDup>254.10</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-24</dVenc><vDup>254.10</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`;
  it("lê a nota", () => {
    const n = lerNfe(xml);
    expect(n.numero).toBe("4730");
    expect(n.emissao).toBe("2026-10-24");
    expect(n.chave).toHaveLength(44);
    expect(n.emitente.uf).toBe("MG");
    expect(n.itens[0].ean).toBe("7891234567895");
    expect(n.itens[1].ean).toBe(null);
    expect(n.duplicatas).toHaveLength(2);
    expect(lerNfe("<x/>").erro).toBeTruthy();
  });
  it("custo final por unidade: preço + IPI + ST + frete rateado; caixa vira unidades; DIFAL só sem ST", () => {
    const n = lerNfe(xml);
    const [a, b] = custoDosItens(n, { fatores: { 2: 12 }, difal: { ligado: true, aliquotaInterna: 0.18 } });
    // batom: 252 + 12,60 + 15,60 + frete 12 × 252/468 = 6,46 → 286,66 / 24
    expect(a.custoUn).toBeCloseTo(11.944, 2);
    expect(a.difal).toBe(0);
    // máscara: 216 + frete 5,54 + DIFAL (216 × 18% − 25,92 = 12,96) → 234,50 / 24 un
    expect(b.quantidade).toBe(24);
    expect(b.difal).toBeCloseTo(12.96, 2);
    expect(b.custoUn).toBeCloseTo(9.771, 2);
  });
  it("custo médio das 3 últimas notas, ponderado", () => {
    const m = custoMedioRevenda([
      { emissao: "2026-10-01", custo_un: 10, quantidade: 10 },
      { emissao: "2026-10-10", custo_un: 12, quantidade: 10 },
      { emissao: "2026-10-20", custo_un: 11, quantidade: 20 },
      { emissao: "2026-10-24", custo_un: 13, quantidade: 10 },
    ]);
    expect(m.preco).toBe(11.75); // (12×10 + 11×20 + 13×10) ÷ 40
  });
  it("estoque começa na 1ª nota; venda antes não baixa; kit baixa as peças", () => {
    const itens = [{ id: "k:1", componentes: [{ produtoId: "B", quantidade: 2 }] }, { id: "v:9", produtoId: "B", quantidade: 3 }];
    const pedidos = [
      { valido: true, id_item: "p:B", q: 1, data: "2026-10-01" }, // antes da 1ª nota: não conta
      { valido: true, id_item: "k:1", q: 1, data: "2026-10-21" },
      { valido: true, id_item: "v:9", q: 1, data: "2026-10-22" },
      { valido: false, id_item: "p:B", q: 5, data: "2026-10-22" }, // cancelado
    ];
    const vendas = vendasPorProduto(pedidos, itens).get("B");
    const est = estoqueDoProduto({ movimentos: [{ data: "2026-10-20", tipo: "entrada", quantidade: 12 }, { data: "2026-10-23", tipo: "ajuste", quantidade: -1 }], vendas, hoje: "2026-10-24" });
    expect(est.inicio).toBe("2026-10-20");
    expect(est.saldo).toBe(6); // 12 − 2 − 3 − 1
    // 5 un vendidas em 7 dias de base = 0,71/dia → dura ~8,4 dias
    expect(situacaoEstoque(est, { prazo: 5, folga: 3 }, "2026-10-24").tipo).toBe("ok");
    const s = situacaoEstoque(est, { prazo: 7, folga: 3 }, "2026-10-24");
    expect(s.tipo).toBe("repor");
    expect(s.comprar).toBe(21); // 0,714 × (7 + 30) = 26,4 → 27 − 6
  });
  it("limite do MEI: faturamento do ano e quando passa", () => {
    const pedidos = [{ valido: true, data: "2026-10-01", pago: 9000 }, { valido: true, data: "2026-03-01", pago: 60000 }, { valido: false, data: "2026-10-02", pago: 999 }];
    const r = limiteMei({ pedidos, limite: 81000, hoje: "2026-10-24" });
    expect(r.faturado).toBe(69000);
    expect(r.atencao).toBe(true);
  });
});

describe("Revenda: unidades por caixa (palpite)", () => {
  it("pela unidade tributável da nota e pelo nome", async () => {
    const { palpiteFator } = await import("../src/lib/revenda.js");
    expect(palpiteFator({ qtd: 2, unidade: "CX", qtdTrib: 24, unidadeTrib: "UN" })).toBe(12);
    expect(palpiteFator({ qtd: 2, unidade: "CX", descricao: "MASCARA CILIOS CX12" })).toBe(12);
    expect(palpiteFator({ qtd: 3, unidade: "PCT", descricao: "ELASTICO C/ 6 UN" })).toBe(6);
    expect(palpiteFator({ qtd: 24, unidade: "UN", descricao: "BATOM CX12" })).toBe(null);
  });
});

describe("Relatório de Ads com lucro real (26/10/2026)", () => {
  it("usa o lucro dos pedidos, corta vendas do CSV acima dos pedidos pagos e mostra o que sobrou", async () => {
    const { relatorioAds } = await import("../src/lib/relatorios.js");
    const { BRL } = await import("../src/lib/format.js");
    const periodo = (id, gasto, vendas, extra = {}) => ({ item_tipo: "produto", item_id: id, canal_id: "c1", inicio: "2026-10-05", parcial: { ate: "2026-10-20", gasto, vendas }, ...extra });
    const linhasAds = {
      linhas: [
        { tipo: "produto", id: "a", canal: { id: "c1", nome: "Shopee" }, item: { nome: "Chaveiro" }, lucro: 5, periodos: [periodo("a", 76, 4, { motivo_fim: "pausei" })], semanas: [] },
        { tipo: "produto", id: "b", canal: { id: "c1", nome: "Shopee" }, item: { nome: "Natal" }, lucro: 20, periodos: [periodo("b", 50, 5)], semanas: [] },
      ],
    };
    const ped = (id, lucro, data = "2026-10-15") => ({ valido: true, canal_id: "c1", data, q: 1, lucro, an: id });
    const pedidos = [ped("a", 1.8), ped("a", 1.8), ped("b", 14), ped("b", 14), ped("b", 14), ped("b", 14), ped("b", 14), ped("b", 14, "2026-10-21")];
    const r = relatorioAds({ linhasAds, hoje: "2026-10-26", pedidos, anuncioDoPedido: (p) => ({ tipo: "produto", id: p.an }) }, "2026-10");
    const t = r.blocos.find((b) => b.tipo === "tabela").linhas;
    const chaveiro = t.find((l) => l[0].startsWith("Chaveiro"));
    expect(chaveiro[1]).toBe("encerrado");
    expect(chaveiro[3]).toBe("2 (CSV 4)"); // só 2 pedidos pagos até o fim do CSV
    expect(chaveiro[5]).toBe(BRL(3.6)); // 2 × R$ 1,80 dos pedidos, não 4 × R$ 5 do preço de hoje
    expect(chaveiro[8]).toBe("parado ✓");
    const natal = t.find((l) => l[0].startsWith("Natal"));
    expect(natal[1]).toBe("ligado");
    expect(natal[5]).toBe(BRL(70)); // 5 × R$ 14 reais
    expect(natal[6]).toBe(BRL(20));
    expect(natal[8]).toBe("manter");
  });
});

describe("Consultor: queda por Ads pausado e produto novo de época", () => {
  it("não propõe análise quando a queda veio do Ads", async () => {
    const { sugerirConsultorias } = await import("../src/lib/consultor.js");
    const ped = (data) => ({ valido: true, data, q: 1, pago: 10, lucro: 2, id_item: "p:x", item: { id: "p:x", nome: "Chaveiro" } });
    const pedidos = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-20"].map(ped);
    const semAds = sugerirConsultorias({ pedidos, linhasAds: { linhas: [] }, hoje: "2026-10-26" });
    expect(semAds.some((c) => c.chave.startsWith("queda|"))).toBe(true);
    const linhasAds = { linhas: [{ tipo: "produto", id: "x", periodos: [{ item_tipo: "produto", item_id: "x", canal_id: "c", inicio: "2026-09-29", fim: "2026-10-08", parcial: { ate: "2026-10-08", gasto: 60, vendas: 5 } }], semanas: [] }] };
    const comAds = sugerirConsultorias({ pedidos, linhasAds, hoje: "2026-10-26" });
    expect(comAds.some((c) => c.chave.startsWith("queda|"))).toBe(false);
  });
});

describe("Repasse dos pedidos = Minha Renda da Shopee (26/10/2026)", () => {
  it("recebe = pago − comissão − taxa fixa; imposto do canal só sai do lucro", async () => {
    const { enriquecer, caixaDosPedidos } = await import("../src/lib/pedidos.js");
    const canais = [{ id: "s", tipo: "shopee", imposto_pct: 0.02, custos_fixos_pct: 0 }, { id: "t", tipo: "tiktok", imposto_pct: 0.02 }];
    const itens = [{ id: "p:ch", custoTotal: 2, peso: 30 }];
    const ped = (pedido, canal_id, unit, desc, situacao) => ({ pedido, canal_id, item_tipo: "produto", item_id: "ch", quantidade: 1, valor_unitario: unit, desconto_pedido: desc, situacao, data: "2026-10-06" });
    const ls = enriquecer([ped("a", "s", 10.59, 0.22, "Entregue"), ped("b", "s", 19.96, 0.4, "Enviado"), ped("c", "t", 17.9, 0, "Entregue")], { itens, canais });
    expect(ls[0].recebe).toBeCloseTo(3.8, 2); // chaveiro real: rendeu R$ 3,79/3,80
    expect(ls[1].recebe).toBeCloseTo(11.15, 2); // kit 2 real: R$ 11,15
    expect(ls[2].recebe).toBeCloseTo(11.04, 2); // TikTok, liquidação real 21/10
    expect(ls[0].imposto).toBeCloseTo(0.2074, 3);
    expect(ls[0].lucro).toBeCloseTo(3.8 - 2 - 0.2074, 2); // lucro continua descontando o imposto
    const c = caixaDosPedidos(ls);
    expect(c.aReceber[0].descricao).toContain("pagos, ainda não entregues");
  });
});
