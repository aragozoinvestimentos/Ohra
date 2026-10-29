import { cascataDoPeriodo } from "../src/lib/resumoLoja.js";
import { aliquotaEfetiva, aliquotaDaVenda, rbt12, dasDoMes } from "../src/lib/simples.js";
import { fiscalDoItem, sugerirSku, produtosParecidos, faltasDoCadastro } from "../src/lib/revenda.js";
import { interpretarDanfe, partesDaChave } from "../src/lib/danfe.js";
import { comparaSemana, notasDaSemana, semanaDe } from "../src/lib/sedeNotas.js";
import { estrelasDaEquipe, prontosPraPromocao, promover, proximoNivel, destaqueDaSemana, opinioesDosGerentes } from "../src/lib/sedeEquipe.js";
import { caixasDoDia, destinosDoArquivo, momentoDaAgenda, novidadeRecente, textoDaTV } from "../src/lib/sedeAgenda.js";
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
import { pessoaDoAviso, salaDoAviso, salasDaLoja, partesDaLoja } from "../src/lib/sede.js";
import { montarCena } from "../src/lib/sedeCena.js";

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
    expect(kpi("Sobrou pra você")).toBe("R$ 25,00");
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

describe("Carteiras do Caixa (26/10/2026)", () => {
  it("separa liberado × a liberar pelo extrato e o saque não muda o total nem o resultado", async () => {
    const { resumoCarteiras, interpretarExtratoShopee, carteiraDe } = await import("../src/lib/carteiras.js");
    const { realDoMes, saldoRealizado } = await import("../src/lib/fluxoCaixa.js");
    const ext = interpretarExtratoShopee([
      ["Relatório"], ["De", "2026-07-26"], ["Para", "2026-10-26"],
      ["Data", "Tipo de transação", "Descrição", "ID do pedido", "Direção do dinheiro", "Valor", "Status", "Balança após as transações", "Valor a Ser Ajustado"],
      ["2026-10-22 14:29:22", "Renda do pedido", "Renda do pedido #X1", "X1", "Entrada", "10.32", "Transação completa", "47.78", "0.00"],
      ["2026-10-09 15:40:21", "Renda do pedido", "Renda do pedido #X0", "X0", "Entrada", "3.79", "Transação completa", "3.79", "0.00"],
    ]);
    expect(ext.ok).toBe(true);
    expect(ext.transacoes).toHaveLength(2);
    const extrato = ext.transacoes.map((t) => ({ ...t, plataforma: "shopee" }));
    const L = [
      { tipo: "entrada", categoria: "venda", valor: 60, data_prevista: "2026-10-20", data_realizada: "2026-10-20", origem_import: "pedidos|shopee|2026-10-19" },
      { tipo: "entrada", categoria: "venda", valor: 14, data_prevista: "2026-10-20", data_realizada: "2026-10-20", origem_import: "pedidos|fisico|2026-10-19" },
      { tipo: "saida", categoria: "transferencia", carteira: "shopee", valor: 20, data_prevista: "2026-10-23", data_realizada: "2026-10-23" },
      { tipo: "entrada", categoria: "transferencia", carteira: "loja", valor: 20, data_prevista: "2026-10-23", data_realizada: "2026-10-23" },
    ];
    expect(carteiraDe(L[0])).toBe("shopee");
    expect(carteiraDe(L[1])).toBe("loja"); // venda física cai direto na Conta da loja
    const r = resumoCarteiras({ lancamentos: L, canais: [{ tipo: "shopee" }], hoje: "2026-10-26", aReceber: [{ plataforma: "shopee", valor: 8 }], extrato });
    const sh = r.carteiras.find((c) => c.id === "shopee");
    expect(sh.saldo).toBe(40);
    expect(sh.liberado).toBe(27.78); // 47,78 do extrato − saque de 20 registrado depois dele
    expect(sh.aLiberar).toBe(12.22); // entregue no app e ainda não liberado
    expect(r.carteiras.find((c) => c.id === "loja").saldo).toBe(34);
    expect(r.total).toBe(74);
    expect(r.aCaminho).toBe(8);
    expect(saldoRealizado(L, "2026-10-26")).toBe(74);
    expect(realDoMes(L, "2026-10").resultado).toBe(74); // o saque não é venda nem gasto
  });
});

describe("Sede nova em perspectiva (27/10/2026)", () => {
  it("cada aviso vai pra sala e pra pessoa certa", () => {
    const av = (id, aba, sub) => ({ id, ir: { aba, pedido: sub ? { sub } : undefined } });
    expect(salaDoAviso(av("farm-manut|1", "farm"))).toBe("operacao");
    expect(pessoaDoAviso(av("farm-manut|1", "farm"))).toBe("ivo");
    expect(salaDoAviso(av("analise|importar", "importar"))).toBe("recepcao");
    expect(pessoaDoAviso(av("analise|importar", "importar"))).toBe("ze");
    expect(pessoaDoAviso(av("caixa|atrasados", "caixa"))).toBe("bia");
  });
  it("só a Live fica fechada sem live; impressoras e revenda acendem dentro da Operação", () => {
    expect(salasDaLoja({ canais: [{ tipo: "shopee" }], lives: [] }).live).toBeTruthy();
    expect(salasDaLoja({ canais: [{ tipo: "shopee" }], lives: [{ id: 1 }] }).live).toBeUndefined();
    expect(partesDaLoja({ impressoras: [{ ativa: true }, { ativa: true }] })).toEqual({ impressoras: 2, revenda: false });
    expect(partesDaLoja({ produtos: [{ origem: "revenda" }] }).revenda).toBe(true);
  });
  it("a cena tem lugar pra todo mundo, sem móvel em cima de quem senta", () => {
    const c = montarCena({ impressoras: 2, revenda: true });
    for (const id of ["ceo1", "ceo2", "consultor", "bia", "lia", "kai", "celia", "rafa", "nina", "leo", "teo", "ivo", "duda", "rui", "ze"]) {
      const l = c.lugares[id];
      expect(l, id).toBeTruthy();
      expect(c.livre(l.x, l.y), id).toBe(true);
    }
    // corredor ↔ Comercial só pela porta; corredor ↔ Diretoria só pela porta da mureta
    expect(c.passa(20, 16, 20, 17)).toBe(true);
    expect(c.passa(5, 16, 5, 17)).toBe(false);
    expect(c.passa(3, 12, 3, 11)).toBe(false);
    expect(c.passa(7, 12, 7, 11)).toBe(true);
    expect(c.placas).toHaveLength(8);
  });
});

describe("Sede — agenda viva (etapa B)", () => {
  const ag = (data, hm) => {
    const [h, m] = hm.split(":").map(Number);
    return { data, h, m, dow: new Date(`${data}T12:00:00Z`).getUTCDay(), minutos: h * 60 + m };
  };
  it("momentos do dia pelo relógio de São Paulo", () => {
    expect(momentoDaAgenda(ag("2026-10-28", "09:05")).k).toBe("bomdia");
    expect(momentoDaAgenda(ag("2026-10-26", "10:10")).k).toBe("semana"); // segunda
    expect(momentoDaAgenda(ag("2026-12-01", "10:10")).k).toBe("fechamento"); // dia 1 (terça)
    expect(momentoDaAgenda(ag("2026-10-28", "12:40")).turno).toBe("b");
    expect(momentoDaAgenda(ag("2026-10-28", "14:05"))).toBeNull();
    expect(momentoDaAgenda(ag("2026-10-28", "14:05"), { novidade: { data: "2026-10-27" } }).k).toBe("treinamento");
    expect(momentoDaAgenda(ag("2026-10-28", "16:10")).k).toBe("coleta");
    expect(momentoDaAgenda(ag("2026-10-31", "17:30")).k).toBe("festa"); // sábado, último dia
    expect(momentoDaAgenda(ag("2026-10-31", "09:05"))).toBeNull();
  });
  it("pallet, arquivos e TV", () => {
    expect(caixasDoDia(11)).toBe(3);
    expect(caixasDoDia(100)).toBe(8);
    expect(destinosDoArquivo("pedidos:olist")).toEqual(["celia", "bia", "duda"]);
    expect(destinosDoArquivo("shopee:ads")).toEqual(["leo"]);
    expect(textoDaTV({ momento: null, agora: ag("2026-10-28", "08:00") }).ata).toBe(false);
    expect(textoDaTV({ momento: null, agora: ag("2026-10-28", "11:00") }).titulo).toBe("Reunião de hoje às 9h ✓");
    const tv = textoDaTV({ momento: { k: "bomdia" }, agora: ag("2026-10-28", "09:05"), bom: { ontem: "2026-10-27", pedidos: null, faltando: [] }, top3: ["A"] });
    expect(tv.linhas[0]).toContain("aguardando arquivo");
    expect(novidadeRecente([{ data: "2026-10-10" }], "2026-10-28")).toBeNull();
  });
});

describe("Sede — equipe (etapa C)", () => {
  const reg = (chave, de, hist, res = []) => ({ tipo: "consultoria", chave, dados: { de, titulo: chave, historico: hist, resultados: res } });
  const regs = [
    reg("ideia|kit|a", "ze", [{ status: "quero", data: "2026-10-20" }], [{ status: "resolveu", em: "2026-10-24" }]),
    reg("ideia|kit|b", "ze", [{ status: "quero", data: "2026-10-21" }], [{ status: "resolveu", em: "2026-10-23" }]),
    reg("ideia|capa|c", "ze", [{ status: "agora-nao", data: "2026-10-21" }]),
    reg("proposta|x", "nina", [{ status: "quero", data: "2026-10-22" }], [{ status: "continuou", em: "2026-10-27" }]),
    reg("queda|y", null, [{ status: "quero", data: "2026-10-22" }]),
    reg("relatorio|semana", null, [{ status: "quero", data: "2026-10-22" }]),
  ];
  it("estrelas: +1 aprovada, +3 deu certo, 0 tentada; relatório não conta", () => {
    const e = estrelasDaEquipe(regs);
    expect(e.ze.estrelas).toBe(8);
    expect(e.ze.deram).toBe(2);
    expect(e.ze.ideias).toBe(3);
    expect(e.nina.estrelas).toBe(1);
    expect(e.nina.tentadas).toBe(1);
    expect(e.consultor.estrelas).toBe(1);
  });
  it("Zé: Estagiário → Analista com 5★ + 2 que deram certo; promoção aprovada sobe o nível", () => {
    const e = estrelasDaEquipe(regs);
    expect(proximoNivel("ze", e, {}).pronto).toBe(true);
    expect(prontosPraPromocao(["ze", "nina"], e, {}, "2026-10-28").map((x) => x.para)).toEqual(["Analista"]);
    const eq = promover({}, "ze", 1, "2026-10-28");
    expect(proximoNivel("ze", e, eq).nome).toBe("Analista sênior");
    expect(proximoNivel("consultor", e, eq)).toBeNull();
  });
  it("destaque da semana e opinião dos gerentes", () => {
    const e = estrelasDaEquipe(regs);
    expect(destaqueDaSemana(e, "2026-10-28").id).toBe("ze"); // semana 19–25/10
    const op = opinioesDosGerentes({ financeiro: [{ grupo: "resolver", titulo: "2 contas atrasadas" }], comercial: [], operacao: [] });
    expect(op[0].texto).toContain("Antes de tudo");
    expect(op[1].texto).toContain("✓");
  });
});

describe("Sede — nota por setor (etapa D)", () => {
  it("Financeiro sem falso 100%: contas em dia mas 90% do bolso", () => {
    const lanc = [
      { tipo: "saida", valor: 90, data_prevista: "2026-10-10", data_realizada: "2026-10-10", pago_com: "bolso", categoria: "filamento" },
      { tipo: "saida", valor: 10, data_prevista: "2026-10-12", data_realizada: "2026-10-12", pago_com: "loja", categoria: "embalagem" },
    ];
    const n = notasDaSemana({ hoje: "2026-10-28", lancamentos: lanc, saldoCaixa: 500, bom: { faltando: [] }, porSala: {}, pedidos: [], linhasAds: [], cheias: {}, estoqueRepor: null });
    const f = n.setores.financeiro;
    expect(f.partes.find((p) => p.k === "contas").nota).toBe(10);
    expect(f.partes.find((p) => p.k === "sePaga").nota).toBe(1);
    expect(f.nota).toBeLessThan(8);
    expect(n.setores.operacao.partes.find((p) => p.k === "estoque").nota).toBeNull();
    expect(n.semana).toBe("2026-10-26");
  });
  it("semana e seta", () => {
    expect(semanaDe("2026-11-01")).toBe("2026-10-26");
    expect(comparaSemana([{ setor: "comercial", semana: "2026-10-19", nota: 6 }], "comercial", "2026-10-26", 7).seta).toBe("↑");
  });
});

describe("Nota de compra pelo PDF (DANFE)", () => {
  const I = (t, x, y, h = 6) => ({ t, x, y, w: t.length * 3, h });
  const pag = {
    itens: [
      I("RECEBEMOS DE LOJA X LTDA OS PRODUTOS CONSTANTES DA NOTA", 30, 30), I("DANFE", 250, 70), I("3524 1012 3456 7800 0190 5500 1000 0012 3410 0000 1234", 400, 80),
      I("DATA DA EMISSAO", 300, 130), I("15/10/2024", 300, 140),
      I("CALCULO DO IMPOSTO", 30, 210), I("VALOR TOTAL DOS PRODUTOS", 30, 220), I("90,00", 30, 230), I("VALOR TOTAL DA NOTA", 200, 220), I("90,00", 200, 230),
      I("DADOS DOS PRODUTOS / SERVICOS", 30, 300), I("CODIGO", 30, 310), I("DESCRICAO", 80, 310), I("QUANT", 350, 310), I("VALOR", 385, 310), I("UNIT", 385, 317), I("VALOR", 420, 310), I("TOTAL", 420, 317),
      I("7891234567895", 30, 330), I("COPO 500ML", 80, 330), I("6,0000", 350, 330), I("15,0000", 385, 330), I("90,00", 420, 330),
      I("2561", 30, 345), I("CANETA RR2200", 80, 345), I("12", 350, 345), I("10,50", 385, 345), I("126,00", 420, 345),
      I("*N. CONTROLE FCI: 67E62219", 58, 352), I("Cód. Barras: 7900083000665", 58, 359),
    ],
  };
  it("chave dá CNPJ, UF, número e série; tabela dá os itens", () => {
    expect(partesDaChave("35241012345678000190550010000012341000001234")).toMatchObject({ uf: "SP", cnpj: "12345678000190", numero: "1234", serie: "1" });
    const n = interpretarDanfe([pag]);
    expect(n.emitente).toMatchObject({ cnpj: "12345678000190", nome: "LOJA X LTDA", uf: "SP" });
    expect(n.emissao).toBe("2024-10-15");
    expect(n.itens[0]).toMatchObject({ ean: "7891234567895", qtd: 6, vUn: 15, vProd: 90, descricao: "COPO 500ML" });
    expect(n.totais.vNF).toBe(90);
    // nota real (28/10/2026): EAN na linha "Cód. Barras" embaixo do item, FCI fora da descrição
    expect(n.itens[1]).toMatchObject({ codigo: "2561", ean: "7900083000665", descricao: "CANETA RR2200", qtd: 12, vProd: 126 });
  });
  it("PDF sem texto ou que não é DANFE", () => {
    expect(interpretarDanfe([{ itens: [] }]).erro).toContain("imagem");
    expect(interpretarDanfe([{ itens: [I("Boleto", 1, 1)] }]).erro).toContain("não parece");
  });
});

describe("Nota de compra — fiscal, SKU e produto parecido (v69)", () => {
  it("nota real Union Medic: CFOP 5405 = ST, NCM 3304 = monofásico, origem pela CST", () => {
    const f = fiscalDoItem({ ncm: "33042010", cfop: "5405", cst: "260" });
    expect(f).toMatchObject({ st: true, monofasico: true, origem: "2" });
    expect(fiscalDoItem({ ncm: "39269090", cfop: "5102", cst: "000" })).toMatchObject({ st: false, monofasico: false });
  });
  it("SKU pela referência do fabricante, sem repetir", () => {
    expect(sugerirSku({ descricao: "CANETA DELINEADORA RR2200 MELU" }).sku).toBe("RR2200");
    expect(sugerirSku({ descricao: "SOMBRA DE SOBRANCELHA HBF572 RUBYROSE" }, new Set(["HBF572"])).sku).toBe("HBF572-2");
    expect(sugerirSku({ descricao: "COPO TERMICO INOX", codigo: "2561" }).sku).toBe("COPO-TERMICO-2561");
  });
  it("produto parecido: EAN, referência e SKU vendido na Olist", () => {
    const prods = [{ id: "a", nome: "Delineador Ruby", sku: "RR2200", ean: "" }, { id: "b", nome: "Outro", sku: "X", ean: "7900083000665" }];
    const r = produtosParecidos({ descricao: "CANETA DELINEADORA RR2200 MELU", ean: "7900083000665" }, prods, { skusVendidos: ["RR2200-PRETO"] });
    expect(r.candidatos.map((c) => c.produto.id)).toEqual(["b", "a"]);
    expect(r.skuVendido).toBe("RR2200-PRETO");
  });
  it("cadastro incompleto", () => {
    expect(faltasDoCadastro({ sku: "", peso_g: null, ncm: "" }, { temPreco: false })).toEqual(["SKU", "peso", "preço", "NCM"]);
  });
});

describe("Simples Nacional (estimativa)", () => {
  it("alíquota efetiva pela faixa: Anexo I com RBT12 de R$ 300 mil", () => {
    // (300.000 × 7,3% − 5.940) ÷ 300.000 = 5,32%
    expect(aliquotaEfetiva("I", 300000)).toBeCloseTo(0.0532, 4);
    expect(aliquotaEfetiva("II", 0)).toBe(0.045);
  });
  it("ST tira o ICMS e monofásico tira PIS/COFINS da alíquota da venda", () => {
    const cheia = aliquotaDaVenda({ anexo: "I", rbt: 100000 });
    expect(cheia).toBeCloseTo(0.04, 6);
    expect(aliquotaDaVenda({ anexo: "I", rbt: 100000, st: true })).toBeCloseTo(0.04 * 0.66, 6);
    expect(aliquotaDaVenda({ anexo: "I", rbt: 100000, st: true, monofasico: true })).toBeCloseTo(0.04 * (1 - 0.34 - 0.0276 - 0.1274), 6);
  });
  it("RBT12 proporcional no início e DAS do mês separado por tipo", () => {
    const ped = (data, pago, item) => ({ valido: true, data, pago, item });
    const pedidos = [ped("2026-08-10", 1000, { id: "p:a" }), ped("2026-09-10", 2000, { id: "p:b" }), ped("2026-10-05", 500, { id: "p:a" }), ped("2026-10-06", 500, { id: "p:b" })];
    expect(rbt12({ pedidos, mes: "2026-10" })).toMatchObject({ valor: 18000, meses: 2, origem: "proporcional" });
    const d = dasDoMes({ pedidos, mes: "2026-10", cfgLoja: { impostos: { regime: "simples" } }, produtos: [{ id: "a", origem: "revenda", imposto_st: true, monofasico: true }, { id: "b", origem: "fabricado" }] });
    expect(d.faturamento).toBe(1000);
    expect(d.linhas.find((l) => l.tipo === "st-mono").imposto).toBeCloseTo(500 * 0.04 * (1 - 0.34 - 0.0276 - 0.1274), 2);
    expect(d.linhas.find((l) => l.anexo === "II").imposto).toBeCloseTo(500 * 0.045, 2);
  });
});

describe("Do faturamento ao lucro (cascata)", () => {
  it("fecha linha por linha até o lucro líquido", () => {
    const canal = { id: "s", nome: "Shopee" };
    const pedidos = [{ valido: true, data: "2026-10-10", pedido: "1", pago: 90, bruto: 100, recebe: 70, imposto: 0, custo: 30, lucro: 40, canal }];
    const lancamentos = [{ tipo: "saida", recorrencia: "mensal", categoria: "taxas", descricao: "DAS MEI", valor: 80, data_prevista: "2026-01-20" }];
    const c = cascataDoPeriodo({ pedidos, linhasAds: { linhas: [] }, lancamentos, de: "2026-10-01", ate: "2026-10-31" }).total;
    expect(c).toMatchObject({ bruto: 100, descontos: 10, pago: 90, taxas: 20, custo: 30, lucroBruto: 40, ads: 0, depoisAds: 40, fixas: 80, liquido: -40 });
  });
});

describe("estoque: sai no Enviado (28/10/2026)", () => {
  it("pago e não enviado fica a enviar; enviado tira do físico", async () => {
    const { vendasPorProduto, estoqueDoProduto } = await import("../src/lib/revenda.js");
    const { ehSaiu } = await import("../src/lib/pedidos.js");
    expect(ehSaiu("Enviado")).toBe(true);
    expect(ehSaiu("Entregue")).toBe(true);
    expect(ehSaiu("Pronto para envio")).toBe(false);
    expect(ehSaiu("Cancelado")).toBe(false);
    const pedidos = [
      { valido: true, id_item: "p:a", q: 2, data: "2026-10-20", pedido: "1", saiu: true },
      { valido: true, id_item: "p:a", q: 3, data: "2026-10-21", pedido: "2", saiu: false },
    ];
    const v = vendasPorProduto(pedidos, [], null).get("a");
    const e = estoqueDoProduto({ movimentos: [{ tipo: "entrada", quantidade: 10, data: "2026-10-01" }, { tipo: "producao", quantidade: 4, data: "2026-10-02" }], vendas: v, hoje: "2026-10-22" });
    expect(e.saldo).toBe(12);
    expect(e.reservado).toBe(3);
    expect(e.disponivel).toBe(9);
  });
});
