export const runtime = 'nodejs';

import { getGenerationByShareToken } from '@/lib/server/generations';

export async function GET(_req, { params }) {
  try {
    const { token } = await params;
    const gen = await getGenerationByShareToken(token);
    if (!gen) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    if (gen.expired) {
      return Response.json({ error: 'expired' }, { status: 410 });
    }
    // Never leak the share_token back — only the docs + client context.
    return Response.json({
      id: gen.id,
      client_name: gen.client_name,
      target_mmp: gen.target_mmp,
      form_snapshot: gen.form_snapshot,
      documents: gen.documents,
      created_at: gen.created_at,
      share_expires_at: gen.share_expires_at,
    });
  } catch (err) {
    console.error('GET /api/share/[token] error', err);
    return Response.json(
      { error: 'lookup failed', detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}
