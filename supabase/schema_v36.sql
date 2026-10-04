-- Precificador Ohra — schema v36 (Crescimento: funil do anúncio na rampa de preço)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA colunas.
-- Do painel de desempenho do produto na Shopee (período: últimos 7 dias):
--   visualizacoes = "Impressões de Produto"
--   visitas       = "Cliques Por Produto"
--   pedidos       = "Pedidos"
-- CTR = visitas ÷ visualizações; Taxa de Conversão de Pedidos = pedidos ÷ visitas.
-- Tudo opcional: em branco fica null (nunca 0).

alter table public.rampa_registros add column if not exists visualizacoes integer;
alter table public.rampa_registros add column if not exists visitas integer;
alter table public.rampa_registros add column if not exists pedidos integer;

-- Recarrega o cache do PostgREST pra as colunas novas aparecerem na hora.
notify pgrst, 'reload schema';
