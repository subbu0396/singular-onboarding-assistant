export const runtime = 'nodejs';
export const maxDuration = 120;

import Anthropic from '@anthropic-ai/sdk';
import {
  buildRunbookPrompt,
  buildFaqPrompt,
  buildChecklistPrompt,
  SKILLS,
  SKILL_SYSTEM_BLOCK,
  SKILL1_SYSTEM_BLOCK,
  SKILL1_TOOLS,
  SKILL4_SYSTEM_BLOCK,
  SKILL4_REST_SYSTEM_BLOCK,
  buildSkillUserPrompt,
  buildSkill1UserPrompt,
  buildSkill4UserPrompt,
  buildFormSlice,
} from '@/lib/server/claudeClient';
import { lookupSalesforceClientReal } from '@/lib/server/salesforce';
import {
  ensureFreshAtlassianSession,
  getMcpUrl,
  buildConfluenceContextForSkill4,
  useMcpConnector,
} from '@/lib/server/atlassian';
import {
  readSession,
  readAtlassianSession,
  buildAtlassianSessionCookie,
} from '@/lib/server/session';
import { retrievePatterns } from '@/lib/retrievePatterns';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const SKILL_MAX_TOKENS = 1500;
const SKILL1_MAX_ITERATIONS = 4;
const MCP_BETA = 'mcp-client-2025-11-20';
const ATLASSIAN_MCP_SERVER_NAME = 'atlassian';
const SKILL4_MCP_TIMEOUT_MS = 45_000;

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

const DOC_BUILDERS = {
  runbook: {
    builder: buildRunbookPrompt,
    system: [CACHED_SYSTEM_BLOCK, RUNBOOK_DYNAMIC_BLOCK],
  },
  faq: {
    builder: buildFaqPrompt,
    system: [CACHED_SYSTEM_BLOCK, FAQ_DYNAMIC_BLOCK],
  },
  checklist: {
    builder: buildChecklistPrompt,
    system: [CACHED_SYSTEM_BLOCK, CHECKLIST_DYNAMIC_BLOCK],
  },
};

const REVIEW_SKILL_ID = 'review_compile';

// Skill 1 runs as a tool-using agent loop. The other skills (2-5) use the
// simpler runSkill path below.
async function runSkill1Agent(client, form, sfSession, send) {
  const skillId = 'client_info';
  send({ type: 'skill_start', skillId });

  // Track the latest session in case the lookup tool refreshes the access
  // token mid-flight — the route handler will rewrite the session cookie
  // after runAgent returns.
  const sessionRef = { current: sfSession };

  const toolHandlers = {
    lookup_salesforce_client: async (input) => {
      if (sessionRef.current) {
        const result = await lookupSalesforceClientReal(input, sessionRef.current);
        if (result._refreshed_session) {
          sessionRef.current = result._refreshed_session;
        }
        const { _refreshed_session, ...visible } = result;
        return visible;
      }
      // No SE session — let the agent know Salesforce isn't connected so it
      // falls back to use_form_data.
      return {
        found: false,
        reason:
          'Salesforce is not connected for this session. Fall back to form data.',
        _source: 'salesforce_unavailable',
      };
    },
    use_form_data: async () =>
      buildFormSlice(SKILLS.find((s) => s.id === skillId), form),
  };

  const messages = [
    { role: 'user', content: buildSkill1UserPrompt(form) },
  ];

  let finalText = '';
  let iteration = 0;

  try {
    while (iteration++ < SKILL1_MAX_ITERATIONS) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: SKILL_MAX_TOKENS,
        system: [SKILL1_SYSTEM_BLOCK],
        tools: SKILL1_TOOLS,
        messages,
      });

      if (response.stop_reason === 'refusal') {
        send({
          type: 'skill_error',
          skillId,
          message: 'Refused by safety filters.',
        });
        return null;
      }

      // Accumulate text from this turn.
      for (const block of response.content) {
        if (block.type === 'text') finalText += block.text;
      }

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const toolUse of toolUses) {
          send({
            type: 'tool_call_start',
            skillId,
            toolName: toolUse.name,
            input: toolUse.input,
          });

          const handler = toolHandlers[toolUse.name];
          if (!handler) {
            send({
              type: 'tool_call_complete',
              skillId,
              toolName: toolUse.name,
              ok: false,
              message: `Unknown tool: ${toolUse.name}`,
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: unknown tool ${toolUse.name}`,
              is_error: true,
            });
            continue;
          }

          try {
            const result = await handler(toolUse.input || {});
            const ok =
              toolUse.name !== 'lookup_salesforce_client' ||
              result?.found === true;
            send({
              type: 'tool_call_complete',
              skillId,
              toolName: toolUse.name,
              ok,
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            send({
              type: 'tool_call_complete',
              skillId,
              toolName: toolUse.name,
              ok: false,
              message: err?.message || 'Tool execution failed',
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${err?.message || 'tool failed'}`,
              is_error: true,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Any other stop reason (max_tokens, etc.) — bail out with what we have.
      break;
    }

    send({ type: 'skill_complete', skillId });
    return {
      output: finalText.trim() || null,
      refreshedSession:
        sessionRef.current !== sfSession ? sessionRef.current : null,
    };
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `${skillId} skill failed (${err.status}): ${err.message}`
        : err?.message || `${skillId} skill failed`;
    send({ type: 'skill_error', skillId, message });
    return {
      output: null,
      refreshedSession:
        sessionRef.current !== sfSession ? sessionRef.current : null,
    };
  }
}

function emitToolEvent(send, skillId, phase, toolName, extra = {}) {
  if (phase === 'start') {
    send({
      type: 'tool_call_start',
      skillId,
      toolName,
      input: extra.input || {},
    });
  } else {
    send({
      type: 'tool_call_complete',
      skillId,
      toolName,
      ok: extra.ok !== false,
      message: extra.message,
    });
  }
}

// Skill 4 (default): Confluence REST + Claude — reliable, fires tool badges.
async function runSkill4ConfluenceAgent(client, form, atlSession, send) {
  const skillId = 'tech_env';
  send({ type: 'skill_start', skillId });

  try {
    const confluenceContext = await buildConfluenceContextForSkill4(
      atlSession,
      form,
      (phase, toolName, payload) => {
        if (phase === 'start') {
          emitToolEvent(send, skillId, 'start', toolName, { input: payload });
        } else {
          emitToolEvent(send, skillId, 'complete', toolName, {
            ok: payload?.ok !== false,
            message: payload?.message,
          });
        }
      }
    );

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: SKILL_MAX_TOKENS,
      system: [SKILL4_REST_SYSTEM_BLOCK],
      messages: [
        {
          role: 'user',
          content: buildSkill4UserPrompt(form, confluenceContext),
        },
      ],
    });

    let output = '';
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        output += event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({
        type: 'skill_error',
        skillId,
        message: 'Refused by safety filters.',
      });
      return null;
    }

    send({ type: 'skill_complete', skillId });
    return output.trim() || null;
  } catch (err) {
    const message = err?.message || 'Skill 4 Confluence agent failed';
    console.error('Skill 4 Confluence REST error — falling back to static prompt', message);
    send({ type: 'skill_error', skillId, message });
    return null;
  }
}

// Skill 4 (opt-in via ATLASSIAN_USE_MCP_CONNECTOR=true): Anthropic MCP connector.
// Can hang 60s+ on Atlassian cold start — kept for experimentation only.
async function runSkill4McpAgent(client, form, atlSession, send) {
  const skillId = 'tech_env';
  send({ type: 'skill_start', skillId });

  let output = '';
  const activeMcpToolByIndex = new Map();

  const runMcp = async () => {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: SKILL_MAX_TOKENS,
      system: [SKILL4_SYSTEM_BLOCK],
      messages: [{ role: 'user', content: buildSkill4UserPrompt(form) }],
      mcp_servers: [
        {
          type: 'url',
          url: getMcpUrl(),
          name: ATLASSIAN_MCP_SERVER_NAME,
          authorization_token: atlSession.access_token,
        },
      ],
      tools: [{ type: 'mcp_toolset', mcp_server_name: ATLASSIAN_MCP_SERVER_NAME }],
      betas: [MCP_BETA],
    });

    emitToolEvent(send, skillId, 'start', 'confluence_mcp_connect', {
      input: { url: getMcpUrl() },
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_start' &&
        event.content_block?.type === 'mcp_tool_use'
      ) {
        emitToolEvent(send, skillId, 'complete', 'confluence_mcp_connect', { ok: true });
        const toolName = event.content_block.name || 'mcp_tool';
        activeMcpToolByIndex.set(event.index, toolName);
        emitToolEvent(send, skillId, 'start', toolName, {
          input: event.content_block.input || {},
        });
      }
      if (
        event.type === 'content_block_stop' &&
        activeMcpToolByIndex.has(event.index)
      ) {
        const toolName = activeMcpToolByIndex.get(event.index);
        activeMcpToolByIndex.delete(event.index);
        emitToolEvent(send, skillId, 'complete', toolName, { ok: true });
      }
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        output += event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({
        type: 'skill_error',
        skillId,
        message: 'Refused by safety filters.',
      });
      return null;
    }

    send({ type: 'skill_complete', skillId });
    return output.trim() || null;
  };

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`MCP connector timed out after ${SKILL4_MCP_TIMEOUT_MS}ms`)),
      SKILL4_MCP_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([runMcp(), timeout]);
  } catch (err) {
    emitToolEvent(send, skillId, 'complete', 'confluence_mcp_connect', {
      ok: false,
      message: err?.message,
    });
    for (const [, toolName] of activeMcpToolByIndex) {
      emitToolEvent(send, skillId, 'complete', toolName, {
        ok: false,
        message: err?.message || 'MCP call failed',
      });
    }
    activeMcpToolByIndex.clear();
    const message =
      err instanceof Anthropic.APIError
        ? `Skill 4 MCP call failed (${err.status}): ${err.message}`
        : err?.message || 'Skill 4 MCP call failed';
    console.error('Skill 4 MCP error — falling back to static prompt', message);
    return null;
  }
}

async function runSkill(client, skill, form, send) {
  send({ type: 'skill_start', skillId: skill.id });
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: SKILL_MAX_TOKENS,
      system: [SKILL_SYSTEM_BLOCK],
      messages: [{ role: 'user', content: buildSkillUserPrompt(skill, form) }],
    });

    let output = '';
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        output += event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({
        type: 'skill_error',
        skillId: skill.id,
        message: 'Refused by safety filters.',
      });
      return null;
    }

    send({ type: 'skill_complete', skillId: skill.id });
    return output.trim();
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `${skill.id} skill failed (${err.status}): ${err.message}`
        : err?.message || `${skill.id} skill failed`;
    send({ type: 'skill_error', skillId: skill.id, message });
    return null;
  }
}

async function streamDoc(client, docType, form, ragContext, skillOutputs, send) {
  const { builder, system } = DOC_BUILDERS[docType];
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        { role: 'user', content: builder(form, ragContext, skillOutputs) },
      ],
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

async function runAgent(client, form, ragContext, docTypes, sfSession, atlSession, send) {
  // Skills 1-5 run in parallel — no inter-skill dependencies.
  // Skill 1: Salesforce tool-using agent (Phase 2).
  // Skill 4: Confluence MCP agent (Phase 3) when Atlassian is connected;
  //          falls back to the static runSkill path when it isn't or fails.
  const skillResults = await Promise.all(
    SKILLS.map(async (skill) => {
      if (skill.id === 'client_info') {
        const { output } = await runSkill1Agent(client, form, sfSession, send);
        return { id: skill.id, output };
      }
      if (skill.id === 'tech_env' && atlSession?.access_token) {
        const runner = useMcpConnector()
          ? runSkill4McpAgent
          : runSkill4ConfluenceAgent;
        const skillOutput = await runner(client, form, atlSession, send);
        if (skillOutput) return { id: skill.id, output: skillOutput };
        // Confluence/MCP path returned null — fall through to static.
      }
      return { id: skill.id, output: await runSkill(client, skill, form, send) };
    })
  );

  const skillOutputs = Object.fromEntries(
    skillResults.filter((r) => r.output).map((r) => [r.id, r.output])
  );

  // Skill 6: parallel doc generations seeded with the skill outputs.
  send({ type: 'skill_start', skillId: REVIEW_SKILL_ID });
  await Promise.allSettled(
    docTypes.map((docType) =>
      streamDoc(client, docType, form, ragContext, skillOutputs, send)
    )
  );
  send({ type: 'skill_complete', skillId: REVIEW_SKILL_ID });
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
  const sfSession = await readSession(req);
  const storedAtlSession = await readAtlassianSession(req);
  const { session: atlSession, refreshedSession: atlRefreshed } =
    await ensureFreshAtlassianSession(storedAtlSession);

  // Headers we may append refreshed-session Set-Cookies onto.
  const extraHeaders = new Headers(SSE_HEADERS);
  if (atlRefreshed) {
    extraHeaders.append('Set-Cookie', await buildAtlassianSessionCookie(atlRefreshed));
  }

  // Single-doc (regenerate) path — runs the full skill pipeline but only
  // streams the requested doc. Keeps doc quality consistent with the
  // initial generation by reusing the same skill analysis.
  if (body.docType && body.form) {
    if (!DOC_BUILDERS[body.docType]) {
      return Response.json(
        { error: `Unknown document type: ${body.docType}` },
        { status: 400 }
      );
    }

    const stream = buildSSEStream(async (send) => {
      const ragContext = await retrievePatterns(body.form);
      await runAgent(
        client,
        body.form,
        ragContext,
        [body.docType],
        sfSession,
        atlSession,
        send
      );
    });

    return new Response(stream, { headers: extraHeaders });
  }

  // Full generation path: skills 1-5 in parallel, then all three docs.
  const formData = body;
  const stream = buildSSEStream(async (send) => {
    const ragContext = await retrievePatterns(formData);
    await runAgent(
      client,
      formData,
      ragContext,
      ['runbook', 'faq', 'checklist'],
      sfSession,
      atlSession,
      send
    );
  });

  return new Response(stream, { headers: extraHeaders });
}
