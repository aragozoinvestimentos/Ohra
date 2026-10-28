-- Margem Real — schema v69 (28/10/2026): DADOS FISCAIS do produto e da compra
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- produtos_cadastro (preenchidos sozinhos pela nota de compra; editáveis no cadastro):
--   ncm                 código NCM (8 dígitos)
--   cest                código CEST (produto com ST)
--   unidade_com         unidade de venda (UN, CX, KG…)
--   origem_mercadoria   origem do ICMS (0 nacional, 1/2 estrangeira…)
--   monofasico          true = PIS/COFINS monofásico (ex.: cosméticos NCM 3303–3307) — no Simples
--                       essa parte sai do DAS. (imposto_st, do v66, = comprado com ICMS-ST.)
--   fiscal              { cfop_compra, cst_compra, fci } — o que veio na última nota
-- compras_revenda_itens: ncm, cest, cfop, cst — histórico do que veio em cada nota.
alter table public.produtos_cadastro add column if not exists ncm text;
alter table public.produtos_cadastro add column if not exists cest text;
alter table public.produtos_cadastro add column if not exists unidade_com text;
alter table public.produtos_cadastro add column if not exists origem_mercadoria text;
alter table public.produtos_cadastro add column if not exists monofasico boolean;
alter table public.produtos_cadastro add column if not exists fiscal jsonb;

alter table public.compras_revenda_itens add column if not exists ncm text;
alter table public.compras_revenda_itens add column if not exists cest text;
alter table public.compras_revenda_itens add column if not exists cfop text;
alter table public.compras_revenda_itens add column if not exists cst text;
