-- Precificador Ohra — schema v30 (anúncio criado direto em cada marketplace)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem apagar nada. Só ADICIONA colunas/tabela; os
-- dados antigos (acréscimo da Olist, publicações antigas) continuam no banco.

-- 1) Desconto exibido no anúncio (padrão do canal) ------------------------
-- Fração (0.3 = 30%). O app calcula o preço ORIGINAL (riscado) pra digitar na
-- plataforma = preço real ÷ (1 − desconto), e a promoção fica nesse %.
alter table public.canais add column if not exists desconto_anuncio_pct numeric;

-- Carrega o acréscimo da Olist que já estava configurado:
-- "base por dentro" de 30% dá exatamente o mesmo que 30% de desconto;
-- "base simples" de a% equivale a a ÷ (1 + a) de desconto.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canais' and column_name = 'acrescimo_olist_pct') then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canais' and column_name = 'acrescimo_olist_modo') then
      execute $q$
        update public.canais
           set desconto_anuncio_pct = case when coalesce(acrescimo_olist_modo, 'dentro') = 'simples'
                                           then acrescimo_olist_pct / (1 + acrescimo_olist_pct)
                                           else acrescimo_olist_pct end
         where desconto_anuncio_pct is null and acrescimo_olist_pct is not null
      $q$;
    else
      execute $q$
        update public.canais set desconto_anuncio_pct = acrescimo_olist_pct
         where desconto_anuncio_pct is null and acrescimo_olist_pct is not null
      $q$;
    end if;
  end if;
end $$;

-- 2) Desconto próprio por produto / kit (opcional) ------------------------
-- { "<canal_id>": 0.25, ... } — vale pro produto e as variações dele.
-- null / canal ausente = usa o padrão do canal.
alter table public.produtos_cadastro add column if not exists desconto_anuncio jsonb;
alter table public.kits add column if not exists desconto_anuncio jsonb;

-- 3) O que foi atualizado em cada plataforma (item × canal) ---------------
create table if not exists public.publicacoes_canal (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'kit', 'variacao')),
  item_id uuid not null,
  canal_id uuid not null references public.canais(id) on delete cascade,
  preco_original numeric not null,
  promo numeric not null,          -- % inteiro
  cliente_paga numeric not null,
  publicado_em timestamptz not null default now(),
  unique (item_tipo, item_id, canal_id)
);
create index if not exists publicacoes_canal_loja_idx on public.publicacoes_canal (loja_id);

alter table public.publicacoes_canal enable row level security;
drop policy if exists "anon pode ler publicacoes_canal" on public.publicacoes_canal;
create policy "anon pode ler publicacoes_canal" on public.publicacoes_canal for select to anon using (true);
drop policy if exists "anon pode inserir publicacoes_canal" on public.publicacoes_canal;
create policy "anon pode inserir publicacoes_canal" on public.publicacoes_canal for insert to anon with check (true);
drop policy if exists "anon pode atualizar publicacoes_canal" on public.publicacoes_canal;
create policy "anon pode atualizar publicacoes_canal" on public.publicacoes_canal for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir publicacoes_canal" on public.publicacoes_canal;
create policy "anon pode excluir publicacoes_canal" on public.publicacoes_canal for delete to anon using (true);
do $$
begin
  alter publication supabase_realtime add table public.publicacoes_canal;
exception when duplicate_object then null;
end $$;
