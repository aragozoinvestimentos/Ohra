-- Precificador Ohra — schema v59 (tudo no banco + limpeza do que não é usado)
-- Cole no SQL Editor do Supabase e rode. Idempotente.
--
-- 1) preferencias_loja: valores que antes ficavam só no navegador (estimativas
--    da projeção do caixa, teto de prejuízo por lote, simulação do Custo de
--    Produção, últimos % de falha/manutenção/acabamento, plataformas
--    conferidas, compras ignoradas) — agora iguais em todo computador/celular.
--    Na 1ª vez que o app abre, o que estava no navegador sobe pra cá.
create table if not exists public.preferencias_loja (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  chave text not null,
  valor jsonb,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists preferencias_loja_chave on public.preferencias_loja (loja_id, chave);

do $$
declare t text;
begin
  foreach t in array array['preferencias_loja'] loop
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

-- 2) Limpeza (pedida pelo Gustavo em 16/10/2026) — só o que o app não usa mais.
-- 2a) Acréscimo antigo da Olist: garante que o valor foi pro desconto do anúncio antes de apagar.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canais' and column_name = 'acrescimo_olist_pct') then
    execute $q$
      update public.canais
         set desconto_anuncio_pct = case when acrescimo_olist_modo = 'simples' then acrescimo_olist_pct / (1 + acrescimo_olist_pct) else acrescimo_olist_pct end
       where desconto_anuncio_pct is null and acrescimo_olist_pct is not null
    $q$;
  end if;
end $$;
alter table public.canais drop column if exists acrescimo_olist_pct;
alter table public.canais drop column if exists acrescimo_olist_modo;
alter table public.canais drop column if exists olist_principal;
-- 2b) Markup do kit (o app não grava desde set/2026; o preço do kit vem da escada).
alter table public.kits drop column if exists markup_desejado;
alter table public.kits drop column if exists preco_sugerido;
-- 2c) Tabela antiga de publicação na Olist (substituída por publicacoes_canal no v30).
drop table if exists public.publicacoes_olist;
