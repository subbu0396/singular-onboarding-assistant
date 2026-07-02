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

## Queued (not built yet)

- **`eval:docs`** — LLM-judge over the generated Runbook / FAQ / Checklist. 5 fixture forms → full 6-skill pipeline → Claude scores each doc on {specificity, actionability, no-hallucination, structure} 1-5. Heavy (each fixture is a full generation) but the highest-value quality signal.
- **`eval:smoke`** — end-to-end smoke: one canonical form runs the whole pipeline in-process, asserts all 6 skills complete and all 3 docs are non-empty. Cheap way to catch crash regressions like the `runAgent` signature bug that shipped twice.

Both are follow-up PRs — they need either a running dev server or a refactor of `/api/generate` to expose the pipeline as a library function. Ship intake alone in this PR to keep the review focused.

## Interpreting results

A single overall score doesn't tell you much. Look at:

- **Overall score trajectory** across runs. `results/intake-*.json` files accumulate — plot or diff to see if a prompt tweak improved or regressed the baseline.
- **Per-field averages** at the bottom of the console output. If `targetGoLiveDate` is stuck at 0.6, that field's prompt guidance needs work regardless of the overall score.
- **Per-fixture failures**. If `minimal-name-only` regresses from 1.0 to 0.3, the model started hallucinating industry / market when it shouldn't. That's a discipline regression.
