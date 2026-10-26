-- Margem Real — schema v67 (26/10/2026): CARTEIRAS do Caixa
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- 1) lancamentos_caixa ganha:
--    carteira          onde o dinheiro está: 'loja' (conta do banco da loja — vendas físicas/orgânicas,
--                      contas, aportes) ou a plataforma ('shopee', 'tiktok', 'ml', 'shein') — saldo dentro do marketplace
--    transferencia_id  liga as 2 linhas de um saque (saída da carteira da plataforma + entrada na conta da loja)
-- 2) Migração: entradas dos pedidos importados (origem_import 'pedidos|<plataforma>|…') vão pra carteira da
--    plataforma; vendas físicas e tudo que foi lançado à mão vão pra 'loja'. O saldo total não muda.
-- 3) extrato_carteira — transações do "Extrato do Meu Saldo" da Shopee (renda do pedido, saque…),
--    uma linha por transação (chave única por loja + plataforma), pra saber o que já foi LIBERADO.

alter table public.lancamentos_caixa add column if not exists carteira text;
alter table public.lancamentos_caixa add column if not exists transferencia_id uuid;

update public.lancamentos_caixa
   set carteira = split_part(origem_import, '|', 2)
 where carteira is null
   and origem_import like 'pedidos|%'
   and split_part(origem_import, '|', 2) in ('shopee', 'tiktok', 'ml', 'shein');

update public.lancamentos_caixa set carteira = 'loja' where carteira is null;

create index if not exists lancamentos_caixa_transf_idx on public.lancamentos_caixa (transferencia_id);

create table if not exists public.extrato_carteira (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  plataforma text not null,
  chave text not null,
  data timestamptz,
  tipo text,
  descricao text,
  pedido text,
  valor numeric,          -- com sinal: entrada +, saída −
  status text,
  saldo_apos numeric,     -- "Balança após as transações"
  criado_em timestamptz default now()
);
create unique index if not exists extrato_carteira_chave_idx on public.extrato_carteira (loja_id, plataforma, chave);

do $$
declare t text;
begin
  foreach t in array array['extrato_carteira'] loop
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
