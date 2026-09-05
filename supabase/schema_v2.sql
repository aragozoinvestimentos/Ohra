-- Precificador Ohra — schema v2 (Materiais, Produtos, Canais, Organização)
-- Cole este arquivo no SQL Editor do Supabase e rode. Não mexe no que já existe
-- (a tabela "produtos" do Histórico continua igual) — só adiciona tabelas novas.

-- =====================================================================
-- Materiais (cadastro de filamentos/insumos)
-- =====================================================================
create table if not exists public.materiais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  preco_kg numeric not null,
  observacao text,
  atualizado_em timestamptz not null default now()
);

alter table public.materiais enable row level security;

drop policy if exists "anon pode ler materiais" on public.materiais;
create policy "anon pode ler materiais" on public.materiais for select to anon using (true);
drop policy if exists "anon pode inserir materiais" on public.materiais;
create policy "anon pode inserir materiais" on public.materiais for insert to anon with check (true);
drop policy if exists "anon pode atualizar materiais" on public.materiais;
create policy "anon pode atualizar materiais" on public.materiais for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir materiais" on public.materiais;
create policy "anon pode excluir materiais" on public.materiais for delete to anon using (true);

-- Semente: os filamentos que já estavam fixos no app.
insert into public.materiais (nome, preco_kg, observacao)
select * from (values
  ('ABS Comum', 99.00, null),
  ('ABS barato', 68.00, null),
  ('Nylon', 320.00, null),
  ('PETG', 90.00, null),
  ('ABS Wood', 150.00, null),
  ('PLA (seu custo real)', 90.16, null)
) as seed(nome, preco_kg, observacao)
where not exists (select 1 from public.materiais);

-- =====================================================================
-- Produtos (ficha reutilizável de cada produto)
-- =====================================================================
create table if not exists public.produtos_cadastro (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  material_nome text,
  custo_producao numeric not null default 0,
  frete_padrao numeric not null default 0,
  embalagem_padrao numeric not null default 0,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.produtos_cadastro enable row level security;

drop policy if exists "anon pode ler produtos_cadastro" on public.produtos_cadastro;
create policy "anon pode ler produtos_cadastro" on public.produtos_cadastro for select to anon using (true);
drop policy if exists "anon pode inserir produtos_cadastro" on public.produtos_cadastro;
create policy "anon pode inserir produtos_cadastro" on public.produtos_cadastro for insert to anon with check (true);
drop policy if exists "anon pode atualizar produtos_cadastro" on public.produtos_cadastro;
create policy "anon pode atualizar produtos_cadastro" on public.produtos_cadastro for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir produtos_cadastro" on public.produtos_cadastro;
create policy "anon pode excluir produtos_cadastro" on public.produtos_cadastro for delete to anon using (true);

-- =====================================================================
-- Canais (Shopee/ML já vêm cadastrados; dá pra adicionar canais próprios)
-- =====================================================================
create table if not exists public.canais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'custom' check (tipo in ('shopee', 'ml', 'custom')),
  ads_pct numeric not null default 0,
  comissao_pct numeric,
  taxa_fixa numeric,
  imposto_pct numeric,
  custos_fixos_pct numeric,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.canais enable row level security;

drop policy if exists "anon pode ler canais" on public.canais;
create policy "anon pode ler canais" on public.canais for select to anon using (true);
drop policy if exists "anon pode inserir canais" on public.canais;
create policy "anon pode inserir canais" on public.canais for insert to anon with check (true);
drop policy if exists "anon pode atualizar canais" on public.canais;
create policy "anon pode atualizar canais" on public.canais for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir canais" on public.canais;
create policy "anon pode excluir canais" on public.canais for delete to anon using (true);

-- Semente: Shopee e Mercado Livre (as taxas continuam calculadas no app pelas
-- faixas oficiais — aqui só fica salvo o % de Ads de cada um).
insert into public.canais (nome, tipo)
select 'Shopee', 'shopee'
where not exists (select 1 from public.canais where tipo = 'shopee');

insert into public.canais (nome, tipo)
select 'Mercado Livre', 'ml'
where not exists (select 1 from public.canais where tipo = 'ml');

-- =====================================================================
-- Organização (kanban simples de etapas)
-- =====================================================================
create table if not exists public.kanban_cards (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  produto_nome text,
  coluna text not null default 'a_produzir'
    check (coluna in ('a_produzir', 'produzindo', 'embalado', 'enviado')),
  criado_em timestamptz not null default now()
);

alter table public.kanban_cards enable row level security;

drop policy if exists "anon pode ler kanban_cards" on public.kanban_cards;
create policy "anon pode ler kanban_cards" on public.kanban_cards for select to anon using (true);
drop policy if exists "anon pode inserir kanban_cards" on public.kanban_cards;
create policy "anon pode inserir kanban_cards" on public.kanban_cards for insert to anon with check (true);
drop policy if exists "anon pode atualizar kanban_cards" on public.kanban_cards;
create policy "anon pode atualizar kanban_cards" on public.kanban_cards for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir kanban_cards" on public.kanban_cards;
create policy "anon pode excluir kanban_cards" on public.kanban_cards for delete to anon using (true);

-- =====================================================================
-- Tempo real (pra sincronizar entre celular/PC igual o Histórico já faz)
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'materiais'
  ) then
    alter publication supabase_realtime add table public.materiais;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'produtos_cadastro'
  ) then
    alter publication supabase_realtime add table public.produtos_cadastro;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'canais'
  ) then
    alter publication supabase_realtime add table public.canais;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kanban_cards'
  ) then
    alter publication supabase_realtime add table public.kanban_cards;
  end if;
end $$;
