-- Precificador Ohra — schema v50 (Minha farm: manutenção das impressoras)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.

-- Plano de manutenção da impressora (null = modelo Bambu Lab A1 do app):
--   [{ id, nome, dias, nota }]
alter table public.impressoras add column if not exists manutencao_plano jsonb;
-- Dia de referência das manutenções (null = o app escolhe, espalhando as
-- impressoras de N em N dias a partir da data de cadastro).
alter table public.impressoras add column if not exists manutencao_inicio date;
-- De quantos em quantos dias espalhar as impressoras (várias máquinas).
alter table public.farm_config add column if not exists manutencao_espaco_dias integer not null default 3;

-- Histórico: cada item de manutenção feito, em que dia.
create table if not exists public.manutencoes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  impressora_id uuid references public.impressoras(id) on delete cascade,
  item_id text not null,
  item_nome text,
  feita_em date not null default current_date,
  nota text,
  criado_em timestamptz not null default now()
);
create index if not exists manutencoes_imp_idx on public.manutencoes (impressora_id, item_id, feita_em);

do $$
declare t text;
begin
  foreach t in array array['manutencoes'] loop
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
