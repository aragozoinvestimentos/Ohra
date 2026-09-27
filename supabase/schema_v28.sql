-- Precificador Ohra — schema v28 (forma do acréscimo da Olist por canal)
-- Idempotente; só adiciona uma coluna.
-- 'dentro' = "Base por dentro" da Olist: anunciado = base ÷ (1 − acréscimo)
-- 'simples' = "Base simples": anunciado = base × (1 + acréscimo)
alter table public.canais add column if not exists acrescimo_olist_modo text not null default 'dentro';
