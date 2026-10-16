-- Precificador Ohra — schema v60 (limpeza: tabelas vazias e sem uso)
-- Cole no SQL Editor do Supabase e rode. Idempotente.
-- Conferido pelo Gustavo em 16/10/2026: kanban_cards = 0 linhas, produtos (antiga) = 0 linhas.
-- Só apaga se continuarem vazias (se aparecer alguma linha, não apaga nada).
do $$
begin
  if to_regclass('public.kanban_cards') is not null and not exists (select 1 from public.kanban_cards) then
    execute 'drop table public.kanban_cards';
  end if;
  if to_regclass('public.produtos') is not null and not exists (select 1 from public.produtos) then
    execute 'drop table public.produtos';
  end if;
end $$;
