export const runtime = 'edge';

import {
  buildClearStateCookie,
  buildSessionCookie,
  readStateCookie,
} from '@/lib/server/session';

const DEFAULT_LOGIN_HOST = 'https://login.salesforce.com';

function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('sf_error', message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': buildClearStateCookie(),
    },
  });
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return errorRedirect(req, `salesforce_${oauthError}`);
  }

  if (!code || !state) {
    return errorRedirect(req, 'missing_code_or_state');
  }

  const expectedState = await readStateCookie(req);
  if (!expectedState || expectedState !== state) {
    return errorRedirect(req, 'state_mismatch');
  }

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;
  const loginHost = process.env.SALESFORCE_LOGIN_HOST || DEFAULT_LOGIN_HOST;

  if (!clientId || !clientSecret || !redirectUri) {
    return errorRedirect(req, 'oauth_not_configured');
  }

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('redirect_uri', redirectUri);

  let tokenResponse;
  try {
    tokenResponse = await fetch(`${loginHost}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch {
    return errorRedirect(req, 'token_exchange_network');
  }

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => '');
    console.error('Salesforce token exchange failed', tokenResponse.status, body);
    return errorRedirect(req, `token_exchange_${tokenResponse.status}`);
  }

  const token = await tokenResponse.json();
  // Salesforce returns: access_token, refresh_token, instance_url, id, issued_at, signature, scope, token_type
  if (!token.access_token || !token.instance_url) {
    return errorRedirect(req, 'token_response_missing_fields');
  }

  // Try to extract identity for the UI badge (best effort).
  let identity = null;
  if (token.id) {
    try {
      const idRes = await fetch(token.id, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (idRes.ok) {
        const idJson = await idRes.json();
        identity = {
          name: idJson.display_name || idJson.username || null,
          email: idJson.email || null,
          user_id: idJson.user_id || null,
        };
      }
    } catch {
      // identity is optional — non-fatal
    }
  }

  const sessionPayload = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    instance_url: token.instance_url,
    issued_at: Number(token.issued_at) || Date.now(),
    identity,
  };

  const sessionCookie = await buildSessionCookie(sessionPayload);
  const clearStateCookie = buildClearStateCookie();

  const home = new URL('/', req.url);
  home.searchParams.set('sf_connected', '1');

  // Two Set-Cookie headers must be returned as separate header entries.
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearStateCookie);
  headers.set('Location', home.toString());

  return new Response(null, { status: 302, headers });
}
