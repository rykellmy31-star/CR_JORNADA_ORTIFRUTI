import {z} from 'zod';
export const loyaltyConfigSchema=z.object({
 enabled:z.boolean(),minimumCents:z.number().int().min(1).max(100000000),
 goal:z.number().int().min(1).max(100),reward:z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
 showReward:z.boolean().default(true)
});
export type LoyaltyConfig=z.infer<typeof loyaltyConfigSchema>;
export const defaultLoyalty=():LoyaltyConfig=>({enabled:false,minimumCents:4000,goal:10,reward:'Prêmio fidelidade',showReward:true});
export function readLoyalty(raw:unknown):LoyaltyConfig{
 if(!raw)return defaultLoyalty();
 try{return loyaltyConfigSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);}catch{return defaultLoyalty();}
}
export function loyaltyGap(config:LoyaltyConfig,subtotalCents:number):number|null{
 if(!config.enabled)return null;
 return Math.max(0,config.minimumCents-subtotalCents);
}
