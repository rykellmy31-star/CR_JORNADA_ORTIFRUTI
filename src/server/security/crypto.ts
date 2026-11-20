/**
 * Utilitários criptográficos baseados exclusivamente na Web Crypto API (`crypto.subtle`),
 * 100% compatíveis com Cloudflare Workers Runtime e Node.js 20+ sem dependências C++.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Comparação em tempo constante para prevenir timing attacks.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    let dummy = 0;
    for (let i = 0; i < aBytes.length; i++) {
      dummy |= aBytes[i] ^ aBytes[i];
    }
    return dummy === 1 && false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BYTES * 8
  );
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  const saltHex = bytesToHex(salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = hexToBytes(parts[2]);
    const expectedHex = parts[3];

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      KEY_BYTES * 8
    );
    const actualHex = bytesToHex(new Uint8Array(derivedBits));
    return timingSafeEqualStr(actualHex, expectedHex);
  } catch {
    return false;
  }
}

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  role: 'superadmin' | 'owner' | 'manager' | 'operator';
  tenantId: string | null;
  iat: number;
  exp: number;
}

export async function signJwt(
  payload: Omit<JwtClaims, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number = 60 * 60 * 12 // 12h
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtClaims = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigEncoded = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${sigEncoded}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerEncoded, payloadEncoded, sigEncoded] = parts;
    const signingInput = `${headerEncoded}.${payloadEncoded}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlDecodeToBytes(sigEncoded);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as BufferSource,
      new TextEncoder().encode(signingInput)
    );
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecodeToBytes(payloadEncoded));
    const claims = JSON.parse(payloadJson) as JwtClaims;
    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}
