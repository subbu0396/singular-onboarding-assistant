// Intake extraction eval.
//
// Runs every fixture through the same runIntakeExtraction() the production
// /api/intake/salesforce route uses, scores field-by-field, prints a summary
// and writes a JSON report to evals/results/ for regression tracking.
//
// Requires ANTHROPIC_API_KEY in .env.local. Run: `npm run eval:intake`.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { runIntakeExtraction } from '../../src/lib/server/intakeTool.js';
import { scoreFixture, aggregate } from '../lib/scoring.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const MODEL = process.env.EVAL_MODEL || 'claude-sonnet-4-6';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/intake');
const RESULTS_DIR = path.resolve(__dirname, '../results');

async function loadFixtures() {
  const files = (await fs.readdir(FIXTURE_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    const body = await fs.readFile(path.join(FIXTURE_DIR, file), 'utf8');
    out.push(JSON.parse(body));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function fmtScore(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required (add to .env.local).');
    process.exit(1);
  }

  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURE_DIR}`);
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = [];
  const started = Date.now();

  console.log(`Running intake eval — ${fixtures.length} fixtures against ${MODEL}\n`);

  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.id.padEnd(28)} `);
    try {
      const extraction = await runIntakeExtraction(client, fixture.description, MODEL);
      const scored = scoreFixture(fixture.expected, extraction.form);
      results.push({
        id: fixture.id,
        overall: scored.overall,
        fields: scored.fields,
        fieldsTested: scored.fieldsTested,
        droppedFields: extraction.droppedFields || [],
        missingFields: extraction.missingFields || [],
      });
      console.log(`${fmtScore(scored.overall)}  (${scored.fieldsTested} fields tested)`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: fixture.id, overall: 0, error: String(err.message || err) });
    }
  }

  const summary = aggregate(results);
  const durationMs = Date.now() - started;

  console.log(`\nOverall score: ${fmtScore(summary.overall)}`);
  console.log(`Fixtures: ${summary.fixtures}, wall time: ${Math.round(durationMs / 1000)}s\n`);

  console.log('By field (avg across fixtures where the field was tested):');
  const sortedFields = Object.entries(summary.perFieldAvg).sort(
    (a, b) => a[1].avg - b[1].avg
  );
  for (const [field, { avg, samples }] of sortedFields) {
    console.log(`  ${field.padEnd(32)} ${fmtScore(avg)}  (n=${samples})`);
  }

  // Persist for regression tracking. Timestamped filename so runs stack up.
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `intake-${stamp}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify({ model: MODEL, durationMs, summary, results }, null, 2)
  );
  console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error('Eval crashed:', err);
  process.exit(1);
});
