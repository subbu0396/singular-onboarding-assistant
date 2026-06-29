// JWE-encrypted cookie session for per-SE Salesforce OAuth tokens.
//
// Sessions are stored in a single httpOnly + secure + sameSite=lax cookie
// encrypted with AES-256-GCM via jose. The server reads/writes them on the
// edge runtime; the browser never sees the plaintext tokens.
//
// Cookie shape (JWE payload):
//   {
//     access_token:   string,
//     refresh_token:  string,
//     instance_url:   string,   // e.g. https://yourname.develop.my.salesforce.com
//     issued_at:      number,   // unix ms
//     expires_at?:    number,   // unix ms — if known
//     identity?:      { name, email, user_id }
//   }
//
// Two cookies are used:
//   - SF_SESSION: long-lived (7 days), holds the encrypted tokens
//   - SF_OAUTH_STATE: short-lived (10 min), CSRF state for the OAuth round trip

import { EncryptJWT, jwtDecrypt, base64url } from 'jose';

const SESSION_COOKIE = 'sf_session';
const STATE_COOKIE = 'sf_oauth_state';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

const ALG = 'dir';
const ENC = 'A256GCM';

let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET env var is not configured. Generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` and add it to Vercel.'
    );
  }
  // Decode the base64 secret into a 32-byte key for A256GCM.
  let keyBytes;
  try {
    keyBytes = base64url.decode(secret);
  } catch {
    keyBytes = null;
  }
  if (!keyBytes || keyBytes.length !== 32) {
    // Try standard base64 too.
    const buf = Buffer.from(secret, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        `SESSION_SECRET must decode to exactly 32 bytes (got ${buf.length}). Generate with \`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\`.`
      );
    }
    keyBytes = new Uint8Array(buf);
  }
  cachedKey = keyBytes;
  return cachedKey;
}

async function encrypt(payload, maxAgeSeconds) {
  const key = getEncryptionKey();
  const now = Math.floor(Date.now() / 1000);
  return await new EncryptJWT(payload)
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .encrypt(key);
}

async function decrypt(jwt) {
  const key = getEncryptionKey();
  const { payload } = await jwtDecrypt(jwt, key);
  return payload;
}

function cookieAttrs(maxAgeSeconds) {
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

export async function readSession(req) {
  const cookie = req.cookies?.get?.(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    return await decrypt(cookie);
  } catch {
    return null;
  }
}

export async function buildSessionCookie(payload) {
  const jwt = await encrypt(payload, SESSION_MAX_AGE_SECONDS);
  return `${SESSION_COOKIE}=${jwt}; ${cookieAttrs(SESSION_MAX_AGE_SECONDS)}`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieAttrs(0)}`;
}

export async function buildStateCookie(state) {
  const jwt = await encrypt({ state }, STATE_MAX_AGE_SECONDS);
  return `${STATE_COOKIE}=${jwt}; ${cookieAttrs(STATE_MAX_AGE_SECONDS)}`;
}

export async function readStateCookie(req) {
  const cookie = req.cookies?.get?.(STATE_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const payload = await decrypt(cookie);
    return payload.state || null;
  } catch {
    return null;
  }
}

export function buildClearStateCookie() {
  return `${STATE_COOKIE}=; ${cookieAttrs(0)}`;
}

export function generateRandomState() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return base64url.encode(bytes);
}
