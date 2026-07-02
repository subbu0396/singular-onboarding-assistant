export const runtime = 'nodejs';
export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';
import {
  lookupSalesforceClient,
  lookupSalesforceClientReal,
} from '@/lib/server/salesforce';
import {
  readSession,
  buildSessionCookie,
} from '@/lib/server/session';
import { runIntakeExtraction } from '@/lib/server/intakeTool';
import { checkRateLimit, rateLimitResponse } from '@/lib/server/rateLimit';

const MODEL = 'claude-sonnet-4-6';

// Turn whatever Salesforce gave us into a plain-text block Claude can
// reason over. Includes every raw field name so the model can match on
// custom-field labels (Platforms__c, Current_MMP__c, etc.) without us
// having to bake a translation map here.
//
// Wrapped in <external_content> tags so the intake system prompt can tell
// the model to treat the body as data, not instructions — mitigates prompt
// injection if a Salesforce record ever contains adversarial text.
function formatAccountForClaude(account, extras = {}) {
  const lines = [];
  lines.push('<external_content source="salesforce_account">');
  for (const [key, value] of Object.entries(account)) {
    if (value === null || value === undefined || value === '') continue;
    lines.push(`- ${key}: ${value}`);
  }
  for (const [label, block] of Object.entries(extras)) {
    if (!block) continue;
    lines.push(`\n[${label}]\n${block}`);
  }
  lines.push('</external_content>');
  return lines.join('\n');
}

export async function POST(req) {
  const limit = checkRateLimit(req, { bucket: 'intake', limit: 15, windowMs: 60_000 });
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const clientName = (body?.clientName || '').trim();
  if (!clientName) {
    return Response.json({ error: 'clientName is required' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not configured' },
      { status: 500 }
    );
  }

  // Prefer the real SF session if the SE is connected. Fall back to the
  // mock so the demo path still works without an OAuth round-trip.
  const sfSession = await readSession(req);
  let lookup;
  let refreshedSession = null;

  if (sfSession) {
    lookup = await lookupSalesforceClientReal({ clientName }, sfSession);
    if (lookup._refreshed_session) {
      refreshedSession = lookup._refreshed_session;
      delete lookup._refreshed_session;
    }
  } else {
    lookup = await lookupSalesforceClient({ clientName });
  }

  if (!lookup.found) {
    return Response.json(
      {
        ok: false,
        reason: lookup.reason || 'No Salesforce account matched.',
        source: lookup._source,
      },
      { status: 404 }
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const contextText = formatAccountForClaude(lookup.account);

  let extraction;
  try {
    extraction = await runIntakeExtraction(client, contextText, MODEL);
  } catch (err) {
    console.error('intake extraction failed', err);
    return Response.json(
      { error: 'Intake extraction failed', detail: String(err?.message || err) },
      { status: 502 }
    );
  }

  const res = Response.json({
    ok: true,
    source: lookup._source,
    form: extraction.form,
    missingFields: extraction.missingFields,
    confidenceNotes: extraction.confidenceNotes,
  });

  // If SF refreshed the token during lookup, persist the new cookie so
  // subsequent Skill 1 calls in the same session don't force another refresh.
  if (refreshedSession) {
    const cookie = await buildSessionCookie(refreshedSession);
    res.headers.append('Set-Cookie', cookie);
  }

  return res;
}
