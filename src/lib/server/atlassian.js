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
  const now = Date.now();
  const primary = resources?.[0] || null;
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    issued_at: now,
    expires_at: now + (Number(token.expires_in) || 3600) * 1000,
    scope: token.scope || getOAuthScopes(),
    cloud_id: primary?.id || null,
    site_url: primary?.url || null,
    identity,
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
    issued_at: now,
    expires_at: now + (Number(refreshed.expires_in) || 3600) * 1000,
    scope: refreshed.scope || session.scope,
  };
  return { session: next, refreshedSession: next };
}

function confluenceApiBase(cloudId) {
  return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function resolveCloudId(session) {
  if (session?.cloud_id) return session.cloud_id;
  const resources = await fetchAccessibleResources(session.access_token);
  return resources?.[0]?.id || null;
}

/** Derive 1-3 Confluence search queries from the form's tech-environment slice. */
export function deriveConfluenceQueries(form) {
  const queries = [];
  const platform = form.targetMmp || 'MMP';

  if (form.backendLanguage) {
    queries.push(`${form.backendLanguage} ${platform} SDK`);
  }
  if (form.dataExportMethods?.includes('Snowflake')) {
    queries.push('Snowflake export landing schema');
  } else if (form.dataExportMethods?.length) {
    queries.push(`${form.dataExportMethods[0]} data export integration`);
  }
  if (form.usesCdp && form.cdpName) {
    queries.push(`${form.cdpName} CDP coexistence`);
  } else if (form.authMethod) {
    queries.push(`${form.authMethod} postback authentication`);
  }

  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  return unique.slice(0, 3);
}

export async function searchConfluence(session, cloudId, query, limit = 3) {
  const cql = `text ~ "${query.replace(/"/g, '\\"')}" AND type=page`;
  const url = `${confluenceApiBase(cloudId)}/search?cql=${encodeURIComponent(cql)}&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Confluence search failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.results || []).map((hit) => ({
    id: hit.content?.id || hit.id,
    title: hit.content?.title || hit.title || 'Untitled',
    excerpt: stripHtml(hit.excerpt || hit.content?.excerpt || ''),
  }));
}

export async function fetchConfluencePage(session, cloudId, pageId) {
  const url = `${confluenceApiBase(cloudId)}/content/${pageId}?expand=body.storage`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Confluence page fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const page = await res.json();
  const raw = page.body?.storage?.value || '';
  const text = stripHtml(raw);
  return {
    id: page.id,
    title: page.title || 'Untitled',
    excerpt: text.slice(0, 2500),
  };
}

// Skill 4 REST path — we call Confluence directly instead of Anthropic's MCP
// connector, which can hang 60s+ on Atlassian's cold MCP handshake.
export async function buildConfluenceContextForSkill4(session, form, emitTool) {
  const cloudId = await resolveCloudId(session);
  if (!cloudId) {
    throw new Error('No Atlassian cloud_id available for Confluence API');
  }

  const queries = deriveConfluenceQueries(form);
  const seenPageIds = new Set();
  const pages = [];

  for (const query of queries) {
    const toolName = 'searchConfluence';
    emitTool?.('start', toolName, { query });
    try {
      const hits = await searchConfluence(session, cloudId, query, 2);
      emitTool?.('complete', toolName, { ok: true });

      for (const hit of hits) {
        if (!hit.id || seenPageIds.has(hit.id)) continue;
        seenPageIds.add(hit.id);

        const fetchTool = 'getConfluencePage';
        emitTool?.('start', fetchTool, { pageId: hit.id, title: hit.title });
        try {
          const page = await fetchConfluencePage(session, cloudId, hit.id);
          pages.push(page);
          emitTool?.('complete', fetchTool, { ok: true });
        } catch (err) {
          emitTool?.('complete', fetchTool, {
            ok: false,
            message: err?.message || 'Page fetch failed',
          });
          if (hit.excerpt) {
            pages.push({ id: hit.id, title: hit.title, excerpt: hit.excerpt.slice(0, 1500) });
          }
        }

        if (pages.length >= 2) break;
      }
    } catch (err) {
      emitTool?.('complete', toolName, {
        ok: false,
        message: err?.message || 'Search failed',
      });
    }

    if (pages.length >= 2) break;
  }

  return { cloudId, queries, pages, searched: queries.length > 0 };
}

export function useMcpConnector() {
  return process.env.ATLASSIAN_USE_MCP_CONNECTOR === 'true';
}
