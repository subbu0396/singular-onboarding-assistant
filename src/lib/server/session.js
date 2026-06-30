// JWE-encrypted cookie sessions for per-SE OAuth tokens.
//
// Two providers share the same encryption + cookie machinery:
//   - Salesforce  → sf_session  / sf_oauth_state   (Phase 2)
//   - Atlassian   → atl_session / atl_oauth_state  (Phase 3 — Confluence MCP)
//
// Sessions are stored in a single httpOnly + sameSite=lax cookie encrypted
// with AES-256-GCM via jose. The server reads/writes them on the edge
// runtime; the browser never sees the plaintext tokens. Payload shape is
// provider-specific (Salesforce has instance_url; Atlassian has cloud_id).

import { EncryptJWT, jwtDecrypt, base64url } from 'jose';

const SF_SESSION_COOKIE = 'sf_session';
const SF_STATE_COOKIE = 'sf_oauth_state';
const ATL_SESSION_COOKIE = 'atl_session';
const ATL_STATE_COOKIE = 'atl_oauth_state';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

const ALG = 'dir';
const ENC = 'A256GCM';

let cachedKey = null;

function decodeBase64ToBytes(str) {
  // Accepts standard base64 (with +, /, padding) AND base64url (-, _, no padding).
  // Normalizes to standard base64 then uses atob, which is available in the
  // Edge runtime. Node's Buffer is NOT available in Edge — do not reach for it.
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeHexToBytes(str) {
  const bytes = new Uint8Array(str.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(str.substr(i * 2, 2), 16);
  }
  return bytes;
}

function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET env var is not configured. Generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` and add it to Vercel.'
    );
  }

  // Aggressive cleanup — strip all whitespace and surrounding quotes that
  // sometimes survive a Vercel env-var paste from a terminal.
  const cleaned = secret
    .replace(/\s+/g, '')
    .replace(/^['"`]+|['"`]+$/g, '');

  let keyBytes;
  let decodeError = null;

  // Try hex first if it looks like hex (handles `openssl rand -hex 32`).
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    try {
      keyBytes = decodeHexToBytes(cleaned);
    } catch (err) {
      decodeError = err;
    }
  }

  // Otherwise try base64 / base64url.
  if (!keyBytes) {
    try {
      keyBytes = decodeBase64ToBytes(cleaned);
    } catch (err) {
      decodeError = err;
    }
  }

  if (!keyBytes) {
    throw new Error(
      `SESSION_SECRET could not be decoded (raw length: ${secret.length}, cleaned length: ${cleaned.length}, error: ${decodeError?.message || decodeError}). Regenerate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" — paste the entire output with no quotes and no extra whitespace.`
    );
  }

  if (keyBytes.length !== 32) {
    throw new Error(
      `SESSION_SECRET must decode to exactly 32 bytes (got ${keyBytes.length} from raw length ${secret.length}, cleaned length ${cleaned.length}). Regenerate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
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

async function readCookieJwt(req, name) {
  const cookie = req.cookies?.get?.(name)?.value;
  if (!cookie) return null;
  try {
    return await decrypt(cookie);
  } catch {
    return null;
  }
}

async function buildSessionCookieFor(name, payload) {
  const jwt = await encrypt(payload, SESSION_MAX_AGE_SECONDS);
  return `${name}=${jwt}; ${cookieAttrs(SESSION_MAX_AGE_SECONDS)}`;
}

async function buildStateCookieFor(name, state) {
  const jwt = await encrypt({ state }, STATE_MAX_AGE_SECONDS);
  return `${name}=${jwt}; ${cookieAttrs(STATE_MAX_AGE_SECONDS)}`;
}

function buildClearCookieFor(name) {
  return `${name}=; ${cookieAttrs(0)}`;
}

// --- Salesforce session (Phase 2) ---

export function readSession(req) {
  return readCookieJwt(req, SF_SESSION_COOKIE);
}

export function buildSessionCookie(payload) {
  return buildSessionCookieFor(SF_SESSION_COOKIE, payload);
}

export function buildClearSessionCookie() {
  return buildClearCookieFor(SF_SESSION_COOKIE);
}

export function buildStateCookie(state) {
  return buildStateCookieFor(SF_STATE_COOKIE, state);
}

export async function readStateCookie(req) {
  const payload = await readCookieJwt(req, SF_STATE_COOKIE);
  return payload?.state || null;
}

export function buildClearStateCookie() {
  return buildClearCookieFor(SF_STATE_COOKIE);
}

// --- Atlassian session (Phase 3 — Confluence MCP) ---
//
// Payload shape:
//   {
//     access_token:   string,
//     refresh_token:  string | null,
//     expires_at:     number,   // unix ms — Atlassian access tokens expire in ~1h
//     issued_at:      number,
//     scope:          string,
//     cloud_id?:      string,   // for the SE's primary Atlassian site
//     site_url?:      string,   // human-readable site URL (informational)
//     identity?:      { name, email, account_id }
//   }

export function readAtlassianSession(req) {
  return readCookieJwt(req, ATL_SESSION_COOKIE);
}

export function buildAtlassianSessionCookie(payload) {
  return buildSessionCookieFor(ATL_SESSION_COOKIE, payload);
}

export function buildClearAtlassianSessionCookie() {
  return buildClearCookieFor(ATL_SESSION_COOKIE);
}

// Atlassian's MCP OAuth uses DCR + PKCE, so the state cookie has to carry
// more than just the CSRF state — it also holds the PKCE verifier and the
// per-login client_id minted by DCR. All three are needed on the callback.
export async function buildAtlassianStateCookie(payload) {
  // Accept either a plain state string (legacy) or a full {state, verifier,
  // client_id} object — the encrypt helper wraps either way.
  const obj = typeof payload === 'string' ? { state: payload } : payload;
  const jwt = await encrypt(obj, STATE_MAX_AGE_SECONDS);
  return `${ATL_STATE_COOKIE}=${jwt}; ${cookieAttrs(STATE_MAX_AGE_SECONDS)}`;
}

export async function readAtlassianStateCookie(req) {
  return await readCookieJwt(req, ATL_STATE_COOKIE);
}

export function buildClearAtlassianStateCookie() {
  return buildClearCookieFor(ATL_STATE_COOKIE);
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
