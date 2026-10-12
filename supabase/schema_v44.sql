-- Precificador Ohra — schema v44 (Períodos de Ads)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.

-- Um período de Ads por produto/kit × canal (Crescimento → Ads).
--   inicio / fim        = datas do período (fim null = ainda ligado)
--   orcamento_diario    = orçamento por dia no início do período
--   meta_roas           = meta de ROAS configurada na plataforma
--   ajustes             = histórico de mudanças [{ data, orcamento, meta, motivo }]
--   motivo_fim / nota   = por que encerrou / observação livre
create table if not exists public.ads_periodos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null default 'produto',
  item_id uuid not null,
  canal_id uuid references public.canais(id) on delete cascade,
  inicio date not null,
  fim date,
  orcamento_diario numeric,
  meta_roas numeric,
  ajustes jsonb not null default '[]'::jsonb,
  motivo_fim text,
  nota text,
  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ads_periodos_item_tipo_check') then
    alter table public.ads_periodos add constraint ads_periodos_item_tipo_check check (item_tipo in ('produto', 'kit', 'variacao'));
  end if;
end $$;

create index if not exists ads_periodos_item_idx on public.ads_periodos (loja_id, item_tipo, item_id, canal_id, inicio);

do $$
declare t text;
begin
  foreach t in array array['ads_periodos'] loop
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

-- Histórico: o teste de lançamento já CONCLUÍDO de cada rampa vira o 1º
-- período de Ads do produto (best-effort; o teste continua na Rampa como
-- estava). Teste em andamento fica só na Rampa.
insert into public.ads_periodos (loja_id, item_tipo, item_id, canal_id, inicio, fim, orcamento_diario, nota)
select r.loja_id, 'produto', r.produto_id, r.canal_id, r.teste_inicio, r.teste_fim,
       case when coalesce(r.teste_dias, 0) > 0 and r.teste_orcamento is not null then round(r.teste_orcamento / r.teste_dias, 2) end,
       'teste de lançamento'
from public.rampas_preco r
where r.teste_status = 'concluido' and r.teste_inicio is not null and r.teste_fim is not null
  and not exists (
    select 1 from public.ads_periodos a
    where a.item_tipo = 'produto' and a.item_id = r.produto_id and a.canal_id = r.canal_id and a.inicio = r.teste_inicio
  );
