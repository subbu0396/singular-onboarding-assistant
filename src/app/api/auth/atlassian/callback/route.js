export const runtime = 'edge';

import { cookies } from 'next/headers';
import {
  ATL_SESSION_COOKIE_NAME,
  ATL_STATE_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  encryptSessionPayload,
  readAtlassianStateCookie,
} from '@/lib/server/session';
import {
  buildSessionFromTokenResponse,
  exchangeCodeForToken,
  fetchAccessibleResources,
  fetchIdentity,
  getAtlassianRedirectUri,
  isAtlassianOAuthConfigured,
} from '@/lib/server/atlassian';

async function clearOAuthStateCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ATL_STATE_COOKIE_NAME);
}

async function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('atl_error', message);
  return errorRedirectWithCleanup(url);
}

async function errorRedirectWithCleanup(url) {
  await clearOAuthStateCookie();
  return Response.redirect(url.toString(), 302);
}

async function handleCallback(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return await errorRedirect(req, `atlassian_${oauthError}`);
  if (!code || !state) return await errorRedirect(req, 'missing_code_or_state');

  const expectedState = await readAtlassianStateCookie(req);
  if (!expectedState || expectedState !== state) {
    return await errorRedirect(req, 'state_mismatch');
  }

  if (!isAtlassianOAuthConfigured()) {
    return await errorRedirect(req, 'oauth_not_configured');
  }

  const redirectUri = getAtlassianRedirectUri(req);
  const token = await exchangeCodeForToken({ code, redirectUri });
  if (!token?.access_token) return await errorRedirect(req, 'token_exchange_failed');

  const [identity, resources] = await Promise.all([
    fetchIdentity(token.access_token),
    fetchAccessibleResources(token.access_token),
  ]);

  const sessionPayload = buildSessionFromTokenResponse(token, identity, resources);
  const sessionJwt = await encryptSessionPayload(sessionPayload);

  const cookieStore = await cookies();
  cookieStore.set(ATL_SESSION_COOKIE_NAME, sessionJwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: '/',
  });
  cookieStore.delete(ATL_STATE_COOKIE_NAME);

  const home = new URL('/', req.url);
  home.searchParams.set('atl_connected', '1');
  return Response.redirect(home.toString(), 302);
}

export async function GET(req) {
  try {
    return await handleCallback(req);
  } catch (err) {
    console.error('Atlassian callback route error:', err);
    return Response.json(
      {
        error: 'Atlassian callback failed.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, OAuth app callback URL mismatch.',
      },
      { status: 500 }
    );
  }
}
