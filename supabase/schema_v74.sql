-- schema_v74 (31/10/2026): estoque por COR.
-- Produto com a variação "Cor" na Ficha do anúncio passa a ter o estoque separado por cor.
-- Os movimentos que já existem ficam sem cor ("sem cor") — distribua com um inventário.
alter table public.estoque_movimentos add column if not exists cor text;
