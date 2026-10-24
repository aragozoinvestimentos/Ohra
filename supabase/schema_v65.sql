-- Margem Real — schema v65 (24/10/2026): CONSULTOR da Sede
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- Um registro por coisa que o consultor guarda, sempre com a loja:
--   tipo = 'pergunta'    → pergunta que ele não soube responder (vai pro pacote "Levar pro Claude")
--                          dados = { texto, tela, numeros, resposta? }, status = aberta | levada | respondida
--   tipo = 'consultoria' → sua decisão sobre uma sugestão dele (chave = a sugestão)
--                          dados = { titulo, viu, porque, ate? }, status = quero | agora-nao | nunca | levada | resolvida
--   tipo = 'erro'        → erro do app, um por mensagem por dia (dados = { msg, tela, vezes, ultima })
--   tipo = 'uso'         → quantas vezes cada tela foi aberta por dia (chave = 'AAAA-MM-DD|tela', dados = { n })
create table if not exists public.consultor_registros (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  tipo text not null,
  chave text not null,
  dados jsonb not null default '{}'::jsonb,
  status text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'consultor_registros_tipo_chk') then
    alter table public.consultor_registros add constraint consultor_registros_tipo_chk
      check (tipo in ('pergunta', 'consultoria', 'erro', 'uso'));
  end if;
end $$;

create unique index if not exists consultor_registros_chave_uk on public.consultor_registros (loja_id, tipo, chave);
create index if not exists consultor_registros_loja_idx on public.consultor_registros (loja_id, tipo, criado_em);

do $$
declare t text;
begin
  foreach t in array array['consultor_registros'] loop
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
