-- Precificador Ohra — schema v4 (PIN e ícone por loja)
-- Cole no SQL Editor do Supabase e rode. Adiciona PIN de acesso e ícone
-- (imagem) pra cada loja, cria o bucket de Storage onde os ícones ficam
-- guardados, e já deixa criada a loja "Ohra - 3D" com PIN 1107.

alter table public.lojas add column if not exists pin text;
alter table public.lojas add column if not exists icone_url text;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'lojas' and constraint_name = 'lojas_pin_formato'
  ) then
    alter table public.lojas add constraint lojas_pin_formato check (pin is null or pin ~ '^[0-9]{4}$');
  end if;
end $$;

-- Bucket público pros ícones das lojas (a URL fica pública, mas só quem tem
-- o link vê a imagem — não expõe nenhum dado do app).
insert into storage.buckets (id, name, public)
values ('loja-icones', 'loja-icones', true)
on conflict (id) do nothing;

drop policy if exists "loja-icones leitura publica" on storage.objects;
create policy "loja-icones leitura publica" on storage.objects
  for select using (bucket_id = 'loja-icones');

drop policy if exists "loja-icones anon insere" on storage.objects;
create policy "loja-icones anon insere" on storage.objects
  for insert to anon with check (bucket_id = 'loja-icones');

drop policy if exists "loja-icones anon atualiza" on storage.objects;
create policy "loja-icones anon atualiza" on storage.objects
  for update to anon using (bucket_id = 'loja-icones') with check (bucket_id = 'loja-icones');

drop policy if exists "loja-icones anon remove" on storage.objects;
create policy "loja-icones anon remove" on storage.objects
  for delete to anon using (bucket_id = 'loja-icones');

-- Loja nova já com PIN cadastrado (id fixo pra poder rodar o script mais de
-- uma vez sem duplicar).
insert into public.lojas (id, nome, pin)
values ('00000000-0000-0000-0000-000000000002', 'Ohra - 3D', '1107')
on conflict (id) do nothing;

-- Mesmo padrão das outras lojas: já nasce com Shopee e Mercado Livre.
insert into public.canais (nome, tipo, loja_id)
select 'Shopee', 'shopee', '00000000-0000-0000-0000-000000000002'
where not exists (
  select 1 from public.canais where loja_id = '00000000-0000-0000-0000-000000000002' and tipo = 'shopee'
);

insert into public.canais (nome, tipo, loja_id)
select 'Mercado Livre', 'ml', '00000000-0000-0000-0000-000000000002'
where not exists (
  select 1 from public.canais where loja_id = '00000000-0000-0000-0000-000000000002' and tipo = 'ml'
);
