import fs from 'node:fs';
import path from 'node:path';
import type { MediaStorageAdapter } from './r2-media';

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function createLocalMediaStorage(baseDir: string): MediaStorageAdapter {
  fs.mkdirSync(baseDir, { recursive: true });

  return {
    async putObject(key: string, bytes: Uint8Array, contentType: string) {
      const safeRel = key.replace(/\.\./g, '').replace(/^\/+/, '');
      const fullPath = path.join(baseDir, safeRel);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(bytes));
      fs.writeFileSync(`${fullPath}.meta.json`, JSON.stringify({ contentType }));
      return {
        key: safeRel,
        publicUrl: `/media/${safeRel}`,
      };
    },
    async getObject(key: string) {
      const safeRel = key.replace(/\.\./g, '').replace(/^\/+/, '');
      const fullPath = path.join(baseDir, safeRel);
      if (!fs.existsSync(fullPath)) return null;
      const buf = fs.readFileSync(fullPath);
      let contentType = EXT_TO_MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream';
      const metaPath = `${fullPath}.meta.json`;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { contentType?: string };
          if (meta.contentType) contentType = meta.contentType;
        } catch {
          // ignore
        }
      }
      return {
        bytes: new Uint8Array(buf),
        contentType,
      };
    },
  };
}
