-- Precificador Ohra — schema v47 ("Minha farm": dados da máquina num lugar só)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
-- Os campos antigos de máquina (dentro de produtos_cadastro.producao_detalhe:
-- maquina, prazoMeses, horasDia, diasMes, kwh, consumo) NÃO são apagados —
-- só deixam de ser usados quando a etapa 2 entrar no ar.

-- 1) Impressoras da farm (por loja, como o resto do app)
create table if not exists public.impressoras (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  nome text not null,
  valor_pago numeric not null default 0,
  vida_util_horas numeric not null default 8000,
  horas_iniciais numeric not null default 0,       -- máquina comprada usada
  data_cadastro date not null default current_date,
  potencia_w numeric not null default 0,
  manutencao_hora numeric not null default 0,      -- R$ por hora de impressão
  padrao boolean not null default false,
  ativa boolean not null default true,
  aviso_desgaste_visto boolean not null default false,
  aviso_fim_visto boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists impressoras_loja_idx on public.impressoras (loja_id);
-- só UMA impressora padrão por loja
create unique index if not exists impressoras_uma_padrao on public.impressoras (loja_id) where padrao;

-- 2) Configuração geral da farm (uma linha por loja)
create table if not exists public.farm_config (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  horas_dia_operacao numeric not null default 6,
  tarifa_kwh numeric not null default 1.05,
  atualizado_em timestamptz not null default now()
);

-- 3) Impressora de cada produto
alter table public.produtos_cadastro
  add column if not exists impressora_id uuid references public.impressoras(id) on delete set null;

-- 4) Histórico de mudanças da farm que pioraram o custo
--    produtos = [{ id, canal_id, custo_antes, custo_depois, lucro_depois, motivo }]
create table if not exists public.farm_alteracoes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  created_at timestamptz not null default now(),
  descricao text,
  produtos jsonb not null default '[]'::jsonb,
  revisado boolean not null default false
);
create index if not exists farm_alteracoes_loja_idx on public.farm_alteracoes (loja_id, revisado);

-- RLS anon + realtime (mesmo padrão das outras tabelas)
do $$
declare t text;
begin
  foreach t in array array['impressoras', 'farm_config', 'farm_alteracoes'] loop
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

-- 5) Migração: por loja, os valores MAIS USADOS hoje nos produtos viram a
--    impressora padrão + a config da farm. Só cria se a loja ainda não tem
--    impressora; produtos sem impressora são ligados à padrão.
create or replace function pg_temp.num_ohra(v text) returns numeric language sql immutable as $f$
  select case when v ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$' then replace(trim(v), ',', '.')::numeric end
$f$;

with base as (
  select p.loja_id,
         pg_temp.num_ohra(p.producao_detalhe->>'maquina')  as maquina,
         pg_temp.num_ohra(p.producao_detalhe->>'consumo')  as consumo,
         pg_temp.num_ohra(p.producao_detalhe->>'kwh')      as kwh,
         pg_temp.num_ohra(p.producao_detalhe->>'horasDia') as horas_dia
  from public.produtos_cadastro p
  where p.loja_id is not null and p.producao_detalhe is not null
),
modas as (
  select l.id as loja_id,
         coalesce((select mode() within group (order by maquina)   from base b where b.loja_id = l.id and maquina > 0), 3198) as maquina,
         coalesce((select mode() within group (order by consumo)   from base b where b.loja_id = l.id and consumo > 0), 350)  as consumo,
         coalesce((select mode() within group (order by kwh)       from base b where b.loja_id = l.id and kwh > 0), 1.05)     as kwh,
         coalesce((select mode() within group (order by horas_dia) from base b where b.loja_id = l.id and horas_dia > 0), 6)  as horas_dia
  from public.lojas l
),
nova_config as (
  insert into public.farm_config (loja_id, horas_dia_operacao, tarifa_kwh)
  select loja_id, horas_dia, kwh from modas
  on conflict (loja_id) do nothing
)
insert into public.impressoras (loja_id, nome, valor_pago, vida_util_horas, horas_iniciais, potencia_w, manutencao_hora, padrao, ativa)
select m.loja_id, 'Impressora 1', m.maquina, 8000, 0, m.consumo, 0, true, true
from modas m
where not exists (select 1 from public.impressoras i where i.loja_id = m.loja_id);

update public.produtos_cadastro p
set impressora_id = i.id
from public.impressoras i
where i.loja_id = p.loja_id and i.padrao and p.impressora_id is null;

-- Conferência (só leitura): a impressora criada e quantos produtos ligados
select i.nome, i.valor_pago, i.potencia_w, i.vida_util_horas, c.horas_dia_operacao, c.tarifa_kwh,
       (select count(*) from public.produtos_cadastro p where p.impressora_id = i.id) as produtos_ligados
from public.impressoras i
left join public.farm_config c on c.loja_id = i.loja_id
where i.padrao;
