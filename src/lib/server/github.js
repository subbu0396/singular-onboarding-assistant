// GitHub integration for Skill 2 (Mobile SDK Setup).
//
// Per-SE OAuth + a small toolkit Claude calls as a tool-using agent:
// search the SE's accessible repos for ones matching the client name,
// then pull the SDK manifests (package.json, Podfile, build.gradle,
// pubspec.yaml) from the matching repo's default branch. The skill
// grounds its SDK-setup analysis in what the client actually has
// installed today (e.g. "currently on Adjust 4.32 — migration path
// requires SDK init swap and event-name remap") instead of writing
// generic platform defaults.

const AUTH_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

// Classic OAuth app scopes. `read:user` for the identity badge,
// `public_repo` so the search can hit any public repo (most client
// codebases for this demo will be public examples). Override with
// GITHUB_OAUTH_SCOPES if you need access to private repos — that
// requires the broader `repo` scope and a different OAuth approval.
export const DEFAULT_GITHUB_SCOPES = 'read:user public_repo';

const REFRESH_SKEW_MS = 60 * 1000;
// Limit how many manifest files we'll fetch per agent call so a single
// Skill 2 invocation can't fan out into 20+ GitHub API hits.
const MAX_MANIFESTS_PER_REPO = 4;

export function isGitHubOAuthConfigured() {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim()
  );
}

export function getGitHubScopes() {
  return process.env.GITHUB_OAUTH_SCOPES || DEFAULT_GITHUB_SCOPES;
}

export function getGitHubRedirectUri(req) {
  return new URL('/api/auth/github/callback', req.url).toString();
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('GitHub token exchange failed', res.status, body);
    return null;
  }
  return await res.json();
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('GitHub token refresh failed', res.status, body);
    return null;
  }
  return await res.json();
}

export async function fetchGitHubIdentity(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const me = await res.json();
    return {
      login: me.login || null,
      name: me.name || null,
      avatar_url: me.avatar_url || null,
    };
  } catch {
    return null;
  }
}

export function buildSessionFromTokenResponse(token, identity) {
  const now = Date.now();
  const session = {
    access_token: token.access_token,
    scope: token.scope || getGitHubScopes(),
    identity: identity || null,
  };
  // GitHub App user-to-server tokens are short-lived. Classic OAuth-app
  // tokens skip both of these — keep them out of the payload to keep
  // the cookie tiny in that case.
  if (token.refresh_token) session.refresh_token = token.refresh_token;
  if (token.expires_in) session.expires_at = now + Number(token.expires_in) * 1000;
  return session;
}

export async function ensureFreshGitHubSession(session) {
  if (!session?.access_token) return { session: null, refreshedSession: null };
  // Classic OAuth tokens have no expires_at — assume valid until proven
  // otherwise by a 401 on an API call.
  if (!session.expires_at) return { session, refreshedSession: null };
  if (session.expires_at - REFRESH_SKEW_MS > Date.now()) {
    return { session, refreshedSession: null };
  }
  if (!session.refresh_token) return { session: null, refreshedSession: null };

  const refreshed = await refreshAccessToken(session.refresh_token);
  if (!refreshed?.access_token) return { session: null, refreshedSession: null };

  const now = Date.now();
  const next = {
    ...session,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: refreshed.expires_in
      ? now + Number(refreshed.expires_in) * 1000
      : session.expires_at,
  };
  return { session: next, refreshedSession: next };
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// --- Skill 2 tool implementations ---

const MMP_VENDORS = [
  'singular',
  'appsflyer',
  'adjust',
  'branch',
  'kochava',
  'tenjin',
  'airbridge',
  'appmetrica',
  'firebase',
  'amplitude',
  'mparticle',
];

// Heuristic SDK-vendor sniff over a manifest file body. Returns an array
// of matched vendor names so Claude can call out the current MMP install
// without having to parse Podfiles or Gradle DSL itself.
function detectMmpVendors(body) {
  if (!body) return [];
  const lower = body.toLowerCase();
  return MMP_VENDORS.filter((v) => lower.includes(v));
}

const MANIFEST_PATHS = [
  // iOS native
  'Podfile',
  'Package.swift',
  // Android native
  'app/build.gradle',
  'app/build.gradle.kts',
  'build.gradle',
  // React Native / Node
  'package.json',
  // Flutter
  'pubspec.yaml',
  // Unity (manifest list in Packages/)
  'Packages/manifest.json',
];

export async function searchClientRepos(accessToken, { clientName, limit = 5 }) {
  if (!clientName) return { items: [] };
  // Search repos by the client name across everything the token can see —
  // GitHub's q= grammar handles ranking; we keep the top N.
  const q = encodeURIComponent(`${clientName} in:name,description,readme`);
  const url = `${API_BASE}/search/repositories?q=${q}&per_page=${Math.min(limit, 10)}`;
  const res = await fetch(url, { headers: authHeaders(accessToken) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub repo search failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    items: (data.items || []).map((r) => ({
      full_name: r.full_name,
      description: r.description || null,
      default_branch: r.default_branch || 'main',
      language: r.language || null,
      stargazers_count: r.stargazers_count || 0,
      url: r.html_url,
    })),
  };
}

async function fetchManifestFile(accessToken, fullName, path) {
  // GET /repos/{owner}/{repo}/contents/{path} returns base64-encoded content
  // for files. 404 is normal (most repos won't have every manifest type).
  const url = `${API_BASE}/repos/${fullName}/contents/${path}`;
  const res = await fetch(url, { headers: authHeaders(accessToken) });
  if (res.status === 404) return null;
  if (!res.ok) {
    return { path, error: `status ${res.status}` };
  }
  const data = await res.json();
  if (data.encoding !== 'base64' || !data.content) {
    return { path, error: 'unexpected encoding' };
  }
  // atob is available in both Edge and Node 18+. Manifests are small —
  // truncate aggressively so a giant generated lockfile can't blow the
  // model's context window.
  let decoded;
  try {
    decoded = atob(data.content.replace(/\s+/g, ''));
  } catch {
    return { path, error: 'base64 decode failed' };
  }
  const trimmed = decoded.length > 8000 ? decoded.slice(0, 8000) + '\n…[truncated]' : decoded;
  return {
    path,
    size: data.size || null,
    body: trimmed,
    detected_mmp_vendors: detectMmpVendors(decoded),
  };
}

export async function fetchRepoManifests(accessToken, { fullName }) {
  if (!fullName || !fullName.includes('/')) {
    throw new Error('fullName must be "owner/repo"');
  }
  const results = await Promise.all(
    MANIFEST_PATHS.slice(0, MAX_MANIFESTS_PER_REPO * 2).map((p) =>
      fetchManifestFile(accessToken, fullName, p).catch(() => null)
    )
  );
  const manifests = results.filter(Boolean).slice(0, MAX_MANIFESTS_PER_REPO);
  return {
    repo: fullName,
    manifests,
    detected_mmp_vendors: Array.from(
      new Set(manifests.flatMap((m) => m.detected_mmp_vendors || []))
    ),
  };
}
