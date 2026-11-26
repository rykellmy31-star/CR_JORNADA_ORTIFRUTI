import {Hono} from 'hono';
import {type AppHonoEnv,requireSuperAdmin,logAudit} from '../context';
import {generateId,hashPassword} from '../security/crypto';
import {ensureTenantWhatsAppSetup} from '../services/evolution-whatsapp';
import {DomainProvisionError,domainAutoConfigured,preflightStoreDomain,provisionStoreDomain} from '../services/cloudflare-domains';
import {isValidStoreSubdomain,HORTIFRUTI_ADMIN_URL,storeHomeUrl} from '../../shared/store-domain';

export const superAdminRoutes=new Hono<AppHonoEnv>();
superAdminRoutes.use('*',requireSuperAdmin);

type StoreDomainRow={
 tenant_id:string;
 hostname:string;
 status:'registered'|'pending'|'conflict'|'manual';
 domain_id:string|null;
 activate_on_success:number;
 last_error:string|null;
 updated_at:string;
};

async function ensurePizzeriaCategories(db:any,tenantId:string,time:string){
 const defaults=[['Pizzas','pizzas','🍕'],['Lanches','lanches','🍔'],['Bebidas','bebidas','🥤'],['Porções','porcoes','🍟'],['Combos','combos','🎁']];
 await db.batch(defaults.map(([name,slug,icon],index)=>db.prepare(`INSERT INTO categories(id,tenant_id,name,slug,icon,sort_order,is_active,created_at)
  SELECT ?,?,?,?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM categories WHERE tenant_id=? AND slug=?)`).bind(generateId(),tenantId,name,slug,icon,index,time,tenantId,slug)));
}

const domainInfo=(row:{domain_status:string|null;hostname:string|null})=>({
 domainStatus:row.domain_status||'manual',
 hostname:row.hostname||null
});

superAdminRoutes.get('/dashboard',async(c)=>{
 const db=c.get('services').db;
 const [tenants,orders]=await Promise.all([
  db.prepare(`SELECT COUNT(*) total,
   SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
   SUM(CASE WHEN status!='active' THEN 1 ELSE 0 END) blocked FROM tenants`).all(),
  db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(total_cents),0) sales
   FROM orders WHERE deleted_at IS NULL AND date(created_at)=date('now','localtime')
   AND status!='cancelled'`).all()
 ]);
 return c.json({tenants:tenants.results[0],today:orders.results[0]});
});

superAdminRoutes.get('/tenants',async(c)=>{
 const q=c.req.query('q')||'';
 const {results}=await c.get('services').db.prepare(`
  SELECT t.id,t.crm_external_id,t.slug,t.name,t.status,t.plan,t.created_at,t.sale_modes_json,
   (SELECT name FROM users WHERE tenant_id=t.id AND role='owner' ORDER BY created_at LIMIT 1) owner_name,
   (SELECT email FROM users WHERE tenant_id=t.id AND role='owner' ORDER BY created_at LIMIT 1) owner_email,
   COUNT(DISTINCT u.id) users,COUNT(DISTINCT o.id) orders,
   d.status AS domain_status,d.hostname
  FROM tenants t
  LEFT JOIN users u ON u.tenant_id=t.id
  LEFT JOIN orders o ON o.tenant_id=t.id AND o.deleted_at IS NULL
  LEFT JOIN tenant_store_domains d ON d.tenant_id=t.id
  WHERE t.is_archived=0 AND (?='' OR t.name LIKE '%'||?||'%' OR t.slug LIKE '%'||?||'%')
  GROUP BY t.id ORDER BY t.created_at DESC`
 ).bind(q,q,q).all<any>();
 return c.json({tenants:results.map(row=>({...row,saleModes:JSON.parse(row.sale_modes_json||'["weight","unit","dual","variants","custom"]'),...domainInfo(row)}))});
});

/** Cadastro exclusivo no sistema CR Jornada Express (Worker legado). Nunca edita a zona de outro serviço.
 * Quando a Cloudflare está habilitada, confere domínio e DNS ANTES de criar dados.
 * Falha após a criação preserva o tenant em onboarding, sem anunciar vitrine ativa.
 */
superAdminRoutes.post('/tenants',async(c)=>{
 const db=c.get('services').db,services=c.get('services');
 const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||typeof body!=='object'||Array.isArray(body))
  return c.json({error:'Preencha os dados do estabelecimento.'},400);
 const name=typeof body.name==='string'?body.name.trim():'';
 const allowedModes=['weight','unit','dual','variants','custom','pizzeria'];
 const saleModes=Array.isArray(body.saleModes)?[...new Set(body.saleModes.filter(v=>typeof v==='string'&&allowedModes.includes(v)))]:allowedModes;
 if(!saleModes.length)return c.json({error:'Selecione ao menos uma modalidade de venda válida.'},400);
 const slug=typeof body.slug==='string'?body.slug.trim().toLowerCase():'';
 const ownerName=typeof body.ownerName==='string'?body.ownerName.trim():'';
 const ownerEmail=typeof body.ownerEmail==='string'?body.ownerEmail.trim().toLowerCase():'';
 if(name.length<2||name.length>160||ownerName.length<2||ownerName.length>160||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)||ownerEmail.length>160)
  return c.json({error:'Confira o nome e o e-mail do estabelecimento/proprietário.'},400);
 if(!isValidStoreSubdomain(slug))
  return c.json({error:'Subdomínio inválido ou reservado por outro serviço da CR Jornada.'},400);
 if(body.temporaryPassword!==undefined&&body.temporaryPassword!==''&&
    (typeof body.temporaryPassword!=='string'||body.temporaryPassword.length<12))
  return c.json({error:'A senha inicial deve ter no mínimo 12 caracteres.'},400);
 if(await db.prepare('SELECT id FROM tenants WHERE slug=?').bind(slug).first())
  return c.json({error:'Já existe uma loja cadastrada com esse subdomínio.'},409);
 if(await db.prepare('SELECT id FROM users WHERE lower(email)=?').bind(ownerEmail).first())
  return c.json({error:'Este e-mail já está em uso em outro estabelecimento.'},409);

 const cf=services.cloudflareDomains||{};
 const shouldProvision=cf.enabled===true;
 if(shouldProvision){
  // A verificação evita criar a conta se o hostname já estiver em DNS/Worker de outro projeto.
  try{await preflightStoreDomain(cf,slug);}
  catch(err){
   if(err instanceof DomainProvisionError)
    return c.json({error:err.message,code:err.kind},err.kind==='conflict'?409:503);
   return c.json({error:'Não foi possível verificar a disponibilidade do domínio.'},503);
  }
 }
 const tenantId=generateId(),ownerId=generateId(),time=new Date().toISOString();
 const password=typeof body.temporaryPassword==='string'&&body.temporaryPassword
  ?body.temporaryPassword:`CRJ-${crypto.randomUUID()}-Tmp!`;
 const passwordHash=await hashPassword(password);
 const initialStatus=shouldProvision?'onboarding':'active';
 try{
  await db.batch([
   db.prepare(`INSERT INTO tenants(
    id,crm_external_id,slug,name,status,plan,
    banner_title,banner_subtitle,
    signup_popup_title,signup_popup_description,signup_popup_button,
    created_at,updated_at,sale_modes_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      tenantId,null,slug,name,initialStatus,'profissional',
      'Bem-vindo à nossa loja!','Confira nossos produtos e ofertas.',
      'Novidades e ofertas em primeira mão!',
      'Cadastre-se para conhecer as novidades e ofertas da nossa loja!',
      'Quero ficar por dentro!',
      time,time,JSON.stringify(saleModes)),
   db.prepare(`INSERT INTO users(id,tenant_id,name,email,phone,password_hash,role,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'owner',1,?,?)`).bind(ownerId,tenantId,ownerName,ownerEmail,null,passwordHash,time,time),
   db.prepare(`INSERT INTO tenant_store_domains
    (tenant_id,hostname,status,domain_id,activate_on_success,last_error,updated_at)
    VALUES(?,?,?,?,?,?,?)`).bind(tenantId,slug+'.crjornada.com',
      shouldProvision?'pending':'manual',null,shouldProvision?1:0,
      shouldProvision?null:'Automação ainda não ativada na Cloudflare.',time)
  ]);
  if(saleModes.includes('pizzeria'))await ensurePizzeriaCategories(db,tenantId,time);
 }catch{
  return c.json({error:'Não foi possível criar a loja. Verifique se o e-mail ou subdomínio já existem.'},409);
 }
 let domainStatus:'registered'|'pending'|'manual'=shouldProvision?'pending':'manual';
 if(shouldProvision&&domainAutoConfigured(cf)){
  try{
   const domain=await provisionStoreDomain(cf,slug);
   await db.batch([
    db.prepare(`UPDATE tenant_store_domains SET status='registered',
     domain_id=?,activate_on_success=0,last_error=NULL,updated_at=? WHERE tenant_id=?`)
     .bind(domain.domainId,new Date().toISOString(),tenantId),
    db.prepare(`UPDATE tenants SET status='active',updated_at=? WHERE id=? AND status='onboarding'`)
     .bind(new Date().toISOString(),tenantId)
   ]);
   domainStatus='registered';
  }catch(err){
   const kind=err instanceof DomainProvisionError?err.kind:'unavailable';
   const status=kind==='conflict'?'conflict':'pending';
   await db.prepare('UPDATE tenant_store_domains SET status=?,last_error=?,updated_at=? WHERE tenant_id=?')
    .bind(status,'Não foi possível confirmar o domínio na Cloudflare.',
      new Date().toISOString(),tenantId).run();
   domainStatus='pending';
  }
 }
 // Mantém a integração existente do WhatsApp deste Worker (sem migrar instâncias).
 await ensureTenantWhatsAppSetup(db,tenantId,slug,services.evolution).catch(()=>undefined);
 await logAudit(db,{actorUserId:c.get('authUser').sub,actorRole:'superadmin',
  action:'superadmin.tenant_created',entityType:'tenant',entityId:tenantId,
  details:{slug,domainStatus}});
 return c.json({
  tenantId,slug,name,ownerEmail,temporaryPassword:password,
  adminUrl:HORTIFRUTI_ADMIN_URL,storeUrl:storeHomeUrl(slug),
  domainStatus,domainMessage:domainStatus==='registered'
   ?'Subdomínio registrado na Cloudflare. A emissão de HTTPS pode levar algum tempo.'
   :domainStatus==='manual'
    ?'Loja criada. A automação Cloudflare ainda está desativada; o link público pode não funcionar.'
    :'Loja criada em implantação. O domínio ainda não foi confirmado; use Tentar novamente no Super Admin.'
 },201);
});


/** Atualiza dados do estabelecimento e modalidades comerciais habilitadas. */
superAdminRoutes.patch('/tenants/:id',async(c)=>{
 const db=c.get('services').db,id=c.req.param('id'),b=await c.req.json().catch(()=>null);
 if(!b)return c.json({error:'Informe os dados para atualizar.'},400);
 const name=String(b.name||'').trim(),ownerName=String(b.ownerName||'').trim(),ownerEmail=String(b.ownerEmail||'').trim().toLowerCase();
 const allowed=['weight','unit','dual','variants','custom','pizzeria'];
 const modes=Array.isArray(b.saleModes)?[...new Set(b.saleModes.filter((v:string)=>allowed.includes(v)))]:[];
 if(name.length<2||name.length>160||ownerName.length<2||ownerName.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)||!modes.length)
  return c.json({error:'Confira os dados do estabelecimento e selecione ao menos uma modalidade.'},400);
 const tenant=await db.prepare('SELECT id FROM tenants WHERE id=? AND is_archived=0').bind(id).first();
 if(!tenant)return c.json({error:'Estabelecimento não encontrado.'},404);
 const owner=await db.prepare("SELECT id FROM users WHERE tenant_id=? AND role='owner' ORDER BY created_at LIMIT 1").bind(id).first<{id:string}>();
 if(!owner)return c.json({error:'Proprietário não encontrado.'},409);
 if(await db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').bind(ownerEmail,owner.id).first())return c.json({error:'Este e-mail já está em uso.'},409);
 const now=new Date().toISOString();
 await db.batch([
  db.prepare('UPDATE tenants SET name=?,sale_modes_json=?,updated_at=? WHERE id=?').bind(name,JSON.stringify(modes),now,id),
  db.prepare('UPDATE users SET name=?,email=?,updated_at=? WHERE id=? AND tenant_id=?').bind(ownerName,ownerEmail,now,owner.id,id)
 ]);
 if(modes.includes('pizzeria'))await ensurePizzeriaCategories(db,id,now);
 await logAudit(db,{actorUserId:c.get('authUser').sub,actorRole:'superadmin',action:'superadmin.tenant_updated',entityType:'tenant',entityId:id,details:{saleModes:modes}});
 return c.json({success:true});
});

/** Arquiva em vez de apagar fisicamente: bloqueia acesso e preserva histórico e pedidos. */
superAdminRoutes.delete('/tenants/:id',async(c)=>{
 const db=c.get('services').db,id=c.req.param('id'),now=new Date().toISOString();
 const r=await db.prepare("UPDATE tenants SET is_archived=1,status='blocked',blocked_reason='Estabelecimento arquivado pelo Super Admin',updated_at=? WHERE id=? AND is_archived=0").bind(now,id).run();
 if(!r.meta.changes)return c.json({error:'Estabelecimento não encontrado ou já arquivado.'},404);
 await logAudit(db,{actorUserId:c.get('authUser').sub,actorRole:'superadmin',action:'superadmin.tenant_archived',entityType:'tenant',entityId:id,details:{preservedData:true}});
 return c.json({success:true,message:'Estabelecimento arquivado; pedidos, clientes e histórico foram preservados.'});
});

/** O botão de retry nunca altera ou remove domínios de outros Workers. */
superAdminRoutes.post('/tenants/:id/domain/retry',async(c)=>{
 const db=c.get('services').db,cf=c.get('services').cloudflareDomains||{};
 const tenant=await db.prepare('SELECT id,slug,status FROM tenants WHERE id=?')
  .bind(c.req.param('id')).first<{id:string;slug:string;status:string}>();
 if(!tenant)return c.json({error:'Estabelecimento não encontrado.'},404);
 const existing=await db.prepare('SELECT * FROM tenant_store_domains WHERE tenant_id=?')
  .bind(tenant.id).first<StoreDomainRow>();
 if(existing?.status==='registered')
  return c.json({success:true,domainStatus:'registered',storeUrl:storeHomeUrl(tenant.slug)});
 if(!domainAutoConfigured(cf))
  return c.json({error:'Ative e configure a integração com a Cloudflare no Worker antes de tentar novamente.'},503);
 try{
  const domain=await provisionStoreDomain(cf,tenant.slug);
  const time=new Date().toISOString();
  await db.batch([
   db.prepare(`INSERT INTO tenant_store_domains
    (tenant_id,hostname,status,domain_id,activate_on_success,last_error,updated_at)
    VALUES(?,?,'registered',?,0,NULL,?)
    ON CONFLICT(tenant_id) DO UPDATE SET
     status='registered',domain_id=excluded.domain_id,
     activate_on_success=0,last_error=NULL,updated_at=excluded.updated_at`)
    .bind(tenant.id,domain.hostname,domain.domainId,time),
   db.prepare(`UPDATE tenants SET status='active',updated_at=?
    WHERE id=? AND status='onboarding' AND ?=1`)
    .bind(time,tenant.id,existing?.activate_on_success===1?1:0)
  ]);
  await logAudit(db,{actorUserId:c.get('authUser').sub,actorRole:'superadmin',
   action:'superadmin.store_domain_registered',entityType:'tenant',entityId:tenant.id,
   details:{slug:tenant.slug}});
  return c.json({success:true,domainStatus:'registered',storeUrl:storeHomeUrl(tenant.slug),
   message:'Domínio registrado. Confirme o certificado HTTPS antes de divulgar.'});
 }catch(err){
  const kind=err instanceof DomainProvisionError?err.kind:'unavailable';
  const status=kind==='conflict'?'conflict':'pending';
  if(existing){
   await db.prepare('UPDATE tenant_store_domains SET status=?,last_error=?,updated_at=? WHERE tenant_id=?')
    .bind(status,'O domínio não foi confirmado na Cloudflare.',new Date().toISOString(),tenant.id).run();
  }
  return c.json({error:err instanceof DomainProvisionError?err.message:
    'A Cloudflare não confirmou o domínio.',domainStatus:status},kind==='conflict'?409:502);
 }
});

superAdminRoutes.patch('/tenants/:id/status',async(c)=>{
 const db=c.get('services').db,id=c.req.param('id'),b=await c.req.json();
 if(!['active','blocked','suspended','onboarding'].includes(b.status))
  return c.json({error:'Status inválido.'},400);
 const reason=b.status==='active'?null:String(b.reason||'Bloqueado pela CR Jornada');
 const r=await db.prepare('UPDATE tenants SET status=?,blocked_reason=?,updated_at=? WHERE id=?')
  .bind(b.status,reason,new Date().toISOString(),id).run();
 return c.json({success:r.meta.changes>0});
});
superAdminRoutes.get('/audit',async(c)=>{
 const {results}=await c.get('services').db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all();
 return c.json({logs:results});
});
