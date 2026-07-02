// Doc-quality + smoke eval.
//
// For each fixture:
//   1. Fire the whole 6-skill pipeline against `${BASE_URL}/api/generate`
//      (requires a running server — dev or deployed).
//   2. Assert smoke: all 6 skills reported skill_complete, all 3 docs are
//      non-empty. Any smoke failure is a hard fail regardless of scores.
//   3. Ship the docs + form to the LLM judge for 1-5 scoring on
//      specificity / actionability / no_hallucination / structure.
//
// Not part of CI — costs tokens for the pipeline AND the judge. Run
// before shipping a prompt or model change: `npm run eval:docs`.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { runPipeline } from '../lib/streamClient.mjs';
import { judgeDocs, aggregateScores } from '../lib/judge.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const BASE_URL = process.env.EVAL_BASE_URL || 'http://localhost:3000';
const MODEL = process.env.EVAL_MODEL || 'claude-sonnet-4-6';
const REQUIRED_SKILLS = [
  'client_info',
  'sdk_setup',
  'integration_type',
  'tech_env',
  'timeline',
  'review_compile',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/docs');
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
  if (n === null || n === undefined) return '—';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function smokeCheck({ documents, skills }) {
  const issues = [];
  for (const skill of REQUIRED_SKILLS) {
    if (skills[skill] !== 'complete') {
      issues.push(`skill ${skill} = ${skills[skill] || 'missing'}`);
    }
  }
  for (const doc of ['runbook', 'faq', 'checklist']) {
    if (!documents[doc] || !documents[doc].trim()) {
      issues.push(`doc ${doc} empty`);
    }
  }
  return { passed: issues.length === 0, issues };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required (add to .env.local).');
    process.exit(1);
  }

  console.log(`Doc-quality eval — pipeline: ${BASE_URL}, judge: ${MODEL}\n`);

  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURE_DIR}`);
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = [];
  const started = Date.now();

  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.id.padEnd(28)} `);
    const record = { id: fixture.id };

    let pipelineOut;
    const fixtureStarted = Date.now();
    try {
      pipelineOut = await runPipeline({
        baseUrl: BASE_URL,
        form: fixture.form,
        onProgress: (evt) => {
          const secs = Math.round((Date.now() - fixtureStarted) / 1000);
          if (evt.kind === 'skill_start') {
            process.stdout.write(`\n    [+${secs}s] start   ${evt.skillId}`);
          } else if (evt.kind === 'skill_complete') {
            process.stdout.write(`\n    [+${secs}s] done    ${evt.skillId}`);
          } else if (evt.kind === 'skill_error') {
            process.stdout.write(`\n    [+${secs}s] FAIL    ${evt.skillId}: ${evt.message}`);
          }
        },
      });
      process.stdout.write('\n    ');
    } catch (err) {
      const secs = Math.round((Date.now() - fixtureStarted) / 1000);
      console.log(`\n    PIPELINE ERROR after ${secs}s: ${err.message}`);
      results.push({ ...record, error: err.message, smoke: { passed: false } });
      continue;
    }

    const smoke = smokeCheck(pipelineOut);
    record.pipelineMs = pipelineOut.durationMs;
    record.smoke = smoke;

    if (!smoke.passed) {
      console.log(`SMOKE FAIL: ${smoke.issues.join(', ')}`);
      results.push(record);
      continue;
    }

    try {
      const judged = await judgeDocs(client, {
        model: MODEL,
        form: fixture.form,
        documents: pipelineOut.documents,
      });
      record.scores = judged.scores;
      const avg =
        (judged.scores.runbook.specificity +
          judged.scores.runbook.actionability +
          judged.scores.runbook.no_hallucination +
          judged.scores.runbook.structure +
          judged.scores.faq.specificity +
          judged.scores.faq.actionability +
          judged.scores.faq.no_hallucination +
          judged.scores.faq.structure +
          judged.scores.checklist.specificity +
          judged.scores.checklist.actionability +
          judged.scores.checklist.no_hallucination +
          judged.scores.checklist.structure) /
        12;
      console.log(`avg ${fmtScore(avg)}  (${Math.round(pipelineOut.durationMs / 1000)}s pipeline)`);
    } catch (err) {
      console.log(`JUDGE ERROR: ${err.message}`);
      record.judgeError = err.message;
    }

    results.push(record);
  }

  const summary = aggregateScores(results);
  const durationMs = Date.now() - started;

  console.log(`\nOverall: ${fmtScore(summary.overall)} across ${summary.fixtures} fixtures`);
  console.log(`Wall time: ${Math.round(durationMs / 1000)}s`);

  const smokeFails = results.filter((r) => r.smoke && !r.smoke.passed);
  if (smokeFails.length > 0) {
    console.log(`\n⚠ Smoke failures (${smokeFails.length}):`);
    for (const r of smokeFails) {
      console.log(`  ${r.id}: ${(r.smoke.issues || []).join(', ') || r.error}`);
    }
  }

  console.log('\nBy doc type (avg across fixtures):');
  for (const [doc, dims] of Object.entries(summary.perDoc)) {
    const dimStr = Object.entries(dims)
      .map(([k, v]) => `${k.slice(0, 5)}=${fmtScore(v)}`)
      .join('  ');
    console.log(`  ${doc.padEnd(10)} ${dimStr}`);
  }

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `docs-${stamp}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      { baseUrl: BASE_URL, model: MODEL, durationMs, summary, results },
      null,
      2
    )
  );
  console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);

  // Non-zero exit if any fixture blew smoke — makes this scriptable.
  if (smokeFails.length > 0) process.exit(2);
}

main().catch((err) => {
  console.error('Eval crashed:', err);
  process.exit(1);
});
