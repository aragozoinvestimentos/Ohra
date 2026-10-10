-- Precificador Ohra — schema v39 (vendas de conhecidos no Registrar semana)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA colunas.
--   rampa_registros.conhecidos     vendas da semana feitas por amigos/família
--   afiliado_registros.conhecidos  idem, pros itens com afiliado fora de rampa
-- Contam nas vendas totais, no lucro da semana e nas avaliações; NÃO contam
-- nas decisões (portão de vendas, check da subida, funil, teste de lançamento).
-- Em branco = null (= 0).

alter table public.rampa_registros add column if not exists conhecidos integer;

alter table public.afiliado_registros add column if not exists conhecidos integer;
