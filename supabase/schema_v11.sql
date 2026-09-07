-- Precificador Ohra — schema v11 (lista própria de Orçamentos avulsos)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema. Não apaga nem altera nada que já existe.

-- 1) Nova tabela "orcamentos_avulsos": guarda os orçamentos salvos em
-- Orçamento → Encomenda avulsa (venda direta, sem comissão de marketplace).
-- Antes esses registros iam pra mesma tabela solta "produtos" que a
-- Precificação por Canal usava (schema v10 já migrou de lá pra
-- "precos_canal") — agora ganham uma lista própria, já que uma encomenda
-- avulsa não tem um canal cadastrado de verdade por trás.
create table if not exists public.orcamentos_avulsos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  custo_total numeric,
  preco numeric,
  lucro numeric,
  margem numeric,
  criado_em timestamptz not null default now()
);

alter table public.orcamentos_avulsos enable row level security;

drop policy if exists "anon pode ler orcamentos_avulsos" on public.orcamentos_avulsos;
create policy "anon pode ler orcamentos_avulsos" on public.orcamentos_avulsos for select to anon using (true);

drop policy if exists "anon pode inserir orcamentos_avulsos" on public.orcamentos_avulsos;
create policy "anon pode inserir orcamentos_avulsos" on public.orcamentos_avulsos for insert to anon with check (true);

drop policy if exists "anon pode atualizar orcamentos_avulsos" on public.orcamentos_avulsos;
create policy "anon pode atualizar orcamentos_avulsos" on public.orcamentos_avulsos for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir orcamentos_avulsos" on public.orcamentos_avulsos;
create policy "anon pode excluir orcamentos_avulsos" on public.orcamentos_avulsos for delete to anon using (true);

alter publication supabase_realtime add table public.orcamentos_avulsos;

-- 2) Migração "melhor esforço" dos orçamentos avulsos antigos (linhas da
-- tabela "produtos" com canal = 'Encomenda avulsa') pra essa nova tabela.
-- Guardado por "not exists" pra não duplicar se essa migração rodar mais
-- de uma vez.
insert into public.orcamentos_avulsos (loja_id, nome, custo_total, preco, lucro, margem, criado_em)
select p.loja_id, p.nome, p.custo, p.preco, p.preco - p.custo, p.margem, p.criado_em
from public.produtos p
where p.canal = 'Encomenda avulsa'
  and not exists (
    select 1 from public.orcamentos_avulsos o
    where o.loja_id is not distinct from p.loja_id
      and o.nome = p.nome
      and o.criado_em = p.criado_em
  );
