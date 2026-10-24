# Decisões pendentes (guardadas pra decidir junto com o Gustavo)

> **24/10/2026: itens 1, 2 e 3 FEITOS** (semana curta + Ads e teste; Início novo; Desempenho com carrinho; diagnóstico por anúncio; Análise → Diagnóstico; histórico de ações v64). Falta só: perguntar ao Gustavo como fazer a "Minha empresa".

Nada daqui foi implementado. Quando o Gustavo pedir, reler e decidir junto.

## 1. Rampa do kit Leão de Judá (23/10/2026)

- **Semana curta antes de um marco novo**: hoje, quando a rampa ganha um marco (início, refazer, subida, descida), os dias entre a última semana fechada e o marco ficam FORA da conta (nem semana, nem "em aberto"). Foi o que fez a venda de 22/10 do kit sumir. Proposta: esses dias viram uma "semana curta" (`semanasAutomaticas` em `src/lib/semanasAuto.js`), que conta nas vendas no total, no lucro e nos portões, com as regras semanais fazendo a proporção (× 7 ÷ N, como já fazem com períodos irregulares). Junto: ao iniciar a rampa, o campo "vendas até hoje" vem preenchido com as vendas já importadas do item no canal.
- **Aba "Ads e teste" sem Ads ligado**: hoje mostra só o período ligado e, sem ele, a última semana fechada com Ads (ficava "—"). Proposta: mostrar o ÚLTIMO PERÍODO ENCERRADO (datas, gasto, vendas, ROAS, retorno — `numerosDoPeriodo`, mesma conta do Painel do anúncio) + linha "Agora: sem Ads próprio · GMV Max da Loja gastou R$X neste item nos últimos 7 dias".
- Lembrete: esse kit nunca teve período de Ads ligado no app (o gasto do CSV ficou sem dono — ID 58270756155 sem ligação com o SKU KIT-LJUDAH-ELEV). Ideia oferecida: avisar quando o CSV tiver gasto de um anúncio sem período no app.

## 2. "Inteligência Comercial" (prompt recebido pelo Gustavo, 24/10/2026)

**Avaliação**: ~70% já existe espalhado no app. NÃO criar módulo paralelo (duplicaria contas). Fazer uma sub-aba nova na Análise que responde as 7 perguntas em cartões e leva pras telas que já calculam, + 4 coisas que faltam.

### Já existe
| Pedido | Onde | Falta |
|---|---|---|
| 1. Indicadores | Dinheiro → Resumo do mês (faturamento, descontos, taxas, repor, Ads, recebe, lucro antes/depois do Ads, por canal e anúncio); Análise → Evolução e métricas (ticket, itens/pedido, desconto efetivo, recompra, cancelamento, TACoS); Comparar períodos | Lucro líquido (tirar as contas fixas do Caixa); categoria (produto não tem o campo) |
| 2. Ticket médio | Evolução e métricas | Simulação "ticket R$30/40/50" (projeção) |
| 3. Cupons | Cupom da loja, Cupons ativos (faixas, ideal, real), cupom da live | Simular 2/5/7/10% em todos os produtos; cadastro com nome/validade/usos/produtos |
| 4. Compra mínima | Só na live | Versão da loja pelos PEDIDOS REAIS |
| 5. Ads | ROAS, equilíbrio, retorno, teto, alertas, GMV Max por produto | Resumo consolidado; CAC não dá |
| 6. Rentabilidade por produto | Curva ABC (lucro/valor/qtd/lucro por hora, chips prejuízo e "cuidar do preço"), Ranking, Comprados juntos | Ordenar por margem % |
| 7. Recomendações | "Pra fazer" do Início (Resolver/Atenção/Oportunidade) | Os avisos comerciais novos — entram no Início |
| 8. Simulador | Por produto (Avulso, Promoções, Metas) | Simulador da loja inteira, atual × simulado |
| 11. Confiabilidade | Já é regra (estimado × real, custo de hoje, Ads uma vez, canais separados) | Linha de fórmula + período em cada cartão |

### Sugestão (ordem de valor)
1. **Compra mínima pelos pedidos reais** — pra cada mínimo (29,90/39,90/49,90/59,90): % dos pedidos que JÁ passam (custo puro do cupom = desconto × esses pedidos), quanto falta pra quem está logo abaixo, quantos pedidos precisariam subir pra empatar. Armadilha: cupom com mínimo abaixo do ticket só dá desconto a quem compraria de qualquer jeito.
2. **Lucro líquido do mês** = margem de contribuição − Ads − contas fixas pagas no mês (do Caixa); sem contas fixas = "Dados insuficientes"; comparar com o mês anterior.
3. **Cupom por %** no Cupom da loja: colunas 2/5/7/10% com lucro por item + "fatia das vendas sem folga".
4. **Análise → 5 · Diagnóstico**: 7 perguntas em cartões (resposta, números, fórmula, período, link), simulador da loja (atual × simulado) e simulação do ticket como projeção. Oportunidades novas também no Início.

### Não fazer (ou depois)
- Cadastro completo de cupons (só se a Shopee exportar relatório de cupons usados — Gustavo mandaria o arquivo).
- Recompra/compradores: o "ID contato" da Olist parece ser um por pedido → recompra subestimada; marcar como dado não confiável.
- CAC: não há como saber cliente novo.
- Categoria: precisa de campo novo (SQL) e de classificar os produtos — decisão do Gustavo.
- Faturamento atribuído a Ads fora da Shopee: "Dados insuficientes".

Sem SQL (a não ser categoria). Começar pelos itens 1 e 2.

## 3. "Diagnóstico Comercial Inteligente" (2º prompt do ChatGPT, 24/10/2026) — junta com o item 2

Avaliação com os arquivos REAIS da Shopee (16–22/10 e 17–23/10):
- **Desempenho do produto** (`parentskudetail.*.xlsx`, 5 abas: Melhor Desempenho (só ela tem SKU — o app lê só ela, e ela já traz TODOS os produtos), Recém-Cadastrados, Impulsionar com ADS, Otimize seus ADS, Acompanhar ADS). Colunas que o app NÃO lê hoje e valem: Pedido Feito × Produto Pago, Unidades realizado × pago, **Compradores** (realizado/pago), **Visitantes do Produto (Visita)**, Visualizações da Página, **Visitantes que saíram / Taxa de Rejeição**, **Cliques em buscas** (orgânico), Curtidas, **Visitantes (Adicionar ao Carrinho)**, Unidades (adicionar ao carrinho), Taxa de conversão (carrinho), **Taxa de Recompra** e média de dias pra recompra (da Shopee — resolve a recompra que a Olist não dá), e carrinho POR VARIAÇÃO.
- **Tráfego do produto** (`producttraffic_Product_Card.*.xlsx`): só impressões/cliques/pedidos/compradores do cartão do produto — nada novo; NÃO importar.
- **Shopee Ads CSV**: também traz "Adicionar ao carrinho", "Conversões Diretas" × total, ACOS (= 1/ROAS).
- **GMV Max da Loja CSV**: já lido.

Ordem proposta: (1) semana curta da rampa; (2) ler as colunas novas do Desempenho (sem SQL — vai no `importacoes.dados`); (3) diagnóstico único por anúncio pra TODOS os anúncios (não só rampa), funil de 4 etapas impressão → clique → carrinho → pago, cenários 2, 4, 6, 7, 10 novos, estrutura diagnóstico/evidência/ação/como/prioridade/reavaliar/sucesso, no "O que fazer agora" do Painel + Início; (4) Análise → Diagnóstico (lista + compra mínima pelos pedidos + lucro líquido); (5) histórico de ações + antes × depois (SQL, tabela nova; ações do app entram sozinhas, manuais com 1 clique; "associação, não causa"). Fora: ACOS separado, motor de 9 pesos (usar os 3 grupos + impacto R$/semana), custo compartilhado em pedido, importar o Tráfego.

### Ajustes aprovados (24/10/2026, retorno do ChatGPT revisado)
- Antes × depois: 1ª avaliação em 7 dias; amostra pequena → estende pra 14+ ("aguardando dados"); variação dentro do ruído = "inconclusivo", nunca "funcionou" automático (a conclusão é sempre do Gustavo).
- Registro manual de decisões tomadas direto no marketplace (Ads, imagem, título, preço, cupom, promoção) — o ajuste de Ads manual reaproveita o "Registrar ajuste" que já existe (sem registro em dobro).
- Custo que não dá pra atribuir com segurança (ex.: GMV Max da Loja por produto, custo por pedido em pedido com vários itens) = mostrar "não atribuído"/limitação, nunca ratear em silêncio.
- Tráfego do produto: conferido coluna a coluna — tudo já existe no Desempenho. Só vale se a tela da Shopee permitir exportar OUTRAS origens de tráfego (o arquivo enviado é só "Product_Card") — Gustavo vai conferir.
- **Depois de concluir o Diagnóstico: perguntar ao Gustavo como fazer a "Minha empresa" (escritório virtual com funcionários por setor, dados reais, só mostra — aprovado em 24/10/2026).**

## 4. "Sede da <loja>" — escritório virtual (decidido em 24/10/2026, prévia ainda não feita)
- Nome: **"Sede da <nome da loja>"**; botão "🏢 Entrar na Sede" no topo do Início (volta com "Sair da Sede").
- Visual 2.5D isométrico, estilo simples e fofo; bonecos SEMPRE se mexendo (andam, digitam, levam caixas); com aviso ganham balão; respeita "reduzir movimento".
- Simula a vida real com dados do app: uma impressora por impressora da Minha farm (manutenção/desgaste visíveis), estoque, recepção com os arquivos, setores (Preços, Anúncios/Rampa, Ads, Financeiro, Análise) com uniforme por setor.
- **Duas salas de diretoria**: Gustavo (CEO, camisa social + blazer) e a esposa (sócia/CEO) — ela anda pela empresa, cuida da Live e da revenda (beleza/maquiagem). **Cantinho de Live** (estúdio) ligado à aba Live (próxima live, "● ao vivo").
- Nome no boneco: NÃO foto — plaquinha com o nome na porta/mesa + boneco com traços parecidos (cabelo, pele, barba/óculos). Falta: nome da esposa e as características dos dois.
- A revenda (beleza) será na MESMA loja Ohra → o estoque da Sede tem prateleiras 3D e de beleza. Juliana = CEO (plaquinha "Juliana · CEO"), uma sala de diretoria com duas mesas. Traços: Gustavo cabelo escuro curto, barba cheia, pele morena clara; Juliana cabelo preto longo e liso, pele clara. Prévia: scratchpad prototipo/sede-v1.html.
