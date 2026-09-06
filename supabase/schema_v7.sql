-- Precificador Ohra — schema v7 (Embalagens + Kits)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nada.
--
-- Cria: catálogo de Embalagens (nome, preço, unidade — igual Materiais, só
-- que pra itens de embalagem); a receita de embalagem de cada Produto
-- (produto_embalagens: quais itens + quantidade); e Kits (vários produtos
-- agrupados, com sua própria embalagem — independente da embalagem de cada
-- produto individual, porque um combo costuma economizar embalagem em vez
-- de somar).

-- =====================================================================
-- Embalagens (catálogo: caixa, plástico bolha, envelope...)
-- =====================================================================
create table if not exists public.embalagens (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  preco numeric not null,
  unidade text not null default 'un',
  observacao text,
  atualizado_em timestamptz not null default now()
);

alter table public.embalagens enable row level security;
drop policy if exists "anon pode ler embalagens" on public.embalagens;
create policy "anon pode ler embalagens" on public.embalagens for select to anon using (true);
drop policy if exists "anon pode inserir embalagens" on public.embalagens;
create policy "anon pode inserir embalagens" on public.embalagens for insert to anon with check (true);
drop policy if exists "anon pode atualizar embalagens" on public.embalagens;
create policy "anon pode atualizar embalagens" on public.embalagens for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir embalagens" on public.embalagens;
create policy "anon pode excluir embalagens" on public.embalagens for delete to anon using (true);

-- =====================================================================
-- Receita de embalagem de cada Produto (itens + quantidade)
-- =====================================================================
create table if not exists public.produto_embalagens (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos_cadastro(id) on delete cascade,
  embalagem_id uuid not null references public.embalagens(id) on delete cascade,
  quantidade numeric not null default 1
);

alter table public.produto_embalagens enable row level security;
drop policy if exists "anon pode ler produto_embalagens" on public.produto_embalagens;
create policy "anon pode ler produto_embalagens" on public.produto_embalagens for select to anon using (true);
drop policy if exists "anon pode inserir produto_embalagens" on public.produto_embalagens;
create policy "anon pode inserir produto_embalagens" on public.produto_embalagens for insert to anon with check (true);
drop policy if exists "anon pode atualizar produto_embalagens" on public.produto_embalagens;
create policy "anon pode atualizar produto_embalagens" on public.produto_embalagens for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir produto_embalagens" on public.produto_embalagens;
create policy "anon pode excluir produto_embalagens" on public.produto_embalagens for delete to anon using (true);

-- =====================================================================
-- Kits (vários produtos agrupados + embalagem própria do combo)
-- =====================================================================
create table if not exists public.kits (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  observacao text,
  atualizado_em timestamptz not null default now()
);

alter table public.kits enable row level security;
drop policy if exists "anon pode ler kits" on public.kits;
create policy "anon pode ler kits" on public.kits for select to anon using (true);
drop policy if exists "anon pode inserir kits" on public.kits;
create policy "anon pode inserir kits" on public.kits for insert to anon with check (true);
drop policy if exists "anon pode atualizar kits" on public.kits;
create policy "anon pode atualizar kits" on public.kits for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir kits" on public.kits;
create policy "anon pode excluir kits" on public.kits for delete to anon using (true);

create table if not exists public.kit_produtos (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  produto_id uuid not null references public.produtos_cadastro(id) on delete cascade,
  quantidade numeric not null default 1
);

alter table public.kit_produtos enable row level security;
drop policy if exists "anon pode ler kit_produtos" on public.kit_produtos;
create policy "anon pode ler kit_produtos" on public.kit_produtos for select to anon using (true);
drop policy if exists "anon pode inserir kit_produtos" on public.kit_produtos;
create policy "anon pode inserir kit_produtos" on public.kit_produtos for insert to anon with check (true);
drop policy if exists "anon pode atualizar kit_produtos" on public.kit_produtos;
create policy "anon pode atualizar kit_produtos" on public.kit_produtos for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir kit_produtos" on public.kit_produtos;
create policy "anon pode excluir kit_produtos" on public.kit_produtos for delete to anon using (true);

create table if not exists public.kit_embalagens (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  embalagem_id uuid not null references public.embalagens(id) on delete cascade,
  quantidade numeric not null default 1
);

alter table public.kit_embalagens enable row level security;
drop policy if exists "anon pode ler kit_embalagens" on public.kit_embalagens;
create policy "anon pode ler kit_embalagens" on public.kit_embalagens for select to anon using (true);
drop policy if exists "anon pode inserir kit_embalagens" on public.kit_embalagens;
create policy "anon pode inserir kit_embalagens" on public.kit_embalagens for insert to anon with check (true);
drop policy if exists "anon pode atualizar kit_embalagens" on public.kit_embalagens;
create policy "anon pode atualizar kit_embalagens" on public.kit_embalagens for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir kit_embalagens" on public.kit_embalagens;
create policy "anon pode excluir kit_embalagens" on public.kit_embalagens for delete to anon using (true);

-- =====================================================================
-- Realtime — pra sincronizar entre abas/aparelhos igual o resto do app
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'embalagens') then
    alter publication supabase_realtime add table public.embalagens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'produto_embalagens') then
    alter publication supabase_realtime add table public.produto_embalagens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kits') then
    alter publication supabase_realtime add table public.kits;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kit_produtos') then
    alter publication supabase_realtime add table public.kit_produtos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kit_embalagens') then
    alter publication supabase_realtime add table public.kit_embalagens;
  end if;
end $$;
