-- Precificador Ohra — schema v26 (peso + variações de quantidade)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem apagar nada. Só ADICIONA colunas/tabela; nenhum
-- dado existente muda.

-- 1) Peso ---------------------------------------------------------------
-- Peso de UMA peça do produto (g) — preenchido pelo Custo de Produção ao
-- salvar como produto, ou digitado na mão.
alter table public.produtos_cadastro add column if not exists peso_g numeric;
-- Peso de UMA unidade do item de embalagem (g).
alter table public.embalagens add column if not exists peso_g numeric;

-- 2) Variações de quantidade -------------------------------------------
-- Cada variação é um jeito de vender o MESMO produto em quantidade (kit 2,
-- kit 3…). Tudo que fica null/false é HERDADO do produto pai na hora do
-- cálculo — só o que foi personalizado fica gravado aqui.
create table if not exists public.produto_variacoes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  produto_id uuid not null references public.produtos_cadastro(id) on delete cascade,
  quantidade integer not null check (quantidade > 0),
  nome text not null,
  sku text,
  -- 'multiplicar' = custo por peça do produto × quantidade
  -- 'chapa'       = recalcula o custo por peça com outro nº de peças por chapa
  -- 'fatiador'    = dados do fatiador próprios (comprimento/tempo da chapa)
  producao_modo text not null default 'multiplicar' check (producao_modo in ('multiplicar', 'chapa', 'fatiador')),
  pecas_por_chapa numeric,
  producao_detalhe jsonb,      -- modo 'fatiador': { comprimento, tempo, pecas, materialNome }
  embalagem_itens jsonb,       -- null = embalagem do produto; senão [{ itemId, quantidade }]
  frete numeric,               -- null = frete padrão do produto
  peso_real_g numeric,         -- null = peso calculado
  ajuste numeric not null default 0,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists produto_variacoes_produto_idx on public.produto_variacoes (produto_id);
create index if not exists produto_variacoes_loja_idx on public.produto_variacoes (loja_id);

alter table public.produto_variacoes enable row level security;

drop policy if exists "anon pode ler produto_variacoes" on public.produto_variacoes;
create policy "anon pode ler produto_variacoes" on public.produto_variacoes for select to anon using (true);

drop policy if exists "anon pode inserir produto_variacoes" on public.produto_variacoes;
create policy "anon pode inserir produto_variacoes" on public.produto_variacoes for insert to anon with check (true);

drop policy if exists "anon pode atualizar produto_variacoes" on public.produto_variacoes;
create policy "anon pode atualizar produto_variacoes" on public.produto_variacoes for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir produto_variacoes" on public.produto_variacoes;
create policy "anon pode excluir produto_variacoes" on public.produto_variacoes for delete to anon using (true);

do $$
begin
  alter publication supabase_realtime add table public.produto_variacoes;
exception when duplicate_object then null;
end $$;

-- 3) Preço salvo por canal também pra variação --------------------------
-- precos_canal.item_tipo passa a aceitar 'variacao' (além de produto/kit).
-- Troca a regra de validação sem tocar em nenhuma linha já salva.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'precos_canal' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%item_tipo%'
  loop
    execute format('alter table public.precos_canal drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.precos_canal
  add constraint precos_canal_item_tipo_check check (item_tipo in ('produto', 'kit', 'variacao'));
