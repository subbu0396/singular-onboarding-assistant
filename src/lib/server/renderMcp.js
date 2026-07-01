// Thin client for the Render-hosted MCP service.
//
// Skills 2 and 4 call this when MCP_SERVICE_URL is set — the Render side
// runs the Anthropic MCP-connector call against Atlassian (Confluence) or
// GitHub with real timeout budget, then returns a summarized
// {output, toolCalls, stop_reason} shape that the caller turns back into
// tool_call_start / tool_call_complete SSE events for the pipeline UI.
//
// When MCP_SERVICE_URL is unset or the call fails, callers fall through
// to their existing REST paths — same graceful-fallback pattern as
// before, just relocated.

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

export function isRenderMcpConfigured() {
  return Boolean(
    process.env.MCP_SERVICE_URL?.trim() && process.env.MCP_SERVICE_SECRET?.trim()
  );
}

async function postJson(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const baseUrl = process.env.MCP_SERVICE_URL.trim().replace(/\/$/, '');
  const secret = process.env.MCP_SERVICE_SECRET.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Render MCP call failed (${res.status}): ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function callRenderSkill4Mcp({ form, atlAccessToken }) {
  return postJson('/skill4/mcp', { form, atlAccessToken });
}

export function callRenderSkill2Mcp({ form, ghAccessToken }) {
  return postJson('/skill2/mcp', { form, ghAccessToken });
}
