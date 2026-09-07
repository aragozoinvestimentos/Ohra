-- Diagnóstico (só leitura, não altera nada) — por que produtos cadastrados
-- antes da mudança não estão aparecendo com preço em "Preços por Canal".
-- Rode as 4 consultas e me manda o resultado de cada uma.

-- 1) Visão geral: quantos cálculos existem na tabela antiga vs quantos já
-- migraram pra precos_canal.
select
  (select count(*) from public.produtos where canal <> 'Encomenda avulsa') as total_antigo,
  (select count(*) from public.precos_canal) as total_migrado;

-- 2) Linhas da tabela antiga que NÃO acharam produto cadastrado
-- correspondente (nome não bate, nem ignorando maiúscula/espaço) — dessas
-- não tem como migrar sem eu ajustar o nome ou ver o que houve.
select p.nome as produto_antigo, p.canal, l.nome as loja, p.preco, p.custo, p.criado_em
from public.produtos p
left join public.lojas l on l.id = p.loja_id
where p.canal <> 'Encomenda avulsa'
  and not exists (
    select 1 from public.produtos_cadastro pcad
    where trim(lower(pcad.nome)) = trim(lower(p.nome))
      and pcad.loja_id is not distinct from p.loja_id
  );

-- 3) Linhas da tabela antiga que ACHARAM produto cadastrado mas não
-- acharam canal correspondente (produto existe, mas o nome do canal salvo
-- não bate com nenhum canal cadastrado hoje) — provavelmente um canal que
-- foi renomeado ou excluído depois.
select p.nome as produto_antigo, p.canal as canal_salvo_antigo, l.nome as loja, p.preco, p.criado_em
from public.produtos p
left join public.lojas l on l.id = p.loja_id
where p.canal <> 'Encomenda avulsa'
  and exists (
    select 1 from public.produtos_cadastro pcad
    where trim(lower(pcad.nome)) = trim(lower(p.nome))
      and pcad.loja_id is not distinct from p.loja_id
  )
  and not exists (
    select 1 from public.canais c
    where c.loja_id is not distinct from p.loja_id
      and (
        trim(lower(c.nome)) = trim(lower(p.canal))
        or (lower(p.canal) = 'shopee' and c.tipo = 'shopee')
        or (lower(p.canal) = 'mercado livre' and c.tipo = 'ml')
        or (lower(p.canal) = 'tiktok shop' and c.tipo = 'tiktok')
        or (lower(p.canal) = 'shein' and c.tipo = 'shein')
      )
  );

-- 4) Produtos cadastrados hoje que não têm NENHUM preço salvo em nenhum
-- canal (pode ser normal — produto cadastrado mas nunca calculado antes —
-- ou pode ser um que devia ter migrado e não migrou).
select pcad.nome as produto, l.nome as loja
from public.produtos_cadastro pcad
left join public.lojas l on l.id = pcad.loja_id
where not exists (
  select 1 from public.precos_canal pc where pc.item_tipo = 'produto' and pc.item_id = pcad.id
)
order by loja, produto;
