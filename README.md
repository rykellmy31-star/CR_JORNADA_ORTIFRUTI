# CR Jornada Express

Plataforma SaaS multiempresa de comércio online para hortifrutis, verdurões, mercearias, mercados, minimercados e lojas de produtos alimentícios. Aplicação construída com React + TypeScript + Vite, API Hono, SQLite para desenvolvimento e Cloudflare Workers + D1 + R2 para produção.

> **Estado desta entrega:** base operacional do MVP implementada e testada localmente (lojas, checkout somente na entrega, reservas atômicas de estoque, administração, isolamento por tenant, CRM API, Evolution API preparada, outbox/retentativas e interface responsiva). A implantação pública ainda depende das contas/credenciais Cloudflare, GitHub privado, URL/chave da Evolution API e credenciais finais do SuperAdmin/CRM. O modo WhatsApp sem Evolution configurada é explicitamente homologação: não envia mensagens reais.

> **Compatibilidade de produção:** a marca exibida passa a ser CR Jornada Express. Os endereços legados `hortifruti.crjornada.com` e `hortifruti-admin.crjornada.com`, identificadores internos do Worker, banco D1, URLs de API e cadastros das lojas continuam inalterados para preservar conexões e clientes existentes.

## Funcionalidades

- Lojas públicas em `/loja/:slug`, busca, categorias, promoções, produtos em peso/unidade/variações, carrinho, bairros, checkout visitante e acompanhamento de pedido protegido pelo telefone.
- Pagamentos exclusivamente na entrega: dinheiro, Pix, débito e crédito, habilitados por loja. Troco validado em centavos e calculado no backend.
- Reserva atômica de estoque, histórico de movimentos, reposição/ajuste, baixa ao entregar e restauração em cancelamento. Pools compartilhaveis para embalagens (ex.: 360 ovos, cartela de 30/dúzia/meia dúzia).
- Painel por empresa em `/admin`: painel do dia, pedidos e ciclo de status, produtos, categorias, estoque, clientes, relatórios, mensagens WhatsApp e configurações/entrega.
- Console CR Jornada em `/superadmin`: criação de estabelecimentos, ativação/bloqueio e auditoria.
- API autenticada de integração CRM em `/api/crm/v1/*`; o CRM existente não é replicado.
- WhatsApp: instância segregada, QR no painel, webhooks autenticados, templates, opt-in transacional, idempotência, outbox e tentativas programadas. Segredos e endpoint Evolution não são retornados à UI.
- R2 para mídia em produção; adaptador local na execução Node.

## Executar localmente

Requisitos: Node.js 22+ e npm (a aplicação local foi validada em Node 20; Wrangler 4 atual requer Node 22 para os comandos Cloudflare).

```bash
npm install
cp .env.example .env # opcional; apenas configure valores locais
npm run dev
```

Abra `http://localhost:5173`. O servidor local (API e SQLite) usa `http://localhost:8787`; Vite encaminha `/api` e `/media` via proxy relativo.

O banco SQLite e as mídias locais ficam em `data/` (ignorado pelo Git). As migrações são aplicadas no início. O seed local cria dois estabelecimentos demonstrativos e 12 itens por loja.

### Credenciais somente de demonstração local

- SuperAdmin: `admin@crjornada.com.br` / `CRJornada!Local2026`
- Proprietário Verde Vivo: `dono@verdevivo.local` / `CRJornada!Local2026`
- Proprietário Sabor da Terra: `dono@sabordaterra.local` / `CRJornada!Local2026`

Essas credenciais são exclusivamente para o banco local de demonstração. **Não as use em produção.** A interface não pré-preenche senhas. Para customizar o seed local, use `SEED_SUPERADMIN_EMAIL` e `SEED_DEMO_PASSWORD`. Em produção, o Worker não executa seed automático. Migre o D1 e crie o primeiro SuperAdmin pelo endpoint de uso único `/api/system/bootstrap-superadmin` com `BOOTSTRAP_SECRET` temporário, password de pelo menos 16 caracteres e HTTPS; depois remova imediatamente com `wrangler secret delete BOOTSTRAP_SECRET`. Não existe credencial de produção neste repositório.

Atalhos locais:
- Vitrine: `/loja/verde-vivo` e `/loja/sabor-da-terra`
- Admin: `/admin`
- Central: `/superadmin`

## Scripts

```bash
npm run dev               # API SQLite + Vite (5173/8787)
npm run build             # typecheck + build do frontend
npm test                  # suíte Vitest
npm run db:migrate:local  # aplicar migrações D1 local com Wrangler
npm run db:migrate:remote # aplicar migrações no D1 remoto
npm run cf:dev            # build e Wrangler local
npm run cf:deploy         # build e deploy do Worker
```

## Configuração e segurança

Veja `.env.example`, `.dev.vars.example`, `ARCHITECTURE.md`, `CRM_INTEGRATION_API.md` e `DEPLOY_CLOUDFLARE_GITHUB.md`.

Nunca commit `.env`, `.dev.vars`, chaves da Evolution, JWT secret, CRM key, credenciais GitHub ou dados pessoais. Use `wrangler secret put` e secrets do GitHub Actions. JWT é assinado com HMAC-SHA256, senhas com PBKDF2-SHA256. As rotas administrativas extraem `tenant_id` somente do JWT verificado e revalidam usuário/tenant no banco em cada requisição.

## Testes e limitações externas

A suíte cobre matemática de preço/troco, isolamento, checkout concorrente do último estoque, disponibilidade pública, embalagens compartilhadas, opt-in/idempotência da outbox e autenticação/criação CRM. `npm run build` e `npm test` são os controles locais obrigatórios do CI.

A Evolution API exige URL privada acessível pelo servidor e API Key fornecidas pelo operador. Até serem configuradas em secrets/env, o sistema opera em homologação e identifica isso no painel; QR demonstrativo não faz pareamento real de WhatsApp. A API do CRM existente também depende de URL/especificação, chave e fluxo de autenticação fornecidos pelo proprietário do CRM. Nenhum dos dois sistemas externos é presumido como já conectado.

Para entrega efetiva em produção ainda são necessários: criar conta/recursos Cloudflare, preencher o `database_id` D1 no `wrangler.toml`, domínio público/URL de callback, secrets e permissões da conta, e criar/conectar o repositório privado GitHub. O conector GitHub/Cloudflare não foi disponibilizado nesta sessão, portanto não foi criado remotamente nem publicado.
