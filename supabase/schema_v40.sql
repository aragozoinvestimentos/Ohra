-- Precificador Ohra — schema v40 (Início, semana pendente e registro por período)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.

-- 1) Lembretes adiados (estado ÚNICO, igual em todos os aparelhos).
--    chave = o que foi adiado (ex.: 'semana|rampa:<id>',
--    'semana|af:<tipo>|<item>|<canal>'); adiado_ate = some até esse dia
--    (exclusive); tipo = 'pular' (não registrar esta semana) | 'amanha'.
--    Nada mais é gravado: o período sem registro continua em aberto.
create table if not exists public.lembretes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  chave text not null,
  adiado_ate date not null,
  tipo text,
  criado_em timestamptz not null default now()
);
create unique index if not exists lembretes_unico on public.lembretes (loja_id, chave);

do $$
declare t text;
begin
  foreach t in array array['lembretes'] loop
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

-- 2) Registro por período (depois de pular semanas): primeiro dia do período
--    coberto pelo registro. null = registro normal de 7 dias (até a véspera
--    da data). As regras semanais normalizam por 7 dias.
alter table public.rampa_registros add column if not exists periodo_inicio date;

alter table public.afiliado_registros add column if not exists periodo_inicio date;
