-- Precificador Ohra — schema v48 (Ads: andamento do período)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
-- parcial = o último andamento informado do período de Ads, ACUMULADO desde
-- o início: { ate: 'YYYY-MM-DD', gasto, cliques, vendas, em: timestamp }.
-- Cada envio substitui o anterior (nunca soma).
alter table public.ads_periodos add column if not exists parcial jsonb;
