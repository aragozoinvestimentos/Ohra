-- schema_v56 — Embalagem própria do canal orgânico (venda na loja)
-- Só ACRESCENTA colunas (nada some; sem configurar, o app fica igual a hoje).
--
-- canais.embalagem_canal (só canais próprios): null = a embalagem do produto
--   (como hoje); {"modo":"sem","freteZero":true} = sem embalagem;
--   {"modo":"itens","itens":[{"embalagem_id":"…","quantidade":1}],"freteZero":true}
--   = receita própria do canal (vale pra todo produto sem a sua).
-- produtos_cadastro.embalagem_organico / kits.embalagem_organico:
--   null = ainda não definido (usa a do canal e o app avisa ao lançar a venda);
--   {"modo":"canal"} = usar a do canal (confirmado); {"modo":"sem"};
--   {"modo":"itens","itens":[…]} = embalagem própria deste produto/kit.
--   Variações (kit 2, kit 3…) seguem a do produto.

alter table public.canais add column if not exists embalagem_canal jsonb;
alter table public.produtos_cadastro add column if not exists embalagem_organico jsonb;
alter table public.kits add column if not exists embalagem_organico jsonb;
