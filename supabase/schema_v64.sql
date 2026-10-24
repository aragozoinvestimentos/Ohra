-- Margem Real — schema v64 (24/10/2026): histórico de AÇÕES COMERCIAIS
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- Registro manual do que você mudou direto no marketplace (foto, título,
-- descrição, promoção, cupom, Ads feito fora do app…) + a CONCLUSÃO de cada
-- ação (funcionou / não funcionou / inconclusivo / aguardando). As ações que
-- o app já grava sozinho (ajuste de Ads, subida/descida de degrau, preço salvo)
-- NÃO são copiadas pra cá — o app lê de onde já estão; aqui só fica a conclusão
-- delas (origem = 'app', chave = a ação de origem).
--   item_tipo   = 'produto' | 'kit' | 'grupo' | 'variacao'
--   tipo        = 'ads-aumento' | 'ads-reducao' | 'ads-pausa' | 'ads-meta' | 'imagem' | 'titulo'
--                 | 'descricao' | 'preco' | 'promocao' | 'cupom' | 'variacao' | 'kit' | 'outro'
--   referencia  = indicadores no momento (jsonb, opcional)
--   conclusao   = 'funcionou' | 'nao-funcionou' | 'inconclusivo' | 'aguardando' | null
create table if not exists public.acoes_comerciais (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  origem text not null default 'manual',
  chave text,
  item_tipo text,
  item_id uuid,
  canal_id uuid,
  tipo text not null default 'outro',
  data date not null default current_date,
  valor_antes text,
  valor_depois text,
  observacao text,
  referencia jsonb,
  conclusao text,
  conclusao_em timestamptz,
  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acoes_comerciais_conclusao_chk') then
    alter table public.acoes_comerciais add constraint acoes_comerciais_conclusao_chk
      check (conclusao is null or conclusao in ('funcionou', 'nao-funcionou', 'inconclusivo', 'aguardando'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acoes_comerciais_origem_chk') then
    alter table public.acoes_comerciais add constraint acoes_comerciais_origem_chk check (origem in ('manual', 'app'));
  end if;
end $$;

create index if not exists acoes_comerciais_loja_idx on public.acoes_comerciais (loja_id, item_id, canal_id);
create unique index if not exists acoes_comerciais_chave_uk on public.acoes_comerciais (loja_id, chave) where chave is not null;

do $$
declare t text;
begin
  foreach t in array array['acoes_comerciais'] loop
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
