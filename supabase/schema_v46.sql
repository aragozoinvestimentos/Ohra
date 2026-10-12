-- Precificador Ohra — schema v46 (Ficha do anúncio etapa 2: anúncio com vários itens)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.

-- Um anúncio que junta itens diferentes numa variação ("Conjunto", "Tamanho"…):
--   opcoes     = [{ rotulo, item_tipo ('produto'|'variacao'|'kit'), item_id, sufixo_sku }] na ordem do anúncio
--   variacao2  = variação própria opcional que combina com todas as opções
--                (ex.: Cor) = { nome, opcoes: [{ nome, sufixo }] }
create table if not exists public.anuncios_grupo (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  variacao_nome text not null default 'Conjunto',
  opcoes jsonb not null default '[]'::jsonb,
  variacao2 jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.anuncios_grupo add column if not exists variacao2 jsonb;

create index if not exists anuncios_grupo_loja_idx on public.anuncios_grupo (loja_id);

do $$
declare t text;
begin
  foreach t in array array['anuncios_grupo'] loop
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
