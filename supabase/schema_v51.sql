-- Precificador Ohra — schema v51 (Fluxo de Caixa: Reserva de produção)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- Reserva de produção = o dinheiro das vendas que volta pra produção
-- (repor material, embalagem, energia, máquina, manutenção, falhas,
-- acabamento). NÃO é saída: o dinheiro continua na mesma conta; o caixa só
-- mostra quanto dele está separado e quanto está livre.
--   tipo 'separar' = guardou na reserva (ex.: "Separar este mês" nas Vendas do mês)
--   tipo 'usar'    = tirou da reserva (ex.: compra de filamento paga com ela)
create table if not exists public.reserva_producao (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  data date not null default current_date,
  mes text,                -- 'YYYY-MM' de referência (separação do mês)
  tipo text not null check (tipo in ('separar', 'usar')),
  valor numeric(12, 2) not null check (valor > 0),
  descricao text,
  lancamento_id uuid references public.lancamentos_caixa(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists reserva_producao_loja_idx on public.reserva_producao (loja_id, data);

do $$
declare t text;
begin
  foreach t in array array['reserva_producao'] loop
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
