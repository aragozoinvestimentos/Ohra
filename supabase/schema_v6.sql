-- Precificador Ohra — schema v6 (Materiais generaliza: filamento + consumíveis)
-- Cole no SQL Editor do Supabase e rode. Pode rodar mais de uma vez sem
-- problema (idempotente) — não apaga nem duplica nada que já existe.
--
-- O que muda: a coluna "preco_kg" vira "preco" (nome genérico, já que nem
-- todo material se mede por kg) e ganha duas colunas novas: "unidade"
-- (kg, un, ml...) e "tipo" (filamento ou consumivel — cola, lixa, tinta
-- etc.). Todo material que já existia vira tipo "filamento" com unidade
-- "kg", exatamente como já funcionava — nada muda pra quem já usava.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'materiais' and column_name = 'preco_kg'
  ) then
    alter table public.materiais rename column preco_kg to preco;
  end if;
end $$;

alter table public.materiais add column if not exists unidade text not null default 'kg';
alter table public.materiais add column if not exists tipo text not null default 'filamento';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'materiais_tipo_check') then
    alter table public.materiais add constraint materiais_tipo_check check (tipo in ('filamento', 'consumivel'));
  end if;
end $$;
