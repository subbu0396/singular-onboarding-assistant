// Supabase Auth server helpers. Handles the OAuth callback cookie plumbing
// via @supabase/ssr, plus a couple of convenience wrappers for reading the
// current user in an App-Router route handler or a Pages-Router SSR call.
//
// Two client shapes we use:
//   - createRouteHandlerClient(req): reads cookies from the incoming NextRequest,
//     used inside src/app/api/*/route.js handlers.
//   - createServiceRoleClient(): bypasses RLS. Used for the profile upsert
//     on first sign-in (needs to write a row before RLS lets the user in)
//     and for anonymous /share/[token] lookups.

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { mmpForEmail } from './mmpAllowlist';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export function isSupabaseAuthConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Route-handler client scoped to the incoming request. Reads / writes the
 * auth cookies via @supabase/ssr's abstraction so refresh-token rotation
 * lands correctly on the response.
 *
 * Pass a `res` (NextResponse) if you need cookies to be written back — for
 * pure reads (getUser) you can skip it.
 */
export function createRouteHandlerClient(req, res = null) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        if (!res) return;
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });
}

export function createServiceRoleClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Get the current signed-in SE (Supabase user + profile row) or null.
 * The profile row carries mmp_platform, which we surface in the UI.
 */
export async function getCurrentSE(req) {
  if (!isSupabaseAuthConfigured()) return null;
  const supabase = createRouteHandlerClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceRoleClient();
  if (!service) return { userId: user.id, email: user.email, mmpPlatform: null };
  const { data: profile } = await service
    .from('profiles')
    .select('mmp_platform, email')
    .eq('id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email,
    mmpPlatform: profile?.mmp_platform || mmpForEmail(user.email),
  };
}

/**
 * Upsert the profile row for a freshly-signed-in user. Called from the OAuth
 * callback after we validate the email domain against MMP_DOMAIN_ALLOWLIST.
 * Uses the service-role client so it can write before RLS admits the user.
 */
export async function upsertProfileForUser(user) {
  const service = createServiceRoleClient();
  if (!service) throw new Error('Supabase service role not configured');
  const mmp = mmpForEmail(user.email);
  if (!mmp) throw new Error(`Email ${user.email} is not on the MMP allowlist`);

  const { error } = await service
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email: user.email,
        mmp_platform: mmp,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  if (error) throw new Error(`Profile upsert failed: ${error.message}`);
  return { mmpPlatform: mmp };
}
