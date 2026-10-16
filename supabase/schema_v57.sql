-- Precificador Ohra — schema v57 (Ads pelo método: lance automático + campanha da loja)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
-- Os períodos que já existem continuam iguais ('normal' = meta de ROAS).

-- 1) Tipo do período: 'auto' = produto novo no GMV Max – Lance Automático
--    (sem meta; o app confere no dia 3 e sugere a meta no dia 7).
alter table public.ads_periodos drop constraint if exists ads_periodos_tipo_check;
alter table public.ads_periodos add constraint ads_periodos_tipo_check check (tipo in ('normal', 'teste', 'auto'));

-- 2) Campanha da loja inteira (GMV Max da Loja): item_tipo = 'loja',
--    item_id = id da loja.
alter table public.ads_periodos drop constraint if exists ads_periodos_item_tipo_check;
alter table public.ads_periodos add constraint ads_periodos_item_tipo_check check (item_tipo in ('produto', 'kit', 'variacao', 'grupo', 'loja'));
