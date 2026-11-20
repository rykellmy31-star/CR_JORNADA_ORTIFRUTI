/**
 * Abstração de Armazenamento de Imagens (Cloudflare R2 + Fallback Local em Disco)
 * Isolamento estrito por empresa: chaves prefixadas por `tenants/{tenantId}/...`
 */

export interface MediaStorageAdapter {
  putObject(
    key: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<{ key: string; publicUrl: string }>;
  getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const ALLOWED_MIME_TYPES: Record<string,string>={
 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png',
 'image/webp':'webp','image/gif':'gif','image/avif':'avif','image/bmp':'bmp'
};
/** A extensão e o Content-Type nunca bastam para identificar uma imagem. */
export function hasImageSignature(contentType:string,bytes:Uint8Array):boolean{
 const is=(...b:number[])=>b.every((n,i)=>bytes[i]===n);
 const letters=(start:number,text:string)=>
   [...text].every((char,i)=>bytes[start+i]===char.charCodeAt(0));
 switch(contentType){
  case 'image/jpeg':case 'image/jpg':return is(0xff,0xd8,0xff);
  case 'image/png':return is(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  case 'image/webp':return letters(0,'RIFF')&&letters(8,'WEBP');
  case 'image/gif':return letters(0,'GIF87a')||letters(0,'GIF89a');
  case 'image/bmp':return letters(0,'BM');
  case 'image/avif':return letters(4,'ftyp')&&
   (letters(8,'avif')||letters(8,'avis'));
  default:return false;
 }
}
export function parseDataUriImage(dataUri:string):{
 bytes:Uint8Array;contentType:string;extension:string;
}{
 if(dataUri.length>8*1024*1024)throw new Error('Imagem muito grande. Limite: 5 MB após conversão.');
 const match=dataUri.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
 if(!match)throw new Error('Envie uma imagem válida em PNG, JPG, WebP, GIF, AVIF ou BMP.');
 const contentType=match[1].toLowerCase();
 const extension=ALLOWED_MIME_TYPES[contentType];
 if(!extension)throw new Error('Formato não permitido. Envie PNG, JPG, WebP, GIF, AVIF ou BMP; outros formatos podem ser convertidos no painel.');
 let binary:string;
 try{binary=atob(match[2]);}
 catch{throw new Error('Arquivo de imagem inválido ou corrompido.');}
 if(!binary.length||binary.length>5*1024*1024)
   throw new Error('A imagem deve ter no máximo 5 MB após conversão.');
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 if(!hasImageSignature(contentType,bytes))
   throw new Error('O arquivo informado não contém uma imagem válida no formato selecionado.');
 return {bytes,contentType:contentType==='image/jpg'?'image/jpeg':contentType,extension};
}

/**
 * Adaptador nativo para Cloudflare R2 Bucket (`env.MEDIA_BUCKET`)
 */
export function createCloudflareR2Storage(bucket: R2Bucket): MediaStorageAdapter {
  return {
    async putObject(key: string, bytes: Uint8Array, contentType: string) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      });
      return {
        key,
        publicUrl: `/media/${key}`,
      };
    },
    async getObject(key: string) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const arrayBuffer = await obj.arrayBuffer();
      return {
        bytes: new Uint8Array(arrayBuffer),
        contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      };
    },
  };
}
