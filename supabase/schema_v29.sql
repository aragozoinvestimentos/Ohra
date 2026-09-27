-- Precificador Ohra — schema v29 (canal principal da Olist)
-- Idempotente; só adiciona colunas. Inclui a coluna do v28 de novo (não faz
-- mal se já existir) pra quem ainda não rodou o v28.
alter table public.canais add column if not exists acrescimo_olist_modo text not null default 'dentro';
-- Canal principal da Olist: o preço cadastrado na Olist = preço real desse canal
-- (e a promo dele = o acréscimo). Um por loja — o app garante isso ao marcar.
alter table public.canais add column if not exists olist_principal boolean not null default false;
