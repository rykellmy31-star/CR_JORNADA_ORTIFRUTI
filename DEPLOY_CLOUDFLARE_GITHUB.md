# Publicar na Cloudflare e conectar GitHub privado

> Projeto já versionado na branch `main` do GitHub, com ID do D1 configurado e migrações remotas aplicadas. O repositório deve ser tornado privado antes de usar dados reais. A publicação na Cloudflare utiliza GitHub Actions e permanece condicionada aos testes e às credenciais cadastradas em GitHub Secrets. O domínio, o primeiro Super Admin de produção e a integração real Evolution/CRM ainda exigem homologação.

## 1. Criar recursos Cloudflare

1. Crie/acesse uma conta Cloudflare com Workers habilitado e instale/autorize Wrangler (`npx wrangler login`).
2. Crie um banco D1 e bucket R2:

```bash
npx wrangler d1 create cr-jornada-hortifruti-db
npx wrangler r2 bucket create cr-jornada-hortifruti-media
```

3. Copie o `database_id` real para `[[d1_databases]]` em `wrangler.toml`; não deixe `REPLACE_WITH_YOUR_CLOUDFLARE_D1_DATABASE_ID`. Confira nome e bucket sem renomear os bindings `DB`/`MEDIA_BUCKET`.
4. Crie domínio/route Worker e configure `PUBLIC_APP_URL` com URL HTTPS final e estável antes de conectar webhook Evolution.
5. Configurar cache, limites de upload, logs/alertas e backups D1/R2 em conta. Em produção executar restauração de backup de teste.

## 2. Segredos

Crie senhas/chaves fortes aleatórias. Não coloque nenhum valor em Git, código ou `wrangler.toml`.

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put CRM_API_KEY
npx wrangler secret put EVOLUTION_API_URL       # URL privada do serviço Evolution
npx wrangler secret put EVOLUTION_API_KEY
npx wrangler secret put EVOLUTION_WEBHOOK_TOKEN
npx wrangler secret put PUBLIC_APP_URL
```

`EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_WEBHOOK_TOKEN` só quando o provedor Evolution real estiver provisionado. O endpoint deve estar acessível **do Worker** por rede privada segura; Workers não alcançam serviços que só escutam dentro de uma rede local sem conectividade. Avalie Cloudflare Tunnel ou serviço público protegido, allowlist, TLS e política da Evolution. URL e chave não aparecem na interface.

O Worker não roda seed demonstrativo. Após migração, crie uma senha forte exclusiva com pelo menos 16 caracteres e execute bootstrap uma única vez: (1) `npx wrangler secret put BOOTSTRAP_SECRET` com um token temporário aleatório; (2) faça `POST /api/system/bootstrap-superadmin` em HTTPS com `X-Bootstrap-Secret` e JSON `{ "name":"...", "email":"...", "password":"..." }`; (3) confirme HTTP 201, autentique e troque/guarde a senha no gerenciador aprovado; (4) rode imediatamente `npx wrangler secret delete BOOTSTRAP_SECRET`. O endpoint falha sem segredo e não cria outra conta se já existir SuperAdmin. O SuperAdmin `admin@crjornada.com.br` do seed local é **apenas local**. Não reutilize senha de demo.

## 3. Migração e build local

```bash
npm ci
npm test
npm run build
npx wrangler d1 migrations apply cr-jornada-hortifruti-db --remote
npm run cf:deploy
```

A migração inicial deve ser validada em banco staging antes de produção. O deployment usa Static Assets em `dist/public` e API Worker. Cron retry está configurado a cada 2 min. R2 serve os objetos via `/media/*` API.

## 4. GitHub privado e CI/CD

1. Na organização/conta correta, crie repositório **Private** e adicione este projeto usando o repositório local (ou import seguro). Nunca importe `data/`, `.env`, `.dev.vars` nem o banco SQLite local.
2. Adicione GitHub Actions Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JWT_SECRET`, `CRM_API_KEY`; para Evolution real também `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`, `PUBLIC_APP_URL`.
3. Ajuste o workflow `.github/workflows/ci-deploy.yml` e branch de produção `main`; proteja branch e exija testes/aprovação. Rotacione secrets se algum log de action acidentalmente os expuser.
4. Push em `main` executará testes, build e Worker deploy. O workflow injeta segredos na conta Worker via `wrangler secret put`; a conta Cloudflare GitHub Action precisa ter escopo restrito ao Worker/D1/R2 necessários.

## 5. Evolution e CRM

- Configure segredo e URL Evolution fora do painel de lojista. Faça teste com número autorizado e sem clientes reais; QR/instância real dependem de Evolution API v2 compatível e WhatsApp.
- `PUBLIC_APP_URL` precisa apontar ao domínio do Worker. Callback `/api/webhooks/evolution` é validado por token; a Evolution deve enviar header `x-evolution-token`.
- Configure `CRM_API_KEY` independentemente e compartilhe somente backend-a-backend. Integração real com o CRM CR Jornada aguarda os detalhes de endpoint, formato de autenticação, ID externo e homologação do CRM existente.

## Checklist anterior à produção

- [ ] Substituir `database_id`, revisar domínio e bindings, deploy staging/teste smoke.
- [ ] Criar SuperAdmin de produção e owner(s) com credenciais únicas; forçar rotação.
- [ ] JWT/CRM/Evolution secretos configurados; revisar logs sem PII/credenciais.
- [ ] Evolution real conectada e callback validado; opção de homologação não confundir lojistas.
- [ ] Retenção LGPD, aviso de privacidade/consentimentos e canal de direitos aprovados juridicamente.
- [ ] Teste concorrente D1 em staging, cancelamentos/retornos, troca, reserva, backup e restore.
- [ ] Domínio HTTPS, SPF/DMARC onde necessário, monitoramento de fila/falhas/alertas e limites por tenant.
- [ ] Criar repositório GitHub Private, revisar branch protection e CI com permissões mínimas.
