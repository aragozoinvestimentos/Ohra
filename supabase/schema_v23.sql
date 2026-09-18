-- Precificador Ohra — schema v23 (persiste markup desejado e preço
-- sugerido do kit)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nada.
--
-- Na tela de Montar kit, "Markup desejado (%)" e "Preço sugerido" sempre
-- foram só estado local do formulário: dava pra digitar um markup e ver o
-- preço calculado na hora, mas nada disso ia junto no "Salvar" — o campo
-- zerava/sumia assim que o kit era reaberto pra edição, dando a entender
-- (errado) que o preço do kit tinha sido definido ali. Agora os dois
-- valores são salvos de verdade junto com o kit e voltam preenchidos
-- quando ele é reaberto.
--
-- Ambas as colunas são aditivas e nullable — nenhum kit já cadastrado
-- perde nada; markup_desejado/preco_sugerido só ficam em branco pros kits
-- antigos, até alguém abrir e salvar de novo com esses campos preenchidos.
alter table public.kits add column if not exists markup_desejado numeric;
alter table public.kits add column if not exists preco_sugerido numeric;
