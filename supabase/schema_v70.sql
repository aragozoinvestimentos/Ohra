-- Margem Real — schema v70 (28/10/2026): ESTOQUE DE FABRICADOS
-- Cole no SQL Editor do Supabase e rode. Idempotente; só ADICIONA (nada é apagado).
--
-- O produto fabricado entra no estoque quando você marca "tenho estoque pronto"
-- (fica em produtos_cadastro.estoque_cfg.pronto — sem coluna nova) e cada impressão
-- com sucesso pode virar uma ENTRADA de produção ligada ao registro da impressão.
-- As saídas continuam AO VIVO pelos pedidos importados (só Enviado/Entregue tira do estoque).
--
-- estoque_movimentos.tipo ganha 'producao' (entrada vinda da impressão)
-- estoque_movimentos.registro_id = qual impressão gerou a entrada (apagar a impressão não apaga a entrada)
alter table public.estoque_movimentos add column if not exists registro_id uuid;

alter table public.estoque_movimentos drop constraint if exists estoque_movimentos_tipo_chk;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_chk
  check (tipo in ('entrada', 'ajuste', 'inventario', 'producao'));
