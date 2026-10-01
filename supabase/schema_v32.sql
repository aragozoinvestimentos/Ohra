-- Precificador Ohra — schema v32 (compras de material + parcelamento no caixa)
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA tabela e
-- colunas — nada existente muda.

-- 1) Compras de material ----------------------------------------------------
-- Cada compra de filamento/insumo. O preço do material (materiais.preco) vira
-- a MÉDIA PONDERADA (pela quantidade) das 3 últimas compras com
-- contar_media = true — o app recalcula e grava em materiais.preco a cada
-- compra registrada/excluída.
create table if not exists public.compras_material (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid references public.lojas(id) on delete cascade,
  material_id uuid not null references public.materiais(id) on delete cascade,
  data date not null default current_date,
  quantidade numeric not null check (quantidade > 0),   -- na unidade do material (kg pro filamento)
  valor_total numeric not null check (valor_total >= 0), -- o que pagou de verdade (com frete e desconto)
  contar_media boolean not null default true,            -- false = compra de teste/pontual
  parcelas integer not null default 1,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists compras_material_idx on public.compras_material (material_id, data desc);

alter table public.compras_material enable row level security;
drop policy if exists "anon pode ler compras_material" on public.compras_material;
create policy "anon pode ler compras_material" on public.compras_material for select to anon using (true);
drop policy if exists "anon pode inserir compras_material" on public.compras_material;
create policy "anon pode inserir compras_material" on public.compras_material for insert to anon with check (true);
drop policy if exists "anon pode atualizar compras_material" on public.compras_material;
create policy "anon pode atualizar compras_material" on public.compras_material for update to anon using (true) with check (true);
drop policy if exists "anon pode excluir compras_material" on public.compras_material;
create policy "anon pode excluir compras_material" on public.compras_material for delete to anon using (true);
do $$
begin
  alter publication supabase_realtime add table public.compras_material;
exception when duplicate_object then null;
end $$;

-- 2) Parcelas e vínculo com a compra no Fluxo de Caixa ----------------------
-- Lançamento parcelado = N linhas com o mesmo parcela_grupo (1/N, 2/N…).
alter table public.lancamentos_caixa add column if not exists parcela_grupo uuid;
alter table public.lancamentos_caixa add column if not exists parcela_num integer;
alter table public.lancamentos_caixa add column if not exists parcela_total integer;
alter table public.lancamentos_caixa add column if not exists compra_material_id uuid references public.compras_material(id) on delete set null;
create index if not exists lancamentos_caixa_grupo_idx on public.lancamentos_caixa (parcela_grupo);
