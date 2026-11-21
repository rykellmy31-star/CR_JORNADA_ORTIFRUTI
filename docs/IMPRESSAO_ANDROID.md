# CR Jornada Express — Impressão automática via Android + Bluetooth ESC/POS

## Status da implementação

- **Backend:** fila transacional idempotente, por estabelecimento, com reserva exclusiva de comanda (lease), até 5 tentativas, confirmação e reimpressão auditada.
- **Painel:** menu **Impressoras**, ativação, código de pareamento (10 minutos, uso único), aparelhos conectados/revogação, fila de comandas e reimpressão.
- **Android:** projeto nativo em `android-print-bridge/` com tela de pareamento, escolha entre impressoras Bluetooth já pareadas, serviço em primeiro plano e recibo ESC/POS de 58 mm (32 colunas).
- **Testes:** API, isolamento por estabelecimento, autenticação, recebimento e confirmação de comandas, revogação e checkout.
- **Produção:** não ativar antes de executar a migração **0010** no D1 remoto e homologar com uma impressora real.

## Como será a configuração

1. Instale o APK de teste **CR Jornada Express Impressão** no Android. O APK é gerado pelo workflow `.github/workflows/android-print-bridge.yml` e fica como **artefato** da execução do GitHub Actions, não na Play Store.
2. No Bluetooth do Android, pareie a impressora térmica ESC/POS 58 mm.
3. No painel web do proprietário da loja, abra **Impressoras > Gerar código de pareamento**.
4. No aplicativo Android, informe o **subdomínio da loja** (por exemplo, `verdurao-itanhem`), o código e o nome do celular. Toque em **Parear este Android**. O código expira em 10 minutos e não pode ser reutilizado.
5. Escolha a impressora entre os dispositivos Bluetooth já pareados e toque em **Iniciar serviço de impressão**.
6. No painel web, **Ative a impressão automática**. Somente **novos pedidos confirmados a partir desse momento** geram comanda. O Android consulta a fila enquanto o serviço estiver funcionando.

O serviço usa notificação persistente para funcionar com o aplicativo em segundo plano. Internet e Bluetooth devem permanecer ligados, e o aparelho não pode desligar/bloquear o serviço por economia extrema de bateria. O serviço não é garantido se o Android encerrar o processo.

## Segurança e falhas

- O Android recebe um **token aleatório próprio por aparelho**; somente o hash SHA-256 fica no D1. O token é protegido por Android Keystore no dispositivo.
- O token pode ser revogado pelo proprietário no painel. Senhas de proprietário e tokens JWT não são embutidos no aplicativo.
- Cada aparelho acessa somente a fila da **própria loja**. Um segundo aparelho de outra loja não consegue obter ou confirmar comandas alheias.
- A fila é criada **na mesma transação** do pedido, sem imprimir pedidos rejeitados. Cancelados são excluídos do envio automático, mas pedidos já enviados fisicamente não podem ser recuperados.
- O backend usa lease de 5 minutos e deduplicação por ID. O Android mantém registro local das comandas enviadas e confirma após a escrita no Bluetooth.
- **Confirmação de impressão significa que os bytes foram enviados sem erro pela conexão Bluetooth; não é confirmação de que havia papel ou de que a impressão física estava legível.** Homologar os erros do modelo comprado.
- A entrega é do tipo **pelo menos uma vez**: se o telefone perder o armazenamento local e a confirmação do servidor após imprimir, pode haver reimpressão. A opção **Reimprimir** registra um novo trabalho manual.
- A função começa **desligada em todas as lojas** e não toca nos dados históricos.

## Regras de implantação seguras

- As migrações D1 são aplicadas automaticamente **antes** da publicação do Worker a cada merge na branch `main`. Falha de migração bloqueia o deploy.
- O portal e a vitrine são validados após a publicação pela equipe.
- O banco D1 já recebeu a migração `0010_print_jobs.sql`; a função continua desligada até configuração do estabelecimento.
- Homologar primeiro em **uma loja-piloto**, com um Android e uma impressora real.
- O APK de release é publicado automaticamente pelo workflow após a **configuração única da assinatura**.

Não há necessidade de pressionar `Run workflow` para cada deploy ou atualização.

## Arquitetura

- API de administração: `GET /api/admin/printing`, `PATCH /api/admin/printing/settings`, `POST /api/admin/printing/pairing-codes`, `DELETE /api/admin/printing/devices/:id`, `POST /api/admin/printing/jobs/:id/reprint`.
- API Android: `POST /api/printing/device/pair`, `GET /api/printing/device/status`, `POST /api/printing/device/jobs/claim`, `POST /api/printing/device/jobs/:id/ack`.
- Banco: `tenants.auto_print_enabled`, `print_jobs`, `print_devices`, `print_pairing_codes`.
- Android: Java nativo, Bluetooth clássico SPP UUID `00001101-0000-1000-8000-00805F9B34FB`, ESC/POS, API mínima Android 8.
- Mantidos os endereços técnicos existentes; o app usa o endpoint HTTPS legado do sistema.

## Homologação pendente

Testar com a impressora do anúncio e o aparelho Android real: compatibilidade do Bluetooth clássico SPP, velocidade, tamanho e papel, acentos/ASCII, bobina vazia, desligamento, falha de internet, pedidos simultâneos, cancelamento, reimpressão, reinício de celular e restrições de bateria.

Apenas após esses testes é possível declarar **impressão automática física homologada**.


## Atualizações do próprio aplicativo (OTA, versão beta)

O Android oferece **Buscar atualizações** e consulta automaticamente a versão publicada ao abrir o aplicativo (até a cada seis horas). Enquanto a impressão estiver ativa, um verificador separado consulta o canal e exibe notificação, sem bloquear o processamento dos pedidos. Ao confirmar uma versão nova, o próprio app faz o download, valida o SHA-256 e o pacote/assinatura, e abre o instalador nativo do Android.

**O Android exige confirmação do usuário para instalar um APK recebido fora da Play Store.** A primeira vez pode pedir permissão "Instalar apps desconhecidos" para o CR Jornada Express Impressão. Não é possível substituir esse consentimento por uma atualização silenciosa num aparelho Android comum.

**Distribuição segura e automática:**
- API pública estável: `GET /api/printing/android-update`.
- GitHub Actions compila `assembleDebug` em PR para testes.
- Em `main`, uma **versão assinada** do APK é criada e publicada em GitHub Releases com tag `cr-express-print-v<versionCode>`, nome fixo `cr-jornada-express-impressao.apk` e SHA-256 na descrição.
- A API anuncia **apenas releases oficiais que atendem ao nome, checksum e URL esperados**, nunca o artefato de debug.
- Instalação é barrada se a assinatura do pacote não coincidir com a assinatura do app instalado; o Android confere novamente antes de substituir.
- Após instalar, o aplicativo preserva credencial do aparelho, escolha de impressora e histórico local de deduplicação; tenta reiniciar o serviço se estava ativo antes da atualização.

### Configuração única da assinatura (obrigatória)

Antes de liberar atualizações oficiais, é necessário criar **uma única chave Android de release, protegida fora do repositório público**, e configurar quatro segredos no repositório GitHub:

- `EXPRESS_ANDROID_KEYSTORE_BASE64` — conteúdo base64 do arquivo `.jks`;
- `EXPRESS_ANDROID_KEYSTORE_PASSWORD` — senha do keystore;
- `EXPRESS_ANDROID_KEY_ALIAS` — alias da chave;
- `EXPRESS_ANDROID_KEY_PASSWORD` — senha da chave.

O workflow **não publica** atualização sem estes segredos. Isso é proposital: builds de teste usam assinatura debug temporária e **não são atualizáveis entre execuções**. Nunca commitar a chave privada no repositório público, nem gerar uma chave nova a cada execução.

**Transição:** o APK beta anterior, distribuído como `app-debug.apk`, não terá a mesma assinatura de release. Instalar a primeira versão oficial exigirá **uma única reinstalação** do aplicativo; como o Android desinstala os dados do APK antigo, o pareamento será refeito. A partir da primeira versão assinada, as próximas atualizações substituirão a versão anterior mantendo o pareamento.

**Operação rotineira:** depois dessa configuração única, cada alteração em `android-print-bridge/**` mesclada em `main` aciona automaticamente build, assinatura, publicação da release e detecção da atualização no aplicativo. Nenhum clique em Run workflow para cada versão.

## Homologação de atualização pendente

Testar instalação da primeira versão assinada, atualização para a segunda versão pela UI, atualização via notificação, permissão de instalador, manutenção do pareamento e retorno do serviço após upgrade. Até então, o canal de update está preparado, mas a atualização de APK físico não está homologada.
