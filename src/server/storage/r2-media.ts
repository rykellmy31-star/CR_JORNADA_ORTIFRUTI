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

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function parseDataUriImage(dataUri: string): {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
} {
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Formato de imagem inválido. Envie uma imagem JPG, PNG ou WebP válida.');
  }
  const contentType = match[1].toLowerCase();
  const extension = ALLOWED_MIME_TYPES[contentType];
  if (!extension) {
    throw new Error(`Tipo de imagem não permitido (${contentType}). Use JPG, PNG ou WebP.`);
  }
  const binary = atob(match[2]);
  if (binary.length > 5 * 1024 * 1024) {
    throw new Error('A imagem excede o limite máximo de 5 MB.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, contentType, extension };
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
