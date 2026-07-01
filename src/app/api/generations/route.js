export const runtime = 'nodejs';

import {
  saveGeneration,
  listRecentGenerations,
} from '@/lib/server/generations';

export async function POST(req) {
  try {
    const body = await req.json();
    const { form, documents } = body || {};
    if (!form || !documents) {
      return Response.json(
        { error: 'form and documents are required' },
        { status: 400 }
      );
    }
    // Guard: only save if all three docs are non-empty. Prevents half-
    // finished pipelines from cluttering the recent list.
    if (
      typeof documents.runbook !== 'string' ||
      typeof documents.faq !== 'string' ||
      typeof documents.checklist !== 'string' ||
      !documents.runbook.trim() ||
      !documents.faq.trim() ||
      !documents.checklist.trim()
    ) {
      return Response.json(
        { error: 'all three documents (runbook, faq, checklist) must be present' },
        { status: 400 }
      );
    }

    const saved = await saveGeneration({ form, documents });
    if (!saved) {
      return Response.json(
        { error: 'save failed — Supabase not configured or write rejected' },
        { status: 500 }
      );
    }
    return Response.json(saved);
  } catch (err) {
    console.error('POST /api/generations error', err);
    return Response.json(
      { error: 'save failed', detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const rows = await listRecentGenerations();
    return Response.json({ generations: rows });
  } catch (err) {
    console.error('GET /api/generations error', err);
    return Response.json(
      { error: 'list failed', detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}
