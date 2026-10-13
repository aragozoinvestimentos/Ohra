-- Precificador Ohra — schema v52 (Fluxo de Caixa → Vendas do mês: venda orgânica)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- Venda orgânica registrada à mão (produto fora de rampa) — SÓ financeiro:
-- entra no fechamento do mês (unidades, recebe, repor, lucro, reserva) e não
-- é lida por Ads, Afiliados nem pela Rampa.
create table if not exists public.vendas_organicas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'variacao', 'kit')),
  item_id uuid not null,
  canal_id uuid references public.canais(id) on delete set null,
  periodo_inicio date,             -- De (opcional)
  data date not null,              -- Até (dia da venda ou fim do período)
  unidades integer not null check (unidades > 0),
  preco numeric(12, 2) not null check (preco > 0),  -- preço de venda de cada unidade
  conhecidos integer,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists vendas_organicas_loja_idx on public.vendas_organicas (loja_id, data);

do $$
declare t text;
begin
  foreach t in array array['vendas_organicas'] loop
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
