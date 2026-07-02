export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/server/supabaseAuth';

export async function POST(req) {
  const res = NextResponse.json({ ok: true });
  const supabase = createRouteHandlerClient(req, res);
  await supabase.auth.signOut();

  // Also clear the per-provider OAuth session cookies (SF, Atlassian,
  // Google-cal, GitHub) so the next SE who signs in on the same device
  // doesn't inherit the previous SE's integrations. Names come from
  // src/lib/server/session.js — kept explicit here to avoid a dependency
  // just to enumerate them.
  const staleCookies = [
    'sf_session',
    'atl_session',
    'google_session',
    'ms_session',
    'github_session',
    'sf_oauth_state',
    'atl_oauth_state',
    'google_oauth_state',
    'ms_oauth_state',
    'github_oauth_state',
  ];
  for (const name of staleCookies) {
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  // Chunked Atlassian cookies.
  for (let i = 0; i < 10; i++) {
    res.cookies.set(`atl_session_${i}`, '', { path: '/', maxAge: 0 });
  }
  res.cookies.set('atl_session_c', '', { path: '/', maxAge: 0 });

  return res;
}
