// Atlassian (Rovo) Remote MCP integration for Skill 4 (Technical Environment).
//
// The Atlassian Rovo MCP server uses OAuth 2.1 + Dynamic Client Registration
// (RFC 7591) + PKCE. It does NOT accept the standard OAuth 2.0 (3LO) bearer
// tokens issued by auth.atlassian.com — connection requests silently hang
// instead of returning a clean 401. So we run the MCP server's OWN OAuth
// flow: discover its endpoints, register a public client on the fly, redirect
// the SE through a PKCE-protected authorization, and exchange the code for
// an access token that's only valid against the MCP server.
//
// The discovery document at mcp.atlassian.com/.well-known/oauth-authorization-server
// is the source of truth — these constants match its current shape but are
// env-overridable in case Atlassian moves them.

import { base64url } from 'jose';

export const DEFAULT_ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v1/mcp';

const DEFAULTS = {
  authorization_endpoint: 'https://mcp.atlassian.com/v1/authorize',
  token_endpoint: 'https://cf.mcp.atlassian.com/v1/token',
  registration_endpoint: 'https://cf.mcp.atlassian.com/v1/register',
};

const REFRESH_SKEW_MS = 60 * 1000;

export function getMcpUrl() {
  return process.env.ATLASSIAN_MCP_URL || DEFAULT_ATLASSIAN_MCP_URL;
}

export function getAuthorizationEndpoint() {
  return process.env.ATLASSIAN_MCP_AUTHORIZATION_ENDPOINT || DEFAULTS.authorization_endpoint;
}

export function getTokenEndpoint() {
  return process.env.ATLASSIAN_MCP_TOKEN_ENDPOINT || DEFAULTS.token_endpoint;
}

export function getRegistrationEndpoint() {
  return process.env.ATLASSIAN_MCP_REGISTRATION_ENDPOINT || DEFAULTS.registration_endpoint;
}

export function isAtlassianOAuthConfigured() {
  // DCR means no client_id/secret env vars are required — the only
  // prerequisite is a redirect URI the MCP server can call back to.
  return Boolean(process.env.ATLASSIAN_REDIRECT_URI);
}

// --- PKCE helpers ---

function randomBytes(n) {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export async function generatePkcePair() {
  // RFC 7636 §4.1: 43-128 chars from [A-Z][a-z][0-9]-._~. base64url of 32
  // random bytes lands at 43 chars without padding and uses a valid alphabet.
  const verifier = base64url.encode(randomBytes(32));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url.encode(new Uint8Array(digest));
  return { verifier, challenge };
}

// --- Dynamic Client Registration (RFC 7591) ---
//
// Register a fresh public client per OAuth round-trip. The MCP server returns
// a client_id (and sometimes client_secret + registration_access_token); we
// only need client_id because we use token_endpoint_auth_method=none + PKCE.
//
// This burns one DCR call per Connect-Atlassian click. Atlassian's MCP server
// hasn't surfaced any DCR rate limits in practice; if that becomes a problem
// the right fix is a server-side cache of (redirect_uri → client_id), but
// edge functions don't have stable storage so we'd need Supabase for that.

export async function registerMcpClient(redirectUri) {
  const res = await fetch(getRegistrationEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'MMP Onboarding Assistant',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Atlassian MCP DCR failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  if (!data.client_id) {
    throw new Error('Atlassian MCP DCR response missing client_id');
  }
  return data;
}

// --- Token endpoints ---

export async function exchangeCodeForMcpToken({ code, redirectUri, clientId, codeVerifier }) {
  const res = await fetch(getTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Atlassian MCP token exchange failed (${res.status}): ${body}`);
  }

  return await res.json();
}

async function refreshMcpToken({ refreshToken, clientId }) {
  const res = await fetch(getTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Atlassian MCP refresh failed', res.status, body);
    return null;
  }

  return await res.json();
}

export function buildSessionFromTokenResponse(token, clientId) {
  // MCP tokens from Atlassian are opaque and short — fit comfortably in the
  // session cookie alongside refresh token and client_id.
  const now = Date.now();
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    client_id: clientId,
    expires_at: now + (Number(token.expires_in) || 3600) * 1000,
  };
}

// Returns { accessToken, refreshedSession? } — accessToken null if the
// session is missing or refresh failed. Caller rewrites the cookie when
// refreshedSession is non-null.
export async function getMcpAccessToken(session) {
  if (!session?.access_token) return { accessToken: null, refreshedSession: null };

  const expiresAt = Number(session.expires_at) || 0;
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return { accessToken: session.access_token, refreshedSession: null };
  }

  if (!session.refresh_token || !session.client_id) {
    return { accessToken: null, refreshedSession: null };
  }

  const refreshed = await refreshMcpToken({
    refreshToken: session.refresh_token,
    clientId: session.client_id,
  });
  if (!refreshed?.access_token) {
    return { accessToken: null, refreshedSession: null };
  }

  const next = buildSessionFromTokenResponse(refreshed, session.client_id);
  // Atlassian may not return a new refresh token on every refresh — keep the
  // existing one if absent so the session stays usable past the next cycle.
  if (!next.refresh_token) next.refresh_token = session.refresh_token;
  return { accessToken: next.access_token, refreshedSession: next };
}
