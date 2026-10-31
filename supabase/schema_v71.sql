-- schema_v71 (31/10/2026): Atualizar dados → Últimas importações.
-- Cada pedido e cada transação do extrato passa a guardar de qual envio
-- (importacoes.id) ele ENTROU pela 1ª vez — assim o × de um envio errado tira
-- só o que aquele arquivo trouxe de novo. Linhas antigas ficam com null
-- (envios de antes deste SQL não dá pra desfazer pedido a pedido — reenviar o
-- arquivo certo continua corrigindo). Só colunas novas; nada é apagado.

alter table public.pedidos_itens add column if not exists importacao_id uuid;
create index if not exists pedidos_itens_importacao_idx on public.pedidos_itens (importacao_id);

alter table public.extrato_carteira add column if not exists importacao_id uuid;
create index if not exists extrato_carteira_importacao_idx on public.extrato_carteira (importacao_id);
