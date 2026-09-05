-- Precificador Ohra — schema do Supabase
-- Cole este arquivo inteiro no SQL Editor do seu projeto Supabase e rode.

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  canal text not null,
  custo numeric not null,
  preco numeric not null,
  margem numeric not null,
  criado_em timestamptz not null default now()
);

-- Habilita Row Level Security (obrigatório para a chave "anon" funcionar com segurança).
alter table public.produtos enable row level security;

-- Este app não tem login (é de uso pessoal, só você tem o link/chave do projeto).
-- As políticas abaixo liberam leitura/escrita para a chave "anon" — ou seja,
-- qualquer pessoa que tiver a URL e a anon key do seu projeto Supabase consegue
-- ler e editar o histórico. Isso é aceitável para uma ferramenta pessoal cujas
-- chaves não são divulgadas publicamente, mas NÃO cole essas chaves em lugares
-- públicos (repositório aberto, prints, etc.). Se um dia quiser adicionar login,
-- troque estas políticas por regras baseadas em auth.uid().
drop policy if exists "anon pode ler produtos" on public.produtos;
create policy "anon pode ler produtos"
  on public.produtos for select
  to anon
  using (true);

drop policy if exists "anon pode inserir produtos" on public.produtos;
create policy "anon pode inserir produtos"
  on public.produtos for insert
  to anon
  with check (true);

drop policy if exists "anon pode excluir produtos" on public.produtos;
create policy "anon pode excluir produtos"
  on public.produtos for delete
  to anon
  using (true);

-- Habilita as atualizações em tempo real (usadas pela aba Histórico).
alter publication supabase_realtime add table public.produtos;
