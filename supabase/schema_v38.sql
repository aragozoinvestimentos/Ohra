-- Precificador Ohra — schema v38 (pedido mínimo pra frete grátis por canal)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA uma coluna.
--   canais.frete_gratis_min  valor mínimo que o cliente PAGA (por pedido) pra ter
--                            frete grátis no canal; null = não se aplica.
-- Shopee já nasce com R$ 10 (só onde ainda está vazio — não sobrescreve nada).

alter table public.canais add column if not exists frete_gratis_min numeric;

update public.canais set frete_gratis_min = 10 where tipo = 'shopee' and frete_gratis_min is null;
