// Google Calendar integration for Skill 5 (Go-Live Timeline).
//
// Per-SE OAuth 2.0 + Calendar API freebusy.query against (a) a shared
// engineering calendar configured via ENGINEERING_CALENDAR_ID, and
// (b) the SE's own primary calendar. The result is normalized into a
// compact context object that Skill 5 ingests to flag timeline risks
// (holiday weeks, low engineering capacity, SE meeting density) around
// form.targetGoLiveDate.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

export const DEFAULT_GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const REFRESH_SKEW_MS = 60 * 1000;
// Window around the go-live date that Skill 5 cares about.
const WINDOW_DAYS_BEFORE = 14;
const WINDOW_DAYS_AFTER = 7;

export function isGoogleOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function getGoogleScopes() {
  return process.env.GOOGLE_OAUTH_SCOPES || DEFAULT_GOOGLE_SCOPES;
}

export function getEngineeringCalendarId() {
  return process.env.ENGINEERING_CALENDAR_ID?.trim() || null;
}

// Derive the callback URL from the incoming request so OAuth works on
// every Vercel alias and on localhost without a separate env var per env.
export function getGoogleRedirectUri(req) {
  return new URL('/api/auth/google/callback', req.url).toString();
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Google token exchange failed', res.status, body);
    return null;
  }
  return await res.json();
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Google token refresh failed', res.status, body);
    return null;
  }
  return await res.json();
}

export async function fetchGoogleIdentity(accessToken) {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    return { email: me.email || null, name: me.name || null };
  } catch {
    return null;
  }
}

export function buildSessionFromTokenResponse(token, identity) {
  const now = Date.now();
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: now + (Number(token.expires_in) || 3600) * 1000,
    scope: token.scope || getGoogleScopes(),
    identity: identity ? { email: identity.email, name: identity.name } : null,
  };
}

export async function ensureFreshGoogleSession(session) {
  if (!session?.access_token) return { session: null, refreshedSession: null };
  const expiresAt = Number(session.expires_at) || 0;
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return { session, refreshedSession: null };
  }
  if (!session.refresh_token) return { session: null, refreshedSession: null };

  const refreshed = await refreshAccessToken(session.refresh_token);
  if (!refreshed?.access_token) return { session: null, refreshedSession: null };

  const now = Date.now();
  const next = {
    ...session,
    access_token: refreshed.access_token,
    // Google may not re-issue a refresh token on refresh — keep the old one.
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: now + (Number(refreshed.expires_in) || 3600) * 1000,
  };
  return { session: next, refreshedSession: next };
}

// --- Calendar reads ---

function clampDate(d) {
  // Trim to second precision; Google's freebusy endpoint accepts RFC3339
  // but is strict about format.
  return new Date(d).toISOString().split('.')[0] + 'Z';
}

function windowAround(targetDate) {
  const base = targetDate ? new Date(targetDate) : new Date();
  const start = new Date(base);
  start.setUTCDate(start.getUTCDate() - WINDOW_DAYS_BEFORE);
  const end = new Date(base);
  end.setUTCDate(end.getUTCDate() + WINDOW_DAYS_AFTER);
  return { timeMin: clampDate(start), timeMax: clampDate(end) };
}

// Sums the total busy minutes across all returned windows. Cheap enough
// signal for Skill 5 — exact meeting count is less useful than density.
function summarizeBusyMinutes(busyArr) {
  if (!Array.isArray(busyArr) || busyArr.length === 0) {
    return { busy_count: 0, total_busy_minutes: 0 };
  }
  let totalMs = 0;
  for (const window of busyArr) {
    const s = new Date(window.start).getTime();
    const e = new Date(window.end).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) totalMs += e - s;
  }
  return {
    busy_count: busyArr.length,
    total_busy_minutes: Math.round(totalMs / 60000),
  };
}

async function queryFreebusy(accessToken, calendarIds, timeMin, timeMax) {
  const res = await fetch(FREEBUSY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google freebusy.query failed (${res.status}): ${body}`);
  }
  return await res.json();
}

// Returns Skill 5's calendar context object, or null if no data is
// reachable. Two calendars queried in one request:
//   - 'primary' → the SE's own calendar (meeting density)
//   - ENGINEERING_CALENDAR_ID → the shared eng team calendar (capacity)
export async function fetchCalendarContext(session, form) {
  if (!session?.access_token) return null;

  const engId = getEngineeringCalendarId();
  const calendars = ['primary'];
  if (engId) calendars.push(engId);

  const { timeMin, timeMax } = windowAround(form?.targetGoLiveDate);

  let data;
  try {
    data = await queryFreebusy(session.access_token, calendars, timeMin, timeMax);
  } catch (err) {
    console.error('Google freebusy fetch failed', err?.message || err);
    return null;
  }

  const cals = data?.calendars || {};
  const primary = cals['primary']?.busy || [];
  const eng = engId ? cals[engId]?.busy || [] : [];

  return {
    window: { start: timeMin, end: timeMax },
    target_go_live_date: form?.targetGoLiveDate || null,
    se_calendar: summarizeBusyMinutes(primary),
    engineering_calendar: engId
      ? { calendar_id: engId, ...summarizeBusyMinutes(eng) }
      : null,
    source: 'google_calendar',
  };
}
