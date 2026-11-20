import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {
  buildTenantInstanceName,
  checkWhatsAppConnectionStatus,
  connectOrRefreshWhatsAppQr,
  dispatchQueuedMessageById,
  enqueueAndDispatchOrderWhatsAppNotification,
  getSanitizedWhatsAppStatus,
  normalizeEvolutionQrImage,
} from '../src/server/services/evolution-whatsapp';

let db:SqliteD1Adapter;
let tenantId:string;
const cfg={
  evolutionApiUrl:'https://evolution-teste.example',
  evolutionApiKey:'chave-apenas-de-teste-nao-real',
  publicWebhookUrl:'https://hortifruti-teste.example',
  evolutionWebhookToken:'webhook-apenas-de-teste',
};
const json=(value:any,code=200)=>new Response(JSON.stringify(value),{
  status:code,headers:{'content-type':'application/json'},
});
beforeEach(async()=>{
  db=new SqliteD1Adapter(':memory:');
  db.execMigrations('./migrations');
  await seedDatabase(db,{});
  tenantId=(await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>()).id;
});
afterEach(()=>{
  vi.unstubAllGlobals();
  db.sqlite.close();
});

describe('Evolution API real e QR por estabelecimento',()=>{
  it('bloqueia QR fictício e nunca marca envio como entregue sem credenciais reais',async()=>{
    const state=await getSanitizedWhatsAppStatus(db,tenantId,{});
    expect(state.configured).toBe(false);
    expect(state.status).toBe('disconnected');
    expect(state.qr_code_base64).toBeNull();
    await expect(connectOrRefreshWhatsAppQr(db,tenantId,'verde-vivo',{}))
      .rejects.toThrow(/não configurada/);
    const created=(await db.prepare('SELECT id FROM orders WHERE tenant_id=? LIMIT 1').bind(tenantId).first<any>()).id;
    const queued=await enqueueAndDispatchOrderWhatsAppNotification(db,tenantId,created,'order_accepted',{});
    expect(queued.queued).toBe(true);
    expect(queued.status).toBe('pending');
    const q=await db.prepare('SELECT status,attempts,sent_at FROM whatsapp_message_queue WHERE id=?').bind(queued.queueId).first<any>();
    expect(q).toMatchObject({status:'pending',attempts:0,sent_at:null});
  });

  it('cria uma instância própria, configura webhook privado e retorna imagem QR válida',async()=>{
    const calls:{url:string;opts:RequestInit}[]=[];
    const qrBase64='A'.repeat(100);
    vi.stubGlobal('fetch',vi.fn(async(input:string,opts:RequestInit={})=>{
      const url=String(input);calls.push({url,opts});
      if(url.includes('/instance/connect/'))return json({error:'not found'},404);
      if(url.endsWith('/instance/create'))return json({qrcode:{base64:qrBase64,code:'2@teste-seguro'}});
      if(url.includes('/webhook/set/'))return json({webhook:true});
      throw Error('Rota externa não esperada: '+url);
    }));
    const connection=await connectOrRefreshWhatsAppQr(db,tenantId,'verde-vivo',cfg);
    const ownName=buildTenantInstanceName('verde-vivo',tenantId);
    expect(connection.configured).toBe(true);
    expect(connection.status).toBe('qr_pending');
    expect(connection.qr_code_base64).toBe('data:image/png;base64,'+qrBase64);
    expect(connection.instance_name).toBe(ownName);
    expect(calls.find(x=>x.url.endsWith('/instance/create'))).toBeTruthy();
    const webhook=calls.find(x=>x.url.includes('/webhook/set/'));
    expect(webhook).toBeTruthy();
    const body=JSON.parse(String(webhook!.opts.body));
    expect(body.webhook.url).toBe('https://hortifruti-teste.example/api/webhooks/evolution');
    expect(body.webhook.headers['x-evolution-token']).toBe(cfg.evolutionWebhookToken);
    expect(connection).not.toHaveProperty('apikey');
    expect(JSON.stringify(connection)).not.toContain(cfg.evolutionApiKey);
    const other=(await db.prepare("SELECT id FROM tenants WHERE slug='sabor-da-terra'").first<any>()).id;
    const untouched=await db.prepare('SELECT status FROM whatsapp_instances WHERE tenant_id=?').bind(other).first<any>();
    expect(untouched.status).toBe('disconnected');
  });

  it('sincroniza QR e status aberto por webhook com token e nome de instância',async()=>{
    const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
    const app=createApp({db,media,jwtSecret:'test-secret'.repeat(4),crmApiKey:'test',appEnv:'production',evolution:cfg});
    const ownName=buildTenantInstanceName('verde-vivo',tenantId);
    const endpoint='http://local/api/webhooks/evolution';
    const post=(token:string,data:any)=>app.fetch(new Request(endpoint,{method:'POST',
      headers:{'content-type':'application/json','x-evolution-token':token},body:JSON.stringify(data)}));
    expect((await post('chave-errada',{instance:ownName,event:'connection.update',data:{state:'open'}})).status).toBe(401);
    expect((await post(cfg.evolutionWebhookToken,{instance:ownName,event:'qrcode.updated',data:{qrcode:{code:'2@teste'}}})).status).toBe(200);
    const pending=await getSanitizedWhatsAppStatus(db,tenantId,cfg);
    expect(pending.status).toBe('qr_pending');
    expect(pending.qr_code_base64).toMatch(/^data:image\/svg\+xml;base64,/);
    expect((await post(cfg.evolutionWebhookToken,{instance:ownName,event:'connection.update',data:{state:'open',owner:'5573999998888@s.whatsapp.net'}})).status).toBe(200);
    const online=await getSanitizedWhatsAppStatus(db,tenantId,cfg);
    expect(online.status).toBe('connected');
    expect(online.qr_code_base64).toBeNull();
    expect(online.connected_phone_raw).toBe('5573999998888');
    const otherName=buildTenantInstanceName('sabor-da-terra','tenant-verdurão-sabor-da-terra');
    expect((await post(cfg.evolutionWebhookToken,{instance:otherName+'-invalid',event:'connection.update',data:{state:'open'}})).status).toBe(404);
  });

  it('envia pelo endpoint real apenas após conexão e registra a tentativa',async()=>{
    await db.prepare("UPDATE whatsapp_instances SET status='connected' WHERE tenant_id=?").bind(tenantId).run();
    const requests:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:string,opts:RequestInit={})=>{
      const url=String(input);requests.push({url,headers:opts.headers,body:opts.body});
      if(url.includes('/message/sendText/'))return json({key:{id:'test-message-01'}});
      return json({instance:{state:'open'}});
    }));
    const order=(await db.prepare("SELECT id FROM orders WHERE tenant_id=? LIMIT 1").bind(tenantId).first<any>()).id;
    const result=await enqueueAndDispatchOrderWhatsAppNotification(db,tenantId,order,'order_accepted',cfg);
    expect(result.status).toBe('sent');
    const send=requests.find(r=>r.url.includes('/message/sendText/'));
    expect(send).toBeTruthy();
    const body=JSON.parse(String(send.body));
    expect(body.number).toMatch(/^55/);
    expect(body.text).toContain('pedido');
    expect(send.headers.apikey).toBe(cfg.evolutionApiKey);
    expect(send.url).toContain(encodeURIComponent(buildTenantInstanceName('verde-vivo',tenantId)));
    const message=await db.prepare('SELECT status,attempts,provider_message_id FROM whatsapp_message_queue WHERE id=?').bind(result.queueId).first<any>();
    expect(message).toMatchObject({status:'sent',attempts:1,provider_message_id:'test-message-01'});
    const duplicate=await enqueueAndDispatchOrderWhatsAppNotification(db,tenantId,order,'order_accepted',cfg);
    expect(duplicate.status).toContain('duplicate_prevented');
    expect(requests.filter(r=>r.url.includes('/message/sendText/'))).toHaveLength(1);
  });
});
