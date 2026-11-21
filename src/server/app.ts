import {Hono} from 'hono';
import {cors} from 'hono/cors';
import type {AppHonoEnv,AppRuntimeServices} from './context';
import {authRoutes} from './routes/auth';
import {publicStoreRoutes} from './routes/public-store';
import {adminRoutes} from './routes/admin';
import {crmRoutes} from './routes/crm';
import {superAdminRoutes} from './routes/superadmin';
import {printingDeviceRoutes} from './routes/printing-device';
import {latestAndroidUpdate} from './services/android-updates';
import {timingSafeEqualStr} from './security/crypto';
import {normalizePhoneBR} from '../shared/pricing';
import {generateId,hashPassword} from './security/crypto';
import {normalizeEvolutionQrImage} from './services/evolution-whatsapp';
import {recordWhatsAppDisconnection,processPendingTelegramAlerts} from './services/telegram-alerts';
import {z} from 'zod';

export function createApp(services:AppRuntimeServices){
 const app=new Hono<AppHonoEnv>();
 app.use('*',async(c,next)=>{c.set('services',services);await next();c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');c.header('X-Frame-Options','DENY');c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');});
 app.use('/api/*',cors({origin:(origin)=>origin||'*',allowHeaders:['Content-Type','Authorization','X-CRM-API-Key'],allowMethods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],maxAge:600}));
 app.get('/api/health',c=>c.json({ok:true,service:'cr-jornada-hortifruti',environment:services.appEnv}));
 app.post('/api/system/bootstrap-superadmin',async(c)=>{if(!services.bootstrapSecret)return c.json({error:'Not found.'},404);const supplied=c.req.header('x-bootstrap-secret')||'';if(!timingSafeEqualStr(supplied,services.bootstrapSecret))return c.json({error:'Não autorizado.'},401);const exists=await services.db.prepare(`SELECT id FROM users WHERE role='superadmin' LIMIT 1`).first();if(exists)return c.json({error:'Bootstrap encerrado: já existe conta Super-Admin.'},409);const schema=z.object({name:z.string().min(2).max(120),email:z.email(),password:z.string().min(16).max(200)});const parsed=schema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:parsed.error.issues[0]?.message||'Dados inválidos.'},400);try{const time=new Date().toISOString();await services.db.prepare(`INSERT INTO users(id,tenant_id,name,email,password_hash,role,is_active,created_at,updated_at) VALUES(?,NULL,?,?,?,'superadmin',1,?,?)`).bind(generateId(),parsed.data.name,parsed.data.email.toLowerCase(),await hashPassword(parsed.data.password),time,time).run();return c.json({created:true,email:parsed.data.email.toLowerCase(),instruction:'Remova imediatamente BOOTSTRAP_SECRET do ambiente após esta resposta.'},201);}catch{return c.json({error:'Bootstrap não concluído; uma conta Super-Admin pode ter sido criada simultaneamente.'},409);}});

 app.route('/api/auth',authRoutes);
 app.route('/api/store',publicStoreRoutes);
 app.route('/api/admin',adminRoutes);
 app.route('/api/crm/v1',crmRoutes);
 app.route('/api/superadmin',superAdminRoutes);
 app.route('/api/printing/device',printingDeviceRoutes);
 // Endpoint fixo para todos os Androids; apenas releases assinadas entram no canal.
 app.get('/api/printing/android-update',async(c)=>{
  try{
   const release=await latestAndroidUpdate();
   c.header('Cache-Control','public, max-age=60');
   return c.json(release);
  }catch{
   return c.json({error:'Não foi possível consultar atualizações agora. Tente novamente.'},503);
  }
 });
 app.post('/api/webhooks/evolution',async(c)=>{
  const secret=services.evolution.evolutionWebhookToken||'';
  const received=c.req.header('x-evolution-token')||'';
  if(!secret||!timingSafeEqualStr(received,secret))
    return c.json({error:'Webhook não autorizado.'},401);
  const body=await c.req.json().catch(()=>({}));
  const instanceName=String(body.instance||body.instanceName||body.data?.instance?.instanceName||'');
  if(!instanceName)return c.json({error:'Instância ausente.'},400);
  const inst=await services.db.prepare('SELECT tenant_id FROM whatsapp_instances WHERE instance_name=?')
    .bind(instanceName).first<{tenant_id:string}>();
  if(!inst)return c.json({error:'Instância não encontrada.'},404);
  const event=String(body.event||'').toLowerCase().replace(/[.\s-]/g,'_');
  const data=body.data||{},time=new Date().toISOString();
  if(event.includes('qrcode')){
    const qr=await normalizeEvolutionQrImage(data);
    const code=String(data.qrcode?.code||data.code||'')||null;
    await services.db.prepare(`UPDATE whatsapp_instances
      SET status='qr_pending',qr_code_base64=?,qr_code_text=?,qr_updated_at=?,
      updated_at=?,provider_mode='evolution_live' WHERE tenant_id=?`)
      .bind(qr,code,time,time,inst.tenant_id).run();
  }else if(event.includes('connection')){
    const state=String(data.state||data.instance?.state||data.connection||'').toLowerCase();
    if(state==='open'){
      const phone=String(data.owner||data.ownerJid||data.instance?.ownerJid||'').split('@')[0];
      await services.db.prepare(`UPDATE whatsapp_instances
        SET status='connected',connected_phone=COALESCE(?,connected_phone),
        qr_code_base64=NULL,qr_code_text=NULL,connected_at=COALESCE(connected_at,?),
        last_checked_at=?,last_error=NULL,provider_mode='evolution_live',updated_at=?
        WHERE tenant_id=?`)
        .bind(phone?normalizePhoneBR(phone):null,time,time,time,inst.tenant_id).run();
    }else if(['close','closed','disconnected'].includes(state)){
      if(await recordWhatsAppDisconnection(services.db,inst.tenant_id,'webhook'))
        await processPendingTelegramAlerts(services.db,services.evolution).catch(()=>undefined);
    }
  }
  return c.json({received:true});
});
 app.get('/media/*',async(c)=>{const key=c.req.path.replace(/^\/media\//,'');if(key.includes('..'))return c.text('Invalid key',400);const obj=await services.media.getObject(key);if(!obj)return c.notFound();return new Response(obj.bytes.buffer as ArrayBuffer,{headers:{'Content-Type':obj.contentType,'Cache-Control':'public, max-age=86400'}});});
 app.onError((err,c)=>{console.error('Unhandled API error',err);return c.json({error:services.appEnv==='production'?'Erro interno do servidor.':err.message},500);});
 return app;
}
