adminRoutes.get('/sales-modes',async(c)=>{
 const row=await c.get('services').db.prepare('SELECT sale_modes_json FROM tenants WHERE id=?').bind(c.get('tenantId')).first<{sale_modes_json:string|null}>();
 return c.json({saleModes:JSON.parse(row?.sale_modes_json||'["weight","unit","dual","variants","custom"]')});
});
import {dispatchLoyaltyNotifications} from '../services/loyalty-notifications';
import {loyaltyConfigSchema,readLoyalty} from '../../shared/loyalty';
import {getStoreStatus,readSchedule} from '../../shared/store-hours';
import {readCustomConfig} from '../../shared/custom-product';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AppHonoEnv, logAudit } from '../context';
import { requireTenantAdmin } from '../context';
import { generateId, hashPassword } from '../security/crypto';
import { ORDER_NEXT_STATUS } from '../../shared/pricing';
import { cancelOrderAndRestoreStock, commitOrderStockOnDelivery } from '../services/inventory';
import { checkWhatsAppConnectionStatus, connectOrRefreshWhatsAppQr, confirmHomologationQrScan, disconnectWhatsAppInstance, dispatchQueuedMessageById, enqueueAndDispatchOrderWhatsAppNotification, DEFAULT_WHATSAPP_TEMPLATES } from '../services/evolution-whatsapp';
import { parseDataUriImage } from '../storage/r2-media';
import {runConditionalTransaction} from '../db/adapter';
import {adjustOrderItems} from '../services/order-adjustments';
import {autoProductImage,suggestProductImages,importCommonsProductImage,importCuratedProductImage} from '../services/product-images';
import {pairingCode,hashPairingCode} from '../services/print-jobs';

export const adminRoutes = new Hono<AppHonoEnv>();
adminRoutes.use('*', requireTenantAdmin());
async function tenantOwnsCategory(db:any,tenantId:string,categoryId:string|null|undefined){if(!categoryId)return true;const found=await db.prepare(`SELECT id FROM categories WHERE id=? AND tenant_id=?`).bind(categoryId,tenantId).first();return !!found;}

// Primeira etapa da integração com impressoras térmicas: gestão da fila.
adminRoutes.get('/printing',async(c)=>{
 const db=c.get('services').db,tenantId=c.get('tenantId');
 const store=await db.prepare('SELECT auto_print_enabled FROM tenants WHERE id=?')
  .bind(tenantId).first<{auto_print_enabled:number}>();
 const {results:jobs}=await db.prepare(`SELECT id,order_id,order_number,job_type,status,attempts,
  last_error,created_at,updated_at,printed_at
  FROM print_jobs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50`)
  .bind(tenantId).all();
 const {results:devices}=await db.prepare(`SELECT id,name,last_seen_at,created_at,revoked_at
  FROM print_devices WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20`)
  .bind(tenantId).all();
 return c.json({enabled:store?.auto_print_enabled===1,jobs,devices});
});

// A fila é opt-in. Ativar sem aplicativo Android conectado não produz impressão.
adminRoutes.patch('/printing/settings',async(c)=>{
 const user=c.get('authUser');
 if(!['owner','manager'].includes(user.role))
  return c.json({error:'Apenas proprietário ou gerente pode configurar impressoras.'},403);
 const payload=z.object({enabled:z.boolean()}).safeParse(await c.req.json().catch(()=>null));
 if(!payload.success)return c.json({error:'Informe enabled como verdadeiro ou falso.'},400);
 const now=new Date().toISOString(),tenantId=c.get('tenantId');
 await c.get('services').db.prepare('UPDATE tenants SET auto_print_enabled=?,updated_at=? WHERE id=?')
  .bind(payload.data.enabled?1:0,now,tenantId).run();
 await logAudit(c.get('services').db,{tenantId,actorUserId:user.sub,actorRole:user.role,
  action:'printing.settings_changed',entityType:'tenant',entityId:tenantId,
  details:{enabled:payload.data.enabled}});
 return c.json({enabled:payload.data.enabled,requiresAndroidBridge:true});
});

// Código aleatório de 64 bits, válida por 10 minutos e consumido uma única vez.
adminRoutes.post('/printing/pairing-codes',async(c)=>{
 const user=c.get('authUser');
 if(!['owner','manager'].includes(user.role))
  return c.json({error:'Somente proprietário ou gerente pode parear dispositivos.'},403);
 const services=c.get('services'),db=services.db,tenantId=c.get('tenantId');
 const code=pairingCode(),codeHash=await hashPairingCode(tenantId,code,services.jwtSecret);
 const now=new Date(),expiresAt=new Date(now.getTime()+10*60_000).toISOString();
 await db.batch([
  db.prepare(`UPDATE print_pairing_codes SET used_at=?
   WHERE tenant_id=? AND used_at IS NULL`).bind(now.toISOString(),tenantId),
  db.prepare(`INSERT INTO print_pairing_codes
   (id,tenant_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)`)
   .bind(generateId(),tenantId,codeHash,expiresAt,now.toISOString())
 ]);
 c.header('Cache-Control','no-store');
 await logAudit(db,{tenantId,actorUserId:user.sub,actorRole:user.role,
  action:'printing.pairing_created',entityType:'tenant',entityId:tenantId});
 return c.json({code,expiresAt});
});

adminRoutes.delete('/printing/devices/:id',async(c)=>{
 const user=c.get('authUser');
 if(!['owner','manager'].includes(user.role))
  return c.json({error:'Somente proprietário ou gerente pode revogar dispositivos.'},403);
 const tenantId=c.get('tenantId'),id=c.req.param('id'),db=c.get('services').db;
 const now=new Date().toISOString();
 const result=await db.prepare(`UPDATE print_devices SET revoked_at=?,updated_at=?
  WHERE id=? AND tenant_id=? AND revoked_at IS NULL`)
  .bind(now,now,id,tenantId).run();
 if(!result.meta.changes)return c.json({error:'Dispositivo já revogado ou inexistente.'},404);
 await logAudit(db,{tenantId,actorUserId:user.sub,actorRole:user.role,
  action:'printing.device_revoked',entityType:'print_device',entityId:id});
 return c.json({success:true});
});

// Apaga somente o registro da fila/histórico, nunca o pedido. Comanda em processamento
// não pode ser excluída: um Android já pode ter recebido o conteúdo para imprimir.
adminRoutes.delete('/printing/jobs/:id',async(c)=>{
 const user=c.get('authUser');
 if(!['owner','manager'].includes(user.role))
  return c.json({error:'Somente proprietário ou gerente pode excluir comandas da fila.'},403);
 const db=c.get('services').db,tenantId=c.get('tenantId'),id=c.req.param('id');
 const found=await db.prepare('SELECT id,order_id,order_number,status,job_type FROM print_jobs WHERE id=? AND tenant_id=?')
  .bind(id,tenantId).first<{id:string;order_id:string;order_number:number;status:string;job_type:string}>();
 if(!found)return c.json({error:'Comanda não encontrada nesta loja.'},404);
 if(found.status==='leased')
  return c.json({error:'Esta comanda já foi enviada ao Android. Aguarde a impressão terminar ou falhar antes de excluí-la.'},409);
 // Filtra o status novamente para impedir a exclusão se outro processo a retirar da fila.
 const result=await db.prepare("DELETE FROM print_jobs WHERE id=? AND tenant_id=? AND status!='leased'")
  .bind(id,tenantId).run();
 if(result.meta.changes!==1)return c.json({error:'A comanda está sendo enviada para impressão. Atualize a fila e tente novamente.'},409);
 await logAudit(db,{tenantId,actorUserId:user.sub,actorRole:user.role,
  action:'printing.job_deleted',entityType:'print_job',entityId:id,
  details:{orderId:found.order_id,orderNumber:found.order_number,jobType:found.job_type,status:found.status}});
 return c.json({success:true,orderNumber:found.order_number});
});

adminRoutes.post('/printing/jobs/:id/reprint',async(c)=>{
 const user=c.get('authUser');
 if(!['owner','manager'].includes(user.role))
  return c.json({error:'Somente proprietário ou gerente pode reimprimir.'},403);
 const db=c.get('services').db,tenantId=c.get('tenantId'),jobId=c.req.param('id');
 const original=await db.prepare(`SELECT j.id,j.order_id,j.order_number,o.status AS order_status
  FROM print_jobs j JOIN orders o ON o.id=j.order_id AND o.tenant_id=j.tenant_id
  WHERE j.id=? AND j.tenant_id=? AND o.deleted_at IS NULL`)
  .bind(jobId,tenantId).first<{id:string;order_id:string;order_number:number;order_status:string}>();
 if(!original)return c.json({error:'Comanda não encontrada nesta loja.'},404);
 if(original.order_status==='cancelled')return c.json({error:'Pedido cancelado não pode ser reimpresso automaticamente.'},409);
 const time=new Date().toISOString();
 const id=generateId();
 await db.prepare(`INSERT INTO print_jobs
  (id,tenant_id,order_id,order_number,idempotency_key,job_type,created_at,updated_at)
  VALUES(?,?,?,?,?,'reprint',?,?)`).bind(id,tenantId,original.order_id,original.order_number,
  'reprint:'+original.order_id+':'+id,time,time).run();
 await logAudit(db,{tenantId,actorUserId:user.sub,actorRole:user.role,
  action:'printing.reprint_requested',entityType:'print_job',entityId:id,
  details:{originalJobId:original.id,orderNumber:original.order_number}});
 return c.json({success:true,id},201);
});

adminRoutes.get('/dashboard', async (c) => {
  const db=c.get('services').db, tenantId=c.get('tenantId');
  const {results: counts}=await db.prepare(`SELECT status, COUNT(*) AS count FROM orders WHERE tenant_id=? AND deleted_at IS NULL AND date(created_at)=date('now','localtime') GROUP BY status`).bind(tenantId).all<{status:string;count:number}>();
  const {results: daily}=await db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS sales, COUNT(*) AS orders FROM orders WHERE tenant_id=? AND deleted_at IS NULL AND date(created_at)=date('now','localtime') AND status!='cancelled'`).bind(tenantId).all();
  const {results: recent}=await db.prepare(`SELECT id, order_number, customer_name, customer_phone, status, total_cents, payment_method, created_at FROM orders WHERE tenant_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 8`).bind(tenantId).all();
  const {results: lowStock}=await db.prepare(`SELECT id,name,physical_qty,reserved_qty,low_stock_threshold,unit_label,sale_mode FROM products WHERE tenant_id=? AND is_deleted=0 AND is_active=1 AND physical_qty-reserved_qty<=low_stock_threshold AND stock_pool_id IS NULL ORDER BY name LIMIT 10`).bind(tenantId).all();
  return c.json({counts:Object.fromEntries(counts.map((r:any)=>[r.status,r.count])), today:daily[0]||{sales:0,orders:0}, recentOrders:recent, lowStock});
});

adminRoutes.get('/orders', async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'); const status=c.req.query('status'); const search=c.req.query('q')||'';
 const {results}=await db.prepare(`SELECT * FROM orders WHERE tenant_id=? AND deleted_at IS NULL AND (?='' OR status=?) AND (?='' OR CAST(order_number AS TEXT) LIKE '%'||?||'%' OR customer_name LIKE '%'||?||'%' OR customer_phone LIKE '%'||?||'%') ORDER BY created_at DESC LIMIT 200`).bind(tid,status||'',status||'',search,search,search,search).all<Record<string,any>>();
 const printSettings=await db.prepare('SELECT receipt_footer,logo_url,receipt_watermark_text,receipt_watermark_orientation,receipt_watermark_opacity,receipt_watermark_font_size FROM tenants WHERE id=?').bind(tid).first<{receipt_footer:string;logo_url:string|null;receipt_watermark_text:string;receipt_watermark_orientation:string;receipt_watermark_opacity:number;receipt_watermark_font_size:number}>();
 const orders=[]; for(const o of results){const {results:items}=await db.prepare(`SELECT id,product_name_snapshot,variant_name_snapshot,sale_mode,quantity,quantity_display,stock_deducted_qty,unit_price_cents,line_total_cents,original_line_total_cents,customization_snapshot FROM order_items WHERE tenant_id=? AND order_id=? ORDER BY rowid`).bind(tid,o.id).all(); const {results:adjustments}=await db.prepare(`SELECT id,version,reason,old_total_cents,new_total_cents,changes_json,created_at
    FROM order_adjustments WHERE tenant_id=? AND order_id=? ORDER BY version DESC LIMIT 25`)
  .bind(tid,o.id).all<Record<string,any>>();
  orders.push({...o,items,adjustments:adjustments.map(x=>({...x,changes:JSON.parse(x.changes_json||'[]')}))});}
 return c.json({orders,receiptFooter:printSettings?.receipt_footer||'',receiptLogoUrl:printSettings?.logo_url||null,receiptWatermark:{text:printSettings?.receipt_watermark_text||'',orientation:printSettings?.receipt_watermark_orientation||'diagonal',opacity:printSettings?.receipt_watermark_opacity??10,fontSize:printSettings?.receipt_watermark_font_size??21}});
});

// Atualizar pedido recebido/aceito/em preparação sem alterar pedidos de outras lojas.
// Ocultação auditável dos pedidos de teste já cancelados: jamais apaga o cliente.
adminRoutes.delete('/orders/:id',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'),uid=c.get('authUser').sub;
 const role=c.get('authUser').role;
 if(!['owner','manager'].includes(role))
   return c.json({error:'Apenas proprietário ou gerente pode remover pedidos.'},403);
 const id=c.req.param('id');
 const order=await db.prepare(`SELECT id,order_number,status,stock_state,deleted_at,customer_id
   FROM orders WHERE id=? AND tenant_id=?`).bind(id,tid).first<Record<string,any>>();
 if(!order||order.deleted_at)return c.json({error:'Pedido não encontrado na lista.'},404);
 if(order.status!=='cancelled'||order.stock_state!=='released')
   return c.json({error:'Cancele o pedido e confirme o estorno do estoque antes de removê-lo da lista.'},409);
 const now=new Date().toISOString();
 try{
   const steps:any[]=[{
      stmt:db.prepare(`UPDATE orders SET deleted_at=?,deleted_by_user_id=?,
        deleted_reason='Removido da lista de pedidos de teste',updated_at=?
        WHERE id=? AND tenant_id=? AND status='cancelled' AND stock_state='released'
          AND deleted_at IS NULL`).bind(now,uid,now,id,tid),
      requireChanges:1,
      failErrorMessage:'O pedido já foi excluído ou mudou de estado. Atualize a página.'
   },{
      stmt:db.prepare(`UPDATE whatsapp_message_queue SET status='failed',
        last_error='Pedido ocultado pelo estabelecimento antes do envio',next_retry_at=NULL,
        updated_at=? WHERE tenant_id=? AND order_id=? AND status IN ('pending','processing')`)
        .bind(now,tid,id)
   }];
   if(order.customer_id)steps.push({
      stmt:db.prepare(`UPDATE customers SET
        orders_count=(SELECT COUNT(*) FROM orders o WHERE o.tenant_id=?
          AND o.customer_id=? AND o.deleted_at IS NULL),
        last_order_at=(SELECT MAX(o.created_at) FROM orders o WHERE o.tenant_id=?
          AND o.customer_id=? AND o.deleted_at IS NULL),
        updated_at=? WHERE id=? AND tenant_id=?`)
        .bind(tid,order.customer_id,tid,order.customer_id,now,order.customer_id,tid)
   });
   await runConditionalTransaction(db,steps);
   await logAudit(db,{tenantId:tid,actorUserId:uid,actorRole:role,
      action:'order.hidden_test',entityType:'order',entityId:id,
      details:{orderNumber:order.order_number,previousStatus:order.status}});
   return c.json({success:true,orderNumber:order.order_number,
      message:'Pedido removido da lista e dos indicadores. Cliente preservado.'});
 }catch(e:any){
   return c.json({error:e.message||'Não foi possível remover o pedido.'},e.statusCode||409);
 }
});

adminRoutes.patch('/orders/:id/items',async(c)=>{
 const services=c.get('services'),db=services.db,tid=c.get('tenantId'),uid=c.get('authUser').sub;
 const schema=z.object({
   expectedVersion:z.number().int().nonnegative(),
   reason:z.string().trim().min(5).max(240),
   updates:z.array(z.object({itemId:z.string().min(1),quantity:z.number().int().nonnegative(),markOutOfStock:z.boolean().optional()}))
     .min(1).max(100)
 });
 const parsed=schema.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:parsed.error.issues[0]?.message||'Confira as quantidades e o motivo.'},400);
 try{
   const result=await adjustOrderItems({db,tenantId:tid,orderId:c.req.param('id'),
     actorId:uid,expectedVersion:parsed.data.expectedVersion,
     reason:parsed.data.reason,updates:parsed.data.updates,evolution:services.evolution});
   await logAudit(db,{tenantId:tid,actorUserId:uid,actorRole:c.get('authUser').role,
     action:'order.items_adjusted',entityType:'order',entityId:c.req.param('id'),
     details:{version:result.version,changes:result.changes,
       oldTotalCents:result.oldTotalCents,newTotalCents:result.newTotalCents}});
   return c.json({success:true,...result});
 }catch(err:any){
   return c.json({error:err.message||'Não foi possível ajustar o pedido.'},err.statusCode||400);
 }
});

adminRoutes.patch('/orders/:id/status',async(c)=>{
 const services=c.get('services'),db=services.db,tid=c.get('tenantId'),uid=c.get('authUser').sub; const id=c.req.param('id');
 const body=await c.req.json().catch(()=>({})); const status=body.status as string;
 const order=await db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=? AND deleted_at IS NULL').bind(id,tid).first<Record<string,any>>(); if(!order)return c.json({error:'Pedido não encontrado.'},404);
 try{
  if(status==='cancelled'){
   if(order.status==='delivered')return c.json({error:'Pedido entregue não pode ser cancelado pelo painel.'},409);
   await cancelOrderAndRestoreStock(db,tid,id,order.order_number,order.stock_state, String(body.reason||'Cancelado pelo estabelecimento'),uid);
   if(order.customer_id) await db.prepare(`UPDATE customers SET total_spent_cents=MAX(0,total_spent_cents-?),updated_at=? WHERE id=? AND tenant_id=?`).bind(order.total_cents,new Date().toISOString(),order.customer_id,tid).run();
   await enqueueAndDispatchOrderWhatsAppNotification(db,tid,id,'order_cancelled',services.evolution).catch(()=>undefined);
  }else{
   const expected=ORDER_NEXT_STATUS[order.status as keyof typeof ORDER_NEXT_STATUS]; if(status!==expected)return c.json({error:`Transição inválida: ${order.status} → ${status}.`},409);
   const time=new Date().toISOString();
   if(status==='delivered') await commitOrderStockOnDelivery(db,tid,id,order.order_number,uid);
   else {
    const stamp=status==='accepted'?'accepted_at':status==='preparing'?'preparing_at':'out_for_delivery_at';
    await db.prepare(`UPDATE orders SET status=?, ${stamp}=?, updated_at=? WHERE id=? AND tenant_id=? AND status=?`).bind(status,time,time,id,tid,order.status).run();
   }
   const event=status==='accepted'?'order_accepted':status==='preparing'?'order_preparing':status==='out_for_delivery'?'order_out_for_delivery':'order_delivered';
   await enqueueAndDispatchOrderWhatsAppNotification(db,tid,id,event,services.evolution).catch(()=>undefined);
  }
  await dispatchLoyaltyNotifications(db,tid,id,services.evolution).catch(()=>undefined);
  await logAudit(db,{tenantId:tid,actorUserId:uid,actorRole:c.get('authUser').role,action:'order.status_changed',entityType:'order',entityId:id,details:{from:order.status,to:status}});
  return c.json({success:true});
 }catch(e:any){return c.json({error:e.message||'Não foi possível atualizar o pedido.'},e.statusCode||400);}
});

adminRoutes.post('/media/upload',async(c)=>{const body=await c.req.json().catch(()=>({}));try{const image=parseDataUriImage(String(body.dataUri||''));const id=generateId();const key=`tenants/${c.get('tenantId')}/${String(body.folder||'products').replace(/[^a-z0-9_-]/gi,'')}/${id}.${image.extension}`;const stored=await c.get('services').media.putObject(key,image.bytes,image.contentType);return c.json({key:stored.key,url:stored.publicUrl},201);}catch(e:any){return c.json({error:e.message||'Falha no upload.'},400);}});
/** Apenas o proprietário autenticado consulta e reutiliza as imagens abertas. */
adminRoutes.get('/products/image-suggestions',async(c)=>{
 const name=String(c.req.query('name')||'').trim();
 if(name.length<2||name.length>140)return c.json({error:'Informe um nome de produto válido.'},400);
 const full=c.req.query('external')!=='0';
 const suggestions=await suggestProductImages(c.get('services').db,name,full);
 return c.json({suggestions,matched:!!suggestions.length});
});
/** Busca automática para produtos antigos sem foto, sem alterar imagens já escolhidas. */
adminRoutes.post('/products/images/autofill',async(c)=>{
 const services=c.get('services'),db=services.db,tid=c.get('tenantId');
 const {results}=await db.prepare(`SELECT id,name FROM products WHERE tenant_id=? AND
  is_deleted=0 AND (image_url IS NULL OR trim(image_url)='') ORDER BY created_at LIMIT 8`)
  .bind(tid).all<{id:string;name:string}>();
 let updated=0,notFound=0;
 for(const item of results){
  const photo=await autoProductImage(db,services.media,item.name,false);
  if(!photo.imageUrl){notFound++;continue;}
  const changed=await db.prepare(`UPDATE products SET image_url=?,updated_at=?
   WHERE id=? AND tenant_id=? AND (image_url IS NULL OR trim(image_url)='')`)
   .bind(photo.imageUrl,new Date().toISOString(),item.id,tid).run();
  updated+=changed.meta.changes;
 }
 return c.json({success:true,checked:results.length,updated,notFound,
  message:updated?updated+' fotos encontradas e associadas.':'Nenhuma nova correspondência segura foi encontrada.'});
});
adminRoutes.post('/products/image-curated',async(c)=>{
 const body=await c.req.json().catch(()=>({}));
 const name=String(body.name||'').trim();
 if(name.length<2||name.length>140)return c.json({error:'Informe o nome correto do produto.'},400);
 try{
  const svc=c.get('services'),photo=await importCuratedProductImage(svc.db,svc.media,name);
  return c.json({imageUrl:photo.imageUrl,photo},201);
 }catch(e:any){
  return c.json({error:e.message||'Não foi possível importar esta foto agora.'},400);
 }
});
adminRoutes.post('/products/image-import',async(c)=>{
 const body=await c.req.json().catch(()=>({}));
 const name=String(body.name||'').trim(),pageId=Number(body.pageId);
 if(name.length<2||name.length>140||!Number.isSafeInteger(pageId)||pageId<1)
  return c.json({error:'Nome ou imagem inválidos.'},400);
 try{
  const {db,media}=c.get('services');
  const result=await importCommonsProductImage(db,media,name,pageId);
  return c.json({imageUrl:result.imageUrl,photo:result},201);
 }catch(e:any){return c.json({error:String(e.message||'Não foi possível importar a imagem.')},400);}
});
adminRoutes.post('/products/with-variants',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json().catch(()=>({}));
 const tenantModes=await db.prepare('SELECT sale_modes_json FROM tenants WHERE id=?').bind(tid).first<{sale_modes_json:string|null}>();
 if(!new Set<string>(JSON.parse(tenantModes?.sale_modes_json||'["weight","unit","dual","variants","custom"]')).has('variants'))
  return c.json({error:'Embalagens e variações não estão habilitadas para este estabelecimento.'},403);
 const name=String(b.name||'').trim(),options=Array.isArray(b.variants)?b.variants:[];
 const fixed=b.fixedOptionsEnabled===true;
 if(name.length<2||name.length>140||options.length<1||options.length>20)
  return c.json({error:'Informe o produto e de 1 a 20 opções de venda.'},400);
 if(b.categoryId&&!await tenantOwnsCategory(db,tid,b.categoryId))
  return c.json({error:'Categoria inválida para este estabelecimento.'},400);
 if(fixed&&!b.sharedPool)
  return c.json({error:'Opções de preço fixo devem compartilhar estoque por peso.'},400);
 const shared=!!b.sharedPool;
 const stockQty=Number(b.poolPhysicalQty);
 if(shared&&(!Number.isSafeInteger(stockQty)||stockQty<1||stockQty>1_000_000_000))
  return c.json({error:'Informe o estoque físico total válido.'},400);
 const normalized:any[]=[],names=new Set<string>();
 for(const item of options){
  const optionName=String(item?.name||'').trim();
  const price=Number(item?.priceCents),promo=item?.promoPriceCents==null?null:Number(item.promoPriceCents);
  const deduction=Number(item?.deductionQty),ownStock=Number(item?.stockQty||0);
  if(optionName.length<2||optionName.length>80||names.has(optionName.toLocaleLowerCase('pt-BR'))||
   !Number.isSafeInteger(price)||price<=0||price>100_000_000||
   (promo!==null&&(!Number.isSafeInteger(promo)||promo<0||promo>=price))||
   !Number.isSafeInteger(deduction)||deduction<1||deduction>1_000_000_000||
   (!shared&&(!Number.isSafeInteger(ownStock)||ownStock<0||ownStock>1_000_000_000)))
   return c.json({error:'Confira nomes únicos, preços e quantidade consumida por opção.'},400);
  names.add(optionName.toLocaleLowerCase('pt-BR'));
  normalized.push({name:optionName,price,promo,deduction,ownStock,sku:item.sku||null});
 }
 const time=new Date().toISOString(),productId=generateId(),poolId=shared?generateId():null;
 const automaticImage=!b.imageUrl?await autoProductImage(db,c.get('services').media,name):null;
 const imageUrl=b.imageUrl||automaticImage?.imageUrl||null;
 const statements:any[]=[];
 if(poolId)statements.push(db.prepare(`INSERT INTO stock_pools
  (id,tenant_id,name,sku_code,base_unit,physical_qty,reserved_qty,low_stock_threshold,created_at,updated_at)
  VALUES(?,?,?,?,?, ?,0,?,?,?)`)
  .bind(poolId,tid,String(b.poolName||`${name} — estoque compartilhado`),b.poolSku||null,
   fixed?'g':'un',stockQty,Number(b.lowStockThreshold)||0,time,time));
 statements.push(db.prepare(`INSERT INTO products
  (id,tenant_id,category_id,sku,name,description,image_url,sale_mode,unit_label,pricing_unit_grams,
   min_qty,step_qty,price_cents,is_featured,is_active,physical_qty,reserved_qty,low_stock_threshold,
   fixed_options_enabled,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,'variants','embalagem',1000,1,1,0,?,?,0,0,0,?,?,?)`)
  .bind(productId,tid,b.categoryId||null,b.sku||null,name,b.description||'',imageUrl,
   b.featured?1:0,b.active===false?0:1,fixed?1:0,time,time));
 for(let i=0;i<normalized.length;i++){
  const v=normalized[i];
  statements.push(db.prepare(`INSERT INTO product_variants
   (id,tenant_id,product_id,sku,name,price_cents,promo_price_cents,stock_pool_id,pool_deduction_qty,
    physical_qty,reserved_qty,low_stock_threshold,sort_order,is_active,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,1,?,?)`)
   .bind(generateId(),tid,productId,v.sku,v.name,v.price,v.promo,poolId,v.deduction,
    poolId?0:v.ownStock,i,time,time));
 }
 await runConditionalTransaction(db,statements.map(stmt=>({stmt})));
 return c.json({id:productId,stockPoolId:poolId,photoSource:automaticImage?.source||'manual'},201);
});

adminRoutes.patch('/products/:id/fixed-stock',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id');
 const body=await c.req.json().catch(()=>({}));
 const qty=Number(body.physicalQtyGrams);
 if(!Number.isSafeInteger(qty)||qty<0||qty>1_000_000_000)
  return c.json({error:'Informe estoque total em gramas, sem valores negativos.'},400);
 const product=await db.prepare(`SELECT v.stock_pool_id AS pool_id
  FROM products p JOIN product_variants v ON v.product_id=p.id AND v.tenant_id=p.tenant_id
  JOIN stock_pools sp ON sp.id=v.stock_pool_id AND sp.tenant_id=p.tenant_id
  WHERE p.tenant_id=? AND p.id=? AND p.is_deleted=0
   AND p.fixed_options_enabled=1 AND sp.base_unit='g' LIMIT 1`)
  .bind(tid,id).first<{pool_id:string}>();
 if(!product)return c.json({error:'Produto de preço fixo não encontrado.'},404);
 const now=new Date().toISOString();
 const result=await db.prepare(`UPDATE stock_pools SET physical_qty=?,updated_at=?
  WHERE id=? AND tenant_id=? AND reserved_qty<=?`)
  .bind(qty,now,product.pool_id,tid,qty).run();
 if(!result.meta.changes)
  return c.json({error:'O estoque não pode ficar abaixo do volume já reservado.'},409);
 return c.json({success:true});
});
adminRoutes.get('/products',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId');const {results}=await db.prepare(`SELECT p.*,c.name as category_name,(p.physical_qty-p.reserved_qty) as available_internal FROM products p LEFT JOIN categories c ON c.id=p.category_id AND c.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.is_deleted=0 ORDER BY p.name`).bind(tid).all<Record<string,any>>();for(const p of results){const {results:variants}=await db.prepare(`SELECT v.*,sp.physical_qty AS pool_physical_qty FROM product_variants v LEFT JOIN stock_pools sp ON sp.id=v.stock_pool_id WHERE v.tenant_id=? AND v.product_id=? AND v.is_active=1 ORDER BY v.sort_order,v.name`).bind(tid,p.id).all();p.variants=variants;}return c.json({products:results});});
adminRoutes.patch('/products/variant-items/:id',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json();const name=String(b.name||'').trim(),price=Number(b.priceCents),deduction=Number(b.deductionQty);if(!name||!Number.isInteger(price)||price<0||!Number.isInteger(deduction)||deduction<=0)return c.json({error:'Nome, preço e unidades consumidas são obrigatórios.'},400);const r=await db.prepare(`UPDATE product_variants SET name=?,sku=?,price_cents=?,promo_price_cents=?,pool_deduction_qty=?,updated_at=? WHERE id=? AND tenant_id=? AND is_active=1`).bind(name,b.sku||null,price,b.promoPriceCents==null?null:Number(b.promoPriceCents),deduction,new Date().toISOString(),id,tid).run();return r.meta.changes?c.json({success:true}):c.json({error:'Variação não encontrada.'},404);});
adminRoutes.post('/products/:id/variants',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),productId=c.req.param('id'),b=await c.req.json();const product=await db.prepare(`SELECT id FROM products WHERE id=? AND tenant_id=? AND sale_mode='variants'`).bind(productId,tid).first();if(!product)return c.json({error:'Produto com variações não encontrado.'},404);if(b.stockPoolId&&!await db.prepare(`SELECT id FROM stock_pools WHERE id=? AND tenant_id=?`).bind(b.stockPoolId,tid).first())return c.json({error:'Pool de estoque inválido para este estabelecimento.'},400);const name=String(b.name||'').trim(),price=Number(b.priceCents),deduction=Number(b.deductionQty||1);if(!name||!Number.isInteger(price)||price<0||!Number.isInteger(deduction)||deduction<=0)return c.json({error:'Confira nome, preço e consumo do estoque.'},400);const id=generateId(),time=new Date().toISOString();await db.prepare(`INSERT INTO product_variants(id,tenant_id,product_id,sku,name,price_cents,promo_price_cents,stock_pool_id,pool_deduction_qty,physical_qty,reserved_qty,low_stock_threshold,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,1,?,?)`).bind(id,tid,productId,b.sku||null,name,price,b.promoPriceCents==null?null:Number(b.promoPriceCents),b.stockPoolId||null,deduction,b.stockPoolId?0:Number(b.stockQty||0),Number(b.sortOrder)||0,time,time).run();return c.json({id},201);});
adminRoutes.delete('/products/variant-items/:id',async(c)=>{const r=await c.get('services').db.prepare(`UPDATE product_variants SET is_active=0,updated_at=? WHERE id=? AND tenant_id=?`).bind(new Date().toISOString(),c.req.param('id'),c.get('tenantId')).run();return c.json({success:r.meta.changes>0});});
adminRoutes.get('/categories',async(c)=>{const {results}=await c.get('services').db.prepare('SELECT * FROM categories WHERE tenant_id=? ORDER BY sort_order,name').bind(c.get('tenantId')).all();return c.json({categories:results});});
adminRoutes.post('/categories',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId');const b=await c.req.json();const name=String(b.name||'').trim();if(!name)return c.json({error:'Nome obrigatório.'},400);const slug=(b.slug||name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-');const id=generateId();await db.prepare(`INSERT INTO categories(id,tenant_id,name,slug,icon,sort_order,is_active,created_at) VALUES(?,?,?,?,?,?,1,?)`).bind(id,tid,name,slug,b.icon||'🥬',Number(b.sortOrder)||0,new Date().toISOString()).run();return c.json({id},201);});
adminRoutes.patch('/categories/:id',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json();const r=await db.prepare(`UPDATE categories SET name=COALESCE(?,name),icon=COALESCE(?,icon),is_active=COALESCE(?,is_active) WHERE id=? AND tenant_id=?`).bind(b.name?String(b.name).trim():null,b.icon||null,b.active===undefined?null:(b.active?1:0),id,tid).run();return c.json({success:r.meta.changes>0});});
adminRoutes.post('/products',async(c)=>{
  const db=c.get('services').db, tid=c.get('tenantId'), b=await c.req.json().catch(()=>({}));
  const name=String(b.name||'').trim();
  if(name.length<2)return c.json({error:'Informe o nome do produto.'},400);
  if(b.categoryId&&!await tenantOwnsCategory(db,tid,b.categoryId))return c.json({error:'Categoria inválida para este estabelecimento.'},400);
  const selected=String(b.saleMode||'unit');
  if(!['weight','unit','dual','custom'].includes(selected))return c.json({error:'Modo de venda inválido.'},400);
  const tenantModes=await db.prepare('SELECT sale_modes_json FROM tenants WHERE id=?').bind(tid).first<{sale_modes_json:string|null}>();
  const enabledModes=new Set<string>(JSON.parse(tenantModes?.sale_modes_json||'["weight","unit","dual","variants","custom"]'));
  const requiredModes=selected==='dual'?['weight','unit']:[selected];
  if(requiredModes.some(mode=>!enabledModes.has(mode)))return c.json({error:'Esta modalidade de venda não está habilitada para seu estabelecimento. Solicite ao Super Admin.'},403);
  let customConfig:string|null=null;
  if(selected==='custom'){try{const config=readCustomConfig(b.customConfig);if(!config)throw Error('Cadastre os grupos de opções.');customConfig=JSON.stringify(config);}catch{return c.json({error:'Confira os grupos, preços e limites de complementos.'},400);}}
  const isDual=selected==='dual', isWeight=selected==='weight'||isDual;
  const price=Number(b.priceCents), stock=Number(b.stockQty), min=selected==='custom'?1:Number(b.minQty??(isWeight?100:1)), step=selected==='custom'?1:Number(b.stepQty??(isWeight?50:1));
  const unitPrice=isDual?Number(b.unitPriceCents):null, unitWeight=isDual?Number(b.unitWeightGrams):null;
  if(!Number.isInteger(price)||price<0||!Number.isInteger(stock)||stock<0||!Number.isInteger(min)||min<1||!Number.isInteger(step)||step<1)return c.json({error:'Confira preço, estoque, mínimo e incremento do produto.'},400);
  if(isDual&&(!Number.isInteger(unitPrice)||(unitPrice??0)<=0||!Number.isInteger(unitWeight)||(unitWeight??0)<=0))return c.json({error:'Para vender por kg e unidade, informe preço por unidade e peso médio em gramas.'},400);
  const id=generateId(),time=new Date().toISOString();
  const automaticImage=!b.imageUrl?await autoProductImage(db,c.get('services').media,name):null;
  const imageUrl=b.imageUrl||automaticImage?.imageUrl||null;
  await db.prepare(`INSERT INTO products(id,tenant_id,category_id,sku,name,description,image_url,sale_mode,unit_label,pricing_unit_grams,min_qty,step_qty,price_cents,promo_price_cents,unit_price_cents,unit_weight_grams,is_featured,is_active,physical_qty,reserved_qty,low_stock_threshold,created_at,updated_at,custom_config_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`)
    .bind(id,tid,b.categoryId||null,b.sku||null,name,b.description||'',imageUrl,isWeight?'weight':'unit',isWeight?'kg':(b.unitLabel||'un'),1000,min,step,price,b.promoPriceCents==null?null:Number(b.promoPriceCents),unitPrice,unitWeight,b.featured?1:0,b.active===false?0:1,stock,Number(b.lowStockThreshold)||0,time,time,customConfig).run();
  return c.json({id,imageUrl,photoSource:automaticImage?.source||'manual'},201);
});
adminRoutes.patch('/products/:id',async(c)=>{
  const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json().catch(()=>({}));
  if(b.categoryId&&!await tenantOwnsCategory(db,tid,b.categoryId))return c.json({error:'Categoria inválida para este estabelecimento.'},400);
  const current=await db.prepare('SELECT sale_mode,stock_pool_id,image_url,name,custom_config_json FROM products WHERE id=? AND tenant_id=? AND is_deleted=0').bind(id,tid).first<{sale_mode:string;stock_pool_id:string|null;image_url:string|null;name:string;custom_config_json:string|null}>();
  if(!current)return c.json({error:'Produto não encontrado.'},404);
  let configUpdate:string|undefined;
  if(b.customConfig!==undefined){
    if(current.sale_mode!=='unit'||current.stock_pool_id||!current.custom_config_json)return c.json({error:'Complementos só podem ser editados em produtos personalizáveis.'},400);
    try{const config=readCustomConfig(b.customConfig);if(!config)throw Error('Cadastre grupos.');configUpdate=JSON.stringify(config);}catch{return c.json({error:'Confira os grupos, preços e limites de complementos.'},400);}
    delete b.customConfig;b.minQty=1;b.stepQty=1;
  }
  const requestedMode=b.saleMode;
  if(requestedMode!==undefined){
    if(!['weight','dual'].includes(requestedMode)||current.sale_mode!=='weight'||current.stock_pool_id)return c.json({error:'Só é possível alternar peso e peso/unidade em produtos cadastrados por peso, sem estoque compartilhado.'},400);
    if(requestedMode==='dual'&&(!Number.isInteger(Number(b.unitPriceCents))||Number(b.unitPriceCents)<=0||!Number.isInteger(Number(b.unitWeightGrams))||Number(b.unitWeightGrams)<=0))return c.json({error:'Informe preço por unidade e peso médio em gramas.'},400);
    b.unitPriceCents=requestedMode==='dual'?Number(b.unitPriceCents):null;
    b.unitWeightGrams=requestedMode==='dual'?Number(b.unitWeightGrams):null;
    delete b.saleMode;
  }
  // Edição opcional: se apagar a imagem ou alterar o nome de um item sem
  // imagem própria, reaproveitar automaticamente foto compatível.
  if((b.imageUrl===null||b.imageUrl==='')&&b.name){
    const automatic=await autoProductImage(db,c.get('services').media,String(b.name));
    if(automatic.imageUrl)b.imageUrl=automatic.imageUrl;
  }else if(b.imageUrl===undefined&&b.name&&!current.image_url){
    const automatic=await autoProductImage(db,c.get('services').media,String(b.name));
    if(automatic.imageUrl)b.imageUrl=automatic.imageUrl;
  }
  const allowed=['name','description','image_url','category_id','sku','unit_label','pricing_unit_grams','min_qty','step_qty','price_cents','promo_price_cents','unit_price_cents','unit_weight_grams','is_featured','is_active','low_stock_threshold'];
  const map:any={imageUrl:'image_url',categoryId:'category_id',unitLabel:'unit_label',pricingUnitGrams:'pricing_unit_grams',minQty:'min_qty',stepQty:'step_qty',priceCents:'price_cents',promoPriceCents:'promo_price_cents',unitPriceCents:'unit_price_cents',unitWeightGrams:'unit_weight_grams',featured:'is_featured',active:'is_active',lowStockThreshold:'low_stock_threshold'};
  const sets:string[]=[],vals:any[]=[];
  for(const[k,v]of Object.entries(b)){const col=map[k]||k;if(allowed.includes(col)){if(['price_cents','unit_price_cents','unit_weight_grams','min_qty','step_qty'].includes(col)&&v!==null&&(!Number.isInteger(Number(v))||Number(v)<(col==='price_cents'?0:1)))return c.json({error:'Preço e quantidades devem ser válidos.'},400);sets.push(`${col}=?`);vals.push(typeof v==='boolean'?Number(v):v);}}
  if(configUpdate!==undefined){sets.push('custom_config_json=?');vals.push(configUpdate);}
  if(!sets.length)return c.json({error:'Nenhum campo válido.'},400);
  sets.push('updated_at=?');vals.push(new Date().toISOString(),id,tid);
  const r=await db.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=? AND tenant_id=? AND is_deleted=0`).bind(...vals).run();
  return r.meta.changes?c.json({success:true}):c.json({error:'Produto não encontrado.'},404);
});
adminRoutes.delete('/products/:id',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id');const r=await db.prepare(`UPDATE products SET is_deleted=1,is_active=0,updated_at=? WHERE id=? AND tenant_id=? AND is_deleted=0 AND is_active=0`).bind(new Date().toISOString(),id,tid).run();if(r.meta.changes)return c.json({success:true});const product=await db.prepare('SELECT id FROM products WHERE id=? AND tenant_id=? AND is_deleted=0').bind(id,tid).first();return product?c.json({error:'Desative o produto antes de excluir.'},409):c.json({error:'Produto não encontrado.'},404);});

adminRoutes.post('/stock/adjust',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json();const target=String(b.targetType),id=String(b.targetId),qty=Number(b.quantity);if(!Number.isInteger(qty)||qty===0)return c.json({error:'Informe ajuste inteiro diferente de zero.'},400);const tables:any={product:'products',variant:'product_variants',pool:'stock_pools'};const table=tables[target];if(!table)return c.json({error:'Tipo de estoque inválido.'},400);const row=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`).bind(id,tid).first<Record<string,any>>();if(!row)return c.json({error:'Item não encontrado.'},404);if(row.physical_qty+qty<row.reserved_qty)return c.json({error:'O ajuste não pode reduzir estoque abaixo do já reservado.'},409);const time=new Date().toISOString();await db.prepare(`UPDATE ${table} SET physical_qty=physical_qty+?,updated_at=? WHERE id=? AND tenant_id=?`).bind(qty,time,id,tid).run();await db.prepare(`INSERT INTO stock_movements(id,tenant_id,target_type,product_id,variant_id,stock_pool_id,target_name,movement_type,delta_physical,delta_reserved,physical_after,reserved_after,unit,actor_user_id,reason,created_at) VALUES(?,?,?,?,?, ?,?,'manual_adjust',?,0,?,?,?, ?,?,?)`).bind(generateId(),tid,target,target==='product'?id:null,target==='variant'?id:null,target==='pool'?id:null,row.name||row.title||'Estoque',qty,row.physical_qty+qty,row.reserved_qty,row.base_unit|| (row.sale_mode==='weight'?'g':'un'),c.get('authUser').sub,String(b.reason||'Ajuste manual'),time).run();return c.json({success:true});});
adminRoutes.get('/stock',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId');const [products,variants,pools,movements]=await Promise.all([db.prepare(`SELECT id,name,sale_mode,unit_label,physical_qty,reserved_qty,low_stock_threshold FROM products WHERE tenant_id=? AND is_deleted=0 AND sale_mode!='variants'`).bind(tid).all(),db.prepare(`SELECT v.id,v.product_id,p.name AS product_name,v.name,v.physical_qty,v.reserved_qty,v.low_stock_threshold,v.stock_pool_id FROM product_variants v JOIN products p ON p.id=v.product_id AND p.tenant_id=v.tenant_id WHERE v.tenant_id=? AND v.stock_pool_id IS NULL`).bind(tid).all(),db.prepare(`SELECT * FROM stock_pools WHERE tenant_id=?`).bind(tid).all(),db.prepare(`SELECT * FROM stock_movements WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100`).bind(tid).all()]);return c.json({products:products.results,variants:variants.results,pools:pools.results,movements:movements.results});});
// Fidelidade: dados de clientes e resgates somente no painel autenticado.
adminRoutes.get('/loyalty',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId');
 const tenant=await db.prepare('SELECT loyalty_config_json FROM tenants WHERE id=?').bind(tid).first<{loyalty_config_json:string|null}>();
 const {results:accounts}=await db.prepare(`SELECT a.customer_id,c.name,c.phone,a.progress,a.goal,a.reward_name,
 (SELECT COUNT(*) FROM loyalty_earnings e WHERE e.tenant_id=a.tenant_id AND e.customer_id=a.customer_id AND e.state!='revoked') AS total_points,
 (SELECT COUNT(*) FROM loyalty_earnings e WHERE e.tenant_id=a.tenant_id AND e.customer_id=a.customer_id AND e.state='pending') AS pending_points
 FROM loyalty_accounts a JOIN customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
 WHERE a.tenant_id=? ORDER BY a.updated_at DESC LIMIT 500`).bind(tid).all();
 const {results:rewards}=await db.prepare(`SELECT r.id,r.reward_name,r.points_used,r.created_at,r.redeemed_at,c.name,c.phone
 FROM loyalty_rewards r JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id
 WHERE r.tenant_id=? ORDER BY r.redeemed_at IS NOT NULL,r.created_at DESC LIMIT 500`).bind(tid).all();
 return c.json({config:readLoyalty(tenant?.loyalty_config_json),accounts,rewards});
});
adminRoutes.put('/loyalty',async(c)=>{
 if(!['owner','manager'].includes(c.get('authUser').role))return c.json({error:'Somente proprietário ou gerente pode editar o programa.'},403);
 const config=loyaltyConfigSchema.safeParse(await c.req.json().catch(()=>null));
 if(!config.success)return c.json({error:'Informe valor mínimo maior que zero, meta de 1 a 100 e nome do prêmio.'},400);
 const db=c.get('services').db,tid=c.get('tenantId');
 await db.prepare('UPDATE tenants SET loyalty_config_json=?,updated_at=? WHERE id=?').bind(JSON.stringify(config.data),new Date().toISOString(),tid).run();
 return c.json({success:true,config:config.data});
});
adminRoutes.post('/loyalty/rewards/:id/redeem',async(c)=>{
 if(!['owner','manager'].includes(c.get('authUser').role))return c.json({error:'Somente proprietário ou gerente pode registrar resgates.'},403);
 const r=await c.get('services').db.prepare('UPDATE loyalty_rewards SET redeemed_at=?,redeemed_by_user_id=? WHERE id=? AND tenant_id=? AND redeemed_at IS NULL')
 .bind(new Date().toISOString(),c.get('authUser').sub,c.req.param('id'),c.get('tenantId')).run();
 return r.meta.changes?c.json({success:true}):c.json({error:'Prêmio não encontrado ou já resgatado.'},409);
});
adminRoutes.get('/customers',async(c)=>{const {results}=await c.get('services').db.prepare(`SELECT * FROM customers WHERE tenant_id=? ORDER BY last_order_at DESC LIMIT 300`).bind(c.get('tenantId')).all();return c.json({customers:results});});
adminRoutes.get('/reports',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId');const from=c.req.query('from')||'2000-01-01',to=c.req.query('to')||'2999-12-31';const {results:summary}=await db.prepare(`SELECT COUNT(*) orders_count,COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_cents ELSE 0 END),0) sales_cents,COALESCE(AVG(CASE WHEN status!='cancelled' THEN total_cents END),0) avg_ticket_cents FROM orders WHERE tenant_id=? AND deleted_at IS NULL AND date(created_at)>=date(?) AND date(created_at)<=date(?)`).bind(tid,from,to).all();const {results:top}=await db.prepare(`SELECT oi.product_name_snapshot, SUM(oi.quantity) quantity, SUM(oi.line_total_cents) sales_cents FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.tenant_id=? AND o.status!='cancelled' AND o.deleted_at IS NULL AND date(o.created_at)>=date(?) AND date(o.created_at)<=date(?) GROUP BY oi.product_id ORDER BY sales_cents DESC LIMIT 10`).bind(tid,from,to).all();return c.json({summary:summary[0],topProducts:top});});


/** Banners próprios de cada loja; imagens de outras contas não são aceitas. */
function validOwnBannerImage(url:unknown,tenantId:string):url is string {
 return typeof url==='string' &&
   url.startsWith('/media/tenants/'+tenantId+'/') &&
   /^\/media\/tenants\/[a-z0-9-]+\/[a-z0-9_-]+\/[a-z0-9-]+\.(png|jpe?g|webp|gif|avif)$/i.test(url);
}
adminRoutes.get('/banners',async(c)=>{
 const {results}=await c.get('services').db.prepare(
  'SELECT id,image_url,mobile_image_url,sort_order,is_active FROM store_banners WHERE tenant_id=? ORDER BY sort_order,created_at LIMIT 10'
 ).bind(c.get('tenantId')).all();
 return c.json({banners:results});
});
adminRoutes.post('/banners',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json().catch(()=>({}));
 if(!validOwnBannerImage(b.imageUrl,tid))return c.json({error:'Envie uma imagem desta loja antes de adicionar o banner.'},400);
 if(b.mobileImageUrl!=null && !validOwnBannerImage(b.mobileImageUrl,tid))
  return c.json({error:'A imagem para celular precisa pertencer à mesma loja.'},400);
 const count=await db.prepare('SELECT COUNT(*) AS n,COALESCE(MAX(sort_order),-1)+1 AS next_order FROM store_banners WHERE tenant_id=?').bind(tid).first<{n:number;next_order:number}>();
 if((count?.n||0)>=10)return c.json({error:'Limite de 10 banners por estabelecimento.'},400);
 const id=generateId(),now=new Date().toISOString();
 await db.prepare('INSERT INTO store_banners(id,tenant_id,image_url,mobile_image_url,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)')
  .bind(id,tid,b.imageUrl,b.mobileImageUrl||null,count?.next_order||0,now,now).run();
 return c.json({id},201);
});
adminRoutes.patch('/banners/:id',async(c)=>{
 const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json().catch(()=>({}));
 const current=await db.prepare('SELECT id,image_url,mobile_image_url,sort_order,is_active FROM store_banners WHERE id=? AND tenant_id=?').bind(id,tid).first<Record<string,any>>();
 if(!current)return c.json({error:'Banner não encontrado nesta loja.'},404);
 if(b.direction==='up'||b.direction==='down'){
  const {results}=await db.prepare('SELECT id,sort_order FROM store_banners WHERE tenant_id=? ORDER BY sort_order,created_at').bind(tid).all<{id:string;sort_order:number}>();
  const index=results.findIndex(x=>x.id===id),other=results[index+(b.direction==='up'?-1:1)];
  if(!other)return c.json({success:true});
  await db.prepare('UPDATE store_banners SET sort_order=CASE WHEN id=? THEN ? WHEN id=? THEN ? ELSE sort_order END,updated_at=? WHERE tenant_id=? AND id IN (?,?)')
   .bind(id,other.sort_order,other.id,current.sort_order,new Date().toISOString(),tid,id,other.id).run();
  return c.json({success:true});
 }
 if(b.imageUrl!==undefined && !validOwnBannerImage(b.imageUrl,tid))
  return c.json({error:'Imagem inválida ou de outra loja.'},400);
 if(b.mobileImageUrl!==undefined && b.mobileImageUrl!==null &&
    !validOwnBannerImage(b.mobileImageUrl,tid))
  return c.json({error:'Imagem para celular inválida ou de outra loja.'},400);
 const fields:string[]=[],values:any[]=[];
 if(b.imageUrl!==undefined){fields.push('image_url=?');values.push(b.imageUrl);}
 if(b.mobileImageUrl!==undefined){fields.push('mobile_image_url=?');values.push(b.mobileImageUrl||null);}
 if(typeof b.active==='boolean'){fields.push('is_active=?');values.push(b.active?1:0);}
 if(!fields.length)return c.json({error:'Nenhuma alteração reconhecida.'},400);
 fields.push('updated_at=?');values.push(new Date().toISOString(),id,tid);
 await db.prepare('UPDATE store_banners SET '+fields.join(',')+' WHERE id=? AND tenant_id=?').bind(...values).run();
 return c.json({success:true});
});
adminRoutes.delete('/banners/:id',async(c)=>{
 const result=await c.get('services').db.prepare('DELETE FROM store_banners WHERE tenant_id=? AND id=?')
  .bind(c.get('tenantId'),c.req.param('id')).run();
 return result.meta.changes?c.json({success:true}):c.json({error:'Banner não encontrado nesta loja.'},404);
});

adminRoutes.get('/settings',async(c)=>{const t=await c.get('services').db.prepare(`SELECT id,slug,name,legal_name,document_cnpj,logo_url,banner_url,banner_title,banner_subtitle,primary_color,accent_color,button_color,page_background_color,surface_color,text_color,whatsapp_public,instagram_url,address_text,business_hours,delivery_info,default_delivery_fee_cents,free_delivery_min_cents,min_order_cents,is_open,accepts_cash,accepts_pix_delivery,accepts_debit_delivery,accepts_credit_delivery,signup_popup_enabled,signup_popup_title,signup_popup_description,signup_popup_button,receipt_footer,receipt_watermark_text,receipt_watermark_orientation,receipt_watermark_opacity,receipt_watermark_font_size,delivery_eta_text,opening_schedule_json FROM tenants WHERE id=?`).bind(c.get('tenantId')).first();const {results:neighborhoods}=await c.get('services').db.prepare('SELECT * FROM neighborhoods WHERE tenant_id=? ORDER BY name').bind(c.get('tenantId')).all();return c.json({settings:t,neighborhoods,storeStatus:t?getStoreStatus(!!(t as any).is_open,(t as any).opening_schedule_json,new Date(),(t as any).business_hours):null});});
adminRoutes.post('/settings/neighborhoods',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json(),name=String(b.name||'').trim();if(!name)return c.json({error:'Nome do bairro obrigatório.'},400);const id=generateId();try{await db.prepare(`INSERT INTO neighborhoods(id,tenant_id,name,delivery_fee_cents,estimated_time,is_active,created_at) VALUES(?,?,?,?,?,1,?)`).bind(id,tid,name,Number(b.deliveryFeeCents)||0,String(b.estimatedTime||'35-50 min'),new Date().toISOString()).run();return c.json({id},201);}catch(e:any){return c.json({error:'Bairro já cadastrado ou dados inválidos.'},409);}});
adminRoutes.patch('/settings/neighborhoods/:id',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json();const r=await db.prepare(`UPDATE neighborhoods SET name=?,delivery_fee_cents=?,estimated_time=?,is_active=? WHERE id=? AND tenant_id=?`).bind(String(b.name||'').trim(),Number(b.deliveryFeeCents)||0,String(b.estimatedTime||'35-50 min'),b.active===false?0:1,id,tid).run();return c.json({success:r.meta.changes>0});});
adminRoutes.delete('/settings/neighborhoods/:id',async(c)=>{const r=await c.get('services').db.prepare(`DELETE FROM neighborhoods WHERE id=? AND tenant_id=?`).bind(c.req.param('id'),c.get('tenantId')).run();return c.json({success:r.meta.changes>0});});
adminRoutes.patch('/settings',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json();const allowed:any={name:'name',logoUrl:'logo_url',bannerUrl:'banner_url',bannerTitle:'banner_title',bannerSubtitle:'banner_subtitle',primaryColor:'primary_color',accentColor:'accent_color',buttonColor:'button_color',pageBackgroundColor:'page_background_color',surfaceColor:'surface_color',textColor:'text_color',whatsappPublic:'whatsapp_public',instagramUrl:'instagram_url',addressText:'address_text',businessHours:'business_hours',deliveryInfo:'delivery_info',defaultDeliveryFeeCents:'default_delivery_fee_cents',freeDeliveryMinCents:'free_delivery_min_cents',minOrderCents:'min_order_cents',isOpen:'is_open',acceptsCash:'accepts_cash',acceptsPixDelivery:'accepts_pix_delivery',acceptsDebitDelivery:'accepts_debit_delivery',acceptsCreditDelivery:'accepts_credit_delivery',signupPopupEnabled:'signup_popup_enabled',signupPopupTitle:'signup_popup_title',signupPopupDescription:'signup_popup_description',signupPopupButton:'signup_popup_button',receiptFooter:'receipt_footer',receiptWatermarkText:'receipt_watermark_text',receiptWatermarkOrientation:'receipt_watermark_orientation',receiptWatermarkOpacity:'receipt_watermark_opacity',receiptWatermarkFontSize:'receipt_watermark_font_size',deliveryEtaText:'delivery_eta_text',openingSchedule:'opening_schedule_json'};const sets:string[]=[],vals:any[]=[];for(const [k,v] of Object.entries(b))if(allowed[k]){
  if(['primaryColor','accentColor','buttonColor','pageBackgroundColor','surfaceColor','textColor'].includes(k)){
    if(typeof v!=='string'||!/^#[0-9a-fA-F]{6}$/.test(v))return c.json({error:'Informe uma cor válida no seletor.'},400);
    sets.push(`${allowed[k]}=?`);vals.push(v.toLowerCase());
  }else if(k==='openingSchedule'){
    try{sets.push('opening_schedule_json=?');vals.push(JSON.stringify(readSchedule(v)));}catch{return c.json({error:'Confira os horários de abertura e fechamento de cada dia.'},400);}
  }else if(k==='receiptFooter'||k==='deliveryEtaText'||k==='receiptWatermarkText'){
    const limit=k==='receiptFooter'?300:k==='deliveryEtaText'?80:100;
    if(typeof v!=='string'||v.length>limit||(k==='deliveryEtaText'&&!v.trim()))return c.json({error:'Confira a mensagem da comanda, marca-d’água e previsão de entrega.'},400);
    sets.push(`${allowed[k]}=?`);vals.push(v.trim());
  }else if(k==='receiptWatermarkOrientation'){
    if(!['horizontal','diagonal','vertical'].includes(String(v)))return c.json({error:'Orientação da marca-d’água inválida.'},400);
    sets.push(`${allowed[k]}=?`);vals.push(v);
  }else if(k==='receiptWatermarkOpacity'||k==='receiptWatermarkFontSize'){
    const min=k==='receiptWatermarkOpacity'?0:10,max=k==='receiptWatermarkOpacity'?35:48;
    if(!Number.isInteger(v)||Number(v)<min||Number(v)>max)return c.json({error:'Ajuste a opacidade ou o tamanho da marca-d’água dentro dos limites.'},400);
    sets.push(`${allowed[k]}=?`);vals.push(v);
  }else if(['signupPopupTitle','signupPopupDescription','signupPopupButton'].includes(k)){
    const value=String(v??'').trim();
    const limit=k==='signupPopupDescription'?300:110;
    if(!value||value.length>limit)return c.json({error:'Preencha o texto do pop-up respeitando o limite de caracteres.'},400);
    sets.push(`${allowed[k]}=?`);vals.push(value);
  }else{
    sets.push(`${allowed[k]}=?`);vals.push(typeof v==='boolean'?Number(v):v);
  }
}if(!sets.length)return c.json({error:'Nenhuma configuração válida.'},400);sets.push('updated_at=?');vals.push(new Date().toISOString(),tid);await db.prepare(`UPDATE tenants SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();return c.json({success:true});});

adminRoutes.get('/whatsapp/status',async(c)=>c.json(await checkWhatsAppConnectionStatus(c.get('services').db,c.get('tenantId'),c.get('tenantSlug'),c.get('services').evolution)));
adminRoutes.post('/whatsapp/connect',async(c)=>{try{return c.json(await connectOrRefreshWhatsAppQr(c.get('services').db,c.get('tenantId'),c.get('tenantSlug'),c.get('services').evolution));}catch(e:any){return c.json({error:e.message},502);}});
adminRoutes.post('/whatsapp/refresh-qr',async(c)=>{try{return c.json(await connectOrRefreshWhatsAppQr(c.get('services').db,c.get('tenantId'),c.get('tenantSlug'),c.get('services').evolution));}catch(e:any){return c.json({error:e.message},502);}});
adminRoutes.post('/whatsapp/disconnect',async(c)=>c.json(await disconnectWhatsAppInstance(c.get('services').db,c.get('tenantId'),c.get('services').evolution)));
adminRoutes.post('/whatsapp/homologation/confirm',async(c)=>{if(c.get('services').appEnv==='production')return c.json({error:'Simulação desativada em produção.'},403);const b=await c.req.json().catch(()=>({}));try{return c.json(await confirmHomologationQrScan(c.get('services').db,c.get('tenantId'),String(b.phone||''),String(b.name||''),c.get('services').evolution));}catch(e:any){return c.json({error:e.message},400);}});
adminRoutes.get('/whatsapp/templates',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId');const {results}=await db.prepare(`SELECT * FROM whatsapp_templates WHERE tenant_id=? ORDER BY event_type`).bind(tid).all();return c.json({templates:results,defaults:DEFAULT_WHATSAPP_TEMPLATES.map(({event_type,title,message_template,is_enabled})=>({event_type,title,message_template,is_enabled}))});});
adminRoutes.put('/whatsapp/templates/:event',async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),event=c.req.param('event'),b=await c.req.json();const r=await db.prepare(`UPDATE whatsapp_templates SET message_template=?,is_enabled=?,updated_at=? WHERE tenant_id=? AND event_type=?`).bind(String(b.messageTemplate||''),b.enabled?1:0,new Date().toISOString(),tid,event).run();return c.json({success:r.meta.changes>0});});
adminRoutes.get('/whatsapp/queue',async(c)=>{const {results}=await c.get('services').db.prepare(`SELECT id,order_id,event_type,recipient_phone,recipient_name,status,attempts,max_attempts,last_error,sent_at,created_at FROM whatsapp_message_queue WHERE tenant_id=? ORDER BY created_at DESC LIMIT 150`).bind(c.get('tenantId')).all();return c.json({messages:results});});
adminRoutes.post('/whatsapp/queue/:id/retry',async(c)=>{const res=await dispatchQueuedMessageById(c.get('services').db,c.get('tenantId'),c.req.param('id'),c.get('services').evolution);return c.json(res);});
adminRoutes.get('/users',async(c)=>{const {results}=await c.get('services').db.prepare(`SELECT id,name,email,phone,role,is_active,last_login_at,created_at FROM users WHERE tenant_id=? ORDER BY role,name`).bind(c.get('tenantId')).all();return c.json({users:results});});
adminRoutes.post('/users',requireTenantAdmin(['owner']),async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),b=await c.req.json();const parsed=z.object({name:z.string().trim().min(2).max(120),email:z.email(),phone:z.string().optional(),password:z.string().min(12).max(200),role:z.enum(['manager','operator'])}).safeParse(b);if(!parsed.success)return c.json({error:parsed.error.issues[0]?.message||'Dados inválidos.'},400);const email=parsed.data.email.toLowerCase(),exists=await db.prepare(`SELECT id FROM users WHERE lower(email)=?`).bind(email).first();if(exists)return c.json({error:'Este e-mail já está em uso.'},409);const id=generateId(),time=new Date().toISOString();await db.prepare(`INSERT INTO users(id,tenant_id,name,email,phone,password_hash,role,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`).bind(id,tid,parsed.data.name,email,parsed.data.phone||null,await hashPassword(parsed.data.password),parsed.data.role,time,time).run();return c.json({id,email,role:parsed.data.role},201);});
adminRoutes.patch('/users/:id',requireTenantAdmin(['owner']),async(c)=>{const db=c.get('services').db,tid=c.get('tenantId'),id=c.req.param('id'),b=await c.req.json(),me=c.get('authUser').sub;if(id===me&&b.active===false)return c.json({error:'Não é possível desativar seu próprio usuário.'},400);const r=await db.prepare(`UPDATE users SET is_active=?,updated_at=? WHERE id=? AND tenant_id=? AND role IN ('manager','operator')`).bind(b.active?1:0,new Date().toISOString(),id,tid).run();return r.meta.changes?c.json({success:true}):c.json({error:'Usuário não encontrado ou protegido.'},404);});
adminRoutes.get('/profile',async(c)=>c.json({user:c.get('authUser'),tenant:{id:c.get('tenantId'),slug:c.get('tenantSlug'),name:c.get('tenantName')}}));
