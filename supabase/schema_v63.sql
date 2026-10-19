-- schema v63 (19/10/2026) — "Pago com" nas saídas do Fluxo de Caixa
-- Meu bolso (dinheiro do Gustavo) × Caixa da loja (dinheiro das vendas).
-- Saída paga do bolso NÃO sai do saldo da loja e conta no Payoff como
-- dinheiro que ele colocou. Aditivo: nada é apagado.

alter table public.lancamentos_caixa
  add column if not exists pago_com text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lancamentos_caixa_pago_com_chk') then
    alter table public.lancamentos_caixa
      add constraint lancamentos_caixa_pago_com_chk check (pago_com is null or pago_com in ('bolso', 'loja'));
  end if;
end $$;

-- Tudo que já foi lançado como saída saiu do bolso do Gustavo (combinado em
-- 19/10/2026) — menos a retirada (pró-labore), que sai do caixa da loja.
update public.lancamentos_caixa
   set pago_com = 'bolso'
 where tipo = 'saida' and pago_com is null and coalesce(categoria, '') <> 'retirada';

update public.lancamentos_caixa
   set pago_com = 'loja'
 where tipo = 'saida' and pago_com is null and categoria = 'retirada';
