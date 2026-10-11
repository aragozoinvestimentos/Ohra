-- Precificador Ohra — schema v41 (quantidades anunciadas por canal)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA uma coluna.
--   produtos_cadastro.quantidades_anuncio  { "<canal_id>": [1, 2, 3] } —
--   quantidades (avulso = 1, variações = 2, 3, 5…) anunciadas em cada canal.
--   null / canal ausente = padrão do app (Shopee: as que cabem na regra de 4×
--   no anúncio do avulso; outros canais: todas). Nada é apagado: preço salvo
--   de quantidade não anunciada continua no banco.

alter table public.produtos_cadastro add column if not exists quantidades_anuncio jsonb;
