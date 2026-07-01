// Small wrapper around Anthropic's Messages API with the MCP connector.
// We call the HTTP API directly rather than pull in @anthropic-ai/sdk —
// the SDK has historically dropped mcp_servers.authorization_token during
// serialization on some versions (that's why the Vercel-side Skill 4
// switched to raw fetch too). Raw fetch is the safest transport for the
// beta feature.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MCP_BETA = 'mcp-client-2025-11-20';

export async function callWithMcp({
  model,
  maxTokens,
  system,
  userPrompt,
  mcpServerName,
  mcpServerUrl,
  authorizationToken,
  timeoutMs = 5 * 60 * 1000,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': MCP_BETA,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userPrompt }],
        mcp_servers: [
          {
            type: 'url',
            url: mcpServerUrl,
            name: mcpServerName,
            authorization_token: authorizationToken,
          },
        ],
        tools: [{ type: 'mcp_toolset', mcp_server_name: mcpServerName }],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic MCP call failed (${response.status}): ${body}`);
  }
  return await response.json();
}

// Walk the response's content blocks and produce a compact
// {output, toolCalls} shape that the Vercel front-end can turn back into
// per-tool SSE events for the UI.
export function summarizeMcpResponse(message) {
  const output = [];
  const toolCalls = [];
  const activeById = new Map();

  for (const block of message?.content || []) {
    if (block.type === 'text') {
      output.push(block.text);
    }
    if (block.type === 'mcp_tool_use') {
      const toolName = block.name || 'mcp_tool';
      activeById.set(block.id, toolName);
      toolCalls.push({ toolName, ok: true, input: block.input || {} });
    }
    if (block.type === 'mcp_tool_result') {
      const toolName = activeById.get(block.tool_use_id) || 'mcp_tool';
      activeById.delete(block.tool_use_id);
      const idx = toolCalls.findIndex(
        (c) => c.toolName === toolName && c.ok === true && c._closed !== true
      );
      if (idx >= 0) {
        toolCalls[idx].ok = !block.is_error;
        toolCalls[idx]._closed = true;
      } else {
        toolCalls.push({ toolName, ok: !block.is_error });
      }
    }
  }

  return {
    output: output.join('').trim() || null,
    toolCalls: toolCalls.map(({ _closed, ...c }) => c),
    stop_reason: message?.stop_reason || null,
  };
}
