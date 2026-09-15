-- Nova aba "Metas": uma meta de faturamento/lucro por mês (loja_id + mes,
-- "mes" no formato 'YYYY-MM') e um simulador de vendas que usa os preços
-- JÁ SALVOS em Preços por Canal (precos_canal) pra ver se um cenário de
-- vendas bateria a meta do mês. Sem "reset" automático no banco — cada mês
-- vira uma linha nova (identificada pelo "mes"), então o histórico de meses
-- anteriores fica guardado sozinho; o app só passa a ler/gravar a linha do
-- mês corrente conforme a data muda.
create table if not exists public.metas_mensais (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  mes text not null,
  faturamento_objetivo numeric,
  lucro_objetivo numeric,
  criado_em timestamptz not null default now()
);

alter table public.metas_mensais enable row level security;

drop policy if exists "anon pode ler metas_mensais" on public.metas_mensais;
create policy "anon pode ler metas_mensais" on public.metas_mensais for select to anon using (true);

drop policy if exists "anon pode inserir metas_mensais" on public.metas_mensais;
create policy "anon pode inserir metas_mensais" on public.metas_mensais for insert to anon with check (true);

drop policy if exists "anon pode atualizar metas_mensais" on public.metas_mensais;
create policy "anon pode atualizar metas_mensais" on public.metas_mensais for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir metas_mensais" on public.metas_mensais;
create policy "anon pode excluir metas_mensais" on public.metas_mensais for delete to anon using (true);

alter publication supabase_realtime add table public.metas_mensais;
