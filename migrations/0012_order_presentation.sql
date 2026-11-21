-- Dados históricos permanecem nulos: não inferir descontos de pedidos antigos.
ALTER TABLE order_items ADD COLUMN original_line_total_cents INTEGER;
ALTER TABLE tenants ADD COLUMN receipt_footer TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN delivery_eta_text TEXT NOT NULL DEFAULT '30 a 40 minutos';

UPDATE whatsapp_templates SET title='Pedido recebido (Detalhes da compra)', message_template='Oba! Recebemos seu pedido! 🥳

🥬 *{nome_estabelecimento}*

Pedido *nº {numero_pedido}*

*🛒 Itens do pedido:*

{itens_pedido}

─────────────────
*Subtotal:* {subtotal}
🛵 *Entrega:* {taxa_entrega}
💰 *Total: {valor_total}*{economia_info}

─────────────────
💳 *Pagamento:* {forma_pagamento}{troco_info}

🏠 *Endereço de entrega:*
{endereco_entrega}

📋 *Status:* Pedido recebido

Avisaremos você assim que seu pedido avançar para a próxima etapa.

Obrigado pela preferência! 💚' WHERE event_type='order_received' AND message_template='Olá, {primeiro_nome}! 🥬 Recebemos o seu pedido *#{numero_pedido}* no *{nome_estabelecimento}* e ele aguarda confirmação.

Valor total: *{valor_total}*
Pagamento: {forma_pagamento}{troco_info}

Assim que o estabelecimento aceitar o pedido, avisaremos você por aqui!';

UPDATE whatsapp_templates SET title='Pedido aceito (Previsão de entrega)', message_template='🥳 Oba! Seu pedido foi aceito!

O seu pedido *Nº {numero_pedido}* está em preparação.

⏱️ A previsão estimada é de *{previsao_entrega}* para seu pedido chegar.

🥬 *{nome_estabelecimento}*' WHERE event_type='order_accepted' AND message_template='Olá, {primeiro_nome}! ✅ Seu pedido *#{numero_pedido}* no *{nome_estabelecimento}* foi *ACEITO*!

*Produtos solicitados:*
{itens_pedido}

Subtotal: {subtotal}
Taxa de entrega: {taxa_entrega}
*Total: {valor_total}*
Pagamento: {forma_pagamento}{troco_info}

Você será avisado automaticamente assim que o seu pedido sair para entrega! 🚚';
