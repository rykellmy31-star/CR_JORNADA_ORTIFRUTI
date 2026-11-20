# CR Jornada Hortifruti — domínios individualizados sem wildcard

Escopo **exclusivamente** do repositório `CR_JORNADA_ORTIFRUTI`.
O Super Admin geral do Pelicano (`admin.crjornada.com`) não participa;
a respectiva PR #96 foi encerrada, sem merge.

## Endereços

- `https://hortifruti-admin.crjornada.com/`: Super Admin já existente no Hortifruti.
- `https://hortifruti.crjornada.com/admin`: login administrativo das lojas.
- `https://{slug}.crjornada.com/`: vitrine individual do estabelecimento.

As rotas antigas `/loja/:slug`, `/admin` e `/superadmin` continuam funcionando.
A senha inicial é mostrada apenas na criação; armazenamento exclusivo em hash.
Não há troca de senha obrigatória no primeiro login.

## Integração automática na Cloudflare

Usar o endpoint oficial da Cloudflare:
`PUT /client/v4/accounts/{account_id}/workers/domains`.
O serviço faz antes duas verificações de leitura:
`GET /accounts/{account_id}/workers/domains?hostname=...` e
`GET /zones/{zone_id}/dns_records?name.exact=...`.

Uma entrada de DNS já existente ou um Custom Domain pertencente a outro Worker
**impedem o cadastro**; a API nunca envia DELETE nem PUT para hostname conflitante.
A chamada usa hostname montado exclusivamente a partir do slug validado:
`{slug}.crjornada.com`, com o serviço fixo `cr-jornada-hortifruti`.
Não aceita URL arbitrária do navegador. Domínios reservados, incluindo
`admin`, `pontos`, `fidelidade`, `gestor`, `evolution`, `agendamentos`,
`crbot`, `hortifruti-admin` e `hortifruti`, são rejeitados localmente.

A Cloudflare cria o DNS e o certificado SSL/TLS para o Custom Domain.
O retorno de registro pela API **não garante** que o certificado HTTPS
esteja disponível naquele instante: confirmar antes de compartilhar.

### Variáveis e secrets do Worker `cr-jornada-hortifruti`

Configurar **somente no Worker do Hortifruti**, por Cloudflare Workers & Pages →
Worker → Configurações → Variáveis e Segredos:

| Chave | Tipo | Conteúdo |
| --- | --- | --- |
| `CF_ACCOUNT_ID` | Secret | ID da conta Cloudflare, 32 caracteres hexadecimais |
| `CF_ZONE_ID` | Secret | Zone ID de `crjornada.com`, 32 caracteres hexadecimais |
| `CF_DOMAINS_API_TOKEN` | Secret | Token API restrito, nunca enviar em chat ou commitar |
| `CF_AUTO_DOMAINS_ENABLED` | Secret | `true` somente após os testes e backup |

A ausência de qualquer requisito desativa o provisionamento.
Os IDs podem ser tratados como valores não secretos, mas foram colocados como
Secrets para que os deploys do Wrangler preservem os bindings fora do `wrangler.toml`.
Nunca usar a Global API Key.

Permissões mínimas conforme acesso disponível na conta:
**Workers Editor** (serviço Worker Hortifruti) e
**Zone → Workers Routes → Write** para `crjornada.com`;
a verificação adicional de DNS requer **Zone → DNS → Read**
para `crjornada.com`. A Cloudflare ainda pode restringir a granularidade
de permissões de Custom Domains. Não conceder DNS Write ou acesso a outras
zonas se não for exigido.

### Publicação segura

1. Fazer backup do D1 atual e registrar a versão do Worker em produção.
2. Aplicar a migração **aditiva** `0008_tenant_store_domains.sql` no banco D1
   `cr-jornada-hortifruti-db` (verificar primeiro em homologação).
   A migration não edita clientes, produtos, pedidos ou senhas existentes.
3. Publicar a branch aprovada do Hortifruti e verificar o login do Super Admin e
   as rotas antigas. Não publicar a PR #96 dos postos.
4. Configurar os quatro Secrets acima; habilitar `CF_AUTO_DOMAINS_ENABLED=true`
   apenas quando o código e a migração estiverem disponíveis em produção.
5. Criar uma nova loja real no Super Admin. O Worker valida conflitos na zona,
   cria a loja e tenta anexar o Custom Domain.
6. Se a Cloudflare falhar depois da criação local, a loja fica
   `onboarding` e o domínio `pending`. A tela permite
   **Tentar configurar domínio** novamente, sem criar segunda conta.
7. Conferir a emissão do HTTPS e o carregamento da vitrine do tenant correto.
8. Confirmar que `admin`, `pontos`, `fidelidade`,
   `evolution`, `gestor`, `agendamentos` e `crbot`
   permanecem conectados aos Workers antigos.

No modo desativado a criação antiga continua disponível, mas exibe
`Sem domínio automático`: **não anuncie a vitrine como publicada**.

## Limites

A Cloudflare informa limite atual de **100 Custom Domains por zona**
(no seu caso `crjornada.com`). A partir do limite, a API recusará novas
vinculações e o sistema deixará a loja pendente. Para escala maior,
seria preciso avaliar outra arquitetura, sem alterar os outros sistemas
sem planejamento e autorização específica.

Referências oficiais:
- https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/workers/platform/limits/
