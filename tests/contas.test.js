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
