-- Precificador Ohra — schema v27 (preço por quantidade + Olist)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem apagar nada. Só ADICIONA colunas/tabelas;
-- nenhum dado existente muda.

-- 1) Acréscimo da Olist por canal -----------------------------------------
-- Mesmo % configurado na integração da Olist pra esse canal (guardado como
-- fração, igual imposto_pct: 0.2 = 20%). null = canal sem Olist.
alter table public.canais add column if not exists acrescimo_olist_pct numeric;

-- 2) Configuração da escada de preços (por loja) --------------------------
-- { r2, r10, piso, vantagemMin, margemMin, margemDesejada, freteMl: [{ ateG, valor }] }
-- null = padrões do app.
alter table public.lojas add column if not exists config_escada jsonb;

-- 3) Escada própria do produto (opcional) --------------------------------
-- null = usa a da loja; senão { r2, r10, piso, vantagemMin }.
alter table public.produtos_cadastro add column if not exists escada_config jsonb;

-- 4) Preço do concorrente por item × canal (opcional) --------------------
create table if not exists public.precos_concorrente (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'kit', 'variacao')),
  item_id uuid not null,
  canal_id uuid not null references public.canais(id) on delete cascade,
  preco numeric not null,
  atualizado_em timestamptz not null default now(),
  unique (item_tipo, item_id, canal_id)
);
create index if not exists precos_concorrente_loja_idx on public.precos_concorrente (loja_id);

-- 5) Última publicação na Olist por item ---------------------------------
-- Guarda o que foi marcado como publicado (base da Olist + promo % por
-- canal) pra aba Publicar saber o que mudou desde então (↻ atualizar).
create table if not exists public.publicacoes_olist (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'kit', 'variacao')),
  item_id uuid not null,
  base numeric not null,
  promos jsonb not null default '{}'::jsonb,   -- { "<canal_id>": 18, ... } (% inteiro)
  publicado_em timestamptz not null default now(),
  unique (item_tipo, item_id)
);
create index if not exists publicacoes_olist_loja_idx on public.publicacoes_olist (loja_id);

-- RLS no mesmo padrão das outras tabelas (anon-key, permissiva) ----------
do $$
declare
  t text;
begin
  foreach t in array array['precos_concorrente', 'publicacoes_olist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon pode ler %s" on public.%I', t, t);
    execute format('create policy "anon pode ler %s" on public.%I for select to anon using (true)', t, t);
    execute format('drop policy if exists "anon pode inserir %s" on public.%I', t, t);
    execute format('create policy "anon pode inserir %s" on public.%I for insert to anon with check (true)', t, t);
    execute format('drop policy if exists "anon pode atualizar %s" on public.%I', t, t);
    execute format('create policy "anon pode atualizar %s" on public.%I for update to anon using (true) with check (true)', t, t);
    execute format('drop policy if exists "anon pode excluir %s" on public.%I', t, t);
    execute format('create policy "anon pode excluir %s" on public.%I for delete to anon using (true)', t, t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
