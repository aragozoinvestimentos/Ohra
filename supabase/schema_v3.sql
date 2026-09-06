-- Precificador Ohra — schema v3 (multi-loja)
-- Cole no SQL Editor do Supabase e rode. Cria a tabela de lojas, adiciona
-- loja_id nas tabelas existentes e migra os dados atuais pra uma loja
-- padrão "Loja 1" — nada some pra quem já vinha usando o app antes disso.

create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

alter table public.lojas enable row level security;

drop policy if exists "anon pode ler lojas" on public.lojas;
create policy "anon pode ler lojas" on public.lojas for select to anon using (true);
drop policy if exists "anon pode inserir lojas" on public.lojas;
create policy "anon pode inserir lojas" on public.lojas for insert to anon with check (true);
drop policy if exists "anon pode atualizar lojas" on public.lojas;
create policy "anon pode atualizar lojas" on public.lojas for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir lojas" on public.lojas;
create policy "anon pode excluir lojas" on public.lojas for delete to anon using (true);

-- Loja padrão pra receber os dados que já existem (id fixo pra o script
-- poder rodar mais de uma vez sem duplicar).
insert into public.lojas (id, nome)
values ('00000000-0000-0000-0000-000000000001', 'Loja 1')
on conflict (id) do nothing;

alter table public.materiais add column if not exists loja_id uuid references public.lojas(id) on delete cascade;
alter table public.produtos_cadastro add column if not exists loja_id uuid references public.lojas(id) on delete cascade;
alter table public.canais add column if not exists loja_id uuid references public.lojas(id) on delete cascade;
alter table public.kanban_cards add column if not exists loja_id uuid references public.lojas(id) on delete cascade;
alter table public.produtos add column if not exists loja_id uuid references public.lojas(id) on delete cascade;

update public.materiais set loja_id = '00000000-0000-0000-0000-000000000001' where loja_id is null;
update public.produtos_cadastro set loja_id = '00000000-0000-0000-0000-000000000001' where loja_id is null;
update public.canais set loja_id = '00000000-0000-0000-0000-000000000001' where loja_id is null;
update public.kanban_cards set loja_id = '00000000-0000-0000-0000-000000000001' where loja_id is null;
update public.produtos set loja_id = '00000000-0000-0000-0000-000000000001' where loja_id is null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lojas'
  ) then
    alter publication supabase_realtime add table public.lojas;
  end if;
end $$;
