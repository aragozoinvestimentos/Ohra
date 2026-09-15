-- "Encomenda em volume" ganhou o botão Salvar (igual "Encomenda avulsa" já
-- tinha) — os dois salvam na mesma tabela orcamentos_avulsos, mas um lote
-- de volume representa VÁRIAS unidades (preço/custo/lucro TOTAIS do
-- pedido). Sem uma quantidade guardada, um preço salvo de um lote de 10
-- pareceria (errado) o preço de uma unidade só. Coluna aditiva e opcional —
-- linhas antigas (todas de "Encomenda avulsa", sempre 1 unidade) ficam com
-- quantidade nula, sem precisar de nenhum backfill.
alter table public.orcamentos_avulsos add column if not exists quantidade integer;
