-- Precificador Ohra — schema v45 (Ads num lugar só: teste de lançamento = período de Ads)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).

-- Tipo do período: 'normal' (aba Ads) ou 'teste' (teste de lançamento da Rampa).
alter table public.ads_periodos add column if not exists tipo text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ads_periodos_tipo_check') then
    alter table public.ads_periodos add constraint ads_periodos_tipo_check check (tipo in ('normal', 'teste'));
  end if;
end $$;

-- Testes já concluídos que o v44 trouxe pro histórico.
update public.ads_periodos set tipo = 'teste'
where tipo = 'normal' and nota = 'teste de lançamento';

-- Teste de lançamento EM ANDAMENTO na Rampa:
-- 1) se já existe um período ligado pro mesmo produto × canal (ex.: criado na
--    aba Ads), ele vira o teste (sem duplicar);
update public.ads_periodos a
set tipo = 'teste', nota = coalesce(a.nota, 'teste de lançamento')
from public.rampas_preco r
where r.teste_status = 'iniciado'
  and a.item_tipo = 'produto' and a.item_id = r.produto_id and a.canal_id = r.canal_id
  and (a.fim is null or a.fim >= current_date)
  and a.tipo = 'normal';

-- 2) senão, cria o período do teste a partir da Rampa.
insert into public.ads_periodos (loja_id, item_tipo, item_id, canal_id, inicio, fim, orcamento_diario, nota, tipo)
select r.loja_id, 'produto', r.produto_id, r.canal_id, r.teste_inicio,
       r.teste_inicio + (greatest(coalesce(r.teste_dias, 7), 1) - 1),
       case when coalesce(r.teste_dias, 0) > 0 and r.teste_orcamento is not null then round(r.teste_orcamento / r.teste_dias, 2) end,
       'teste de lançamento', 'teste'
from public.rampas_preco r
where r.teste_status = 'iniciado' and r.teste_inicio is not null
  and not exists (
    select 1 from public.ads_periodos a
    where a.item_tipo = 'produto' and a.item_id = r.produto_id and a.canal_id = r.canal_id
      and (a.fim is null or a.fim >= r.teste_inicio)
  );
