-- Precificador Ohra — schema v16 (campo SKU em Produtos e Kits)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema. Não apaga nem altera nenhum produto/kit já
-- cadastrado — só adiciona a coluna (fica vazia pros que já existem, você
-- preenche quando quiser em "Editar").

alter table public.produtos_cadastro add column if not exists sku text;
alter table public.kits add column if not exists sku text;
