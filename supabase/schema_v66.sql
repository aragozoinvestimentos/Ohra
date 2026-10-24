-- Margem Real — schema v66 (24/10/2026): REVENDA (produto comprado pronto)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- 1) produtos_cadastro ganha:
--    origem      'fabricado' (o de sempre) | 'revenda' (comprado pronto — custo vem das notas)
--    ean         código de barras do produto
--    fornecedor_id  fornecedor principal (revenda)
--    imposto_st  true = comprado com ST (no Simples paga menos); null = não informado
--    estoque_cfg { prazo: dias do fornecedor, folga: dias a mais pra avisar }
-- 2) fornecedores               — cadastro simples
-- 3) fornecedor_itens           — "esse item da nota é qual produto meu" (lembrado pra sempre)
-- 4) compras_revenda            — cada nota de compra importada (XML), chave da NF-e única por loja
-- 5) compras_revenda_itens      — os itens da nota com o custo final por unidade
-- 6) estoque_movimentos         — entradas (nota), ajustes e inventário. As VENDAS não são gravadas:
--                                 saem ao vivo dos pedidos importados da Olist.

alter table public.produtos_cadastro add column if not exists origem text not null default 'fabricado';
alter table public.produtos_cadastro add column if not exists ean text;
alter table public.produtos_cadastro add column if not exists fornecedor_id uuid;
alter table public.produtos_cadastro add column if not exists imposto_st boolean;
alter table public.produtos_cadastro add column if not exists estoque_cfg jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_cadastro_origem_chk') then
    alter table public.produtos_cadastro add constraint produtos_cadastro_origem_chk
      check (origem in ('fabricado', 'revenda'));
  end if;
end $$;

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  cnpj text,
  uf text,
  prazo_dias integer,
  pedido_minimo numeric,
  contato text,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists fornecedores_loja_idx on public.fornecedores (loja_id);

create table if not exists public.fornecedor_itens (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  fornecedor_id uuid references public.fornecedores(id) on delete cascade,
  codigo text not null,
  ean text,
  descricao text,
  produto_id uuid references public.produtos_cadastro(id) on delete cascade,
  fator numeric not null default 1,
  criado_em timestamptz not null default now()
);
create unique index if not exists fornecedor_itens_uk on public.fornecedor_itens (loja_id, fornecedor_id, codigo);

create table if not exists public.compras_revenda (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  chave_nfe text,
  numero text,
  serie text,
  emissao date not null,
  uf_origem text,
  uf_destino text,
  total_produtos numeric,
  total_ipi numeric,
  total_st numeric,
  total_frete numeric,
  total_outros numeric,
  total_desconto numeric,
  total_nota numeric,
  difal numeric,
  aliquota_interna numeric,
  contar_media boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);
create unique index if not exists compras_revenda_chave_uk on public.compras_revenda (loja_id, chave_nfe);
create index if not exists compras_revenda_loja_idx on public.compras_revenda (loja_id, emissao);

create table if not exists public.compras_revenda_itens (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  compra_id uuid references public.compras_revenda(id) on delete cascade,
  produto_id uuid references public.produtos_cadastro(id) on delete set null,
  codigo text,
  ean text,
  descricao text,
  unidade text,
  qtd_nota numeric,
  fator numeric not null default 1,
  quantidade numeric not null,
  preco_un numeric,
  ipi_un numeric,
  st_un numeric,
  frete_un numeric,
  difal_un numeric,
  custo_un numeric not null,
  criado_em timestamptz not null default now()
);
create index if not exists compras_revenda_itens_idx on public.compras_revenda_itens (loja_id, produto_id);

create table if not exists public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  produto_id uuid references public.produtos_cadastro(id) on delete cascade,
  data date not null,
  tipo text not null,
  quantidade numeric not null,
  custo_un numeric,
  motivo text,
  compra_id uuid references public.compras_revenda(id) on delete cascade,
  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estoque_movimentos_tipo_chk') then
    alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_chk
      check (tipo in ('entrada', 'ajuste', 'inventario'));
  end if;
end $$;
create index if not exists estoque_movimentos_idx on public.estoque_movimentos (loja_id, produto_id, data);

-- Caixa: a saída da nota aponta pra compra (excluir a nota apaga as parcelas em aberto).
alter table public.lancamentos_caixa add column if not exists compra_revenda_id uuid;

do $$
declare t text;
begin
  foreach t in array array['fornecedores', 'fornecedor_itens', 'compras_revenda', 'compras_revenda_itens', 'estoque_movimentos'] loop
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
