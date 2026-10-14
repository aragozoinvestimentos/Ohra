-- Precificador Ohra — schema v53 (vendas do anúncio com vários itens)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- A importação do relatório da Shopee (Crescimento → Registrar semana)
-- separa as vendas do anúncio com vários itens (ex.: Kit Natal 01) por opção
-- e grava cada opção em vendas_organicas (SÓ financeiro: Vendas do mês, lucro,
-- reserva — não conta nos portões da rampa nem no Ads). Esta coluna diz de
-- qual anúncio a venda veio, pro quadro "Qual opção vende" da 3º Ficha.
alter table public.vendas_organicas add column if not exists grupo_id uuid references public.anuncios_grupo(id) on delete set null;
create index if not exists vendas_organicas_grupo_idx on public.vendas_organicas (grupo_id, data);
