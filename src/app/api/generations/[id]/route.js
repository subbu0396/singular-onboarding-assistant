export const runtime = 'nodejs';

import { getGenerationById } from '@/lib/server/generations';
import { getCurrentSE, isSupabaseAuthConfigured } from '@/lib/server/supabaseAuth';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    let ownerId = null;
    if (isSupabaseAuthConfigured()) {
      const se = await getCurrentSE(req);
      if (!se) return Response.json({ error: 'not authenticated' }, { status: 401 });
      ownerId = se.userId;
    }
    // When auth is on, we scope the lookup to the SE's own rows so one
    // SE can't open another's generation by guessing the id.
    const gen = await getGenerationById(id, { ownerId });
    if (!gen) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    return Response.json(gen);
  } catch (err) {
    console.error('GET /api/generations/[id] error', err);
    return Response.json(
      { error: 'lookup failed', detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}
