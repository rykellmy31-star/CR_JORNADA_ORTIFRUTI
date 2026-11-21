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

1. Execute **Preparar banco D1** em GitHub Actions **selecionando a branch da PR**, com a migração `0010_print_jobs.sql`. Confirme o registro `0010_print_jobs.sql ✅` no log.
2. Depois dos testes da API e do build do APK verdes, faça merge da PR.
3. Publique o Worker na Cloudflare e confira que o portal de pedidos continua respondendo.
4. Habilite em **uma loja-piloto** somente após instalar e conectar o Android.

**Não publicar o código no Worker antes da migração 0010**, porque o checkout já consulta a tabela de impressão.

## Arquitetura

- API de administração: `GET /api/admin/printing`, `PATCH /api/admin/printing/settings`, `POST /api/admin/printing/pairing-codes`, `DELETE /api/admin/printing/devices/:id`, `POST /api/admin/printing/jobs/:id/reprint`.
- API Android: `POST /api/printing/device/pair`, `GET /api/printing/device/status`, `POST /api/printing/device/jobs/claim`, `POST /api/printing/device/jobs/:id/ack`.
- Banco: `tenants.auto_print_enabled`, `print_jobs`, `print_devices`, `print_pairing_codes`.
- Android: Java nativo, Bluetooth clássico SPP UUID `00001101-0000-1000-8000-00805F9B34FB`, ESC/POS, API mínima Android 8.
- Mantidos os endereços técnicos existentes; o app usa o endpoint HTTPS legado do sistema.

## Homologação pendente

Testar com a impressora do anúncio e o aparelho Android real: compatibilidade do Bluetooth clássico SPP, velocidade, tamanho e papel, acentos/ASCII, bobina vazia, desligamento, falha de internet, pedidos simultâneos, cancelamento, reimpressão, reinício de celular e restrições de bateria.

Apenas após esses testes é possível declarar **impressão automática física homologada**.
