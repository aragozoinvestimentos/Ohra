-- Precificador Ohra — schema v24 (nova aba "Registro de Impressões")
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem apagar nada.
--
-- Tabela nova, não mexe em nenhuma tabela existente. Cada linha é UM job de
-- impressão (uma "chapa"/lote) registrado depois que ela termina (deu certo
-- ou falhou), usado pra calcular uma taxa de falha real e um prejuízo médio
-- por impressão perdida, e recomendar um tamanho de lote seguro.
create table if not exists public.registros_impressao (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  -- Vínculo opcional com o catálogo (Cadastros → Produtos) — se o produto
  -- cadastrado for excluído depois, o registro não some, só perde o vínculo
  -- (produto_nome guarda o nome de qualquer forma, pro histórico não quebrar).
  produto_id uuid references public.produtos_cadastro(id) on delete set null,
  produto_nome text not null,
  quantidade_lote integer not null default 1 check (quantidade_lote > 0),
  tempo_estimado_min numeric,
  status text not null check (status in ('sucesso', 'falha')),
  -- Só preenchido quando status = 'falha': em que % da impressão ela parou
  -- (0–100) — usado pra estimar quanto de material/tempo foi desperdiçado.
  falha_pct numeric check (falha_pct is null or (falha_pct >= 0 and falha_pct <= 100)),
  -- Custo total do lote (peças × custo unitário) no momento do registro —
  -- guardado congelado aqui pra o histórico de prejuízo não mudar sozinho
  -- se o preço do filamento ou outros custos mudarem depois.
  custo_lote_estimado numeric,
  observacao text,
  criado_em timestamptz not null default now()
);

create index if not exists registros_impressao_loja_idx on public.registros_impressao (loja_id, criado_em desc);

alter table public.registros_impressao enable row level security;

drop policy if exists "anon pode ler registros_impressao" on public.registros_impressao;
create policy "anon pode ler registros_impressao" on public.registros_impressao for select to anon using (true);

drop policy if exists "anon pode inserir registros_impressao" on public.registros_impressao;
create policy "anon pode inserir registros_impressao" on public.registros_impressao for insert to anon with check (true);

drop policy if exists "anon pode atualizar registros_impressao" on public.registros_impressao;
create policy "anon pode atualizar registros_impressao" on public.registros_impressao for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir registros_impressao" on public.registros_impressao;
create policy "anon pode excluir registros_impressao" on public.registros_impressao for delete to anon using (true);

alter publication supabase_realtime add table public.registros_impressao;
