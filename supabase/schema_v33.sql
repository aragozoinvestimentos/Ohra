-- Precificador Ohra — schema v33 (aba Crescimento: rampa de preço)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA tabelas —
-- nada existente muda. O preço salvo (precos_canal) continua sendo o ALVO;
-- a rampa guarda à parte em que degrau o produto está vendendo.

-- 1) Rampa por produto × canal -----------------------------------------------
create table if not exists public.rampas_preco (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  produto_id uuid not null references public.produtos_cadastro(id) on delete cascade,
  canal_id uuid not null references public.canais(id) on delete cascade,
  degraus jsonb not null default '[]'::jsonb,       -- preços reais de cada degrau, do 1º ao alvo
  degrau_atual integer not null default 0,          -- índice em degraus
  desde date not null default current_date,         -- quando entrou no degrau atual
  base_avaliacoes integer not null default 0,       -- avaliações no início do degrau atual
  vendas_iniciais integer not null default 0,       -- vendas que o anúncio já tinha ao iniciar
  checklist jsonb not null default '{}'::jsonb,     -- "Revisar anúncio" marcado
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (produto_id, canal_id)
);

-- 2) Registros: início, semanas e mudanças de degrau --------------------------
create table if not exists public.rampa_registros (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  rampa_id uuid not null references public.rampas_preco(id) on delete cascade,
  tipo text not null default 'semana' check (tipo in ('inicio', 'semana', 'subida', 'descida')),
  data date not null default current_date,
  degrau integer,
  preco numeric,                 -- preço real do degrau naquele momento
  vendas integer,                -- vendas da semana
  avaliacoes integer,            -- total de avaliações do anúncio
  nota numeric,
  avaliacoes_ruins integer not null default 0,  -- 1–2★ recebidas na semana
  ads_gasto numeric,
  ads_vendas integer,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists rampa_registros_idx on public.rampa_registros (rampa_id, data);

do $$
declare t text;
begin
  foreach t in array array['rampas_preco', 'rampa_registros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon pode ler %1$s" on public.%1$I', t);
    execute format('create policy "anon pode ler %1$s" on public.%1$I for select to anon using (true)', t);
    execute format('drop policy if exists "anon pode inserir %1$s" on public.%1$I', t);
    execute format('create policy "anon pode inserir %1$s" on public.%1$I for insert to anon with check (true)', t);
    execute format('drop policy if exists "anon pode atualizar %1$s" on public.%1$I', t);
    execute format('create policy "anon pode atualizar %1$s" on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('drop policy if exists "anon pode excluir %1$s" on public.%1$I', t);
    execute format('create policy "anon pode excluir %1$s" on public.%1$I for delete to anon using (true)', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
