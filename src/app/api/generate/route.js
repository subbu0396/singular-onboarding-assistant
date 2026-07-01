export const runtime = 'nodejs';
export const maxDuration = 300;

import Anthropic from '@anthropic-ai/sdk';
import {
  buildRunbookPrompt,
  buildFaqPrompt,
  buildChecklistPrompt,
  SKILLS,
  SKILL_SYSTEM_BLOCK,
  SKILL1_SYSTEM_BLOCK,
  SKILL1_TOOLS,
  SKILL2_SYSTEM_BLOCK,
  SKILL2_TOOLS,
  SKILL4_AGENT_SYSTEM_BLOCK,
  SKILL4_TOOLS,
  SKILL5_SYSTEM_BLOCK,
  buildSkillUserPrompt,
  buildSkill1UserPrompt,
  buildSkill2UserPrompt,
  buildSkill4AgentUserPrompt,
  buildSkill5UserPrompt,
  buildFormSlice,
} from '@/lib/server/claudeClient';
import { lookupSalesforceClientReal } from '@/lib/server/salesforce';
import {
  ensureFreshAtlassianSession,
  resolveCloudId,
  searchConfluence,
  fetchConfluencePage,
} from '@/lib/server/atlassian';
import {
  readSession,
  readAtlassianSession,
  buildAtlassianSessionCookies,
  readGoogleSession,
  buildGoogleSessionCookie,
  readGitHubSession,
  buildGitHubSessionCookie,
} from '@/lib/server/session';
import {
  ensureFreshGoogleSession,
  fetchCalendarContext,
} from '@/lib/server/googleCalendar';
import {
  ensureFreshGitHubSession,
  searchClientRepos,
  fetchRepoManifests,
} from '@/lib/server/github';
import { retrievePatterns } from '@/lib/retrievePatterns';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const SKILL_MAX_TOKENS = 1500;
const SKILL1_MAX_ITERATIONS = 4;
const SKILL2_MAX_ITERATIONS = 5;
const DOC_STREAM_TIMEOUT_MS = 120_000;

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
2. Onboarding Schedule & Availability
3. SDK Integration Steps (one subsection per platform in the client stack)
4. Event Mapping Table
5. Postback / S2S Configuration
6. Data Export Setup
7. QA and Validation Steps
8. Go-Live Sign-off Criteria

In section 2 (Onboarding Schedule & Availability), surface scheduling specifics from the Go-Live Timeline analysis: target go-live date, the SE's own availability notes (quote them verbatim if provided), and any engineering-capacity flags from the connected calendar. If the SE supplied availability windows, propose concrete kickoff / SDK-review / cutover slots within those windows. If no SE notes or calendar data was provided, say "No SE availability or calendar data provided — schedule TBD" and move on.`,
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

// Skill 4: Confluence tool-using agent. Claude picks the queries and
// decides which pages to open, so the pipeline badges reflect the
// model's actual reasoning instead of a hard-coded server-side loop.
// Each tool result carries a `count` field the UI uses to color the
// badge green (has content), amber (call worked but nothing useful),
// or red (call failed).
async function runSkill4ConfluenceAgent(client, form, atlSession, send) {
  const skillId = 'tech_env';
  send({ type: 'skill_start', skillId });

  const accessToken = atlSession?.access_token;
  // resolveCloudId hits accessible-resources once; cache the result so
  // multiple search / fetch tool calls don't re-do it every time.
  let cachedCloudId = null;
  const getCloudId = async () => {
    if (cachedCloudId) return cachedCloudId;
    cachedCloudId = await resolveCloudId(atlSession);
    return cachedCloudId;
  };
  // Keep a title lookup so get_confluence_page results can surface a
  // human-readable page title in the UI tooltip.
  const pageTitleById = new Map();

  const toolHandlers = {
    search_confluence: async (input) => {
      if (!accessToken) {
        return { hits: [], count: 0, _reason: 'Atlassian not connected.' };
      }
      try {
        const cloudId = await getCloudId();
        if (!cloudId) {
          return { hits: [], count: 0, _error: 'No accessible Confluence site' };
        }
        const hits = await searchConfluence(atlSession, cloudId, input?.query || '', 5);
        for (const hit of hits) {
          if (hit.id && hit.title) pageTitleById.set(hit.id, hit.title);
        }
        return {
          query: input?.query,
          hits: hits.map((h) => ({ id: h.id, title: h.title, excerpt: h.excerpt })),
          count: hits.length,
        };
      } catch (err) {
        return { hits: [], count: 0, _error: err?.message || 'search failed' };
      }
    },
    get_confluence_page: async (input) => {
      if (!accessToken) return { _reason: 'Atlassian not connected.', count: 0 };
      try {
        const cloudId = await getCloudId();
        if (!cloudId) return { _error: 'No accessible Confluence site', count: 0 };
        const page = await fetchConfluencePage(atlSession, cloudId, input?.pageId || '');
        if (page?.title) pageTitleById.set(page.id, page.title);
        const excerpt = page?.excerpt || '';
        return {
          id: page?.id,
          title: page?.title,
          excerpt,
          count: excerpt.trim().length > 0 ? 1 : 0,
        };
      } catch (err) {
        return { _error: err?.message || 'page fetch failed', count: 0 };
      }
    },
    use_form_data: async () =>
      buildFormSlice(SKILLS.find((s) => s.id === skillId), form),
  };

  const messages = [{ role: 'user', content: buildSkill4AgentUserPrompt(form) }];
  let finalText = '';
  let iteration = 0;
  const SKILL4_MAX_ITERATIONS = 8;

  try {
    while (iteration++ < SKILL4_MAX_ITERATIONS) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: SKILL_MAX_TOKENS,
        system: [SKILL4_AGENT_SYSTEM_BLOCK],
        tools: SKILL4_TOOLS,
        messages,
      });

      if (response.stop_reason === 'refusal') {
        send({ type: 'skill_error', skillId, message: 'Refused by safety filters.' });
        return null;
      }

      for (const block of response.content) {
        if (block.type === 'text') finalText += block.text;
      }

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const toolUse of toolUses) {
          // The badge's tooltip surfaces the input verbatim — for a
          // get_confluence_page call, swap in the resolved title once we
          // know it, so the SE sees "Snowflake landing schema" instead
          // of an opaque page id.
          const rawInput = toolUse.input || {};
          const badgeInput =
            toolUse.name === 'get_confluence_page' && pageTitleById.has(rawInput.pageId)
              ? { ...rawInput, title: pageTitleById.get(rawInput.pageId) }
              : rawInput;

          send({
            type: 'tool_call_start',
            skillId,
            toolName: toolUse.name,
            input: badgeInput,
          });

          const handler = toolHandlers[toolUse.name];
          if (!handler) {
            send({
              type: 'tool_call_complete',
              skillId,
              toolName: toolUse.name,
              ok: false,
              count: 0,
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
            const result = await handler(rawInput);
            const ok = !result?._error;
            const count = typeof result?.count === 'number' ? result.count : undefined;
            // If get_confluence_page just resolved a title, patch the
            // completion event so the badge tooltip is right without a
            // second re-render.
            const completeInput =
              toolUse.name === 'get_confluence_page' && result?.title
                ? { ...rawInput, title: result.title }
                : undefined;
            send({
              type: 'tool_call_complete',
              skillId,
              toolName: toolUse.name,
              ok,
              count,
              input: completeInput,
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
              count: 0,
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

      break;
    }

    send({ type: 'skill_complete', skillId });
    return finalText.trim() || null;
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Skill 4 Confluence agent failed (${err.status}): ${err.message}`
        : err?.message || 'Skill 4 Confluence agent failed';
    console.error('Skill 4 Confluence agent error — falling back to static prompt', message);
    send({ type: 'skill_error', skillId, message });
    return null;
  }
}


// Skill 2: when GitHub is connected, run as a tool-using agent that searches
// the SE's accessible repos by client name and fetches SDK manifests from
// the top match. Falls back to runSkill (static prompt) when GitHub isn't
// connected or the agent loop fails / produces no output.
async function runSkill2GitHubAgent(client, form, githubSession, send) {
  const skillId = 'sdk_setup';
  send({ type: 'skill_start', skillId });

  const accessToken = githubSession?.access_token;

  const toolHandlers = {
    search_github_repos: async (input) => {
      if (!accessToken) {
        return { items: [], _reason: 'GitHub not connected — fall back to use_form_data.' };
      }
      try {
        return await searchClientRepos(accessToken, {
          clientName: input?.clientName || form.clientName,
        });
      } catch (err) {
        return { items: [], _error: err?.message || 'search failed' };
      }
    },
    fetch_repo_manifests: async (input) => {
      if (!accessToken) return { repo: input?.fullName, manifests: [], _reason: 'not connected' };
      try {
        return await fetchRepoManifests(accessToken, { fullName: input?.fullName });
      } catch (err) {
        return { repo: input?.fullName, manifests: [], _error: err?.message || 'fetch failed' };
      }
    },
    use_form_data: async () =>
      buildFormSlice(SKILLS.find((s) => s.id === skillId), form),
  };

  const messages = [{ role: 'user', content: buildSkill2UserPrompt(form) }];
  let finalText = '';
  let iteration = 0;

  try {
    while (iteration++ < SKILL2_MAX_ITERATIONS) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: SKILL_MAX_TOKENS,
        system: [SKILL2_SYSTEM_BLOCK],
        tools: SKILL2_TOOLS,
        messages,
      });

      if (response.stop_reason === 'refusal') {
        send({ type: 'skill_error', skillId, message: 'Refused by safety filters.' });
        return null;
      }

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
            // Treat a successful API call as ok=true even if it returned
            // zero items — the UI shouldn't flag a no-results search as
            // failed. Real failures populate `_error`. The UI uses `count`
            // to differentiate "call succeeded with content" (green) from
            // "call succeeded but empty" (amber).
            const ok = !result?._error;
            let count;
            if (toolUse.name === 'search_github_repos') {
              count = Array.isArray(result?.items) ? result.items.length : 0;
            } else if (toolUse.name === 'fetch_repo_manifests') {
              count = Array.isArray(result?.manifests) ? result.manifests.length : 0;
            }
            send({ type: 'tool_call_complete', skillId, toolName: toolUse.name, ok, count });
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

      break;
    }

    send({ type: 'skill_complete', skillId });
    return finalText.trim() || null;
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Skill 2 GitHub call failed (${err.status}): ${err.message}`
        : err?.message || 'Skill 2 GitHub call failed';
    console.error('Skill 2 GitHub error — falling back to static prompt', message);
    return null;
  }
}

async function runSkill(client, skill, form, send, { skipLifecycle = false } = {}) {
  if (!skipLifecycle) send({ type: 'skill_start', skillId: skill.id });
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
    if (!skipLifecycle) send({ type: 'skill_error', skillId: skill.id, message });
    return null;
  }
}

// Skill 5: when a Google (or Microsoft) calendar is connected, fetch a
// compact calendar context (engineering free/busy + SE meeting density
// around the target go-live date) and run the timeline skill with that
// context in the prompt. Falls back to the static runSkill path when no
// calendar is connected or the fetch fails.
// Heuristic floor — used only if the LLM risk-assessment call below fails.
// Counts calendar busy minutes against a 21-day window. Misses date-range
// conflicts buried in free-text notes (e.g. "PTO 5-9 Aug" overlapping
// go-live week), which is why the LLM assessment is the primary path.
const TIMELINE_WINDOW_MINUTES = 21 * 8 * 60;
function computeTimelineRiskHeuristic({ targetGoLiveDate, engBusyMinutes, seBusyMinutes }) {
  const target = targetGoLiveDate ? Date.parse(targetGoLiveDate) : NaN;
  const daysToGoLive = Number.isFinite(target)
    ? Math.max(0, Math.round((target - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const engRatio = (engBusyMinutes || 0) / TIMELINE_WINDOW_MINUTES;
  const seRatio = (seBusyMinutes || 0) / TIMELINE_WINDOW_MINUTES;
  const maxRatio = Math.max(engRatio, seRatio);

  if (daysToGoLive !== null && daysToGoLive < 7) return 'red';
  if (maxRatio > 0.6 && (daysToGoLive === null || daysToGoLive < 21)) return 'red';
  if (maxRatio > 0.4) return 'amber';
  if (daysToGoLive !== null && daysToGoLive < 14) return 'amber';
  return 'green';
}

// Primary risk assessment: short, focused Claude call that reads the
// free-text notes alongside the calendar numbers and outputs a structured
// {risk_level, rationale}. This catches conflicts the busy-minute heuristic
// can't see — e.g. "PTO 5-9 Aug" overlapping a 12 Aug go-live.
//
// We force structured output via tool_use rather than asking Claude to
// emit raw JSON — the previous text-then-regex approach occasionally
// extracted the wrong field when the model wrote its reasoning out loud
// before the JSON, or got truncated mid-rationale at max_tokens.
const RISK_ASSESSMENT_SYSTEM = `You assess go-live timeline risk for an MMP onboarding. Apply the rules below in order; STOP at the first matching rule.

Rules:
1. If ANY date range in se_notes or engineering_notes overlaps the go-live date or the 7 days before/after it → red. Common patterns: "PTO 5-9 Aug", "code freeze 8-12 Aug", "on leave 9-15 Aug". Parse loosely. Empty notes or notes that are literally "NA", "N/A", "none", or "n/a" carry no conflict signal — skip this rule.
2. If days_to_go_live < 7 → red.
3. If engineering_busy_minutes or se_busy_minutes exceeds 3000 AND days_to_go_live < 21 → red.
4. If days_to_go_live < 14 → amber.
5. If engineering_busy_minutes or se_busy_minutes exceeds 1800 → amber.
6. Otherwise → green.

Then call the report_timeline_risk tool with the matched level and a one-sentence rationale naming the specific trigger.`;

const RISK_ASSESSMENT_TOOL = {
  name: 'report_timeline_risk',
  description: 'Report the timeline risk assessment derived from applying the rules in order.',
  input_schema: {
    type: 'object',
    properties: {
      risk_level: {
        type: 'string',
        enum: ['green', 'amber', 'red'],
        description: 'The matched risk level.',
      },
      rationale: {
        type: 'string',
        description:
          'One short sentence naming the specific trigger — the rule that matched, the overlapping date range, the busy minute count, or "no conflicts found" for green.',
      },
    },
    required: ['risk_level', 'rationale'],
    additionalProperties: false,
  },
};

async function assessTimelineRisk(client, form, calendarContext) {
  const targetGoLiveDate =
    calendarContext?.target_go_live_date || form?.targetGoLiveDate || null;
  const target = targetGoLiveDate ? Date.parse(targetGoLiveDate) : NaN;
  const daysToGoLive = Number.isFinite(target)
    ? Math.max(0, Math.round((target - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const engBusyMinutes = calendarContext?.engineering_calendar?.total_busy_minutes || 0;
  const seBusyMinutes = calendarContext?.se_calendar?.total_busy_minutes || 0;
  const seNotes = form?.seAvailabilityNotes?.trim() || '';
  const engNotes = form?.engineeringAvailabilityNotes?.trim() || '';

  const heuristic = computeTimelineRiskHeuristic({
    targetGoLiveDate,
    engBusyMinutes,
    seBusyMinutes,
  });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: RISK_ASSESSMENT_SYSTEM,
      tools: [RISK_ASSESSMENT_TOOL],
      tool_choice: { type: 'tool', name: 'report_timeline_risk' },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            today: new Date().toISOString().split('T')[0],
            target_go_live_date: targetGoLiveDate,
            days_to_go_live: daysToGoLive,
            engineering_busy_minutes: engBusyMinutes,
            se_busy_minutes: seBusyMinutes,
            se_notes: seNotes,
            engineering_notes: engNotes,
          }),
        },
      ],
    });

    const toolUse = response.content?.find((b) => b.type === 'tool_use' && b.name === 'report_timeline_risk');
    const input = toolUse?.input;
    if (input && ['green', 'amber', 'red'].includes(input.risk_level)) {
      return {
        riskLevel: input.risk_level,
        rationale: typeof input.rationale === 'string' ? input.rationale : null,
      };
    }
  } catch (err) {
    console.error('Timeline risk assessment failed — using heuristic', err?.message || err);
  }
  return { riskLevel: heuristic, rationale: null };
}

async function runSkill5CalendarAgent(client, form, calendarContext, send) {
  const skillId = 'timeline';
  send({ type: 'skill_start', skillId });
  // Push a structured context summary to the pipeline UI so the SE can
  // see at-a-glance which signals fed the timeline analysis (engineering
  // busy minutes, SE busy minutes, SE-provided notes).
  const targetGoLiveDate =
    calendarContext?.target_go_live_date || form?.targetGoLiveDate || null;
  const { riskLevel, rationale } = await assessTimelineRisk(client, form, calendarContext);
  send({
    type: 'skill_context',
    skillId,
    context: {
      source: calendarContext?.source || 'calendar',
      window: calendarContext?.window || null,
      engineering: calendarContext?.engineering_calendar || null,
      se: calendarContext?.se_calendar || null,
      seNotes: form?.seAvailabilityNotes?.trim() || null,
      engNotes: form?.engineeringAvailabilityNotes?.trim() || null,
      targetGoLiveDate,
      riskLevel,
      riskRationale: rationale,
    },
  });
  // Surface that we hit a calendar so the UI can show a tool badge,
  // mirroring how Skill 1 surfaces Salesforce.
  send({
    type: 'tool_call_start',
    skillId,
    toolName: calendarContext?.source || 'calendar',
    input: { window: calendarContext?.window },
  });
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: SKILL_MAX_TOKENS,
      system: [SKILL5_SYSTEM_BLOCK],
      messages: [
        {
          role: 'user',
          content: buildSkill5UserPrompt(form, calendarContext),
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
        type: 'tool_call_complete',
        skillId,
        toolName: calendarContext?.source || 'calendar',
        ok: false,
      });
      send({ type: 'skill_error', skillId, message: 'Refused by safety filters.' });
      return null;
    }

    send({
      type: 'tool_call_complete',
      skillId,
      toolName: calendarContext?.source || 'calendar',
      ok: true,
    });
    send({ type: 'skill_complete', skillId });
    return output.trim() || null;
  } catch (err) {
    send({
      type: 'tool_call_complete',
      skillId,
      toolName: calendarContext?.source || 'calendar',
      ok: false,
    });
    const message =
      err instanceof Anthropic.APIError
        ? `Skill 5 calendar call failed (${err.status}): ${err.message}`
        : err?.message || 'Skill 5 calendar call failed';
    console.error('Skill 5 calendar error — falling back to static prompt', message);
    return null;
  }
}

async function streamDoc(client, docType, form, ragContext, skillOutputs, send) {
  const { builder, system } = DOC_BUILDERS[docType];

  const run = async () => {
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
  };

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`${docType} generation timed out after ${DOC_STREAM_TIMEOUT_MS / 1000}s`)),
      DOC_STREAM_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([run(), timeout]);
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `${docType} generation failed (${err.status}): ${err.message}`
        : err?.message || `${docType} generation failed`;
    send({ type: `${docType}_error`, message });
  }
}

async function runAgent(client, form, ragContext, docTypes, sfSession, atlSession, calendarContext, githubSession, send) {
  // Skills 1-5 run in parallel — no inter-skill dependencies.
  // Skill 1: Salesforce tool-using agent (Phase 2).
  // Skill 2: GitHub tool-using agent (Phase 5) when GitHub is connected;
  //          falls back to the static runSkill path when it isn't or fails.
  // Skill 4: Confluence MCP agent (Phase 3) when Atlassian is connected;
  //          falls back to the static runSkill path when it isn't or fails.
  // Skill 5: Calendar-aware agent (Phase 4) when Google/MS Calendar is
  //          connected and a calendar context was successfully fetched.
  const skillResults = await Promise.all(
    SKILLS.map(async (skill) => {
      if (skill.id === 'client_info') {
        const { output } = await runSkill1Agent(client, form, sfSession, send);
        return { id: skill.id, output };
      }
      if (skill.id === 'sdk_setup' && githubSession?.access_token) {
        // GitHub's hosted MCP server rejects our classic OAuth-app tokens
        // (needs Copilot-issued ones), so Skill 2 stays on the Vercel-side
        // REST tool-using agent from Phase 5 — same grounding, no MCP.
        const skillOutput = await runSkill2GitHubAgent(client, form, githubSession, send);
        if (skillOutput) return { id: skill.id, output: skillOutput };
        return {
          id: skill.id,
          output: await runSkill(client, skill, form, send, { skipLifecycle: true }),
        };
      }
      if (skill.id === 'tech_env' && atlSession?.access_token) {
        // Direct Confluence REST call — every MCP path we tried against
        // Atlassian's Rovo server (Vercel Edge in Phase 3, Render in
        // Phase 6) hit unbounded server-side latency. REST is fast and
        // reliable and grounds Skill 4 in real Confluence content.
        const skillOutput = await runSkill4ConfluenceAgent(client, form, atlSession, send);
        if (skillOutput) return { id: skill.id, output: skillOutput };
        return {
          id: skill.id,
          output: await runSkill(client, skill, form, send, { skipLifecycle: true }),
        };
      }
      if (skill.id === 'timeline' && calendarContext) {
        const skillOutput = await runSkill5CalendarAgent(client, form, calendarContext, send);
        if (skillOutput) return { id: skill.id, output: skillOutput };
        return {
          id: skill.id,
          output: await runSkill(client, skill, form, send, { skipLifecycle: true }),
        };
      }
      if (
        skill.id === 'timeline' &&
        (form?.seAvailabilityNotes?.trim() || form?.engineeringAvailabilityNotes?.trim())
      ) {
        // No calendar connected but the SE typed availability notes — still
        // run the LLM risk assessment on those notes alone so date-range
        // conflicts (PTO, code freezes) still color the card correctly.
        const targetGoLiveDate = form?.targetGoLiveDate || null;
        const { riskLevel, rationale } = await assessTimelineRisk(client, form, null);
        send({
          type: 'skill_context',
          skillId: 'timeline',
          context: {
            source: 'notes_only',
            seNotes: form.seAvailabilityNotes?.trim() || null,
            engNotes: form.engineeringAvailabilityNotes?.trim() || null,
            targetGoLiveDate,
            riskLevel,
            riskRationale: rationale,
          },
        });
      }
      return { id: skill.id, output: await runSkill(client, skill, form, send) };
    })
  );

  const skillOutputs = Object.fromEntries(
    skillResults.filter((r) => r.output).map((r) => [r.id, r.output])
  );

  // Skill 6: compile docs one at a time so each finishes reliably within the
  // Vercel function limit and streams visible progress to the client.
  send({ type: 'skill_start', skillId: REVIEW_SKILL_ID });
  for (const docType of docTypes) {
    send({ type: 'doc_compile_start', docType });
    await streamDoc(client, docType, form, ragContext, skillOutputs, send);
    send({ type: 'doc_compile_complete', docType });
  }
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

  // Phase 4: refresh the Google session up-front and fetch the calendar
  // context once. The form lives on `body` directly for full generation
  // and on `body.form` for single-doc regenerate.
  const storedGoogleSession = await readGoogleSession(req);
  const { session: googleSession, refreshedSession: googleRefreshed } =
    await ensureFreshGoogleSession(storedGoogleSession);
  const formForCalendar = body.docType && body.form ? body.form : body;
  let calendarContext = null;
  if (googleSession?.access_token) {
    calendarContext = await fetchCalendarContext(googleSession, formForCalendar);
  }

  // Phase 5: refresh the GitHub session up-front. The Skill 2 tool-using
  // agent reads tokens off it directly; if not connected, githubSession
  // stays null and Skill 2 falls back to the static-prompt path.
  const storedGitHubSession = await readGitHubSession(req);
  const { session: githubSession, refreshedSession: githubRefreshed } =
    await ensureFreshGitHubSession(storedGitHubSession);

  // Headers we may append refreshed-session Set-Cookies onto.
  const extraHeaders = new Headers(SSE_HEADERS);
  if (atlRefreshed) {
    for (const cookie of await buildAtlassianSessionCookies(atlRefreshed)) {
      extraHeaders.append('Set-Cookie', cookie);
    }
  }
  if (googleRefreshed) {
    extraHeaders.append('Set-Cookie', await buildGoogleSessionCookie(googleRefreshed));
  }
  if (githubRefreshed) {
    extraHeaders.append('Set-Cookie', await buildGitHubSessionCookie(githubRefreshed));
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
        calendarContext,
        githubSession,
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
      calendarContext,
      githubSession,
      send
    );
  });

  return new Response(stream, { headers: extraHeaders });
}
