import type {DbClient} from '../db/adapter';
import {dispatchQueuedMessageById,type EvolutionEnvConfig} from './evolution-whatsapp';
export async function dispatchLoyaltyNotifications(db:DbClient,tenantId:string,orderId:string,env:EvolutionEnvConfig){
 const {results}=await db.prepare("SELECT id FROM whatsapp_message_queue WHERE tenant_id=? AND order_id=? AND event_type IN ('loyalty_earned','loyalty_recalculated','loyalty_reward') AND status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at,id").bind(tenantId,orderId,new Date().toISOString()).all<{id:string}>();
 for(const row of results)await dispatchQueuedMessageById(db,tenantId,row.id,env).catch(()=>undefined);
}
