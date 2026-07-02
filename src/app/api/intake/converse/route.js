export const runtime = 'nodejs';
export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';
import {
  INTAKE_TOOL,
  INTAKE_TOOL_NAME,
  mergeIntakeIntoForm,
  validateIntakeInput,
} from '@/lib/server/intakeTool';
import { checkRateLimit, rateLimitResponse } from '@/lib/server/rateLimit';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 30;

const SYSTEM_PROMPT = `You are the intake copilot for a Singular Solutions Engineer. Your job is to gather enough context about a client onboarding to populate the ${INTAKE_TOOL_NAME} tool.

Conversation style:
- Ask one focused question per turn. Never dump a long list of questions.
- Prioritize the required fields first: clientName, targetMmp (which MMP they will use — Singular, AppsFlyer, Adjust, Branch, etc.), targetGoLiveDate.
- Once you have those three and a rough picture of platforms / current MMP / industry, call the ${INTAKE_TOOL_NAME} tool. The SE will edit anything missing on the form.
- Do NOT ask about every schema field one by one — the SE just wants to skip typing. Aim for 3–6 turns total.
- If the SE volunteers a lot upfront ("Rovio, iOS-first, target August 15, moving from AppsFlyer to Singular"), call the tool immediately with what you have and let missingFields carry the rest.

Rules for the tool call:
- Every enum value must match the schema exactly.
- targetGoLiveDate must be YYYY-MM-DD. If the SE says "mid-August" or "Q3", leave it null and add a confidenceNotes line.
- List every unpopulated field in missingFields.

Ground rules:
- Keep answers short. This is a data-collection chat, not a design conversation.
- Never invent fields the SE didn't mention. Missing is better than wrong.`;

function toClaudeMessages(history) {
  if (!Array.isArray(history)) return [];
  const filtered = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    // Cap per-message length so a pasted wall of text can't blow token limits
    // or become a prompt-injection surface. Truncated messages keep enough
    // signal for the model to still make progress on intake.
    .map((m) => ({
      role: m.role,
      content: m.content.length > MAX_MESSAGE_CHARS
        ? `${m.content.slice(0, MAX_MESSAGE_CHARS)}\n\n[…truncated by server]`
        : m.content,
    }));
  // Trim overall history to the most recent turns so a client that keeps
  // appending forever can't grow indefinitely.
  return filtered.slice(-MAX_HISTORY_TURNS);
}

// Convert Claude's structured content blocks back into a plain-text
// assistant message we can append to the client-side history. Tool_use
// blocks are handled separately via the intake_ready payload.
function extractAssistantText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export async function POST(req) {
  const limit = checkRateLimit(req, { bucket: 'intake', limit: 30, windowMs: 60_000 });
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not configured' },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messages = toClaudeMessages(body?.messages);
  if (messages.length === 0) {
    return Response.json({ error: 'messages is required' }, { status: 400 });
  }
  if (messages[messages.length - 1].role !== 'user') {
    return Response.json(
      { error: 'Last message must be from the user' },
      { status: 400 }
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [INTAKE_TOOL],
      system: SYSTEM_PROMPT,
      messages,
    });
  } catch (err) {
    console.error('intake converse failed', err);
    return Response.json(
      { error: 'Intake conversation failed', detail: String(err?.message || err) },
      { status: 502 }
    );
  }

  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === INTAKE_TOOL_NAME
  );

  if (toolUse) {
    // Run the same schema guardrail that Salesforce autofill uses: drop bad
    // enums, coerce bad dates to null, cap free-text length. droppedFields
    // is folded into missingFields so the SE sees what to review.
    const { input: validated } = validateIntakeInput(toolUse.input || {});
    const handoffText =
      extractAssistantText(response.content) ||
      "Here's what I captured. Review each section — edit anything I got wrong or left blank, then generate.";
    return Response.json({
      type: 'intake_ready',
      assistantText: handoffText,
      form: mergeIntakeIntoForm(validated),
      missingFields: validated.missingFields || [],
      confidenceNotes: validated.confidenceNotes || null,
      source: 'chat',
    });
  }

  const assistantText = extractAssistantText(response.content);
  return Response.json({
    type: 'assistant',
    assistantText: assistantText || "Could you tell me a bit more?",
    stopReason: response.stop_reason,
  });
}
