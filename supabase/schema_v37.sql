-- Precificador Ohra — schema v37 (Estratégia do preço por item × canal)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA colunas.
-- Sem migração: estrategia null = Normal (todos os preços já salvos seguem iguais).
--   estrategia          'normal' | 'crescimento' | 'atracao' — decisão do Gustavo ("Manter assim")
--   estrategia_ate      até quando vale (crescimento: padrão 30 dias; atração: sem prazo)
--   estrategia_lucro_ref lucro ao vivo no dia da decisão — se o lucro cair mais de R$0,05, a decisão vence
--   estrategia_motivo   texto livre opcional
--   estrategia_em       quando foi decidido
-- Gravar um preço NOVO zera essas colunas (preço novo = decisão nova).

alter table public.precos_canal add column if not exists estrategia text;
alter table public.precos_canal add column if not exists estrategia_ate date;
alter table public.precos_canal add column if not exists estrategia_lucro_ref numeric;
alter table public.precos_canal add column if not exists estrategia_motivo text;
alter table public.precos_canal add column if not exists estrategia_em timestamptz;

-- Valores aceitos (separado do "add column" pra continuar idempotente).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'precos_canal_estrategia_check') then
    alter table public.precos_canal
      add constraint precos_canal_estrategia_check check (estrategia in ('normal', 'crescimento', 'atracao'));
  end if;
end $$;

-- Recarrega o cache do PostgREST pra as colunas novas aparecerem na hora.
notify pgrst, 'reload schema';
