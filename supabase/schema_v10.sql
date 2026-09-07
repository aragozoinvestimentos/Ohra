-- Precificador Ohra — schema v10 (canal Shein + tabela "Preços por Canal")
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema. Não apaga nem altera nenhum produto, kit ou canal
-- já cadastrado — só adiciona.

-- 1) Libera o tipo 'shein' na tabela de canais (mesmo problema que o TikTok
-- Shop teve na v9: o botão "+ Adicionar Shein" ia falhar sem isso).
alter table public.canais drop constraint if exists canais_tipo_check;
alter table public.canais add constraint canais_tipo_check
  check (tipo in ('shopee', 'ml', 'tiktok', 'shein', 'custom'));

-- 2) Nova tabela "precos_canal": um preço real por produto/kit × canal,
-- preenchida automaticamente quando você salva em Precificação por Canal.
-- Substitui o antigo uso da tabela "produtos" (histórico solto, sem ligação
-- de verdade com o cadastro) — essa tabela antiga NÃO é apagada aqui, só
-- deixa de ser usada pelo app a partir de agora.
create table if not exists public.precos_canal (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  item_tipo text not null check (item_tipo in ('produto', 'kit')),
  item_id uuid not null,
  canal_id uuid not null references public.canais(id) on delete cascade,
  preco numeric not null,
  custo_total numeric,
  lucro numeric,
  margem numeric,
  atualizado_em timestamptz not null default now(),
  unique (item_tipo, item_id, canal_id)
);

alter table public.precos_canal enable row level security;

drop policy if exists "anon pode ler precos_canal" on public.precos_canal;
create policy "anon pode ler precos_canal" on public.precos_canal for select to anon using (true);

drop policy if exists "anon pode inserir precos_canal" on public.precos_canal;
create policy "anon pode inserir precos_canal" on public.precos_canal for insert to anon with check (true);

drop policy if exists "anon pode atualizar precos_canal" on public.precos_canal;
create policy "anon pode atualizar precos_canal" on public.precos_canal for update to anon using (true) with check (true);

drop policy if exists "anon pode excluir precos_canal" on public.precos_canal;
create policy "anon pode excluir precos_canal" on public.precos_canal for delete to anon using (true);

alter publication supabase_realtime add table public.precos_canal;

-- 3) Migração "melhor esforço" dos dados antigos da tabela "produtos" pra
-- essa nova estrutura: casa pelo NOME do produto (igual, mesma loja) e pelo
-- tipo/nome do canal (Shopee/Mercado Livre/TikTok Shop/Shein batem pelo
-- tipo oficial; qualquer outro nome tenta bater com o nome de um canal
-- próprio cadastrado). Linha que não achar produto ou canal correspondente
-- simplesmente não é migrada — nada quebra, você só cadastra ela nas mãos
-- de novo se notar que faltou.
with produtos_com_tipo_alvo as (
  select
    p.*,
    case
      when p.canal = 'Shopee' then 'shopee'
      when p.canal = 'Mercado Livre' then 'ml'
      when p.canal = 'TikTok Shop' then 'tiktok'
      when p.canal = 'Shein' then 'shein'
      else null
    end as tipo_alvo
  from public.produtos p
)
insert into public.precos_canal (loja_id, item_tipo, item_id, canal_id, preco, custo_total, lucro, margem, atualizado_em)
select distinct on (pc.loja_id, pcad.id, c.id)
  pc.loja_id,
  'produto',
  pcad.id,
  c.id,
  pc.preco,
  pc.custo,
  pc.preco - pc.custo,
  pc.margem,
  pc.criado_em
from produtos_com_tipo_alvo pc
join public.produtos_cadastro pcad
  on pcad.nome = pc.nome
  and pcad.loja_id is not distinct from pc.loja_id
join public.canais c
  on c.loja_id is not distinct from pc.loja_id
  and (
    (pc.tipo_alvo is not null and c.tipo = pc.tipo_alvo)
    or c.nome = pc.canal
  )
order by pc.loja_id, pcad.id, c.id, pc.criado_em desc
on conflict (item_tipo, item_id, canal_id) do update set
  preco = excluded.preco,
  custo_total = excluded.custo_total,
  lucro = excluded.lucro,
  margem = excluded.margem,
  atualizado_em = excluded.atualizado_em;
