-- Margem Real — schema v61 (aba Live)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- A live é um plano PARALELO: quando um produto entra na live, o app copia o
-- preço salvo, o custo e o riscado daquele dia pra dentro da live (coluna
-- produtos). Nada da live grava em preços, Rampa, Ads ou anúncios, e nada de
-- fora muda a live. Tudo por loja.

-- 1) lives: o plano, a cópia dos produtos e o resultado de cada live.
create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text,
  canal_id uuid references public.canais(id) on delete set null,
  data date not null,
  inicio timestamptz,                  -- "Começar a live"
  fim timestamptz,                     -- "Encerrar a live"
  status text not null default 'plano' check (status in ('plano', 'aovivo', 'encerrada')),
  prazo_dias integer,                  -- dias úteis pra enviar (TikTok 1, Shopee 2 — editável)
  taxa_extra numeric,                  -- fração extra sobre o preço (ex.: comissão de criador); vazio = 0
  produtos jsonb not null default '[]'::jsonb,  -- cópia: [{key, item_id, nome, sku, custo, peso, salvo, riscado, pecas, estrategia, ordem}]
  pedidos jsonb not null default '{}'::jsonb,   -- cruzamento com os pedidos importados: {chave do pedido: 'live' | 'nao'}
  diferente text,                      -- "o que fiz diferente"
  notas text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists lives_loja_idx on public.lives (loja_id, data);

-- 2) live_eventos: cada venda (+1/−1/ajuste), mudança de preço e troca de
-- estratégia, com a hora — o resultado sai minuto a minuto.
create table if not exists public.live_eventos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  live_id uuid not null references public.lives(id) on delete cascade,
  tipo text not null check (tipo in ('venda', 'preco', 'estrategia')),
  produto_key text not null,           -- key do produto dentro de lives.produtos
  quantidade integer,                  -- venda: +1, −1 ou o ajuste da lista
  preco numeric,                       -- preço da live naquele momento
  info jsonb,
  manual boolean not null default false,  -- ajuste feito depois, na lista
  em timestamptz not null default now()
);
create index if not exists live_eventos_live_idx on public.live_eventos (live_id, em);
create index if not exists live_eventos_loja_idx on public.live_eventos (loja_id);

do $$
declare t text;
begin
  foreach t in array array['lives', 'live_eventos'] loop
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
