-- Precificador Ohra — schema v25 (nova aba "Fluxo de Caixa")
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem apagar nada. Tabela nova, não mexe em nenhuma
-- tabela existente.
--
-- Cada linha é um lançamento de caixa (entrada ou saída). "Previsto" até ter
-- data_realizada; quando o dinheiro cai/sai de fato, data_realizada é
-- preenchida. Lançamento com recorrencia = 'mensal' é um MODELO (ex.: energia,
-- assinatura, parcela da impressora): não entra no saldo sozinho — o app
-- projeta uma ocorrência por mês a partir de data_prevista (até
-- recorrencia_ate, ou sem fim) e, quando você confirma o mês, grava uma linha
-- normal com recorrencia_origem_id apontando pro modelo.
create table if not exists public.lancamentos_caixa (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  descricao text not null,
  categoria text not null default 'outros',
  canal_id uuid references public.canais(id) on delete set null,
  valor numeric not null check (valor >= 0),
  data_prevista date not null,
  data_realizada date,
  recorrencia text not null default 'nenhuma' check (recorrencia in ('nenhuma', 'mensal')),
  recorrencia_ate date,
  recorrencia_origem_id uuid references public.lancamentos_caixa(id) on delete set null,
  observacao text,
  criado_em timestamptz not null default now()
);

create index if not exists lancamentos_caixa_loja_idx on public.lancamentos_caixa (loja_id, data_prevista);

alter table public.lancamentos_caixa enable row level security;

drop policy if exists "anon pode ler lancamentos_caixa" on public.lancamentos_caixa;
create policy "anon pode ler lancamentos_caixa" on public.lancamentos_caixa for select to anon using (true);

drop policy if exists "anon pode inserir lancamentos_caixa" on public.lancamentos_caixa;
create policy "anon pode inserir lancamentos_caixa" on public.lancamentos_caixa for insert to anon with check (true);

drop policy if exists "anon pode atualizar lancamentos_caixa" on public.lancamentos_caixa;
create policy "anon pode atualizar lancamentos_caixa" on public.lancamentos_caixa for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir lancamentos_caixa" on public.lancamentos_caixa;
create policy "anon pode excluir lancamentos_caixa" on public.lancamentos_caixa for delete to anon using (true);

do $$
begin
  alter publication supabase_realtime add table public.lancamentos_caixa;
exception when duplicate_object then null;
end $$;
