export const runtime = 'nodejs';

import { getCurrentSE, isSupabaseAuthConfigured } from '@/lib/server/supabaseAuth';

export async function GET(req) {
  if (!isSupabaseAuthConfigured()) {
    return Response.json({ signedIn: false, authConfigured: false });
  }
  const se = await getCurrentSE(req);
  if (!se) {
    return Response.json({ signedIn: false, authConfigured: true });
  }
  return Response.json({
    signedIn: true,
    authConfigured: true,
    email: se.email,
    mmpPlatform: se.mmpPlatform,
  });
}
