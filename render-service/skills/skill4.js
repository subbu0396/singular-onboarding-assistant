// Skill 4 — Technical Environment, grounded in Confluence via Atlassian's
// Rovo MCP server. Vercel side POSTs {form, atlAccessToken} here; we run
// the Anthropic MCP call against the Atlassian server with real timeout
// budget and return {output, toolCalls, stop_reason}.
//
// The system prompt mirrors what the Vercel-side Skill 4 uses so the
// generated docs read consistently regardless of which host ran the
// analysis.

import { callWithMcp, summarizeMcpResponse } from '../anthropic.js';

const MODEL = process.env.MCP_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const DEFAULT_ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v1/mcp/authv2';

const SYSTEM = `You are the Technical Environment skill in an MMP onboarding agent. Your job is to produce 120-220 words of focused technical analysis covering: backend-language SDK availability, warehouse landing patterns, CDP coexistence, and auth-method implications for postbacks and exports.

You have access to Confluence (via the Atlassian MCP server) containing internal integration runbooks, architecture patterns, and SE-authored notes from prior onboardings.

Process:
1. Derive 1-3 short search queries from the client's tech slice (backend language, warehouse presence, CDP name, auth method).
2. Search Confluence using those queries. Open the most relevant 1-2 pages.
3. Synthesize the page contents with the form's tech slice into the analysis. Where you pulled a specific operational pattern from a page, name the page title inline.
4. If a search returns nothing relevant, do not invent content from the page titles alone — fall back to general best-practice analysis and say so.

Output rules:
- 120-220 words, plain prose, no markdown headers, no bullet lists.
- No preamble ("Here is the analysis...") and no closing summary.
- Three Confluence tool calls is the maximum you should need.`;

function buildUserPrompt(form) {
  const slice = {
    backendLanguage: form?.backendLanguage,
    hasDataWarehouse: form?.hasDataWarehouse,
    usesCdp: form?.usesCdp,
    cdpName: form?.cdpName,
    authMethod: form?.authMethod,
  };
  return `Produce the Technical Environment section analysis.

Target MMP: ${form?.targetMmp || 'MMP'}

Client tech slice:
${JSON.stringify(slice, null, 2)}

Search Confluence for runbooks and patterns that fit this stack, then produce the analysis. Cite page titles inline when you pull from one.`;
}

export async function runSkill4Mcp({ form, atlAccessToken }) {
  const message = await callWithMcp({
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: SYSTEM,
    userPrompt: buildUserPrompt(form),
    mcpServerName: 'atlassian',
    mcpServerUrl: process.env.ATLASSIAN_MCP_URL || DEFAULT_ATLASSIAN_MCP_URL,
    authorizationToken: atlAccessToken,
  });
  return summarizeMcpResponse(message);
}
