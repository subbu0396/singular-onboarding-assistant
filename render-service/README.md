# mmp-onboarding-mcp

Long-lived Node service that runs the MCP-heavy analyst skills for the main app. Sits alongside the Vercel front-end; the front-end proxies MCP calls to this service so they aren't bound by Vercel's serverless timeout budget.

- **What runs here:** Skill 2 (Mobile SDK Setup via the GitHub MCP server) and Skill 4 (Technical Environment via Atlassian's Rovo MCP server).
- **What still runs on Vercel:** Everything else — form UI, OAuth flows, session cookies, RAG, doc streaming, and the non-MCP paths for every skill (which are the fallback when this service isn't configured or a call fails).

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/health` | — | `{ok, service, ts}` |
| `POST` | `/skill4/mcp` | `{form, atlAccessToken}` | `{output, toolCalls, stop_reason}` |
| `POST` | `/skill2/mcp` | `{form, ghAccessToken}` | `{output, toolCalls, stop_reason}` |

All non-`/health` requests require `Authorization: Bearer <MCP_SERVICE_SECRET>`.

## Env vars

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Same key as Vercel — this service also calls Anthropic |
| `MCP_SERVICE_SECRET` | Shared secret Vercel presents on every request |
| `ATLASSIAN_MCP_URL` | Optional — override the Confluence MCP server URL |
| `GITHUB_MCP_URL` | Optional — override the GitHub MCP server URL |
| `PORT` | Provided by Render at runtime |

## Deploy to Render

1. In [Render dashboard](https://dashboard.render.com/) → **New** → **Blueprint**
2. Connect the `singular-onboarding-assistant` repo and pick `render-service/render.yaml`
3. Set the three secrets (`ANTHROPIC_API_KEY`, `MCP_SERVICE_SECRET`; leave the MCP URL overrides blank unless you're pointing at a different server)
4. Deploy. Note the public URL (e.g. `https://mmp-onboarding-mcp.onrender.com`).
5. Back in Vercel project settings → env vars:
   - `MCP_SERVICE_URL` = the Render URL from step 4
   - `MCP_SERVICE_SECRET` = the same secret as on Render
6. Trigger a Vercel redeploy so both new env vars take effect.

Once both sides are configured, Skills 2 and 4 will automatically proxy through this service. If either env var is unset or the service is unreachable, the Vercel front-end quietly falls back to the existing REST paths — the onboarding pipeline always completes.

## Local dev

```bash
cd render-service
npm install
ANTHROPIC_API_KEY=... MCP_SERVICE_SECRET=dev-secret npm run dev
# Service starts on http://localhost:10000
# Point Vercel-dev's MCP_SERVICE_URL at http://localhost:10000
```
