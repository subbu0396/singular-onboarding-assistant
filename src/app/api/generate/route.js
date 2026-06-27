export const runtime = 'edge';
export const maxDuration = 60;

import {
  buildRunbookPrompt,
  buildFaqPrompt,
  buildChecklistPrompt,
} from '@/lib/server/claudeClient';

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

async function callClaude(systemPrompts, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompts,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();

  if (process.env.NODE_ENV === 'development') {
    const usage = data.usage;
    console.log('Cache stats:', {
      input_tokens: usage.input_tokens,
      cache_creation_tokens: usage.cache_creation_input_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
      output_tokens: usage.output_tokens,
    });
  }

  return data.content[0].text;
}

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'Server misconfigured: API key missing' }, { status: 500 });
  }

  try {
    const { form, docType, generateAll } = await req.json();

    if (!form) {
      return Response.json({ error: 'Form data is required' }, { status: 400 });
    }

    if (generateAll) {
      const [runbook, faq, checklist] = await Promise.all([
        callClaude([CACHED_SYSTEM_BLOCK, RUNBOOK_DYNAMIC_BLOCK], buildRunbookPrompt(form)),
        callClaude([CACHED_SYSTEM_BLOCK, FAQ_DYNAMIC_BLOCK], buildFaqPrompt(form)),
        callClaude([CACHED_SYSTEM_BLOCK, CHECKLIST_DYNAMIC_BLOCK], buildChecklistPrompt(form)),
      ]);

      return Response.json({ documents: { runbook, faq, checklist } });
    }

    if (!docType) {
      return Response.json(
        { error: 'docType is required for single document generation' },
        { status: 400 }
      );
    }

    const systemPrompts = DOC_SYSTEM_BLOCKS[docType];
    const buildUserPrompt = DOC_PROMPT_BUILDERS[docType];

    if (!systemPrompts || !buildUserPrompt) {
      return Response.json({ error: `Unknown document type: ${docType}` }, { status: 400 });
    }

    const content = await callClaude(systemPrompts, buildUserPrompt(form));
    return Response.json({ docType, content });
  } catch (error) {
    console.error('Document generation error:', error);
    return Response.json(
      { error: error.message || 'Document generation failed' },
      { status: 500 }
    );
  }
}
