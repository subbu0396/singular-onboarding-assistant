// LLM-judge over the generated docs. One Claude call scores all three
// documents in a single tool_use so the model sees them together and can
// cross-check consistency (e.g. does the FAQ contradict the Runbook?).
//
// Scoring rubric (1-5 each dimension):
//   - specificity        — does the doc name specific endpoints, SDK versions,
//                          config values grounded in the form's values?
//   - actionability      — can an engineer execute each step as written?
//   - no_hallucination   — does it invent details not supported by the form?
//                          5 = every specific traces back to the form.
//   - structure          — mandated section structure + markdown format.
//
// The judge is instructed to be strict — a 3 is average, 4 is good, 5 is
// exceptional. Prevents ceiling-hugging that masks regressions.

const RUBRIC_SYSTEM = `You are a strict technical evaluator for onboarding documents.
Your job is to score the three generated docs (Runbook, FAQ, Checklist) against
a client form and return your scores by calling the report_doc_scores tool.

Scoring bands for EVERY dimension:
  5 = exceptional; every claim is grounded, every step is executable,
      every section follows the mandated structure.
  4 = good; occasional generic phrasing, minor structural quirks.
  3 = acceptable; noticeable generic language or vague steps but the doc is
      usable.
  2 = weak; multiple hallucinations, vague steps, or missing sections.
  1 = broken; unusable output.

Be strict — 3 is the AVERAGE score, not the floor.
For no_hallucination, penalize any invented specifics (endpoint URLs, SDK
versions, event names) that are not in the form. Grounded generic advice
(e.g. "consult the SDK docs") is fine; INVENTED specifics are not.

Do not narrate. Call the tool once with all three doc scores.`;

const REPORT_TOOL = {
  name: 'report_doc_scores',
  description:
    'Emit per-document scores (1-5) on the four rubric dimensions plus a one-line rationale each.',
  input_schema: {
    type: 'object',
    properties: {
      runbook: docSchema(),
      faq: docSchema(),
      checklist: docSchema(),
      overall_rationale: {
        type: 'string',
        description:
          'One sentence on the strongest and weakest of the three docs and why.',
      },
    },
    required: ['runbook', 'faq', 'checklist'],
  },
};

function docSchema() {
  return {
    type: 'object',
    properties: {
      specificity: { type: 'integer', minimum: 1, maximum: 5 },
      actionability: { type: 'integer', minimum: 1, maximum: 5 },
      no_hallucination: { type: 'integer', minimum: 1, maximum: 5 },
      structure: { type: 'integer', minimum: 1, maximum: 5 },
      rationale: { type: 'string' },
    },
    required: ['specificity', 'actionability', 'no_hallucination', 'structure', 'rationale'],
  };
}

function truncate(s, max = 8000) {
  if (typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}\n[…truncated for judge]` : s;
}

/**
 * Run the judge. Returns the tool_use input object plus stop_reason.
 * Throws if the judge doesn't call the tool.
 */
export async function judgeDocs(client, { model, form, documents }) {
  const userText = `<client_form>
${JSON.stringify(form, null, 2)}
</client_form>

<runbook>
${truncate(documents.runbook)}
</runbook>

<faq>
${truncate(documents.faq)}
</faq>

<checklist>
${truncate(documents.checklist)}
</checklist>

Score these three docs against the form using the report_doc_scores tool.`;

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report_doc_scores' },
    system: RUBRIC_SYSTEM,
    messages: [{ role: 'user', content: userText }],
  });

  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'report_doc_scores'
  );
  if (!toolUse) {
    throw new Error(`Judge did not emit tool_use (stop_reason: ${response.stop_reason})`);
  }
  return { scores: toolUse.input, stopReason: response.stop_reason };
}

// Aggregate scores across fixtures. Reports per-dimension averages per
// doc-type so we can spot patterns like "checklist actionability is
// consistently low across all fixtures."
export function aggregateScores(results) {
  const docTypes = ['runbook', 'faq', 'checklist'];
  const dims = ['specificity', 'actionability', 'no_hallucination', 'structure'];
  const buckets = {};
  for (const doc of docTypes) {
    buckets[doc] = {};
    for (const dim of dims) buckets[doc][dim] = { sum: 0, n: 0 };
  }

  let overallSum = 0;
  let overallN = 0;
  for (const r of results) {
    if (!r.scores) continue;
    for (const doc of docTypes) {
      const s = r.scores[doc];
      if (!s) continue;
      for (const dim of dims) {
        if (typeof s[dim] !== 'number') continue;
        buckets[doc][dim].sum += s[dim];
        buckets[doc][dim].n += 1;
        overallSum += s[dim];
        overallN += 1;
      }
    }
  }

  const perDoc = {};
  for (const doc of docTypes) {
    perDoc[doc] = {};
    for (const dim of dims) {
      const { sum, n } = buckets[doc][dim];
      perDoc[doc][dim] = n === 0 ? null : sum / n;
    }
  }

  return {
    overall: overallN === 0 ? null : overallSum / overallN,
    perDoc,
    fixtures: results.length,
  };
}
