-- Precificador Ohra — schema v34 (Crescimento: teste de lançamento com Ads)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA colunas.

-- Teste de lançamento por rampa: status (null = o app decide: observando /
-- não precisa / recomendado), quando começou, orçamento, prazo e meta.
alter table public.rampas_preco add column if not exists teste_status text;     -- 'iniciado' | 'concluido' | 'pulado'
alter table public.rampas_preco add column if not exists teste_inicio date;
alter table public.rampas_preco add column if not exists teste_fim date;
alter table public.rampas_preco add column if not exists teste_orcamento numeric;
alter table public.rampas_preco add column if not exists teste_dias integer;
alter table public.rampas_preco add column if not exists teste_meta integer;

-- Cliques do Ads em cada registro (pra saber se o problema é visita ou anúncio).
alter table public.rampa_registros add column if not exists ads_cliques integer;
