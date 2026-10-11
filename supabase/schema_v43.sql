-- Precificador Ohra — schema v43 (venda direta: varejo por markup, atacado por
-- faixas e personalização). Cole no SQL Editor do Supabase e rode.
-- Idempotente; só ADICIONA (nenhum dado existente muda).

-- 1) Canal próprio em "modo markup": preço = custo × markup (em vez da margem).
--    modo_preco: 'padrao' (como sempre) | 'markup'; null = padrão.
alter table public.canais add column if not exists modo_preco text;
alter table public.canais add column if not exists markup numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canais_modo_preco_check') then
    alter table public.canais add constraint canais_modo_preco_check check (modo_preco is null or modo_preco in ('padrao', 'markup'));
  end if;
end $$;

-- 2) Orçamentos salvos: detalhe do pedido direto (peças · personalização · arte · frete).
alter table public.orcamentos_avulsos add column if not exists valor_pecas numeric;
alter table public.orcamentos_avulsos add column if not exists personalizacao numeric;
alter table public.orcamentos_avulsos add column if not exists arte numeric;
alter table public.orcamentos_avulsos add column if not exists frete numeric;

-- As faixas de atacado e os padrões de personalização ficam em
-- lojas.config_escada.atacado (jsonb que já existe desde o v27) — sem coluna nova.
