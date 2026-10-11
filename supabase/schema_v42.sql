-- Precificador Ohra — schema v42 (tarefas manuais no Início)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.

-- Tarefas que você cria à mão no "Pra fazer" do Início.
--   vence       = data (opcional); vencida = Resolver, hoje/amanhã = Atenção
--   repetir     = 'semanal' | 'mensal' | null — ao concluir, o app cria a próxima
--   link_aba    = aba pra abrir (opcional); link_item = item do catálogo ('p:<id>', 'v:<id>', 'k:<id>')
--   concluida_em = quando foi concluída (null = em aberto)
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  descricao text not null,
  vence date,
  repetir text,
  link_aba text,
  link_item text,
  concluida_em timestamptz,
  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarefas_repetir_check') then
    alter table public.tarefas add constraint tarefas_repetir_check check (repetir in ('semanal', 'mensal'));
  end if;
end $$;

create index if not exists tarefas_loja_idx on public.tarefas (loja_id, concluida_em);

do $$
declare t text;
begin
  foreach t in array array['tarefas'] loop
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
