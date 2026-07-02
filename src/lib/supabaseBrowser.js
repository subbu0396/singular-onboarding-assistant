// Browser-side Supabase client. Used by the SignInGate to kick off the
// Google OAuth flow and by UserChip to sign out.
//
// Reads the public URL + anon key that Next.js exposes to the client bundle
// via the NEXT_PUBLIC_ prefix. Never import service-role secrets here.

import { createBrowserClient } from '@supabase/ssr';

let singleton = null;

export function getSupabaseBrowserClient() {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  singleton = createBrowserClient(url, anon);
  return singleton;
}
