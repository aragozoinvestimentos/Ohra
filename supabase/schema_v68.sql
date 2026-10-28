-- Margem Real — schema v68 (28/10/2026): NOTA POR SETOR da Sede (etapa D)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- Uma linha por loja × semana (segunda-feira, 'AAAA-MM-DD') × setor (financeiro, comercial, operacao).
-- A nota (0 a 10) é calculada pelo app (src/lib/sedeNotas.js) e regravada enquanto a semana
-- não fecha; a da semana que passou fica como histórico (seta ↑↓ na Sede).
-- partes = [{ k, nome, peso, nota, texto }] — de onde veio a nota (sem "falso 100%").
create table if not exists public.sede_notas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  semana text not null,
  setor text not null,
  nota numeric not null,
  partes jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

create unique index if not exists sede_notas_uk on public.sede_notas (loja_id, semana, setor);

do $$
declare t text;
begin
  foreach t in array array['sede_notas'] loop
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
