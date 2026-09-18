-- Precificador Ohra — schema v22 (vincula o Material de um produto ao
-- catálogo de Materiais por id, em vez de só por nome digitado)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nem sobrescrever nada que já tenha sido vinculado.
--
-- O que muda: produtos_cadastro.material_nome sempre foi texto livre — quem
-- cadastrava um produto digitava (ou copiava de uma sugestão) o nome do
-- material, sem nenhum vínculo de verdade com a tabela materiais. Isso
-- significa que renomear um material em Cadastros → Materiais quebrava
-- silenciosamente esse "link": o produto continuava mostrando o nome
-- antigo, sem ninguém ser avisado que os dois já não eram mais o mesmo
-- registro. A partir de agora, a tela de Produtos usa um <select> ligado
-- de verdade ao catálogo (por id) em vez de um campo de texto solto.
--
-- material_id é aditiva e opcional (nullable) — nenhum produto já
-- cadastrado perde o nome que tinha. O UPDATE abaixo só é um "melhor
-- esforço" de preencher esse vínculo pra quem já tinha um material_nome
-- que bate (comparando por nome, sem diferenciar maiúscula/minúscula nem
-- espaço nas pontas) com um material já cadastrado NA MESMA LOJA — nunca
-- chuta um vínculo em caso de dúvida: se o nome não existir mais no
-- catálogo (material renomeado ou excluído antes dessa migração), ou se
-- pertencer a outra loja, a linha simplesmente fica com material_id nulo e
-- CONTINUA mostrando o material_nome original como estava — nada é
-- apagado nem sobrescrito, só o vínculo por id fica de fora até alguém
-- escolher um material manualmente na tela de Produtos.
alter table public.produtos_cadastro
  add column if not exists material_id uuid references public.materiais(id) on delete set null;

update public.produtos_cadastro pc
set material_id = m.id
from public.materiais m
where pc.material_id is null
  and pc.material_nome is not null
  and trim(pc.material_nome) <> ''
  and lower(trim(m.nome)) = lower(trim(pc.material_nome))
  -- mesma loja dos dois lados (ou as duas sem loja, em bases antigas de
  -- antes do multi-loja) — nunca vincula material de uma loja a produto de
  -- outra só porque o nome bateu por coincidência.
  and pc.loja_id is not distinct from m.loja_id;
