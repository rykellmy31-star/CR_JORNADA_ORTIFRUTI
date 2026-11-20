import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { SqliteD1Adapter } from './db/sqlite-local';
import { createLocalMediaStorage } from './storage/local-media';
import { seedDatabase } from './seed';
import type { EvolutionEnvConfig } from './services/evolution-whatsapp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function loadLocalEnv(){
 const p=path.join(root,'.env');if(!fs.existsSync(p))return;
 for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
}
loadLocalEnv();
const dbPath=process.env.DATABASE_PATH||path.join(root,'data/local.sqlite');
const db=new SqliteD1Adapter(dbPath);db.execMigrations(path.join(root,'migrations'));
const media=createLocalMediaStorage(path.join(root,'data/media'));
if(process.env.APP_ENV==='production'&&(!process.env.JWT_SECRET||!process.env.CRM_API_KEY))throw new Error('JWT_SECRET e CRM_API_KEY são obrigatórios em produção.');
const services={db,media,jwtSecret:process.env.JWT_SECRET||'local-development-only-change-this-secret-please',bootstrapSecret:process.env.BOOTSTRAP_SECRET,crmApiKey:process.env.CRM_API_KEY||'local-crm-key-not-for-production',crmWebhookUrl:process.env.CRM_WEBHOOK_URL,crmWebhookSecret:process.env.CRM_WEBHOOK_SECRET,appEnv:process.env.APP_ENV||'development',evolution:{evolutionApiUrl:process.env.EVOLUTION_API_URL,evolutionApiKey:process.env.EVOLUTION_API_KEY,publicWebhookUrl:process.env.PUBLIC_APP_URL,evolutionWebhookToken:process.env.EVOLUTION_WEBHOOK_TOKEN} as EvolutionEnvConfig};
if(process.env.APP_ENV!=='production')await seedDatabase(db,process.env);
const app=createApp(services);
const port=Number(process.env.PORT||8787);
serve({fetch:async(request)=>{
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return app.fetch(request);
 const publicDir=path.join(root,'dist/public');
 let relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
 let target=path.resolve(publicDir,relative||'index.html');
 if(!target.startsWith(publicDir))return new Response('Forbidden',{status:403});
 try{if(fs.statSync(target).isDirectory())target=path.join(target,'index.html');}catch{target=path.join(publicDir,'index.html');}
 try{const bytes=fs.readFileSync(target);const ext=path.extname(target);const types:any={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2'};return new Response(bytes,{headers:{'Content-Type':types[ext]||'application/octet-stream'}});}catch{return new Response('Frontend not built yet. Run npm run build:web.',{status:503});}
},port,hostname:'0.0.0.0'});
console.log(`CR Jornada Hortifruti running on http://0.0.0.0:${port}`);
