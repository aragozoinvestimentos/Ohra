-- Precificador Ohra — schema v14 (segunda passada de migração pra Preços
-- por Canal, mais tolerante, + diagnóstico do que ainda não migrou)
-- Rode depois do schema_v10.sql. Idempotente e só ADICIONA o que ainda não
-- tinha migrado — nunca sobrescreve um preço que já esteja certo em
-- precos_canal (usa "on conflict do nothing").

-- 1) Repete a migração do v10, mas comparando nome do produto e nome/tipo
-- do canal ignorando maiúsculas/minúsculas e espaço sobrando nas pontas —
-- pra pegar casos que não migraram no v10 só por causa de uma pequena
-- diferença de digitação (ex: "Vaso Decorativo " com espaço no fim).
with produtos_com_tipo_alvo as (
  select
    p.*,
    case
      when trim(lower(p.canal)) = 'shopee' then 'shopee'
      when trim(lower(p.canal)) = 'mercado livre' then 'ml'
      when trim(lower(p.canal)) = 'tiktok shop' then 'tiktok'
      when trim(lower(p.canal)) = 'shein' then 'shein'
      else null
    end as tipo_alvo
  from public.produtos p
  where p.canal <> 'Encomenda avulsa'
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
  on trim(lower(pcad.nome)) = trim(lower(pc.nome))
  and pcad.loja_id is not distinct from pc.loja_id
join public.canais c
  on c.loja_id is not distinct from pc.loja_id
  and (
    (pc.tipo_alvo is not null and c.tipo = pc.tipo_alvo)
    or trim(lower(c.nome)) = trim(lower(pc.canal))
  )
order by pc.loja_id, pcad.id, c.id, pc.criado_em desc
on conflict (item_tipo, item_id, canal_id) do nothing;

-- 2) Diagnóstico: lista o que sobrou na tabela antiga "produtos" sem achar
-- um produto correspondente em produtos_cadastro (nem com a comparação
-- tolerante acima) — se aparecer alguma linha aqui depois de rodar isso,
-- me manda o resultado (nome, canal, loja) que eu ajusto o casamento.
select p.nome as produto_antigo, p.canal, p.loja_id, p.preco, p.custo, p.criado_em
from public.produtos p
where p.canal <> 'Encomenda avulsa'
  and not exists (
    select 1 from public.produtos_cadastro pcad
    where trim(lower(pcad.nome)) = trim(lower(p.nome))
      and pcad.loja_id is not distinct from p.loja_id
  );
