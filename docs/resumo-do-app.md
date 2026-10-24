# Margem Real — resumo completo do aplicativo (outubro/2026)

Use este texto como contexto ao pedir análises ou sugestões sobre o app.

## O que é
Margem Real ("o lucro de verdade de cada venda") é um aplicativo web (PWA, funciona no PC e no celular) de precificação, vendas, crescimento, produção e dinheiro para lojas de marketplace. A primeira loja é a **Ohra - 3D** (produtos impressos em 3D vendidos na Shopee, TikTok Shop, Mercado Livre, Shein e venda física). O app é multiloja: cada loja tem seus dados 100% separados, com PIN próprio. Tecnologia: React + Vite, banco Supabase, publicado no Vercel.

## Princípios
- **Só existe o preço real** (o que o cliente paga). Preço riscado e % de promoção aparecem só onde se digita o anúncio.
- **Preço alvo × preço agora**: alvo = preço salvo (onde se quer chegar); agora = o que o cliente paga hoje (pode estar num degrau da rampa). Todo RESULTADO usa o preço de agora.
- **Lucro = recebe − repor**: "você recebe" = o que o marketplace repassa depois das taxas; "repor" = custo de hoje (fabricação + embalagem + frete); lucro = o que sobra.
- **Tudo ao vivo**: custos, taxas e lucros são recalculados com os preços de hoje (material, embalagem, taxas oficiais atualizadas). Dados importados aparecem na hora.
- **Cada assunto tem UM lugar que decide**; as outras telas só obedecem ou levam até lá.
- **Todo aviso que pede ação aparece no "Pra fazer" do Início.**
- Nada muda preço sozinho: o app sugere, o dono decide.
- Dados ficam no banco (iguais em qualquer aparelho); o navegador guarda só aparência e navegação.

## Menu
**Início · Atualizar dados · Produtos · Anúncios · Vender mais · Live · Dinheiro · Análise · Produção · Configuração** (+ Tutorial). No celular, barra embaixo: Início, Anúncios, Vender, Dinheiro, Mais.

## Início
- Faixa de status: Dinheiro, Vendas, Catálogo, Produção (verde/amarelo/vermelho + frase).
- **Pra fazer**: todos os avisos do app, em grupos **Resolver** (vermelho: prejuízo, conta vencida, Ads no prejuízo…), **Atenção e rotina** (âmbar) e **Oportunidades** (verde). Filtro por área, avisos do mesmo anúncio agrupados num card, "lembrar em 30 dias", faixa de urgentes.
- **Tarefas manuais** (com data, repetição semanal/mensal, link pra aba/produto).
- Áreas resumidas: Dinheiro (saldo, projeção, meta), Vendas e crescimento (lucro dos últimos 7 dias, Ads, origem das vendas), Catálogo, Produção (taxa de falha, reserva de produção).
- Bolinhas de contagem nos itens do menu.

## Atualizar dados (importações — a fonte dos dados reais)
- **Pedidos da Olist** num arquivo só (separa cada pedido pela plataforma pelo nº do pedido). Guarda só o necessário (sem nome/CPF/endereço). Pedido "Dados incompletos" = não pago (carrinho abandonado), fora das vendas.
- **Shopee**: Desempenho do produto (funil: impressões, cliques, pedidos), **Shopee Ads (CSV)** e **GMV Max da Loja (CSV)** em janelas de datas (recusa período que repete dias; indica o próximo período a exportar).
- **Avaliações** (digitadas por estrela, com modo simples).
- **Venda física** (lançada à mão).
- SKU não cadastrado → cadastrar ou descartar. Pedidos entregues viram entradas no Caixa por plataforma × semana.

## Produtos
- **Catálogo**: busca, filtros (tipo, quando vende, impressora, canal, rampa, SKU, curva ABC), custo de hoje, preço salvo por canal, excluir.
- **Página do produto**: visão geral por canal, cadastro em passos, custo detalhado, variações e kits.
- **Cadastro de produtos**: SKU, material/filamento, impressora, detalhamento de produção (peças por chapa, tempo, material, energia, máquina, % de falhas/manutenção/acabamento), **parte artesanal** (vela, cimento… com rendimento por lote), embalagem (receita com itens), peso, frete, variações de quantidade (kit 2, kit 3…), "Quando vende" (ano todo / pico / só na época de Natal etc.), embalagem do canal orgânico.
- **Kits** (produtos diferentes vendidos juntos): custo pelas peças, SKU sugerido, preço sugerido por canal.
- **Simular custo**: calculadora de custo de produção (3D + artesanal), comparar filamentos, salvar como produto.

## Anúncios
- **Lista de anúncios** (item × canal): preço agora, lucro por venda, vendas 30 dias, rampa, Ads, situação.
- **Painel do anúncio**: resumo e o que fazer agora, vendas, preço (alvo/agora, escada, régua de concorrência), rampa, Ads (medidor de retorno), anúncio (o que digitar, funil, avaliações), custo.
- **Preços salvos** (Produtos precificados): grade produto × canal com lucro, margem, alertas (prejuízo, abaixo do mínimo, frete grátis, custo mudou), comparar com o sugerido, editar, clonar, tirar do canal, estratégia ("manter assim": crescimento/atração).
- **Comparar canais**.
- **Fluxo de lançamento em 5 passos**:
  1. **Avulso** — preço pela margem desejada (ou markup na venda direta), taxas reais do canal, mínimo aceitável, concorrente, âncora pro kit 2, cupom máximo.
  2. **Por quantidade** — escada de kits por curva de desconto, regra de 4× da Shopee, quantidades anunciadas por canal, preço de cadastro (riscado).
  3. **Ficha do anúncio** — tabela pronta pra criar o anúncio (variações, SKUs, preço original, promo), inclusive **anúncio com vários itens** e "Montar combinações".
  4. **Lançamento** — entra em rampa ou anuncia no alvo.
  5. **Anunciar** — o que digitar em cada marketplace; o preço original (riscado) fica FIXO depois de anunciado e só a % de promo muda.

## Vender mais
- **Rampa de preço**: entrar perto do 0 a 0 pra gerar vendas e avaliações e subir em degraus até o alvo. Portões (vendas, avaliações, nota, dias, sem 1–2★), decisão pelo LUCRO da semana (fica/sinaliza/volta), salto duplo, atalho pelo ritmo, 7 dias sem venda, funil do anúncio (diagnóstico: título/vitrine/página), revisar anúncio (checklist), teste de lançamento, testar acima do alvo, rampa sazonal (cronograma até a data, entressafra), rampa de kit e do anúncio com vários itens, "O que fazer agora". Pode ser desligada por canal (TikTok sem rampa).
- **Ads** (método combinado com o "Ads não é milagre, é método"): períodos de Ads por anúncio, lance automático → meta de ROAS, **ROAS de equilíbrio** (preço ÷ lucro), retorno, escada de aumento (+20%/+30% por semana), descer um degrau, dia 3 sem venda, Ads no prejuízo, pausar/despausar, **teto de Ads da loja** por faixas de faturamento, GMV Max da Loja com quebra por produto, andamento pelo CSV, corrigir gasto, decisão às 22h, "não usar Ads por enquanto".
- **Afiliados**: comissão máxima/ideal/recomendada por item (a margem do dono vem primeiro), parceiros, amostras, sugestões.
- **Promoções e cupons**: simular promoções (desconto, combo, progressivo, frete grátis, liquidação), promoções salvas, **Cupom da loja** (cupom máximo por item, cupons ativos com faixas, cupom ideal e real).
- **Orçamento e atacado**: encomenda avulsa e em volume (faixas de atacado sobre o custo, personalização, arte, frete).

## Live
Plano paralelo (nada da live altera preço salvo, rampa ou Ads): **Planejar** (produtos com cópia do preço/custo do dia, estratégias — escada subindo, primeiros N, relâmpago, brinde, preço fixo — ou modo "preço da loja + cupom" com faixas e combos), **Ao vivo** (cronômetro, +1 venda, preço sugerido, cupom), **Resultados** (lista de vendas e roteiro de impressão, conferência com os pedidos importados, comparar lives, curva ABC das lives).

## Dinheiro
- **Resumo do mês**: faturamento, descontos, taxas, repor, Ads, recebe, lucro antes/depois do Ads, por canal e por anúncio.
- **1 · Caixa**: lançamentos de entrada/saída por dia, previstos e realizados, recorrentes, parcelados, compra de material (atualiza o preço médio do filamento), "pago com meu bolso × caixa da loja", recarga e saldo de Ads na Shopee, projeção de 3/6/12 meses com gráfico.
- **2 · Contas fixas e parcelas**.
- **3 · Vendas do mês**: vendas reais (pedidos) + estimadas, lucro por produto × canal, **Reserva de produção** (separar o dinheiro de repor material/embalagem/máquina), período de vários meses.
- **4 · Payoff**: quanto o dono já colocou, quanto a loja pagou, quanto entrou, quanto falta voltar pro bolso e quando volta.
- **Metas** mensais (faturamento/lucro) e **Ranking por retorno**.

## Análise
- **Curva ABC** (por lucro, valor, quantidade ou lucro por hora de impressora; projeção do mês, ponto de equilíbrio, concentração; comprados juntos → montar kit).
- **Curva XYZ** (regularidade semanal, matriz ABC×XYZ, **estoque sugerido** — quanto ter pronto e quando reimprimir).
- **Evolução e métricas** (ticket médio, itens por pedido, desconto efetivo, recompra, cancelamentos, TACoS, lucro real, dia que mais vende, preço × vendas na rampa).
- **Comparar períodos** (A × B, por canal/produto, gráfico).
- **Carrinhos abandonados** (não pagos; pago depois / recuperado / provável / não voltou).

## Produção
- **Registro de impressões** (sucesso/falha por lote, taxa de falha real da loja, lote máximo seguro).
- **Otimização** (chapa, planejar produção de kit).
- **Minha farm** (impressoras: custo/hora, vida útil, desgaste, manutenção por calendário, aviso quando o custo sobe e quais produtos reajustar).
- **Insumos**: materiais (filamentos com média das últimas compras, trocar filamento em lote) e embalagens.

## Configuração
**Lojas** (PIN, impressoras), **Canais** (taxas, desconto de anúncio padrão, frete grátis mínimo, rampa ligada/desligada, preço por markup na venda direta, embalagem do canal), **Taxas dos marketplaces** (conferidas nos sites oficiais: Shopee, ML com custo de envio por peso, TikTok com taxa SFP, Shein), **Regras** (metas de preço — margem desejada, margem mínima, lucro mínimo —, calendário de vendas e campanhas, escada de kits, portões da rampa, Ads, estoque, atacado, cupons ativos).

## Limites atuais (o que o app NÃO tem)
- Não controla estoque (só sugere).
- Ads e funil só da Shopee (outros canais: só pedidos).
- Recompra pouco confiável (o contato da Olist parece ser um por pedido).
- Produto sem campo de categoria.
- Vendas via afiliado não vêm em arquivo.
- Lucro líquido com despesas fixas ainda não aparece num número só.
