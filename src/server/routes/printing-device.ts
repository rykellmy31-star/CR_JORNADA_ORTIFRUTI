import {Hono} from 'hono';
import {z} from 'zod';
import type {AppHonoEnv} from '../context';
import {authenticatePrintDevice,acknowledgePrintJob,claimNextPrintJob,
 hashPairingCode,hashSecret,randomSecret,updatePrintDeviceHeartbeat} from '../services/print-jobs';
import {generateId} from '../security/crypto';

/** API destinada exclusivamente ao aplicativo CR Jornada Express Impressão.
 * Não aceita o token de sessão do painel como token de impressora.
 */
export const printingDeviceRoutes=new Hono<AppHonoEnv>();

printingDeviceRoutes.post('/pair',async(c)=>{
 const parsed=z.object({
  tenantSlug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  code:z.string().trim().min(16).max(32),
  deviceName:z.string().trim().min(2).max(75)
 }).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Informe o estabelecimento, o código e o nome do aparelho.'},400);
 const services=c.get('services'),db=services.db,body=parsed.data;
 const tenant=await db.prepare("SELECT id,name FROM tenants WHERE slug=? AND status='active'")
  .bind(body.tenantSlug).first<{id:string;name:string}>();
 if(!tenant)return c.json({error:'Pareamento não autorizado. Confira loja e código.'},403);
 const hash=await hashPairingCode(tenant.id,body.code,services.jwtSecret);
 const now=new Date().toISOString();
 const used=await db.prepare(`UPDATE print_pairing_codes SET used_at=?
  WHERE id=(SELECT id FROM print_pairing_codes
   WHERE tenant_id=? AND code_hash=? AND used_at IS NULL AND expires_at>?
   LIMIT 1)
  RETURNING id`).bind(now,tenant.id,hash,now).first<{id:string}>();
 if(!used)return c.json({error:'Código inválido, expirado ou já utilizado.'},403);
 const token=randomSecret(),tokenHash=await hashSecret(token),deviceId=generateId();
 await db.prepare(`INSERT INTO print_devices
  (id,tenant_id,name,token_hash,created_at,updated_at)
  VALUES(?,?,?,?,?,?)`).bind(deviceId,tenant.id,body.deviceName,tokenHash,now,now).run();
 c.header('Cache-Control','no-store');
 return c.json({deviceId,deviceToken:token,storeName:tenant.name},201);
});

printingDeviceRoutes.get('/status',async(c)=>{
 const services=c.get('services');
 const device=await authenticatePrintDevice(services.db,c.req.header('Authorization')||'');
 if(!device)return c.json({error:'Impressora não autorizada. Faça novo pareamento.'},401);
 const settings=await services.db.prepare('SELECT auto_print_enabled FROM tenants WHERE id=?')
  .bind(device.tenant_id).first<{auto_print_enabled:number}>();
 await updatePrintDeviceHeartbeat(services.db,device);
 return c.json({connected:true,enabled:settings?.auto_print_enabled===1,deviceName:device.name});
});

printingDeviceRoutes.post('/jobs/claim',async(c)=>{
 const services=c.get('services'),db=services.db;
 const device=await authenticatePrintDevice(db,c.req.header('Authorization')||'');
 if(!device)return c.json({error:'Dispositivo não autorizado ou revogado.'},401);
 await updatePrintDeviceHeartbeat(db,device);
 const job=await claimNextPrintJob(db,device);
 if(!job)return c.body(null,204);
 c.header('Cache-Control','no-store');
 return c.json({job});
});

printingDeviceRoutes.post('/jobs/:id/ack',async(c)=>{
 const services=c.get('services'),db=services.db;
 const device=await authenticatePrintDevice(db,c.req.header('Authorization')||'');
 if(!device)return c.json({error:'Dispositivo não autorizado ou revogado.'},401);
 const parsed=z.object({leaseToken:z.string().length(48).regex(/^[a-f0-9]+$/),
  success:z.boolean(),error:z.string().max(200).optional()})
  .safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Confirmação inválida.'},400);
 const status=await acknowledgePrintJob(db,device,c.req.param('id'),
  parsed.data.leaseToken,parsed.data.success,parsed.data.error);
 if(!status)return c.json({error:'Comanda não pertence a este dispositivo, ou o lease expirou.'},409);
 return c.json({status});
});
