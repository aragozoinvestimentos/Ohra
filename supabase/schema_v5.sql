-- Precificador Ohra — schema v5 (aba Otimização)
-- Cole no SQL Editor do Supabase e rode. Adiciona os campos de tempo de
-- produção (por produto) e de recursos disponíveis (por loja) usados pra
-- calcular a capacidade máxima de produção por dia.

-- Recursos da loja: quantas impressoras, quantas horas elas podem rodar por
-- dia, quantas horas de mão de obra (acabamento/embalagem/separação) você
-- tem disponíveis, e o tempo médio de separação por pedido.
alter table public.lojas add column if not exists impressoras integer;
alter table public.lojas add column if not exists horas_impressora_dia numeric;
alter table public.lojas add column if not exists horas_mao_obra_dia numeric;
alter table public.lojas add column if not exists tempo_separacao_pedido_min numeric;
alter table public.lojas add column if not exists pedidos_estimados_dia numeric;

-- Tempos de produção por item cadastrado.
alter table public.produtos_cadastro add column if not exists pecas_por_impressao numeric;
alter table public.produtos_cadastro add column if not exists tempo_impressao_horas numeric;
alter table public.produtos_cadastro add column if not exists tempo_setup_min numeric;
alter table public.produtos_cadastro add column if not exists tempo_acabamento_min numeric;
alter table public.produtos_cadastro add column if not exists tempo_embalagem_min numeric;
