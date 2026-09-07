-- Precificador Ohra — schema v12 (Shein como canal padrão em todas as lojas)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema. Não apaga nem duplica nada: só adiciona Shein pras
-- lojas que ainda não têm.

insert into public.canais (nome, tipo, loja_id)
select 'Shein', 'shein', l.id
from public.lojas l
where not exists (
  select 1 from public.canais c where c.loja_id = l.id and c.tipo = 'shein'
);
