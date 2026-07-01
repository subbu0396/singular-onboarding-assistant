export const runtime = 'nodejs';
export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';
import { INTAKE_TOOL, INTAKE_TOOL_NAME, mergeIntakeIntoForm } from '@/lib/server/intakeTool';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

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
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
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
    const toolInput = toolUse.input || {};
    // Any text Claude emitted alongside the tool call becomes a friendly
    // handoff line ("Here's what I've captured — review and edit anything.").
    const handoffText =
      extractAssistantText(response.content) ||
      "Here's what I captured. Review each section — edit anything I got wrong or left blank, then generate.";
    return Response.json({
      type: 'intake_ready',
      assistantText: handoffText,
      form: mergeIntakeIntoForm(toolInput),
      missingFields: Array.isArray(toolInput.missingFields) ? toolInput.missingFields : [],
      confidenceNotes: toolInput.confidenceNotes || null,
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
