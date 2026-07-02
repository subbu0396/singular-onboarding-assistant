export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import {
  createRouteHandlerClient,
  upsertProfileForUser,
  isSupabaseAuthConfigured,
} from '@/lib/server/supabaseAuth';
import { mmpForEmail } from '@/lib/server/mmpAllowlist';

// Supabase Auth Google OAuth callback. The browser gets redirected here
// with ?code=... after Google accepts the sign-in. We exchange the code
// for a session, validate the email domain against the MMP allowlist,
// upsert the profile, then bounce the SE to the home page.
export async function GET(req) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(new URL('/?auth_error=not_configured', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  if (!code) {
    return NextResponse.redirect(new URL('/?auth_error=missing_code', req.url));
  }

  const res = NextResponse.redirect(new URL(next, req.url));
  const supabase = createRouteHandlerClient(req, res);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    console.error('exchangeCodeForSession failed', error);
    return NextResponse.redirect(new URL('/?auth_error=exchange_failed', req.url));
  }

  // Reject before the session is trusted for anything else: sign the user
  // straight back out and redirect to a rejection screen.
  const mmp = mmpForEmail(data.user.email);
  if (!mmp) {
    await supabase.auth.signOut();
    const domain = (data.user.email || '').split('@')[1] || 'unknown';
    return NextResponse.redirect(
      new URL(`/?auth_error=domain_not_allowed&domain=${encodeURIComponent(domain)}`, req.url)
    );
  }

  try {
    await upsertProfileForUser(data.user);
  } catch (err) {
    console.error('profile upsert failed', err);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/?auth_error=profile_failed', req.url));
  }

  return res;
}
