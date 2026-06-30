export const runtime = 'edge';

import {
  buildAtlassianStateCookie,
  generateRandomState,
} from '@/lib/server/session';
import {
  generatePkcePair,
  getAuthorizationEndpoint,
  isAtlassianOAuthConfigured,
  registerMcpClient,
} from '@/lib/server/atlassian';

export async function GET() {
  try {
    if (!isAtlassianOAuthConfigured()) {
      return Response.json(
        {
          error:
            'Atlassian MCP OAuth is not configured. Set ATLASSIAN_REDIRECT_URI in Vercel.',
        },
        { status: 500 }
      );
    }

    const redirectUri = process.env.ATLASSIAN_REDIRECT_URI;

    // Dynamic Client Registration on every login — Atlassian's MCP server
    // requires DCR per RFC 7591, and edge functions don't have stable
    // server-side storage to cache the resulting client_id across requests.
    // One extra round-trip (~50ms) per Connect click is an acceptable cost.
    const client = await registerMcpClient(redirectUri);
    const { verifier, challenge } = await generatePkcePair();
    const state = generateRandomState();

    const stateCookie = await buildAtlassianStateCookie({
      state,
      verifier,
      client_id: client.client_id,
    });

    const authUrl = new URL(getAuthorizationEndpoint());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        'Set-Cookie': stateCookie,
      },
    });
  } catch (err) {
    console.error('Atlassian login route error:', err);
    return Response.json(
      {
        error: 'Atlassian login failed before redirect.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, ATLASSIAN_REDIRECT_URI missing for this deployment environment, Atlassian MCP DCR endpoint unreachable.',
      },
      { status: 500 }
    );
  }
}
