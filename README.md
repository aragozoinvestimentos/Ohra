# Precificador Ohra

App de precificação da Ohra: custo de produção e preço de venda por canal
(Shopee, Mercado Livre ou outro canal), com histórico de produtos salvos.
Funciona no celular e no computador — pode ser "instalado" como um app
(PWA), sem precisar de login na Claude.

Stack: [Vite](https://vite.dev) + React, [Supabase](https://supabase.com)
(banco de dados do histórico), hospedado na [Vercel](https://vercel.com).

## Rodando localmente

```bash
npm install
cp .env.example .env   # depois preencha com as chaves do seu projeto Supabase
npm run dev
```

Sem o `.env` preenchido o app funciona normalmente — só a aba **Histórico**
fica desativada (mostra um aviso em vez da lista de produtos).

## Configurando o Supabase (banco do histórico)

1. Crie uma conta/projeto em [supabase.com](https://supabase.com) (recomendado:
   usar a mesma conta Google `aragozoinvestimentos@gmail.com`).
2. No painel do projeto, abra **SQL Editor**, cole o conteúdo de
   [`supabase/schema.sql`](./supabase/schema.sql) e rode. Isso cria a tabela
   `produtos` e as permissões necessárias.
3. Em **Project Settings → API**, copie a **Project URL** e a chave
   **anon public**.
4. Cole esses dois valores no `.env` (local) e nas variáveis de ambiente do
   projeto na Vercel (produção) — veja abaixo.

> Este app não tem tela de login: quem tiver o link do site consegue usá-lo.
> Isso é intencional (uso pessoal, sem fricção). Só não compartilhe a chave
> `anon` publicamente (ex: em um repositório aberto no GitHub).

## Deploy na Vercel

1. Suba este repositório no GitHub (na conta `aragozoinvestimentos@gmail.com`).
2. Em [vercel.com](https://vercel.com), clique em **Add New → Project** e
   importe o repositório. A Vercel detecta o Vite automaticamente.
3. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Clique em **Deploy**. A cada `git push` no branch principal, a Vercel
   publica uma nova versão automaticamente.
5. Abra o link gerado (ou configure um domínio próprio) no celular e escolha
   **"Adicionar à tela de início"** (Android/Chrome) ou **"Adicionar à Tela
   de Início"** no Safari (iPhone) para usar como um app instalado, sem a
   barra do navegador.

## Estrutura

- `src/lib/calc.js` — toda a lógica de cálculo (custo de produção e
  precificação por canal), a mesma validada na planilha "Precificador Ohra
  2.0".
- `src/components/CustoProducao.jsx` — aba de custo de produção.
- `src/components/PrecificacaoCanal.jsx` — aba de preço por canal
  (Shopee / Mercado Livre / outro), com salvamento no histórico.
- `src/components/Historico.jsx` — aba de histórico, lida do Supabase em
  tempo real.
- `supabase/schema.sql` — schema do banco (tabela `produtos` + permissões).

## Atualizando as taxas dos canais

As taxas da Shopee e do Mercado Livre mudam de tempos em tempos. Elas estão
centralizadas em `src/lib/calc.js` (`SHOPEE_TIERS`, `ML_CATEGORY_PCT`,
`ML_FEE_TIERS`) — atualize os valores lá, faça commit e a Vercel republica
sozinha.

<!-- trigger fresh Vercel build to pick up Supabase env vars -->
