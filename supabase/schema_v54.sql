-- Precificador Ohra — schema v54 (Ads e rampa do ANÚNCIO com vários itens)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- 1) Ads do anúncio inteiro: um período de Ads pode ser de um anúncio com
--    vários itens (item_tipo = 'grupo', item_id = anuncios_grupo.id).
alter table public.ads_periodos drop constraint if exists ads_periodos_item_tipo_check;
alter table public.ads_periodos add constraint ads_periodos_item_tipo_check check (item_tipo in ('produto', 'kit', 'variacao', 'grupo'));

-- 2) Rampa do anúncio inteiro: a rampa pode ser de um anúncio com vários
--    itens (grupo_id). Nesse caso os degraus são % do preço salvo de cada
--    opção (ex.: 90, 95, 100) e produto_id fica vazio. As rampas por produto
--    continuam exatamente como estão.
alter table public.rampas_preco add column if not exists grupo_id uuid references public.anuncios_grupo(id) on delete cascade;
alter table public.rampas_preco alter column produto_id drop not null;
create unique index if not exists rampas_preco_grupo_canal on public.rampas_preco (grupo_id, canal_id) where grupo_id is not null;
