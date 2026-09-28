-- Precificador Ohra — schema v31 (Ficha do anúncio: cores/versões por produto)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA colunas.

-- Cores (ou versões) de um produto/kit como aparecem nas plataformas:
-- [{ "nome": "Preto", "sufixo": "-P" }, { "nome": "Branco", "sufixo": "-B" }]
-- SKU de cada opção = SKU do item (produto, variação ou kit) + sufixo.
-- null / [] = sem cores (uma opção por item, SKU sem sufixo).
alter table public.produtos_cadastro add column if not exists cores_anuncio jsonb;
alter table public.kits add column if not exists cores_anuncio jsonb;
