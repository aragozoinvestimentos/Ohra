-- Precificador Ohra — schema v21 (normalização de embalagens.unidade)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem duplicar nada (só re-grava o mesmo valor nas linhas já
-- corretas, o que não muda nada).
--
-- O campo "Unidade" de Embalagens era texto livre: cada cadastro podia
-- escrever "un", "UN", "uni", "unidade", "Unidade" etc. pra dizer a mesma
-- coisa, o que fragmentava qualquer relatório/agrupamento por unidade. O
-- app passou a usar uma lista fixa (un, kg, g, m, cm, par, rolo) — este
-- script só normaliza o que JÁ está cadastrado pra bater com essa lista;
-- não mexe em estrutura de tabela nem em policy.
--
-- Mapeamento (case-insensitive, ignorando espaço nas pontas via
-- lower(trim(unidade))):
--   un   <- 'un', 'unid', 'unidade', 'und', 'uni', 'unida'
--   kg   <- 'kg', 'kgs', 'quilo', 'quilos', 'quilograma', 'quilogramas'
--   g    <- 'g', 'gr', 'grs', 'grama', 'gramas'
--   m    <- 'm', 'mt', 'mts', 'metro', 'metros'
--   cm   <- 'cm', 'cms', 'centimetro', 'centimetros', 'centímetro', 'centímetros'
--   par  <- 'par', 'pares'
--   rolo <- 'rolo', 'rolos'
--
-- Qualquer valor que não caia em nenhuma variação acima fica como está —
-- é melhor mostrar um valor "fora do padrão" (o app já lida com isso,
-- preservando a opção no <select> de edição) do que arriscar normalizar
-- errado um dado que a gente não reconheceu com certeza.
update public.embalagens
set unidade = 'un'
where lower(trim(unidade)) in ('un', 'unid', 'unidade', 'und', 'uni', 'unida');

update public.embalagens
set unidade = 'kg'
where lower(trim(unidade)) in ('kg', 'kgs', 'quilo', 'quilos', 'quilograma', 'quilogramas');

update public.embalagens
set unidade = 'g'
where lower(trim(unidade)) in ('g', 'gr', 'grs', 'grama', 'gramas');

update public.embalagens
set unidade = 'm'
where lower(trim(unidade)) in ('m', 'mt', 'mts', 'metro', 'metros');

update public.embalagens
set unidade = 'cm'
where lower(trim(unidade)) in ('cm', 'cms', 'centimetro', 'centimetros', 'centímetro', 'centímetros');

update public.embalagens
set unidade = 'par'
where lower(trim(unidade)) in ('par', 'pares');

update public.embalagens
set unidade = 'rolo'
where lower(trim(unidade)) in ('rolo', 'rolos');
