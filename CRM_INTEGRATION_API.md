# API de integração CRM — v1

Raiz: `https://<dominio-hortifruti>/api/crm/v1`.

A API permite ao CRM já existente administrar os estabelecimentos sem recriar esse CRM. Todas as chamadas exigem segredo servidor-a-servidor `CRM_API_KEY`; enviar via header `X-CRM-API-Key: <segredo>` (alternativamente `Authorization: Bearer <segredo>`). O valor nunca deve sair do backend do CRM para navegador, app ou repositório. A chave é comparada em tempo constante.

## Rotas

### `GET /health`
Retorna status e versão da integração. Ainda exige a chave.

### `GET /establishments`
Lista `id`, `crm_external_id`, `slug`, `name`, `status`, `plan`, datas. No MVP, não aceita paginação; limite e paginação cursor-based devem ser adicionados antes de bases muito grandes.

### `POST /establishments`

```json
{
  "externalId": "id-estavel-no-crm",
  "name": "Hortifruti Exemplo",
  "slug": "hortifruti-exemplo",
  "ownerName": "Nome do proprietário",
  "ownerEmail": "proprietario@example.com",
  "ownerPhone": "+5573999999999",
  "ownerTemporaryPassword": "opcional-com-no-minimo-12",
  "status": "onboarding",
  "plan": "profissional"
}
```

`externalId`, `slug` e e-mail devem ser únicos. O endpoint cria tenant, owner e a configuração inicial WhatsApp no banco. Se uma senha inicial for fornecida, o CRM deve entregá-la ao owner por canal seguro, exigir troca e evitar armazená-la em logs. Sem ela, o sistema gera senha temporária e retorna uma única vez na resposta. Resposta `201` inclui ID interno `data.id`, `externalId`, loja e aviso da senha temporária.

### `GET /establishments/:id`
Busca pelo ID interno do tenant ou pelo `crm_external_id`.

### `PATCH /establishments/:id/status`

```json
{ "status": "active" }
```

Valores aceitos: `active`, `blocked`, `suspended`, `onboarding`. Para bloqueio/suspensão, use `{"status":"blocked","reason":"Fatura pendente"}`. O middleware administrativo revalida o status da empresa em cada chamada, portanto o bloqueio passa a valer imediatamente.

### `POST /establishments/:id/owner`
Cria owner adicional: `{ "name":"...", "email":"...", "phone":"...", "temporaryPassword":"pelo-menos-12" }`.

### `PATCH /establishments/:id/owner/:userId`
Ativa/desativa o usuário owner neste tenant: `{ "active": false }`.

## Erros/status HTTP

- `400`: validação de payload.
- `401`: chave ausente/inválida.
- `404`: tenant não localizado.
- `409`: ID/slug/e-mail duplicado.
- `5xx`: falha da aplicação; usar retry com backoff para operações idempotentes.

## Segurança e prontidão

- Usar TLS, restrição de egress/IP se disponível, rotação de chave e secret manager.
- Recomendado adicionar `Idempotency-Key` no CRM antes de retries de `POST` (a primeira versão aplica unicidade a externalId/slug, não reutiliza a resposta original).
- Registrar `externalId` estável no CRM para reconciliar chamadas; não usar nome como chave.
- A integração técnica com o CRM existente **ainda exige** endpoint/URL e autenticação próprios do CRM, mapeamento do ID externo, política de retries/webhooks e ambiente sandbox fornecidos pelo cliente. A API aqui é a extremidade Hortifruti; não presume nenhum endpoint existente.
- Configurar `CRM_API_KEY` como secret Cloudflare/Node. Para testar localmente, defina `CRM_API_KEY` em `.env`; sem `.env`, Node local usa a chave fixa de desenvolvimento `local-crm-key-not-for-production`. Ela não é uma credencial de produção e nunca é enviada ao frontend.
