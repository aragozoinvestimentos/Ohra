-- Margem Real — schema v73 (Saldo de filamento, 01/11/2026)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- Contagem do filamento que você tem guardado (por material e cor). O app parte
-- da última contagem, soma as compras de material registradas depois e tira o
-- que as impressões registradas gastaram (estimado pelo peso do fatiador).
create table if not exists public.insumos_contagem (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  material_id uuid not null references public.materiais(id) on delete cascade,
  cor text not null default '',
  kg numeric not null check (kg >= 0),
  data date not null default current_date,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists insumos_contagem_idx on public.insumos_contagem (loja_id, material_id, data desc);

do $$
declare t text;
begin
  foreach t in array array['insumos_contagem'] loop
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
