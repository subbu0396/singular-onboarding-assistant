export const runtime = 'edge';
export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';
import {
  buildRunbookPrompt,
  buildFaqPrompt,
  buildChecklistPrompt,
} from '@/lib/server/claudeClient';
import { retrievePatterns } from '@/lib/retrievePatterns';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;

const CACHED_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are a senior integrations engineer and technical writer specializing in enterprise SaaS onboarding. You generate three types of client-facing onboarding documents:

1. Integration Runbooks — step-by-step technical setup guides
2. FAQ Documents — anticipated questions with precise answers
3. Test Checklists — QA validation steps with pass/fail criteria

Rules that always apply to every document you generate:
- Use markdown throughout. Use ## for sections, ### for subsections.
- Use numbered lists for all sequential steps.
- Use tables for structured data (event mappings, config values, test cases).
- Use code blocks for any API calls, config snippets, or sample payloads.
- Write for a technical audience: engineers, technical PMs, solutions engineers.
- Never use filler language, marketing language, or vague statements.
- Every step must be independently executable and sequentially ordered.
- Flag known failure modes, common gotchas, and retry logic where relevant.
- Be specific: name exact endpoints, headers, parameter names, and expected response shapes where applicable.
- Do not include a preamble or closing summary. Start directly with the first section header.`,
  cache_control: { type: 'ephemeral' },
};

const RUNBOOK_DYNAMIC_BLOCK = {
  type: 'text',
  text: `You are generating an Integration Runbook.
Structure it with exactly these sections:
1. Pre-Integration Checklist
2. SDK Integration Steps (one subsection per platform in the client stack)
3. Event Mapping Table
4. Postback / S2S Configuration
5. Data Export Setup
6. QA and Validation Steps
7. Go-Live Sign-off Criteria`,
};

const FAQ_DYNAMIC_BLOCK = {
  type: 'text',
  text: `You are generating a FAQ Document.
Generate 12-15 questions a technical client team would realistically ask.
Cover: SDK setup, attribution logic, postback delays, data discrepancies, dashboard access, data export delivery, and authentication.
Format each as: ### Q: [question] followed by **A:** [answer]`,
};

const CHECKLIST_DYNAMIC_BLOCK = {
  type: 'text',
  text: `You are generating a Test Checklist.
Structure it with these sections:
- SDK Initialization Tests
- Event Firing and Mapping Validation
- Attribution Flow Tests (organic, paid, re-engagement)
- Postback Delivery Tests
- Data Export Validation
- Edge Cases and Error Scenarios
Each checklist item format:
- [ ] **Test:** [what to test] | **Expected:** [expected result] | **Pass criteria:** [how to confirm pass]`,
};

const DOC_SYSTEM_BLOCKS = {
  runbook: [CACHED_SYSTEM_BLOCK, RUNBOOK_DYNAMIC_BLOCK],
  faq: [CACHED_SYSTEM_BLOCK, FAQ_DYNAMIC_BLOCK],
  checklist: [CACHED_SYSTEM_BLOCK, CHECKLIST_DYNAMIC_BLOCK],
};

const DOC_PROMPT_BUILDERS = {
  runbook: buildRunbookPrompt,
  faq: buildFaqPrompt,
  checklist: buildChecklistPrompt,
};

async function streamDoc(client, docType, systemPrompts, userPrompt, send) {
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompts,
      messages: [{ role: 'user', content: userPrompt }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        send({ type: `${docType}_delta`, delta: event.delta.text });
      }
    }

    const final = await stream.finalMessage();

    if (final.stop_reason === 'refusal') {
      send({
        type: `${docType}_error`,
        message: 'Content was declined by safety filters.',
      });
      return;
    }

    send({ type: `${docType}_complete`, stop_reason: final.stop_reason });
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `${docType} generation failed (${err.status}): ${err.message}`
        : err?.message || `${docType} generation failed`;
    send({ type: `${docType}_error`, message });
  }
}

function buildSSEStream(work) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (payload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        await work(send);
        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: err?.message || 'Generation failed' });
      } finally {
        controller.close();
      }
    },
  });
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  const body = await req.json();
  const client = new Anthropic({ apiKey });

  // Single-doc (regenerate) path
  if (body.docType && body.form) {
    const systemPrompts = DOC_SYSTEM_BLOCKS[body.docType];
    const buildUserPrompt = DOC_PROMPT_BUILDERS[body.docType];

    if (!systemPrompts || !buildUserPrompt) {
      return Response.json(
        { error: `Unknown document type: ${body.docType}` },
        { status: 400 }
      );
    }

    const stream = buildSSEStream(async (send) => {
      const ragContext = await retrievePatterns(body.form);
      await streamDoc(
        client,
        body.docType,
        systemPrompts,
        buildUserPrompt(body.form, ragContext),
        send
      );
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  // Full generation path: stream all three in parallel
  const formData = body;

  const stream = buildSSEStream(async (send) => {
    const ragContext = await retrievePatterns(formData);

    await Promise.allSettled([
      streamDoc(
        client,
        'runbook',
        [CACHED_SYSTEM_BLOCK, RUNBOOK_DYNAMIC_BLOCK],
        buildRunbookPrompt(formData, ragContext),
        send
      ),
      streamDoc(
        client,
        'faq',
        [CACHED_SYSTEM_BLOCK, FAQ_DYNAMIC_BLOCK],
        buildFaqPrompt(formData, ragContext),
        send
      ),
      streamDoc(
        client,
        'checklist',
        [CACHED_SYSTEM_BLOCK, CHECKLIST_DYNAMIC_BLOCK],
        buildChecklistPrompt(formData, ragContext),
        send
      ),
    ]);
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
