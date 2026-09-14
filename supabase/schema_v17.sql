-- Nova tabela "promocoes_salvas": guarda as promoções salvas em
-- Promoções → Simular promoção → "Salvar essa promoção" — mesmo padrão de
-- orcamentos_avulsos (schema v11), mas com um "tipo" (desconto, progressivo,
-- combo, combinada, frete, brinde, liquidação) e um "resumo" em texto da
-- configuração usada, já que cada tipo de promoção calcula de um jeito
-- diferente e nem sempre tem um preço único (ex: Progressivo tem várias
-- faixas, não um preço só).
create table if not exists public.promocoes_salvas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  tipo text not null,
  item_nome text,
  canal_nome text,
  preco numeric,
  lucro numeric,
  margem numeric,
  resumo text,
  criado_em timestamptz not null default now()
);

alter table public.promocoes_salvas enable row level security;

drop policy if exists "anon pode ler promocoes_salvas" on public.promocoes_salvas;
create policy "anon pode ler promocoes_salvas" on public.promocoes_salvas for select to anon using (true);

drop policy if exists "anon pode inserir promocoes_salvas" on public.promocoes_salvas;
create policy "anon pode inserir promocoes_salvas" on public.promocoes_salvas for insert to anon with check (true);

drop policy if exists "anon pode atualizar promocoes_salvas" on public.promocoes_salvas;
create policy "anon pode atualizar promocoes_salvas" on public.promocoes_salvas for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir promocoes_salvas" on public.promocoes_salvas;
create policy "anon pode excluir promocoes_salvas" on public.promocoes_salvas for delete to anon using (true);

alter publication supabase_realtime add table public.promocoes_salvas;
