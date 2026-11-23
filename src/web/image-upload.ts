/** Conversão local para imagens seguras que podem ser exibidas na vitrine.
 * Usa o decodificador do navegador (PNG/JPEG/WebP/AVIF/GIF/BMP/SVG e HEIC
 * quando o navegador suportar) e salva um WebP estático no R2.
 */
export const MAX_ORIGINAL_IMAGE_BYTES=20*1024*1024;
export const MAX_UPLOADED_IMAGE_BYTES=5*1024*1024;
export const IMAGE_ACCEPT='image/*,.heic,.heif';

export function isImageUploadCandidate(file:Pick<File,'name'|'type'|'size'>):boolean{
 const extension=file.name.split('.').pop()?.toLowerCase()||'';
 const imageExtensions=new Set(['png','jpg','jpeg','webp','gif','avif','bmp','svg','heic','heif']);
 const claimedImage=file.type.toLowerCase().startsWith('image/');
 return file.size>0&&file.size<=MAX_ORIGINAL_IMAGE_BYTES&&
   (imageExtensions.has(extension)||claimedImage);
}
export async function prepareBrandImage(file:File,kind:'logo'|'banner'):Promise<string>{
 if(!isImageUploadCandidate(file)){
   throw new Error('Escolha uma imagem de até 20 MB (PNG, JPG, WebP, GIF, AVIF ou outra compatível com seu aparelho).');
 }
 const objectUrl=URL.createObjectURL(file);
 const image=new Image();
 try{
   let loadTimer:number|undefined;
   const loaded=new Promise<void>((resolve,reject)=>{
     image.onload=()=>resolve();
     image.onerror=()=>reject(new Error('O navegador não conseguiu abrir essa imagem. Converta-a para PNG ou JPG e tente novamente.'));
     loadTimer=window.setTimeout(()=>reject(new Error('A preparação da imagem demorou mais de 30 segundos. Tente uma imagem JPG ou PNG menor.')),30000);
   });
   image.src=objectUrl;
   try{await loaded;}finally{if(loadTimer!==undefined)window.clearTimeout(loadTimer);}
   if(!image.naturalWidth||!image.naturalHeight)throw new Error('Imagem sem dimensões válidas.');
   const maxEdge=kind==='logo'?1200:2600;
   const fit=Math.min(1,maxEdge/Math.max(image.naturalWidth,image.naturalHeight));
   let width=Math.max(1,Math.round(image.naturalWidth*fit));
   let height=Math.max(1,Math.round(image.naturalHeight*fit));
   let quality=.9;
   for(let attempt=0;attempt<7;attempt++){
     const canvas=document.createElement('canvas');
     canvas.width=width;canvas.height=height;
     const ctx=canvas.getContext('2d');
     if(!ctx)throw new Error('Seu navegador não disponibilizou o processamento da imagem.');
     ctx.imageSmoothingEnabled=true;
     ctx.imageSmoothingQuality='high';
     try{ctx.drawImage(image,0,0,width,height);}
     catch{throw new Error('Não foi possível converter esta imagem. Experimente PNG, JPG ou WebP.');}
     let data=canvas.toDataURL('image/webp',quality);
     // Caso o navegador não suporte saída WebP, usar PNG em formato seguro.
     if(!data.startsWith('data:image/webp;base64,'))data=canvas.toDataURL('image/png');
     const estimatedBytes=Math.floor((data.length-data.indexOf(',')-1)*.75);
     if(estimatedBytes<=MAX_UPLOADED_IMAGE_BYTES)return data;
     width=Math.max(1,Math.round(width*.78));
     height=Math.max(1,Math.round(height*.78));
     quality=Math.max(.6,quality-.065);
   }
   throw new Error('A imagem continua muito grande. Escolha uma imagem mais leve.');
 }finally{
   image.src='';
   URL.revokeObjectURL(objectUrl);
 }
}
