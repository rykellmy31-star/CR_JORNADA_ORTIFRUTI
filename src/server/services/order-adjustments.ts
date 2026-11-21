/**
 * Edição segura de itens do pedido (somente redução ou remoção).
 * Opera no D1 e SQLite local com lote atômico e controle otimista de versão.
 * O histórico e a mensagem ao cliente são gravados na mesma transação.
 */
import type {DbClient,DbPreparedStatement} from '../db/adapter';
import {runConditionalTransaction,StockConflictError} from '../db/adapter';
import {generateId} from '../security/crypto';
import {
  formatBRL,formatQuantityDisplay,extractFirstName,normalizePhoneBR
} from '../../shared/pricing';
import type {EvolutionEnvConfig} from './evolution-whatsapp';
import {dispatchQueuedMessageById} from './evolution-whatsapp';

interface EditInput {
  itemId:string;
  quantity:number;
  markOutOfStock?:boolean;
}
interface OrderRecord {
  id:string;tenant_id:string;customer_id:string|null;order_number:number;
  status:string;stock_state:string;payment_method:string;needs_change:number;
  change_for_cents:number|null;subtotal_cents:number;delivery_fee_cents:number;
  total_cents:number;customer_name:string;customer_phone:string;
  whatsapp_opt_in:number;adjustment_version:number;
}
interface ItemRecord {
  id:string;product_id:string;variant_id:string|null;stock_pool_id:string|null;
  product_name_snapshot:string;variant_name_snapshot:string|null;
  sale_mode:'weight'|'unit'|'variants';quantity:number;quantity_display:string;
  stock_deducted_qty:number;unit_price_cents:number;pricing_unit_label:string;
  line_total_cents:number;
  customization_snapshot?:string|null;
  original_line_total_cents:number|null;
}
type Change = {
  itemId:string;name:string;from:string;to:string;
  oldQuantity:number;newQuantity:number;oldLineTotalCents:number;newLineTotalCents:number;
};
type Step={stmt:DbPreparedStatement;requireChanges?:number;failErrorMessage?:string};

const nameOf=(it:ItemRecord)=>it.product_name_snapshot+
  (it.variant_name_snapshot?' — '+it.variant_name_snapshot:'')+(it.customization_snapshot?' ('+it.customization_snapshot.replace(/\n/g,'; ')+')':'');
function newDisplay(item:ItemRecord,qty:number){
  return qty===0?'Retirado':formatQuantityDisplay(qty,item.sale_mode,
    item.pricing_unit_label,item.variant_name_snapshot);
}
function targetInfo(item:ItemRecord):{type:'product'|'variant'|'pool';id:string;table:string}{
  if(item.stock_pool_id)return {type:'pool',id:item.stock_pool_id,table:'stock_pools'};
  if(item.variant_id)return {type:'variant',id:item.variant_id,table:'product_variants'};
  return {type:'product',id:item.product_id,table:'products'};
}
export function orderAdjustmentMessage(
  name:string,store:string,number:number,reason:string,changes:Change[],
  items:Array<{name:string;display:string;total:number}>,
  oldTotal:number,newTotal:number,delivery:number,changeFor:number|null
):string{
  const modifications=changes.map(c=>
    `• ${c.name}: ${c.from} → ${c.to} (${formatBRL(c.oldLineTotalCents)} → ${formatBRL(c.newLineTotalCents)})`
  ).join('\n');
  const updated=items.map(i=>`• ${i.name} — ${i.display} · ${formatBRL(i.total)}`).join('\n');
  const cash=changeFor!==null?
    `\nTroco para: ${formatBRL(changeFor)} · Troco atualizado: ${formatBRL(changeFor-newTotal)}`:'';
  return [
    `Olá, ${extractFirstName(name)}! 🧺 Atualizamos seu pedido *#${number}* no *${store}*.`,
    `\n*O que mudou:*\n${modifications}`,
    `\nMotivo: ${reason}`,
    `\n*Itens atualizados:*\n${updated}`,
    `\nTotal anterior: ${formatBRL(oldTotal)}`,
    `*Novo total: ${formatBRL(newTotal)}* (entrega: ${delivery===0?'Grátis':formatBRL(delivery)})${cash}`,
    '\nO valor atualizado também está disponível no acompanhamento do seu pedido. Se tiver alguma dúvida, entre em contato com a loja.'
  ].join('\n');
}

export async function adjustOrderItems(params:{
  db:DbClient;tenantId:string;orderId:string;actorId:string;
  expectedVersion:number;reason:string;updates:EditInput[];
  evolution:EvolutionEnvConfig;
}):Promise<{adjustmentId:string;version:number;changes:Change[];
  oldTotalCents:number;newTotalCents:number;notificationStatus:string}>{
  const {db,tenantId,orderId,actorId,expectedVersion,evolution}=params;
  const reason=params.reason.trim().replace(/\s+/g,' ');
  if(reason.length<5||reason.length>240)throw new Error('Informe um motivo com 5 a 240 caracteres.');
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)
    throw new Error('Atualize o pedido antes de editar os itens.');
  if(!Array.isArray(params.updates)||!params.updates.length||params.updates.length>100)
    throw new Error('Informe os itens e as novas quantidades.');
  const seen=new Set<string>();
  for(const up of params.updates){
    if(!up.itemId||seen.has(up.itemId)||!Number.isSafeInteger(up.quantity)||up.quantity<0)
      throw new Error('Identificação ou quantidade de item inválida.');
    seen.add(up.itemId);
  }
  const order=await db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?')
    .bind(orderId,tenantId).first<OrderRecord>();
  if(!order)throw new StockConflictError('Pedido não encontrado nesta loja.');
  if(order.stock_state!=='reserved'||!['received','accepted','preparing'].includes(order.status))
    throw new StockConflictError('Só é possível editar produtos antes da saída para entrega.');
  if(order.adjustment_version!==expectedVersion)
    throw new StockConflictError('Outro usuário atualizou este pedido. Reabra os detalhes antes de salvar.');

  const {results:items}=await db.prepare(`SELECT * FROM order_items
    WHERE tenant_id=? AND order_id=? ORDER BY rowid`).bind(tenantId,orderId).all<ItemRecord>();
  const byId=new Map(items.map(i=>[i.id,i]));
  const changes:Change[]=[],nextLines=new Map<string,{quantity:number;display:string;deducted:number;total:number}>();
  for(const item of items)nextLines.set(item.id,{quantity:item.quantity,display:item.quantity_display,
    deducted:item.stock_deducted_qty,total:item.line_total_cents});
  for(const up of params.updates){
    const item=byId.get(up.itemId);
    if(!item)throw new Error('Um dos itens não pertence a este pedido.');
    if(up.quantity>item.quantity)throw new Error('Para acrescentar mercadorias, faça um novo pedido; nesta tela é permitido apenas reduzir ou remover.');
    if(up.markOutOfStock && up.quantity!==0)
      throw new Error('Marque como esgotado somente produtos removidos do pedido.');
    if(up.quantity===item.quantity)continue;
    let deducted=0,total=0;
    if(up.quantity>0){
      const ratio=item.stock_deducted_qty*up.quantity/item.quantity;
      if(!Number.isSafeInteger(ratio)||ratio<=0)
        throw new Error('Quantidade incompatível com a reserva do estoque. Ajuste em unidades inteiras ou gramas compatíveis.');
      deducted=ratio;
      total=Math.round(item.line_total_cents*up.quantity/item.quantity);
    }
    const display=newDisplay(item,up.quantity);
    changes.push({itemId:item.id,name:nameOf(item),from:item.quantity_display,to:display,
      oldQuantity:item.quantity,newQuantity:up.quantity,
      oldLineTotalCents:item.line_total_cents,newLineTotalCents:total});
    nextLines.set(item.id,{quantity:up.quantity,display,deducted,total});
  }
  if(!changes.length)throw new Error('Altere a quantidade de pelo menos um produto.');
  const remaining=items.filter(i=>(nextLines.get(i.id)?.quantity??0)>0);
  if(!remaining.length)throw new Error('O pedido ficará vazio. Utilize Cancelar pedido para estornar todos os produtos.');
  const newSubtotal=items.reduce((sum,i)=>sum+nextLines.get(i.id)!.total,0);
  const newTotal=newSubtotal+order.delivery_fee_cents;
  if(newSubtotal<0||newTotal<0||newTotal>order.total_cents)
    throw new Error('Erro de cálculo do novo total. Nenhum dado foi alterado.');
  if(order.needs_change && (order.change_for_cents===null || order.change_for_cents<newTotal))
    throw new Error('Não foi possível recalcular o troco do pedido. Verifique o pagamento.');

  const now=new Date().toISOString(),adjustmentId=generateId(),version=expectedVersion+1;
  const tenant=await db.prepare('SELECT name FROM tenants WHERE id=?')
    .bind(tenantId).first<{name:string}>();
  if(!tenant)throw new Error('Estabelecimento não encontrado.');
  const message=orderAdjustmentMessage(order.customer_name,tenant.name,order.order_number,
    reason,changes,remaining.map(i=>({name:nameOf(i),display:nextLines.get(i.id)!.display,total:nextLines.get(i.id)!.total})),
    order.total_cents,newTotal,order.delivery_fee_cents,order.needs_change?order.change_for_cents:null);
  const queueId=generateId(),queueStatus=order.whatsapp_opt_in?'pending':'skipped_no_optin';
  const steps:Step[]=[{
    stmt:db.prepare(`UPDATE orders SET subtotal_cents=?,total_cents=?,
      change_amount_cents=CASE WHEN needs_change=1 THEN change_for_cents-? ELSE NULL END,
      adjustment_version=adjustment_version+1,updated_at=?
      WHERE id=? AND tenant_id=? AND adjustment_version=? AND stock_state='reserved'
      AND status IN ('received','accepted','preparing')`)
      .bind(newSubtotal,newTotal,newTotal,now,orderId,tenantId,expectedVersion),
    requireChanges:1,failErrorMessage:'Este pedido foi alterado por outro usuário. Reabra-o antes de salvar.'
  }];
  for(const change of changes){
    const old=byId.get(change.itemId)!;
    const next=nextLines.get(old.id)!;
    const difference=old.stock_deducted_qty-next.deducted;
    if(difference<=0)throw new Error('Redução de estoque inválida.');
    const target=targetInfo(old);
    if(next.quantity===0){
      steps.push({stmt:db.prepare('DELETE FROM order_items WHERE id=? AND tenant_id=? AND order_id=? AND quantity=?')
        .bind(old.id,tenantId,orderId,old.quantity),requireChanges:1});
    }else{
      steps.push({stmt:db.prepare(`UPDATE order_items SET quantity=?,quantity_display=?,stock_deducted_qty=?,
        line_total_cents=?,original_line_total_cents=? WHERE id=? AND tenant_id=? AND order_id=? AND quantity=?`)
        .bind(next.quantity,next.display,next.deducted,next.total,old.original_line_total_cents==null?null:Math.round(old.original_line_total_cents*next.quantity/old.quantity),old.id,tenantId,orderId,old.quantity),requireChanges:1});
    }
    steps.push({
      stmt:db.prepare(`UPDATE ${target.table} SET reserved_qty=reserved_qty-?,updated_at=?
        WHERE id=? AND tenant_id=? AND reserved_qty>=?`)
        .bind(difference,now,target.id,tenantId,difference),
      requireChanges:1,failErrorMessage:'Estoque reservado mudou. Reabra o pedido antes de ajustar.'
    });
    const joins=target.type==='product'
      ?{pid:target.id,vid:null,sid:null,label:old.product_name_snapshot,unit:old.sale_mode==='weight'?'g':'un'}
      :target.type==='variant'
        ?{pid:old.product_id,vid:target.id,sid:null,label:nameOf(old),unit:'un'}
        :{pid:null,vid:null,sid:target.id,label:nameOf(old),unit:'g'};
    const unit=target.type==='pool'?'base_unit':target.type==='variant'?"'un'":"CASE WHEN sale_mode='weight' THEN 'g' ELSE 'un' END";
    const nameExpr=target.type==='pool'?'name':target.type==='variant'?'name':'name';
    steps.push({stmt:db.prepare(`INSERT INTO stock_movements(
      id,tenant_id,target_type,product_id,variant_id,stock_pool_id,target_name,
      movement_type,delta_physical,delta_reserved,physical_after,reserved_after,
      unit,order_id,actor_user_id,reason,created_at)
      SELECT ?,?,?,?, ?,?,?, 'manual_adjust',0,?,physical_qty,reserved_qty,${unit},?,?,?,?
      FROM ${target.table} WHERE id=? AND tenant_id=?`)
      .bind(generateId(),tenantId,target.type,joins.pid,joins.vid,joins.sid,joins.label,
        -difference,orderId,actorId,
        `Revisão do pedido #${order.order_number}: ${reason} (${change.from} → ${change.to})`,
        now,target.id,tenantId)});
  }
  // Quando um produto realmente acabou, a loja pode zerar o estoque livre
  // sem mexer nas unidades já reservadas para outros pedidos. Isso impede
  // que a vitrine volte a vender mercadoria fisicamente indisponível.
  const outOfStock=new Map<string,ReturnType<typeof targetInfo>>();
  for(const up of params.updates){
    if(!up.markOutOfStock)continue;
    const original=byId.get(up.itemId)!;
    const target=targetInfo(original);
    outOfStock.set(target.type+':'+target.id,target);
  }
  for(const target of outOfStock.values()){
    const unitExpr=target.type==='pool'?'base_unit':
      target.type==='variant'?"'un'":"CASE WHEN sale_mode='weight' THEN 'g' ELSE 'un' END";
    const refs=target.type==='pool'?[null,null,target.id]:
      target.type==='variant'?[null,target.id,null]:[target.id,null,null];
    steps.push({stmt:db.prepare(`INSERT INTO stock_movements(
      id,tenant_id,target_type,product_id,variant_id,stock_pool_id,target_name,
      movement_type,delta_physical,delta_reserved,physical_after,reserved_after,
      unit,order_id,actor_user_id,reason,created_at)
      SELECT ?,?,?,?, ?,?,name,'manual_adjust',
       reserved_qty-physical_qty,0,reserved_qty,reserved_qty,${unitExpr},?,?,?,?
      FROM ${target.table} WHERE id=? AND tenant_id=?`)
      .bind(generateId(),tenantId,target.type,...refs,
        orderId,actorId,`Esgotado na vitrine após revisão do pedido #${order.order_number}: ${reason}`,
        now,target.id,tenantId)});
    steps.push({stmt:db.prepare(`UPDATE ${target.table} SET physical_qty=reserved_qty,updated_at=?
      WHERE id=? AND tenant_id=? AND physical_qty>=reserved_qty`)
      .bind(now,target.id,tenantId),requireChanges:1,
      failErrorMessage:'Estoque já foi alterado; reabra o pedido antes de marcar como esgotado.'});
  }
  if(order.customer_id){
    steps.push({stmt:db.prepare(`UPDATE customers SET total_spent_cents=MAX(0,total_spent_cents-?),
      updated_at=? WHERE id=? AND tenant_id=?`)
      .bind(order.total_cents-newTotal,now,order.customer_id,tenantId)});
  }
  steps.push({stmt:db.prepare(`INSERT INTO order_adjustments(
      id,tenant_id,order_id,version,actor_user_id,reason,old_subtotal_cents,
      new_subtotal_cents,old_total_cents,new_total_cents,changes_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(adjustmentId,tenantId,orderId,version,actorId,reason,
      order.subtotal_cents,newSubtotal,order.total_cents,newTotal,JSON.stringify(changes),now)});
  steps.push({stmt:db.prepare(`INSERT INTO whatsapp_message_queue(
     id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,
     rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
     VALUES(?,?,?,'order_adjusted',?,?,?,?,?,0,3,?,?,?)`)
    .bind(queueId,tenantId,orderId,`${orderId}:order_adjusted:v${version}`,
      normalizePhoneBR(order.customer_phone),order.customer_name,
      order.whatsapp_opt_in?message:'[Notificação de alteração desativada: cliente não autorizou o WhatsApp]',
      queueStatus,order.whatsapp_opt_in?now:null,now,now)});
  await runConditionalTransaction(db,steps);
  let notificationStatus=queueStatus;
  if(order.whatsapp_opt_in){
    try{
      notificationStatus=(await dispatchQueuedMessageById(db,tenantId,queueId,evolution)).status;
    }catch{notificationStatus='pending';}
  }
  return {adjustmentId,version,changes,
    oldTotalCents:order.total_cents,newTotalCents:newTotal,notificationStatus};
}
