// Atlassian (Rovo) Remote MCP integration for Skill 4 (Technical Environment).
//
// We do not call the MCP server directly — Anthropic's mcp_servers connector
// handles the protocol. Our job is OAuth: hold the access token in a JWE
// cookie, refresh it when it's near expiry, and hand a fresh bearer token to
// the Messages API as { authorization_token } on each Skill 4 invocation.
//
// Confluence/Jira read scopes the demo asks for are env-configurable so a
// fork can broaden or narrow them without code changes.

const AUTH_HOST = 'https://auth.atlassian.com';
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const ME_URL = 'https://api.atlassian.com/me';

// Atlassian retired the /v1/sse endpoint on 30 June 2026 in favour of
// /v1/mcp/authv2. Env-overridable for future moves.
export const DEFAULT_ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v1/mcp/authv2';

// Default to a read-only Confluence scope set. Override with
// ATLASSIAN_OAUTH_SCOPES (space-separated) to broaden (e.g. add Jira).
export const DEFAULT_ATLASSIAN_SCOPES = [
  'read:confluence-content.summary',
  'read:confluence-content.all',
  'read:confluence-space.summary',
  'read:confluence-user',
  'search:confluence',
  'read:me',
  'offline_access',
].join(' ');

// Refresh access tokens this many ms before the stored expiry — covers clock
// skew and round-trip latency to Anthropic's MCP connector.
const REFRESH_SKEW_MS = 60 * 1000;

export function getMcpUrl() {
  return process.env.ATLASSIAN_MCP_URL || DEFAULT_ATLASSIAN_MCP_URL;
}

export function getOAuthScopes() {
  return process.env.ATLASSIAN_OAUTH_SCOPES || DEFAULT_ATLASSIAN_SCOPES;
}

export function isAtlassianOAuthConfigured() {
  return Boolean(
    process.env.ATLASSIAN_CLIENT_ID &&
      process.env.ATLASSIAN_CLIENT_SECRET &&
      process.env.ATLASSIAN_REDIRECT_URI
  );
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Atlassian token exchange failed', res.status, body);
    return null;
  }

  return await res.json();
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Atlassian token refresh failed', res.status, body);
    return null;
  }

  return await res.json();
}

// Fetches the SE's accessible Atlassian sites so we can record a primary
// cloud_id + site_url for the badge. Best-effort: if it fails the session
// still works; the MCP server will use the token's bound resources.
export async function fetchAccessibleResources(accessToken) {
  try {
    const res = await fetch(ACCESSIBLE_RESOURCES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchIdentity(accessToken) {
  try {
    const res = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    return {
      name: me.name || me.nickname || null,
      email: me.email || null,
      account_id: me.account_id || null,
    };
  } catch {
    return null;
  }
}

export function buildSessionFromTokenResponse(token, identity, resources) {
  // Keep this payload as small as possible — Atlassian access tokens are
  // ~1.5KB JWTs and refresh tokens add another ~500B; JWE encryption adds
  // ~33% overhead. The whole Set-Cookie value must stay under the ~4KB
  // browser limit or the cookie is silently dropped. Drop anything that's
  // not strictly needed for the MCP call, refresh, or the badge.
  const now = Date.now();
  const primary = resources?.[0] || null;
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: now + (Number(token.expires_in) || 3600) * 1000,
    // Trimmed identity — only the display name keeps the badge useful.
    identity_name: identity?.name || identity?.email || primary?.name || null,
  };
}

// Returns a session guaranteed to have a non-expired access token, refreshing
// once if the stored one is within REFRESH_SKEW_MS of expiry. Returns null if
// the session is missing/unrecoverable.
//
// Caller is responsible for rewriting the cookie when refreshedSession is set.
export async function ensureFreshAtlassianSession(session) {
  if (!session?.access_token) return { session: null, refreshedSession: null };

  const expiresAt = Number(session.expires_at) || 0;
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return { session, refreshedSession: null };
  }

  if (!session.refresh_token) {
    // Stale and no refresh token — surface as "not connected" so Skill 4 falls back.
    return { session: null, refreshedSession: null };
  }

  const refreshed = await refreshAccessToken(session.refresh_token);
  if (!refreshed?.access_token) {
    return { session: null, refreshedSession: null };
  }

  const now = Date.now();
  const next = {
    ...session,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: now + (Number(refreshed.expires_in) || 3600) * 1000,
  };
  return { session: next, refreshedSession: next };
}
