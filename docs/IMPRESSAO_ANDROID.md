# CR Jornada Express — Impressão automática de pedidos (Android)

## Etapa 1: fila segura no backend (implementada nesta PR)

- Após **checkout confirmado**, uma comanda `new_order` é enfileirada **dentro da transação do pedido** para a loja que ativar a opção.
- O recurso é **desativado por padrão**, inclusive para todas as lojas existentes. Não há retroatividade: só novos pedidos depois de ativar entram na fila.
- Cada comanda guarda apenas a referência ao pedido e o número, sem copiar dados pessoais. Os dados do recibo serão obtidos no backend autenticado no momento da impressão.
- Cada nova comanda possui chave idempotente exclusiva por loja e pedido, evitando criação duplicada.
- `GET /api/admin/printing` retorna configuração e histórico limitado à loja autenticada; `PATCH /api/admin/printing/settings` permite proprietário/gerente ativar/desativar, com corpo `{"enabled":true}`. **Ainda não expor como "pronto para imprimir" na interface.**
- Migração `0010_print_jobs.sql`: nova tabela `print_jobs` e flag `tenants.auto_print_enabled`.
- **Deploy exige aplicar a migração remota antes de publicar o código**, pois a rota de checkout usa o novo esquema.

## Etapa 2: aplicativo-ponte Android (AINDA NÃO IMPLEMENTADA)

O aplicativo Android recebe sua credencial própria e acessa apenas a fila do estabelecimento autorizado. Ele mantém serviço em primeiro plano quando apropriado, solicita permissões Bluetooth, estabelece conexão com impressoras térmicas ESC/POS de 58 mm, imprime o recibo e confirma resultado ao servidor.

Fluxo planejado:

1. Proprietário autoriza/pareia Android no painel com código temporário de uso único.
2. Servidor emite **token de dispositivo revogável**, armazenado somente como hash no backend; nenhuma credencial de funcionário ou segredo da plataforma fica embutido no APK.
3. O dispositivo conectado consulta `print_jobs`, obtém uma única comanda por **lease** exclusivo, acessa o resumo do pedido e imprime por Bluetooth.
4. Após sucesso, confirma a impressão; falhas reais são registradas e podem ser reprocessadas. Bloquear impressão automática de pedido cancelado antes de o aparelho receber a comanda.
5. Proprietário vê estados `Na fila`, `Em impressão`, `Impresso`, `Falhou` e poderá reimprimir manualmente.

**Limitação técnica:** a entrega de trabalho é do tipo *pelo menos uma vez*; uma desconexão no instante entre papel impresso e confirmação ao servidor pode ocasionar repetição. Mitigar com IDs impressos e deduplicação persistida no Android, com reimpressão sinalizada.

Sem APK instalado e configurado, **Bluetooth sozinho não permite impressão silenciosa automática a partir do navegador**. A automação em segundo plano também depende de restrições do Android e de permissões concedidas; o sistema deve sinalizar quando o dispositivo estiver offline.

## Etapa 3: homologação física (PENDENTE)

- Testar o modelo adquirido com Android real, conexão ESC/POS Bluetooth e papel térmico 58 mm.
- Validar acentuação, letras grandes, preço, peso, troco, forma de pagamento, endereço e conferência de quantidade.
- Testar pedidos consecutivos, Android sem rede, Bluetooth desligado, papel esgotado e reconexão.
- Somente depois de homologar, liberar o recurso no painel de todos os estabelecimentos.

*As URLs internas legadas do Hortifruti e o fluxo de compras existentes não devem ser renomeados.*
