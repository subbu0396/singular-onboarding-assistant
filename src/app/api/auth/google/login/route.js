export const runtime = 'edge';

import {
  buildGoogleStateCookie,
  generateRandomState,
} from '@/lib/server/session';
import {
  getGoogleRedirectUri,
  getGoogleScopes,
  isGoogleOAuthConfigured,
} from '@/lib/server/googleCalendar';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(req) {
  try {
    if (!isGoogleOAuthConfigured()) {
      return Response.json(
        {
          error:
            'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.',
        },
        { status: 500 }
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID.trim();
    const redirectUri = getGoogleRedirectUri(req);
    const state = generateRandomState();
    const stateCookie = await buildGoogleStateCookie(state);

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', getGoogleScopes());
    authUrl.searchParams.set('state', state);
    // access_type=offline + prompt=consent ensures Google issues a refresh
    // token on first consent AND on every reconnect (otherwise reconnects
    // silently skip the refresh-token leg and our sessions can't survive
    // past the first 1h expiry).
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        'Set-Cookie': stateCookie,
      },
    });
  } catch (err) {
    console.error('Google login route error:', err);
    return Response.json(
      {
        error: 'Google login failed before redirect.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, GOOGLE_* env vars missing for this deployment environment.',
      },
      { status: 500 }
    );
  }
}
