-- Precificador Ohra — schema v9 (permite canal do tipo TikTok Shop)
-- Cole no SQL Editor do Supabase e rode. Idempotente — pode rodar mais de
-- uma vez sem problema.
--
-- O que muda: a tabela "canais" tinha uma regra (CHECK) que só permitia
-- tipo = 'shopee', 'ml' ou 'custom'. Isso ficou esquecido quando o TikTok
-- Shop foi adicionado ao app — por isso o botão "+ Adicionar TikTok Shop"
-- em Cadastros → Canais estava falhando com erro "Não foi possível
-- adicionar". Esse script atualiza a regra pra incluir 'tiktok'.

alter table public.canais drop constraint if exists canais_tipo_check;
alter table public.canais add constraint canais_tipo_check
  check (tipo in ('shopee', 'ml', 'tiktok', 'custom'));
