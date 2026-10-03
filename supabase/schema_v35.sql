-- Precificador Ohra — schema v35 (Crescimento → Afiliados)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA tabelas.

-- 1) Comissão de afiliado: linha sem item = comissão padrão do canal (campanha
--    aberta); linha com item = item na campanha (ativo) com comissão própria
--    (ou null = usa a padrão do canal).
create table if not exists public.afiliado_config (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  canal_id uuid not null references public.canais(id) on delete cascade,
  item_tipo text,          -- null | 'produto' | 'variacao' | 'kit'
  item_id uuid,
  comissao numeric,        -- fração (0.12 = 12%)
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists afiliado_config_unico on public.afiliado_config (canal_id, coalesce(item_tipo, ''), coalesce(item_id::text, ''));

-- 2) Parceiros (campanhas exclusivas) e amostras.
create table if not exists public.afiliados (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,                 -- @perfil
  rede text,                          -- Instagram, TikTok, grupo…
  nicho text,
  canal_id uuid references public.canais(id) on delete set null,
  comissao numeric,                   -- fração
  status text not null default 'convidado' check (status in ('convidado', 'amostra', 'divulgou', 'ativo', 'parado')),
  status_desde date not null default current_date,
  amostra_item_tipo text,
  amostra_item_id uuid,
  amostra_qtd integer not null default 1,
  amostra_frete numeric,
  amostra_data date,
  observacao text,
  criado_em timestamptz not null default now()
);

-- 3) Registro da semana de item com afiliado: vendas via afiliado e comissão;
--    pra item fora de rampa, também o total vendido e o Ads da semana.
create table if not exists public.afiliado_registros (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null,
  item_id uuid not null,
  canal_id uuid not null references public.canais(id) on delete cascade,
  data date not null default current_date,
  vendas integer not null default 0,  -- vendas via afiliado
  comissao numeric not null default 0,-- comissão paga (R$)
  preco numeric,                      -- preço vendendo na semana
  vendas_total integer,               -- total vendido na semana (só pra item fora de rampa)
  ads_gasto numeric,                  -- (só pra item fora de rampa)
  ads_cliques integer,
  ads_vendas integer,
  parceiro_id uuid references public.afiliados(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists afiliado_registros_idx on public.afiliado_registros (item_tipo, item_id, canal_id, data);

do $$
declare t text;
begin
  foreach t in array array['afiliado_config', 'afiliados', 'afiliado_registros'] loop
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
