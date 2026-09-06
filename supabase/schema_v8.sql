-- Precificador Ohra — schema v8 (detalhamento do custo de produção por produto)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema.
--
-- O que muda: produtos_cadastro ganha uma coluna "producao_detalhe" (jsonb,
-- opcional) — guarda todos os campos usados na aba Custo de Produção
-- (comprimento de filamento, densidade, tempo de impressão, consumíveis
-- usados, ROI da máquina etc.) pra esse produto específico. Produtos
-- cadastrados antes disso continuam funcionando normalmente, só ficam sem
-- esse detalhamento até serem preenchidos manualmente na aba Produtos.

alter table public.produtos_cadastro add column if not exists producao_detalhe jsonb;
