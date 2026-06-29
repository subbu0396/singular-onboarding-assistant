export const runtime = 'edge';

import {
  buildStateCookie,
  generateRandomState,
} from '@/lib/server/session';

const DEFAULT_LOGIN_HOST = 'https://login.salesforce.com';

export async function GET(req) {
  try {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const redirectUri = process.env.SALESFORCE_REDIRECT_URI;
    const loginHost = process.env.SALESFORCE_LOGIN_HOST || DEFAULT_LOGIN_HOST;

    if (!clientId || !redirectUri) {
      return Response.json(
        {
          error:
            'Salesforce OAuth is not configured. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_REDIRECT_URI in Vercel.',
        },
        { status: 500 }
      );
    }

    const state = generateRandomState();
    const stateCookie = await buildStateCookie(state);

    const authUrl = new URL(`${loginHost}/services/oauth2/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'api refresh_token id');
    authUrl.searchParams.set('prompt', 'login');

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        'Set-Cookie': stateCookie,
      },
    });
  } catch (err) {
    console.error('Salesforce login route error:', err);
    return Response.json(
      {
        error: 'Salesforce login failed before redirect.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set, SESSION_SECRET not 32 bytes when base64-decoded, or env vars missing for this deployment environment (check Vercel Settings → Environment Variables and make sure the var is enabled for Production).',
      },
      { status: 500 }
    );
  }
}
