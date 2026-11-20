# Publicar na Cloudflare e conectar GitHub privado

> Projeto já versionado na branch `main` do GitHub, com ID do D1 configurado e migrações remotas aplicadas. O repositório deve ser tornado privado antes de usar dados reais. A publicação na Cloudflare utiliza GitHub Actions e permanece condicionada aos testes e às credenciais cadastradas em GitHub Secrets. O Super Admin inicial já foi criado no D1; o login administrativo está em validação. O domínio próprio e a integração real Evolution/CRM ainda exigem homologação.

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

## Atualização — Venda por kg e unidade (20/11/2026)

- Vitrine exclusiva por loja, sem diretório público de estabelecimentos nem links para outros hortifrutis.
- Cadastro opcional de dois preços: por kg e por unidade; peso médio (g/unidade) define consumo do mesmo estoque em gramas.
- Checkout preserva o modo escolhido e registra preço e quantidade específicos de cada item.
- Clientes, pedidos, produtos e estoques continuam isolados por identificador de estabelecimento.
- Migração D1 `0003_dual_sale_mode.sql` aplicada antes do deploy; nenhum dado anterior removido.

## Atualização — Selo e preço promocional (20/11/2026)

- Cada produto com preço promocional menor que o preço original exibe um selo verde com percentual arredondado sobre a imagem, como `-19%`.
- O preço atual permanece destacado e o antigo aparece riscado, lado a lado.
- Em produtos por kg/unidade ou com embalagens, selo e valores seguem a opção selecionada, sem anunciar desconto em modalidade sem promoção.
- Produtos sem promoção continuam com preço normal, sem selo de desconto.
- Testes automatizados de preço e compilação devem passar antes da publicação.

## Atualização — Quantidade de itens na cesta (20/11/2026)

- A cesta e o indicador do carrinho mostram a quantidade de produtos distintos, sem somar gramas ou unidades compradas.
- Exemplo: banana 400 g, abacaxi 300 g, beterraba 2 un e melancia 1 un resultam em 4 itens.
- Produtos com duas modalidades de venda não são duplicados no contador de itens; no carrinho, permanecem linhas separadas com seus pesos e valores.
- Correção testada automaticamente, sem modificar estoque, preços ou pedidos.


## Atualização — Botão Remover da cesta (20/11/2026)

- Cada linha de produto na cesta exibe uma ação "Remover" com ícone de lixeira.
- A remoção é imediata e retira a quantidade inteira daquela opção, sem exigir repetidos cliques no sinal de menos.
- A contagem dos itens, o subtotal e o valor total são recalculados automaticamente.
- Comprar o mesmo produto por kg e por unidade continua permitindo remover uma modalidade sem apagar a outra.
- O recurso também está disponível no carrinho do celular e não modifica estoque ou pedidos antes da finalização.

## Atualização — Cadastro voluntário no pop-up (20/11/2026)
- Pop-up hortifruti sem cupons, com nome completo, e-mail, celular e consentimento expresso para cadastro. Autorização para receber novidades é separada e opcional.
- Convite configurável por loja em Configurações: ativação, título, descrição e texto do botão. Texto inicial: "🍓 Fresquinho de verdade, novidades em primeira mão!".
- Dados armazenados na tabela de clientes por tenant; e-mail, origem do cadastro e consentimento de marketing visíveis na aba Clientes.
- Duplicatas de telefone da mesma loja atualizam o cadastro sem criar um segundo cliente; mesmo telefone em outro estabelecimento não compartilha dados.
- O pop-up pode ser fechado; reaparece após 7 dias no navegador se não houver cadastro. Após cadastro, deixa de aparecer naquele navegador.
- Nenhum cupom é criado, nenhuma campanha ou WhatsApp promocional é enviado automaticamente.
- Migração aditiva D1 0004_customer_popup.sql e testes automáticos concluídos antes da publicação.


## Atualização — Integração Evolution API real (20/11/2026)

- A aba **WhatsApp** do painel de cada estabelecimento oferece criação da própria instância e QR Code real, diretamente no site, sem expor URL/chave da Evolution ao lojista.
- Cada loja tem identificador exclusivo de instância `crj_<slug>_<id>`. O serviço não altera instâncias de outros sistemas.
- Integração Evolution API v2: criar instância Baileys (quando ainda não existe), conectar/atualizar QR, consultar `connectionState`, configurar webhook específico e enviar textos pelo endpoint `message/sendText`.
- O Worker usa `PUBLIC_APP_URL` se configurado; caso contrário utiliza a origem HTTPS da própria requisição autenticada para a URL do webhook. O token do webhook é validado no backend e nunca é devolvido ao navegador.
- Modelos transacionais existentes: pedido recebido, aceito (com itens/quantidades), em preparação, saída para entrega, entregue e cancelado, com consentimento separado no checkout.
- Sem `EVOLUTION_API_URL` ou `EVOLUTION_API_KEY`, o painel indica *Não configurado*, não cria QR simulado e nenhuma mensagem recebe status de enviada.
- Fila de mensagens não consome tentativas por falta de conexão, e descarta eventos muito antigos em vez de enviar avisos de pedidos desatualizados.
- Após configurar os **GitHub Secrets** `EVOLUTION_API_URL` (URL HTTPS da API Evolution acessível a partir da Cloudflare), `EVOLUTION_API_KEY` (chave do provedor) e `EVOLUTION_WEBHOOK_TOKEN` (chave aleatória forte própria para autenticar os callbacks), execute novamente **Publicar CR Jornada Hortifruti** em Actions > Run workflow na branch main.
- Depois da nova publicação, no painel de proprietário vá a **WhatsApp → Conexão → Conectar WhatsApp**, leia o QR com o aparelho empresarial e confirme o estado **Conectado**. Faça pedido de teste com número próprio autorizado e valide em **Histórico de envios**, sem enviar campanhas a clientes reais durante os testes.
- Revisado e validado com testes automatizados de QR, webhook, fila, envio e isolamento multiempresa. Integração com servidor Evolution externo ainda depende das credenciais e da conexão do número pelo responsável.

### Validação de credenciais Evolution — 20/11/2026

- Depois de o administrador cadastrar os três GitHub Secrets `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_WEBHOOK_TOKEN`, foi feita uma consulta autenticada somente de leitura à API Evolution.
- Os três segredos foram encontrados no ambiente de produção e a consulta HTTPS a `/instance/fetchInstances` retornou HTTP 200.
- Nenhuma instância foi criada ou conectada durante essa conferência. O próximo passo é republicar o Worker para carregar as credenciais e, no painel, conectar o WhatsApp da loja com QR Code.

## Atualização — Edição de pedidos por falta de mercadoria (20/11/2026)

- Na aba **Pedidos → Detalhes → Editar itens**, o dono pode reduzir quantidades em **unidades ou gramas** e retirar um produto inteiro antes da saída para entrega; não é possível adicionar novos produtos ou aumentar quantidades nesse fluxo.
- É obrigatório informar um motivo (que aparece no histórico e na mensagem ao cliente). A janela mostra uma prévia do novo total antes de salvar.
- A atualização de pedidos, itens, reservas de estoque e histórico ocorre em lote atômico; versão otimista impede edições simultâneas sobre dados desatualizados.
- Reservas liberadas retornam à disponibilidade apenas se houver estoque físico. Opcionalmente, ao retirar um item, marque **Esgotado na vitrine** para zerar a disponibilidade desse estoque sem interferir nas quantidades reservadas para outros pedidos.
- Valores são recalculados em centavos (subtotal, total, troco). A taxa de entrega original permanece acordada, evitando cobranças adicionais após o pedido.
- Histórico de revisões permanece ligado ao pedido e pode ser consultado pelo cliente na página de acompanhamento, que atualiza automaticamente a cada 12 segundos após a consulta autenticada pelo número de telefone.
- Cada revisão produz aviso com nome do cliente, itens corrigidos, quantidades antigas/novas, motivo e total anterior/atualizado. O aviso é enfileirado com identificador único por revisão na Evolution API, respeitando a autorização do cliente para receber mensagens transacionais por WhatsApp.
- Se o WhatsApp estiver desconectado, o aviso fica pendente no Histórico de Envios; se o cliente não autorizou o canal, nenhuma mensagem é enviada, mas o acompanhamento exibe o novo valor.
- Só é possível editar pedidos nas etapas **Recebido**, **Aceito** e **Em preparação**, com estoque ainda reservado. Pedidos já em entrega, entregues e cancelados não podem ser modificados por esse fluxo.
- Os testes automatizados usam banco SQLite em memória e não modificam o pedido real #1001 nem disparam mensagens externas. Migração D1 incremental `0005_order_adjustments.sql` aplicada com êxito.


## Atualização — Alertas Telegram e remoção de pedidos de teste (20/11/2026)

- Cada loja recebe alerta administrativo no Telegram quando uma instância Evolution **conectada** desconecta no painel, em webhook Evolution ou no monitor de estado a cada 2 minutos. O aviso informa o estabelecimento, a instância e a hora. A transição é deduplicada e a fila de alertas permite tentativas posteriores, sem bloquear pedidos nem WhatsApp.
- Para ativar o envio REAL ao Telegram, configure dois **GitHub Actions Secrets do ambiente `production` ou do repositório**: `TELEGRAM_BOT_TOKEN` (token do bot Telegram que enviará avisos) e `TELEGRAM_CHAT_ID` (ID do chat privado ou grupo onde o bot tem permissão para escrever). Não divulgue esses valores em prints ou conversas. O bot precisa ter recebido `/start` no chat privado ou ser membro do grupo.
- Após configurar ambos, publique a branch `main` novamente para que o Worker receba os segredos. O painel WhatsApp indica se os alertas estão configurados; se ainda não há segredos, as desconexões novas ficam na fila sem envio e serão processadas após a configuração.
- O monitor considera desconexão apenas estado confirmado `close/closed/disconnected`; erro temporário de HTTP não é tratado como queda. Não envia alertas quando nunca houve conexão, nem um aviso a cada atualização do mesmo estado.
- Em **Pedidos**, proprietário/gerente pode clicar no ícone de lixeira para **remover da operação** somente pedidos que já estejam `cancelled` e com estoque `released`. A ação exige confirmação e preserva a linha do pedido no banco para fins de auditoria, mas com `deleted_at` preenchido.
- Pedidos ocultos não aparecem na listagem, nos indicadores do proprietário, em relatórios, no Super Admin nem na consulta pública de pedidos. O cadastro do cliente e seus dados são preservados; o contador de pedidos do cliente é recalculado para desconsiderar o teste oculto.
- A exclusão nunca estorna estoque uma segunda vez, não cancela pedidos ativos automaticamente e impede envio posterior de mensagens pendentes do pedido ocultado.
- Migração aditiva: `0006_order_visibility_telegram_alerts.sql`. Testes automatizados realizados em banco isolado, sem desconectar números reais nem apagar pedidos de produção.
