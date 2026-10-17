-- Margem Real — schema v62 (rampa de KIT)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- Rampa de preço de um kit cadastrado (Produtos → Kits) vendido no anúncio
-- próprio dele: degraus em R$ até o preço salvo do kit, igual à rampa de
-- produto. produto_id fica vazio. As rampas de produto e de anúncio com
-- vários itens continuam exatamente como estão.
alter table public.rampas_preco add column if not exists kit_id uuid references public.kits(id) on delete cascade;
create unique index if not exists rampas_preco_kit_canal on public.rampas_preco (kit_id, canal_id) where kit_id is not null;
