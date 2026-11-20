import {createApp} from './server/app';
import {CloudflareD1Adapter} from './server/db/cloudflare-d1';
import {createCloudflareR2Storage} from './server/storage/r2-media';
import {processPendingWhatsAppQueue,type EvolutionEnvConfig} from './server/services/evolution-whatsapp';

interface Env {
 DB:D1Database; MEDIA_BUCKET:R2Bucket; ASSETS:Fetcher;
 JWT_SECRET:string; CRM_API_KEY:string; BOOTSTRAP_SECRET?:string; CRM_WEBHOOK_URL?:string; CRM_WEBHOOK_SECRET?:string;
 EVOLUTION_API_URL?:string; EVOLUTION_API_KEY?:string; PUBLIC_APP_URL?:string; EVOLUTION_WEBHOOK_TOKEN?:string;
 APP_ENV?:string;
}
const servicesFor=(env:Env,origin?:string)=>({db:new CloudflareD1Adapter(env.DB),media:createCloudflareR2Storage(env.MEDIA_BUCKET),jwtSecret:env.JWT_SECRET,bootstrapSecret:env.BOOTSTRAP_SECRET,crmApiKey:env.CRM_API_KEY||'',crmWebhookUrl:env.CRM_WEBHOOK_URL,crmWebhookSecret:env.CRM_WEBHOOK_SECRET,appEnv:env.APP_ENV||'production',evolution:{evolutionApiUrl:env.EVOLUTION_API_URL,evolutionApiKey:env.EVOLUTION_API_KEY,publicWebhookUrl:env.PUBLIC_APP_URL||origin,evolutionWebhookToken:env.EVOLUTION_WEBHOOK_TOKEN} as EvolutionEnvConfig});
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return createApp(servicesFor(env,url.origin)).fetch(request,env,ctx);
  return env.ASSETS.fetch(request);
 },
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){const services=servicesFor(env);ctx.waitUntil(processPendingWhatsAppQueue(services.db,services.evolution,50));}
};
