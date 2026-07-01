export const runtime = 'nodejs';

import { getGenerationById } from '@/lib/server/generations';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const gen = await getGenerationById(id);
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
