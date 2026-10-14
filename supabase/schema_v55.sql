-- Precificador Ohra — schema v55 (aba Análise: vendas reais importadas)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- 1) pedidos_itens: uma linha por item vendido — pedidos de venda exportados
--    da Olist (por plataforma) e vendas físicas registradas no app. NÃO guarda
--    nome, CPF, endereço nem telefone do cliente: só o código do cliente da
--    Olist ("ID contato"), que serve pra contar recompra.
create table if not exists public.pedidos_itens (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  chave text not null,                 -- pedido|sku|n (não duplica ao reenviar o arquivo)
  origem text not null default 'olist' check (origem in ('olist', 'fisico')),
  canal_id uuid references public.canais(id) on delete set null,
  plataforma text,                     -- shopee | ml | tiktok | shein | fisico
  pedido text not null,                -- ID do pedido na Olist (ou gerado na venda física)
  numero text,                         -- "Número do pedido" da Olist
  ordem_compra text,                   -- número do pedido no marketplace
  data date not null,
  situacao text,                       -- Enviado, Entregue, Cancelado…
  sku text,
  descricao text,
  item_tipo text check (item_tipo in ('produto', 'variacao', 'kit')),
  item_id uuid,
  quantidade numeric not null default 1,
  valor_unitario numeric not null default 0,
  desconto_item numeric not null default 0,
  desconto_pedido numeric not null default 0,  -- desconto do pedido rateado (cupom)
  frete numeric not null default 0,
  cliente text,                        -- ID contato da Olist (não é dado pessoal)
  pagamento text,                      -- venda física: Pix, dinheiro, cartão
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists pedidos_itens_chave on public.pedidos_itens (loja_id, chave);
create index if not exists pedidos_itens_data_idx on public.pedidos_itens (loja_id, data);

-- 2) importacoes: cada arquivo enviado na central (último envio, período,
--    ✓/✗ e o resumo). Relatórios de anúncio (Desempenho e Ads da Shopee)
--    guardam o conteúdo lido em `dados` pro Registrar semana preencher sozinho.
create table if not exists public.importacoes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  relatorio text not null,             -- pedidos:shopee, shopee:desempenho, shopee:ads…
  arquivo text,
  periodo_de date,
  periodo_ate date,
  ok boolean not null default true,
  resumo text,
  dados jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists importacoes_loja_idx on public.importacoes (loja_id, relatorio, criado_em);

-- 3) skus_ignorados: SKUs que você escolheu "Descartar" na importação.
create table if not exists public.skus_ignorados (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  sku text not null,
  criado_em timestamptz not null default now()
);
create unique index if not exists skus_ignorados_unico on public.skus_ignorados (loja_id, sku);

-- 4) Fluxo de Caixa: os pedidos ENTREGUES viram uma entrada por plataforma ×
--    semana (e as vendas físicas por semana). Esta coluna identifica a linha
--    pra ela ser atualizada ao reenviar o arquivo, sem duplicar.
alter table public.lancamentos_caixa add column if not exists origem_import text;
create unique index if not exists lancamentos_caixa_origem_import on public.lancamentos_caixa (loja_id, origem_import);

do $$
declare t text;
begin
  foreach t in array array['pedidos_itens', 'importacoes', 'skus_ignorados'] loop
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
