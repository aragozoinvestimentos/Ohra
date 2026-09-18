-- Duas colunas novas em promocoes_salvas, aditivas e opcionais (linhas
-- antigas ficam com elas em branco, sem precisar de backfill):
--
-- preco_referencia: o preço "de" (preço normal/de tabela por trás da
-- promoção) no momento em que foi salva — hoje só existia escondido dentro
-- do texto do "resumo". Guardado pra virar uma coluna própria em Promoções
-- salvas, em vez de só aparecer em texto solto. Nem todo tipo de promoção
-- tem um "de" único e claro (Progressivo tem várias faixas; Brinde/Frete
-- grátis não mudam o preço em si) — nesses casos fica null.
--
-- desconto_pct: só pra promoções do tipo "desconto" — o percentual de
-- desconto usado (nos dois modos: "por %" e "por preço final"). Junto com
-- preco_referencia, permite reabrir a edição de uma promoção de desconto só
-- com o campo "Desconto (%)" (preço recalcula sozinho: referência × (1 −
-- desconto)), em vez de pedir preço/lucro soltos toda vez.
alter table public.promocoes_salvas add column if not exists preco_referencia numeric;
alter table public.promocoes_salvas add column if not exists desconto_pct numeric;
