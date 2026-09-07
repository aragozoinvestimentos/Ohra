-- Precificador Ohra — schema v13 (migra o canal "Shein" manual da loja
-- "Naty" pro canal Shein oficial e remove o manual)
-- Rode DEPOIS do schema_v12.sql (que garante que a loja "Naty" já tem o
-- canal Shein oficial). Idempotente — pode rodar mais de uma vez sem
-- problema; se não encontrar nada pra migrar, só avisa e não faz nada.

do $$
declare
  v_loja_id uuid;
  v_shein_manual_id uuid;
  v_shein_oficial_id uuid;
begin
  select id into v_loja_id from public.lojas where nome = 'Naty' limit 1;
  if v_loja_id is null then
    raise notice 'Loja "Naty" não encontrada — nada a fazer.';
    return;
  end if;

  select id into v_shein_oficial_id from public.canais where loja_id = v_loja_id and tipo = 'shein' limit 1;
  if v_shein_oficial_id is null then
    raise notice 'Canal Shein oficial ainda não existe na loja Naty — rode o schema_v12.sql primeiro.';
    return;
  end if;

  select id into v_shein_manual_id
  from public.canais
  where loja_id = v_loja_id and tipo = 'custom' and nome ilike 'shein'
  limit 1;

  if v_shein_manual_id is null then
    raise notice 'Nenhum canal "Shein" cadastrado manualmente na loja Naty — nada a migrar.';
    return;
  end if;

  -- Migra os preços salvos (Preços por Canal) que apontavam pro Shein
  -- manual pro Shein oficial — sem duplicar caso já exista um preço salvo
  -- pro mesmo produto/kit no oficial.
  update public.precos_canal pc
  set canal_id = v_shein_oficial_id
  where pc.canal_id = v_shein_manual_id
    and not exists (
      select 1 from public.precos_canal pc2
      where pc2.item_tipo = pc.item_tipo and pc2.item_id = pc.item_id and pc2.canal_id = v_shein_oficial_id
    );

  -- Remove qualquer preço que não migrou (só sobraria se já existisse um
  -- preço igual salvo no oficial pro mesmo produto/kit).
  delete from public.precos_canal where canal_id = v_shein_manual_id;

  -- Remove o canal Shein cadastrado manualmente, já sem nada dependendo dele.
  delete from public.canais where id = v_shein_manual_id;

  raise notice 'Shein manual migrado pro oficial e removido da loja Naty.';
end $$;
