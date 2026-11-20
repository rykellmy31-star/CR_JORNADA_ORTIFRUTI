# Arquitetura — CR Jornada Hortifruti

## Componentes

- **Frontend:** React 18, TypeScript, React Router, Vite e CSS responsivo local (`src/web`). Sem dependência de CDN para estilo ou imagens essenciais.
- **API:** Hono no Worker (`src/worker-entry.ts`) e mesma aplicação via Node (`src/server/node-entry.ts`). JSON REST em `/api/*`.
- **Persistência:** contrato `DbClient`; `CloudflareD1Adapter` para D1 e `SqliteD1Adapter` baseado em `better-sqlite3`/WAL local.
- **Mídia:** `MediaStorageAdapter`; R2 na Cloudflare, armazenamento local no Node. Upload validado até 5 MB e prefixado em `tenants/{tenantId}/...`.
- **Background:** Cloudflare Cron a cada 2 minutos processa outbox do WhatsApp; D1 é fonte durável da fila. Envio individual tem backoff e máximo de tentativas.

## Multi-tenancy e autorização

As entidades operacionais incluem `tenant_id`; queries do painel e alterações recebem tenant **somente** do JWT validado e de junção `users`→`tenants` no servidor. A API pública resolve o tenant via slug e só seleciona catálogo ativo/disponível, omitindo números internos de estoque. A API CRM tem chave servidor-servidor própria. SuperAdmin usa middleware separado.

A proteção é lógica em banco compartilhado (D1), adequada à fase inicial. Para escalar, considerar database-per-tenant ou particionamento operacional; manter checks na API mesmo com futura mudança.

## Banco e reserva

A migração `migrations/0001_initial_schema.sql` define 15 tabelas: tenants, users, bairros, categorias, pools, produtos, variações, clientes, pedidos, itens, movimentos, instâncias WhatsApp, templates, outbox e audit logs.

Quantidades de venda são inteiros: gramas para peso e inteiros para unidade/embalagens. Preços são centavos. Produtos podem apontar a uma origem física `stock_pool_id`. Os serviços agregam demanda por bucket (produto, variação ou pool) e fazem update condicional `WHERE physical_qty - reserved_qty >= demanda` dentro de lote transacional. D1 insere guardas SQL abortivas no mesmo `batch`, garantindo rollback integral inclusive de pedido/itens se uma reserva concorrente perder. SQLite local usa transação `BEGIN IMMEDIATE`.

O checkout reserva e incrementa `reserved_qty`; ao entregar, a transição condicional `reserved`→`committed` baixa `physical_qty` uma só vez. Ao cancelar, `reserved` é liberado, ou o estoque já comprometido é retornado. `released` bloqueia estorno duplicado.

## Pedidos e pagamento

Checkout de convidado valida novamente catálogo, bairro, disponibilidade, pagamentos ativos, mínimo e troco no backend. Não há endpoint de pagamento online. Os meios persistidos são `cash`, `pix_delivery`, `debit_card` e `credit_card`. A cobrança total é calculada sobre linhas + taxa de entrega selecionada. Informações de pedido são expostas no tracking apenas com o telefone normalizado completo.

## WhatsApp e privacidade

`evolution-whatsapp.ts` coordena uma instância por tenant, QR interno, templates e outbox com unicidade `(tenant_id, idempotency_key)`. Mensagens são ignoradas sem consentimento (`whatsapp_opt_in=0`). Templates recebem apenas variáveis transacionais. Cron reprocessa pendências; tentativas limitadas, erros filtrados e payload sem credenciais.

Em `homologation`, pareamento/envio é uma simulação local auditável — não há entrega externa. O modo real exige `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, URL pública e token forte para webhook. O webhook não é provisionado sem token configurado. Proteger também acesso de rede à Evolution API (allowlist/VPN/TLS privado) e fazer rotação de chave.

## LGPD e operação

Coletar somente dados para entrega/contato; opt-in do WhatsApp é explícito e opcional; política de privacidade/retention, base legal, prazos de retenção e canal para direitos LGPD ainda devem ser definidos pela CR Jornada antes de produção. Não registrar senha/tokens; logs de auditoria para ações operacionais. Planejar backups/exportação D1 e R2, restauração ensaiada, retenção mínima de backups e monitoramento de erros/filas.

## Estrutura

- `src/shared/`: cálculos e contratos compartilhados.
- `src/server/routes/`: `auth`, `public-store`, `admin`, `crm`, `superadmin`.
- `src/server/services/`: inventário atômico e Evolution/outbox.
- `src/server/db/`: adaptadores D1/SQLite e contrato comum.
- `migrations/`: SQL compatível com SQLite/D1.
- `tests/core.test.ts`: cenários invariantes críticos.
