import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {
  recordWhatsAppDisconnection,
  processPendingTelegramAlerts,
  monitorWhatsAppDisconnections
} from '../src/server/services/telegram-alerts';

let db:SqliteD1Adapter;
let tenantId:string,instanceName:string;
const cfg={
  evolutionApiUrl:'https://evolution.example',
  evolutionApiKey:'fake-test-api-key',
  evolutionWebhookToken:'test-webhook-key',
  telegramBotToken:'fake-telegram-test-token',
  telegramChatId:'-10012345'
};
const json=(value:any,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json'}
});
beforeEach(async()=>{
  db=new SqliteD1Adapter(':memory:');
  db.execMigrations('./migrations');
  await seedDatabase(db,{});
  const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'")
    .first<any>();
  tenantId=tenant.id;
  const inst=await db.prepare('SELECT instance_name FROM whatsapp_instances WHERE tenant_id=?')
    .bind(tenantId).first<any>();
  instanceName=inst.instance_name;
});
afterEach(()=>{vi.unstubAllGlobals();db?.close()});
const connect=()=>db.prepare(`UPDATE whatsapp_instances
  SET status='connected',connected_phone='5573999000111' WHERE tenant_id=?`).bind(tenantId).run();
const alerts=async()=> (await db.prepare('SELECT * FROM whatsapp_disconnect_alerts WHERE tenant_id=? ORDER BY created_at')
  .bind(tenantId).all<any>()).results;

describe('alertas Telegram de queda da Evolution',()=>{
 it('registra uma única desconexão real e mantém fila se Telegram não foi configurado',async()=>{
  expect(await recordWhatsAppDisconnection(db,tenantId,'webhook')).toBe(false);
  await connect();
  expect(await recordWhatsAppDisconnection(db,tenantId,'webhook')).toBe(true);
  expect(await recordWhatsAppDisconnection(db,tenantId,'webhook')).toBe(false);
  const queued=await alerts();
  expect(queued).toHaveLength(1);
  expect(queued[0].source).toBe('webhook');
  expect(queued[0].status).toBe('pending');
  expect(await processPendingTelegramAlerts(db,{})).toMatchObject({configured:false,sent:0});
  expect((await alerts())[0].status).toBe('pending');
 });
 it('notifica via Telegram, cita a loja e evita alerta duplicado',async()=>{
  await connect();
  await recordWhatsAppDisconnection(db,tenantId,'panel');
  const sent:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    expect(url).toContain('/sendMessage');
    const body=JSON.parse(String(init.body));
    expect(body.chat_id).toBe(cfg.telegramChatId);
    sent.push(body.text);
    return json({ok:true,result:{message_id:101}});
  }));
  expect(await processPendingTelegramAlerts(db,cfg)).toMatchObject({configured:true,sent:1});
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('Verde Vivo');
  expect(sent[0]).toContain('Desconexão pelo painel');
  expect((await alerts())[0].status).toBe('sent');
  expect((await processPendingTelegramAlerts(db,cfg)).sent).toBe(0);
 });
 it('recebe o webhook autenticado e alerta apenas na transição connected->close',async()=>{
  await connect();
  const calls:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    calls.push(JSON.parse(String(init.body)));
    return json({ok:true});
  }));
  const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
  const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',
    appEnv:'test',evolution:cfg});
  const post=(token:string)=>app.fetch(new Request('http://local/api/webhooks/evolution',{
    method:'POST',headers:{'content-type':'application/json','x-evolution-token':token},
    body:JSON.stringify({event:'connection.update',instance:instanceName,data:{state:'close'}})
  }));
  expect((await post('wrong-secret')).status).toBe(401);
  expect((await post(cfg.evolutionWebhookToken)).status).toBe(200);
  expect((await post(cfg.evolutionWebhookToken)).status).toBe(200);
  expect((await alerts())).toHaveLength(1);
  expect(calls).toHaveLength(1);
 });
 it('monitora instância desconectada sem confundir falhas HTTP com queda',async()=>{
  await connect();
  vi.stubGlobal('fetch',vi.fn(async()=>json({error:'offline'},503)));
  expect(await monitorWhatsAppDisconnections(db,cfg)).toBe(0);
  expect(await alerts()).toHaveLength(0);
  vi.stubGlobal('fetch',vi.fn(async()=>json({instance:{state:'close'}})));
  expect(await monitorWhatsAppDisconnections(db,cfg)).toBe(1);
  expect(await monitorWhatsAppDisconnections(db,cfg)).toBe(0);
  expect((await alerts())[0].source).toBe('monitor');
 });
 it('desconexão manual no painel agenda alerta e altera o status da loja',async()=>{
  await connect();
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit={})=>{
    const url=String(input);calls.push(url);
    if(url.includes('/instance/logout/'))return json({success:true});
    if(url.includes('api.telegram.org'))return json({ok:true});
    throw Error('unexpected external URL');
  }));
  const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
  const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',
    appEnv:'test',evolution:cfg});
  const login=await app.fetch(new Request('http://local/api/auth/login',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
  }));
  expect(login.status).toBe(200);
  const {token}=await login.json() as any;
  const response=await app.fetch(new Request('http://local/api/admin/whatsapp/disconnect',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:'{}'
  }));
  expect(response.status).toBe(200);
  const body:any=await response.json();
  expect(body.status).toBe('disconnected');
  expect(body.telegram_alerts_configured).toBe(true);
  expect((await alerts())[0].status).toBe('sent');
  expect(calls.some(url=>url.includes('api.telegram.org'))).toBe(true);
 });
});
