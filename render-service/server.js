// MCP-heavy analyst skills, run out of a long-lived Node process instead of
// Vercel serverless. Vercel's edge / serverless timeouts (25–300s depending
// on plan) proved too tight for Anthropic's MCP connector calls against
// Atlassian's Rovo MCP server during Phase 3 — the vendor server takes
// long enough on cold connections that we consistently hit the runtime
// budget with no response. This service holds each MCP call open as long
// as it needs (~2–3 minutes worst case) and returns a fully-formed
// {output, toolCalls} payload the Vercel front-end can turn into SSE
// tool_call events for the UI.
//
// Routes:
//   GET  /health                → simple liveness check
//   POST /skill4/mcp            → Confluence MCP (Atlassian Rovo)
//   POST /skill2/mcp            → GitHub MCP (GitHub's official server)
//
// Auth: every non-health request must carry Authorization: Bearer <MCP_SERVICE_SECRET>.
// Vercel is the only client; the secret is a shared long-random string,
// rotated in Vercel + Render env vars together.

import express from 'express';
import { runSkill4Mcp } from './skills/skill4.js';
import { runSkill2Mcp } from './skills/skill2.js';

const PORT = process.env.PORT || 10000;

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mmp-onboarding-mcp', ts: Date.now() });
});

function requireSharedSecret(req, res, next) {
  const configured = process.env.MCP_SERVICE_SECRET?.trim();
  if (!configured) {
    return res.status(500).json({
      error: 'MCP_SERVICE_SECRET is not configured on the Render service.',
    });
  }
  const authHeader = req.header('authorization') || '';
  const presented = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented || presented !== configured) {
    return res.status(401).json({ error: 'invalid shared secret' });
  }
  next();
}

app.post('/skill4/mcp', requireSharedSecret, async (req, res) => {
  const { form, atlAccessToken } = req.body || {};
  if (!atlAccessToken) {
    return res.status(400).json({ error: 'atlAccessToken is required' });
  }
  try {
    const result = await runSkill4Mcp({ form, atlAccessToken });
    res.json(result);
  } catch (err) {
    console.error('skill4 mcp failed', err?.message || err);
    res.status(502).json({
      error: 'skill4 mcp failed',
      detail: err?.message || String(err),
    });
  }
});

app.post('/skill2/mcp', requireSharedSecret, async (req, res) => {
  const { form, ghAccessToken } = req.body || {};
  if (!ghAccessToken) {
    return res.status(400).json({ error: 'ghAccessToken is required' });
  }
  try {
    const result = await runSkill2Mcp({ form, ghAccessToken });
    res.json(result);
  } catch (err) {
    console.error('skill2 mcp failed', err?.message || err);
    res.status(502).json({
      error: 'skill2 mcp failed',
      detail: err?.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mmp-onboarding-mcp listening on :${PORT}`);
});
