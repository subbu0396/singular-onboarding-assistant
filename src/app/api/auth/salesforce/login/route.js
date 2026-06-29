export const runtime = 'edge';

import {
  buildStateCookie,
  generateRandomState,
} from '@/lib/server/session';

const DEFAULT_LOGIN_HOST = 'https://login.salesforce.com';

export async function GET(req) {
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
  const authUrl = new URL(`${loginHost}/services/oauth2/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'api refresh_token id');
  authUrl.searchParams.set('prompt', 'login');

  const stateCookie = await buildStateCookie(state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': stateCookie,
    },
  });
}
