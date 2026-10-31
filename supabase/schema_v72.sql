-- Margem Real — schema v72 (Caixinhas do Dinheiro, 01/11/2026)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA.
--
-- As caixinhas são separações VIRTUAIS do dinheiro da loja (o caixa não muda):
--   giro (antes "Reserva de produção"), impostos, equipamentos,
--   reserva (emergência), reinvestimento, prolabore.
-- Usa a mesma tabela da Reserva de produção (v51): ganha a coluna `caixinha`.
-- Tudo que já foi separado/usado continua lá e vira a caixinha GIRO.
alter table public.reserva_producao add column if not exists caixinha text not null default 'giro';
alter table public.reserva_producao add column if not exists origem text; -- 'distribuir' = distribuição do mês
update public.reserva_producao set caixinha = 'giro' where caixinha is null;
do $$
begin
  alter table public.reserva_producao drop constraint if exists reserva_producao_caixinha_check;
  alter table public.reserva_producao add constraint reserva_producao_caixinha_check
    check (caixinha in ('giro', 'impostos', 'equipamentos', 'reserva', 'reinvestimento', 'prolabore'));
end $$;
create index if not exists reserva_producao_caixinha_idx on public.reserva_producao (loja_id, caixinha);
