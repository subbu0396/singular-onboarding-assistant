# Evals

Offline test-suites that call the real Anthropic API to lock in behavior before prompt or model changes ship. Not CI-run — they cost tokens; you run them intentionally.

## Setup

`ANTHROPIC_API_KEY` needs to be in `.env.local` (same file Vercel local uses). No other setup — evals import the same modules the production routes do.

## Currently shipping

### `npm run eval:intake`

Golden set of unstructured client descriptions → expected populated form. Runs each fixture through `runIntakeExtraction()` (the same function `/api/intake/salesforce` and `/api/intake/converse` use in production), scores field-by-field, prints a summary, and writes a JSON report to `evals/results/` for regression tracking.

**Scoring:**
- Enum fields (targetMmp, industry, etc.): 1.0 for exact match, 0 otherwise.
- Array enums (platforms, integrationMethods): Jaccard similarity between expected and actual sets.
- Strings (clientName, cdpName): 1.0 exact (case-insensitive), 0.5 for substring match, 0 miss.
- Date (targetGoLiveDate): 1.0 exact, 0.5 within 3 days, 0 miss. **Null is a valid expected value** — for fixtures where the description says "mid-August" the correct answer is null, and the eval rewards the model for not guessing.
- Booleans (hasDataWarehouse, usesCdp): exact match.

**Fixture format** (`evals/fixtures/intake/*.json`):

```json
{
  "id": "some-slug",
  "description": "Unstructured client blurb the SE might paste or say.",
  "expected": {
    "clientName": "Acme Corp",
    "targetMmp": "Singular",
    "targetGoLiveDate": null,
    ...
  },
  "notes": "Optional — explain what makes this fixture tricky."
}
```

Only fields present in `expected` are scored. Leave a field out of `expected` if you don't want to test it. Use `null` when you're testing that the model correctly *declines* to populate the field.

**Adding fixtures.** Pick a real client description you've seen, redact any PII, save as a new JSON file. Aim for coverage across: verbose vs terse input, missing information, vague dates, unusual industries, migration wording, brand-new prospects.

### `npm run eval:docs`

End-to-end quality + smoke eval over the generated Runbook / FAQ / Checklist.

**How it runs.** For each fixture, hits `${EVAL_BASE_URL}/api/generate` (default `http://localhost:3000`), parses the SSE stream to assemble the three docs, then ships {form, docs} to Claude as an **LLM judge** that scores each doc on four dimensions 1-5:

- **specificity** — does it name specific endpoints, SDK versions, config values grounded in the form?
- **actionability** — can an engineer execute each step as written?
- **no_hallucination** — does it invent details not supported by the form? 5 = every specific traces back to the form.
- **structure** — mandated section structure + markdown format.

Rubric is strict: 3 is the average, not the floor. Prevents ceiling-hugging.

**Also acts as the smoke test.** Any fixture that doesn't emit `skill_complete` for all 6 skills or that produces an empty doc is a hard fail — reported before the judge runs and exits the process with code 2 so CI (if you ever add it) can catch it.

**How to run.** Costs Anthropic tokens for both pipeline AND judge, so run intentionally.

```
# terminal 1
npm run dev

# terminal 2
npm run eval:docs
```

Or point at a deployed URL — no dev server needed:

```
EVAL_BASE_URL=https://singular-onboarding-assistant.vercel.app npm run eval:docs
```

**Fixture format** (`evals/fixtures/docs/*.json`):

```json
{
  "id": "some-slug",
  "notes": "Optional — what makes this fixture stress-test the pipeline.",
  "form": {
    "clientName": "Acme Corp",
    "targetMmp": "Singular",
    ...every field the pipeline reads...
  }
}
```

No expected output — the LLM judge scores in absolute terms. Add fixtures that cover different shapes: verbose form, thin form, unusual industry, CDP + warehouse combo, tight timeline, etc.

**Interpreting results.** Look for regressions in the per-doc-type per-dimension table:

```
By doc type (avg across fixtures):
  runbook    speci=4.33  actio=4.00  no_ha=4.67  struc=4.33
  faq        speci=3.67  actio=3.33  no_ha=4.33  struc=4.00
  checklist  speci=4.00  actio=4.67  no_ha=4.33  struc=4.67
```

If `faq.actionability` drops from 3.33 to 2.5 after a prompt tweak, that's the specific thing to fix. If everything drops by 0.5 across the board, you probably regressed the shared system block. Reports accumulate in `evals/results/docs-*.json` for cross-run diffing.

## Interpreting results

A single overall score doesn't tell you much. Look at:

- **Overall score trajectory** across runs. `results/intake-*.json` files accumulate — plot or diff to see if a prompt tweak improved or regressed the baseline.
- **Per-field averages** at the bottom of the console output. If `targetGoLiveDate` is stuck at 0.6, that field's prompt guidance needs work regardless of the overall score.
- **Per-fixture failures**. If `minimal-name-only` regresses from 1.0 to 0.3, the model started hallucinating industry / market when it shouldn't. That's a discipline regression.
