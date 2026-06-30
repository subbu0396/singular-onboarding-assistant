export const runtime = 'edge';

import {
  buildClearGoogleStateCookie,
  buildGoogleSessionCookie,
  readGoogleStateCookie,
} from '@/lib/server/session';
import {
  buildSessionFromTokenResponse,
  exchangeCodeForToken,
  fetchGoogleIdentity,
  getGoogleRedirectUri,
  isGoogleOAuthConfigured,
} from '@/lib/server/googleCalendar';

function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('google_error', message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': buildClearGoogleStateCookie(),
    },
  });
}

async function handleCallback(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return errorRedirect(req, `google_${oauthError}`);
  if (!code || !state) return errorRedirect(req, 'missing_code_or_state');

  const expectedState = await readGoogleStateCookie(req);
  if (!expectedState || expectedState !== state) {
    return errorRedirect(req, 'state_mismatch');
  }

  if (!isGoogleOAuthConfigured()) {
    return errorRedirect(req, 'oauth_not_configured');
  }

  const redirectUri = getGoogleRedirectUri(req);
  const token = await exchangeCodeForToken({ code, redirectUri });
  if (!token?.access_token) return errorRedirect(req, 'token_exchange_failed');

  const identity = await fetchGoogleIdentity(token.access_token);
  const sessionPayload = buildSessionFromTokenResponse(token, identity);
  const sessionCookie = await buildGoogleSessionCookie(sessionPayload);
  const clearStateCookie = buildClearGoogleStateCookie();

  const home = new URL('/', req.url);
  home.searchParams.set('google_connected', '1');

  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearStateCookie);
  headers.set('Location', home.toString());

  return new Response(null, { status: 302, headers });
}

export async function GET(req) {
  try {
    return await handleCallback(req);
  } catch (err) {
    console.error('Google callback route error:', err);
    return Response.json(
      {
        error: 'Google callback failed.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, OAuth client redirect URI mismatch.',
      },
      { status: 500 }
    );
  }
}
