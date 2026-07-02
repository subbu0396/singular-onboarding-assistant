// Minimal SSE client that hits POST /api/generate on a running dev server,
// parses the event stream, and returns the assembled docs + skill status.
//
// The eval treats the pipeline as a black box — same URL a real browser
// would hit — so we don't have to duplicate any pipeline logic here or
// refactor the route into a library. The tradeoff is you need `npm run dev`
// running in another terminal (or point BASE_URL at a deployed instance).

const DOC_KEYS = ['runbook', 'faq', 'checklist'];
const SUFFIXES = ['_delta', '_complete', '_error'];

function parseDocEvent(eventType) {
  for (const suffix of SUFFIXES) {
    if (eventType.endsWith(suffix)) {
      return { docType: eventType.slice(0, -suffix.length), kind: suffix.slice(1) };
    }
  }
  return null;
}

/**
 * Run the pipeline for a given form. Returns:
 *   { documents: { runbook, faq, checklist },
 *     skills: { <skillId>: 'complete'|'error'|'pending' },
 *     durationMs, errors: [] }
 *
 * Rejects on non-2xx response. Never throws mid-stream — a broken doc gets
 * marked in the errors[] instead, which is what the smoke assertions look at.
 */
export async function runPipeline({ baseUrl, form, timeoutMs = 180_000 }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`fetch failed: ${err?.message || err}`);
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    throw new Error(`pipeline HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) {
    clearTimeout(timer);
    throw new Error('pipeline returned no body');
  }

  const documents = { runbook: '', faq: '', checklist: '' };
  const skills = {};
  const errors = [];

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data: ')) continue;
      let parsed;
      try {
        parsed = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      const type = parsed.type;
      const docEvent = type ? parseDocEvent(type) : null;
      if (docEvent && DOC_KEYS.includes(docEvent.docType)) {
        if (docEvent.kind === 'delta' && parsed.content) {
          documents[docEvent.docType] += parsed.content;
        } else if (docEvent.kind === 'error') {
          errors.push({ docType: docEvent.docType, message: parsed.message || 'stream error' });
        }
        continue;
      }
      if (type === 'skill_start') skills[parsed.skillId] = 'active';
      else if (type === 'skill_complete') skills[parsed.skillId] = 'complete';
      else if (type === 'skill_error') {
        skills[parsed.skillId] = 'error';
        errors.push({ skillId: parsed.skillId, message: parsed.message || 'skill error' });
      }
    }
  }

  clearTimeout(timer);

  return {
    documents,
    skills,
    errors,
    durationMs: Date.now() - started,
  };
}
