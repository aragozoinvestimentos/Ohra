-- Precificador Ohra — schema v58 (Análise → Importar dados: bloco Avaliações)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- Avaliações não vêm em nenhum arquivo da plataforma: cada atualização do
-- bloco Avaliações guarda o TOTAL que a plataforma mostra naquele dia (por
-- estrela, ou só o total no modo simples). O app tira a diferença pra saber as
-- novas. Os portões da Rampa leem daqui (o "Registrar semana" saiu).
create table if not exists public.avaliacoes_produto (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'kit', 'grupo')),
  item_id uuid not null,
  canal_id uuid references public.canais(id) on delete cascade,
  data date not null,
  e5 integer, e4 integer, e3 integer, e2 integer, e1 integer, -- total por estrela (null = modo simples)
  total integer,                   -- total de avaliações
  nota numeric(3, 2),              -- nota mostrada (opcional; sem ela, calcula pelas estrelas)
  ruins_novas integer,             -- modo simples: 1–2★ novas informadas
  tres_novas integer,              -- modo simples: 3★ novas informadas
  criado_em timestamptz not null default now()
);
create index if not exists avaliacoes_produto_item_idx on public.avaliacoes_produto (loja_id, item_tipo, item_id, canal_id, data);

do $$
declare t text;
begin
  foreach t in array array['avaliacoes_produto'] loop
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

-- Migração: a última avaliação/nota registrada em cada rampa (Registrar semana)
-- vira a 1ª linha do item, pra o bloco já abrir com o total de hoje.
insert into public.avaliacoes_produto (loja_id, item_tipo, item_id, canal_id, data, total, nota)
select distinct on (r.id)
  r.loja_id,
  case when r.grupo_id is not null then 'grupo' else 'produto' end,
  coalesce(r.grupo_id, r.produto_id),
  r.canal_id,
  g.data,
  g.avaliacoes,
  g.nota
from public.rampas_preco r
join public.rampa_registros g on g.rampa_id = r.id and g.avaliacoes is not null
where coalesce(r.grupo_id, r.produto_id) is not null
  and not exists (
    select 1 from public.avaliacoes_produto a
    where a.item_id = coalesce(r.grupo_id, r.produto_id) and a.canal_id = r.canal_id
  )
order by r.id, g.data desc, g.criado_em desc;
