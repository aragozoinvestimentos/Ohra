-- Precificador Ohra — schema v49 (Otimização: chapa do kit)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
-- chapa_kit = chapa mista com as peças do kit, copiada do fatiador:
--   { kitsPorChapa, tempo (min, total da chapa), comprimento (m, total), materialNome }
-- Só pra comparar o custo "sob pedido" com o custo pelas peças (o preço do kit
-- continua vindo das peças).
alter table public.kits add column if not exists chapa_kit jsonb;
