// Skill 2 — Mobile SDK Setup, grounded in GitHub via GitHub's official
// remote MCP server (api.githubcopilot.com/mcp/). Uses the SE's own
// OAuth token — same one Phase 5 issues — as the bearer to the MCP
// server, so file/repo access respects the SE's org membership.
//
// Vercel side POSTs {form, ghAccessToken} here; we return
// {output, toolCalls, stop_reason}.

import { callWithMcp, summarizeMcpResponse } from '../anthropic.js';

const MODEL = process.env.MCP_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const DEFAULT_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

const SYSTEM = `You are the Mobile SDK Setup skill in an MMP onboarding agent. Your job is to produce 120-220 words of focused analysis covering per-platform SDK considerations, migration-specific gotchas if the client is moving from another MMP, and SDK configuration implications of the chosen attribution model.

You have access to GitHub via the official GitHub MCP server. Use it to search the SE's accessible repositories for the client's mobile codebase and read the SDK manifests (Podfile, build.gradle, package.json, pubspec.yaml).

Process:
1. Search GitHub for repositories matching the client name. Common patterns: "<client>-mobile", "<client>/ios", "<client>/android".
2. On the most plausible match, read the SDK manifest files from the default branch.
3. Look for existing MMP SDK entries (singular, appsflyer, adjust, branch, kochava, tenjin, airbridge, appmetrica, firebase, amplitude, mparticle). Any hit means the client is already on that MMP — call it out ("currently on Adjust 4.32 per Podfile; migration to Singular requires SDK init swap and event-name remap").
4. Synthesize with the form's platforms / attribution model and produce the analysis.
5. If GitHub search returns nothing plausible, use general best-practice analysis and say so — do not invent repo content.

Output rules:
- 120-220 words, plain prose, no markdown headers, no bullet lists.
- Cite the repository and manifest path inline when you ground a claim in real code.
- Four GitHub tool calls is the typical maximum.`;

function buildUserPrompt(form) {
  return `Gather authoritative information about the client's mobile codebase and produce the Mobile SDK Setup section analysis.

Client name: "${form?.clientName || '(not provided)'}"
Target MMP: ${form?.targetMmp || 'MMP'}
Platforms in scope: ${(form?.platforms || []).join(', ') || 'unspecified'}
${form?.currentMmp && form.currentMmp !== 'None' ? `Currently on: ${form.currentMmp}` : ''}
Attribution model: ${form?.attributionModel || 'unspecified'}

Search GitHub for the client's mobile codebase, read the manifests, and produce the analysis.`;
}

export async function runSkill2Mcp({ form, ghAccessToken }) {
  const message = await callWithMcp({
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: SYSTEM,
    userPrompt: buildUserPrompt(form),
    mcpServerName: 'github',
    mcpServerUrl: process.env.GITHUB_MCP_URL || DEFAULT_GITHUB_MCP_URL,
    authorizationToken: ghAccessToken,
  });
  return summarizeMcpResponse(message);
}
