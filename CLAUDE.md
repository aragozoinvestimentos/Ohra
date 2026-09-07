# Precificador Ohra

PWA de precificação/produção pra produtos impressos em 3D (Gustavo vende via Shopee, Mercado Livre, TikTok Shop, Shein). React 19 + Vite, Supabase (anon-key, RLS permissiva), deploy automático no Vercel a partir do `main` (`https://ohraa.vercel.app`).

## Regras que NUNCA podem ser esquecidas

- **Dado cadastrado nunca pode sumir quando o app muda.** Toda vez que uma mudança reestrutura onde/como um dado vive (nova tabela substituindo uma antiga, campo que muda de lugar, cálculo que passa a vir de outro lugar), a tarefa só está completa com uma migração SQL que carrega os dados que já existiam pra estrutura nova — nunca deixe alguém com produto/preço/canal já cadastrado "sumindo" da tela depois de uma melhoria. Migração deve ser aditiva e best-effort (usar `on conflict do nothing`/`do update`, nunca apagar a tabela antiga sem que Gustavo peça, e nunca travar se uma linha não achar par — só pula ela).
- **Gustavo mantém dados reais cadastrados o tempo todo** ("estou cadastrando algumas coisas, não apague"). Nunca criar/editar/excluir registros reais via ferramentas de automação/browser — verificação de deploy é sempre só leitura (comparar hash do JS buildado com o servido em produção, olhar console, print de tela). Ações destrutivas em dado real só acontecem via SQL que o próprio Gustavo roda no Supabase, nunca direto por mim.
- Eu não tenho acesso direto ao banco (sem MCP/DDL). Todo `ALTER TABLE`/migração vira um arquivo em `supabase/schema_vN.sql` (idempotente, sempre incrementando o número), colado no chat pra ele copiar e rodar no SQL Editor do Supabase — nunca só como arquivo anexado (ele prefere código colado direto na mensagem).
- Depois de qualquer alteração: `npm run lint` e `npm run build` (checar que não subiu warning novo além do baseline conhecido), commit com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` + `Claude-Session: <url>`, push, esperar o deploy (~45s) e verificar via browser (comparar hash de `dist/assets/index-*.js` local com o servido, checar console sem erro).
- Gustavo prefere discutir/alinhar antes de mudanças maiores ("me retorne antes de alterar qualquer coisa") — pra ajustes pequenos e bem definidos pode implementar direto.

## Tabelas principais (Supabase)

`lojas`, `canais` (tipo: shopee/ml/tiktok/shein/custom — toda loja nova já nasce com shopee/ml/shein), `produtos_cadastro`, `kits` (+ `kit_produtos`, `kit_embalagens`), `embalagens`, `materiais`, `precos_canal` (preço real por produto/kit × canal, chave única `item_tipo,item_id,canal_id` — alimentada pelo "Salvar" da Precificação por Canal, lida pela grade "Preços por Canal"), `orcamentos_avulsos` (lista de encomendas avulsas salvas). A tabela antiga `produtos` (histórico solto, sem FK) foi descontinuada a partir do schema v10 — mantida no banco só como fonte de migração, não é mais lida pelo app.
