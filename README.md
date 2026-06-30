# MMP Onboarding Assistant

> Generate tailored onboarding documents for any Mobile Measurement Platform (Singular, AppsFlyer, Adjust, Branch, Firebase, …) from a tech-stack form or a client SOW. Three docs, in parallel, streamed token-by-token, grounded in a curated knowledge base — plus optional live Salesforce CRM lookup.

**Live demo:** [singular-onboarding-assistant.vercel.app](https://singular-onboarding-assistant.vercel.app/)

<!-- Replace with an actual screenshot or 15-30s screen recording -->
![Screenshot placeholder — replace with a screen recording of the form-to-streaming-docs flow](docs/screenshot.png)

---

## The problem

Solutions engineers onboarding new clients to an MMP rewrite the same docs every time: a setup runbook, a client-facing FAQ, a QA checklist. The structure barely changes — only the names, SDKs, and integration stack swap. That's tens of hours of repeated work per quarter that adds nothing distinctive to the client experience.

## What this does

An SE fills a 5-section form — or uploads the client's SOW — and gets three tailored documents in ~30 seconds:

| Document | Audience | Purpose |
|---|---|---|
| **Integration Runbook** | Engineers | Step-by-step technical setup with SDK code, event mappings, postback config, data export setup |
| **FAQ Document** | Client team | 12–15 anticipated questions with precise answers — attribution logic, postback delays, dashboard access |
| **Test Checklist** | QA | Pass/fail validation steps for SDK init, event firing, attribution flows, edge cases |

Each is markdown-formatted, specific to the client's tech stack and chosen MMP, and streams to the UI as it's generated.

## What's interesting about it (architecturally)

This isn't a single LLM call. It's a six-skill agent pipeline:

```
User submits form
      │
      ▼
┌───────────────────────────────────────────────────────────────┐
│  Skill 1: Client Info           ─┐                            │
│   (tool-using agent —            │                            │
│    Salesforce OR form data)      │                            │
│  Skill 2: Mobile SDK Setup       │                            │
│  Skill 3: Integration Type       ├─ parallel  ~5 s            │
│  Skill 4: Technical Environment  │                            │
│  Skill 5: Go-Live Timeline      ─┘                            │
│                                                               │
│  Skill 6: Review & Compile                                    │
│   ├─ Runbook    ─┐                                            │
│   ├─ FAQ        ├─ parallel, streaming    ~15–20 s            │
│   └─ Checklist  ─┘                                            │
└───────────────────────────────────────────────────────────────┘
      │
      ▼
Three tabs filling concurrently
```

Each analyst skill is a focused LLM call that reads its slice of the form and produces 120–220 words of considerations (industry-specific defaults, gotchas, regional regulatory notes). Skill 1 is a **real Claude tool-using agent** — the model decides whether to look up the client in Salesforce CRM or fall back to form data, and the runbook reflects that choice. The Review skill takes all five analyses and writes three documents in parallel, seeded with that context.

A few PM-level decisions that shaped the build:

- **Three documents, not one.** Engineers, the client team, and QA each need different things from the same input. Three tabs, one form.
- **Stream the output.** Time-to-first-token is ~1 s. Watching a runbook appear in real time feels fast; staring at a spinner for 30 seconds doesn't.
- **Specificity over flexibility.** Per-export-method operational hints (Snowflake → storage integrations + `MATCH_BY_COLUMN_NAME`; BigQuery → DTS + ingestion-time partitioning; SFTP → ed25519 + `.part` atomic rename) were the single biggest jump in output quality. Generic prompts produce generic docs.
- **Accelerate judgment, don't replace it.** The output is a strong first draft, not a deliverable. SEs still review and adapt — the goal is to skip the blank-page problem.

## Tech stack

- **Frontend / Backend:** [Next.js 16](https://nextjs.org/) (App Router for API routes, Pages Router for the main page), React 18, Tailwind CSS
- **LLM:** [Anthropic Claude Sonnet 4.6](https://platform.claude.com/docs/) via the official [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — streaming, structured outputs, tool use
- **RAG:** [Supabase](https://supabase.com/) Postgres + `pgvector` for the knowledge base, [Voyage AI](https://www.voyageai.com/) (`voyage-3-lite`, 512-dim) for embeddings
- **OAuth session storage:** JWE-encrypted httpOnly cookies via [`jose`](https://github.com/panva/jose) (AES-256-GCM)
- **CRM integration:** Salesforce REST API via OAuth 2.0 web-server flow
- **Knowledge-base integration:** Atlassian Rovo Remote MCP server via Anthropic's MCP connector (`mcp-client-2025-11-20` beta), OAuth 2.0 (3LO) for the SE
- **PDF / DOCX export:** [`jspdf`](https://github.com/parallax/jsPDF) + [`html2canvas`](https://github.com/niklasvh/html2canvas), [`html-to-docx`](https://github.com/privateOmega/html-to-docx)
- **Deployment:** [Vercel](https://vercel.com/) — Edge runtime for API routes, automatic HTTPS, preview deployments per PR

## Key features

- **Six-skill agent pipeline** with per-skill progress indicators streamed to the UI
- **Document upload extraction** — drop a PDF SOW, Claude reads it natively via document blocks and auto-fills the form (`output_config.json_schema` for guaranteed-valid JSON output)
- **RAG over curated integration patterns** — pre-seeded patterns per MMP / export method / auth pattern surface in the prompt context based on the client's stack
- **Salesforce per-SE OAuth** — each SE connects their own SF account; tokens are encrypted in cookies and never reach the browser as readable text; CSRF state validation on the callback
- **Streaming SSE** with per-doc deltas buffered through `requestAnimationFrame` to avoid React jank during high-throughput token streams
- **Hardened API routes** — origin checks on the export endpoint, document content treated as untrusted input in the extract endpoint, abort-signal timeouts on outbound calls
- **Three export formats** — Markdown, PDF, DOCX, all generated client-side or via a same-origin endpoint with size caps

## Try it locally

### Prerequisites

- Node.js 22+
- A few API accounts (all have free tiers):
  - [Anthropic](https://console.anthropic.com/) for Claude
  - [Supabase](https://supabase.com/) for the RAG store
  - [Voyage AI](https://dash.voyageai.com/) for embeddings
  - *(Optional)* [Salesforce Developer Edition](https://developer.salesforce.com/signup) for the Skill 1 CRM integration

### Setup

```bash
git clone https://github.com/subbu0396/singular-onboarding-assistant.git
cd singular-onboarding-assistant
npm install

cp .env.example .env.local
# Fill in the env vars — see .env.example for the full list

npm run dev
# Open http://localhost:3000
```

### Salesforce OAuth (optional)

If you want Skill 1's tool-using agent to actually query Salesforce instead of falling back to form data:

1. In your Salesforce dev org → **Setup → App Manager → New Connected App**
2. Enable OAuth, set Callback URL = `http://localhost:3000/api/auth/salesforce/callback` (and your prod URL)
3. Scopes: `api`, `refresh_token` + `offline_access`, `id` + `profile` + `email`
4. Copy Consumer Key and Consumer Secret into `.env.local` as `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`
5. Generate a `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

The "Connect Salesforce" button in the header will then walk you through the OAuth flow.

### Atlassian / Confluence MCP (optional)

If you want Skill 4's Technical Environment analysis to pull from real Confluence pages via the Atlassian Rovo Remote MCP server instead of falling back to a static prompt:

1. Go to [developer.atlassian.com](https://developer.atlassian.com/console/myapps/) → **Create app** → **OAuth 2.0 (3LO) integration**
2. Set Callback URL = `http://localhost:3000/api/auth/atlassian/callback` (and your prod URL)
3. Add the **Confluence Cloud API** to your app and grant read scopes — by default this project asks for: `read:confluence-content.summary`, `read:confluence-content.all`, `read:confluence-space.summary`, `read:confluence-user`, `search:confluence`, `read:me`, `offline_access`. Override the set via `ATLASSIAN_OAUTH_SCOPES` (space-separated) if you want to broaden (e.g. add Jira) or narrow.
4. Copy the app's client ID and secret into `.env.local`:
   ```env
   ATLASSIAN_CLIENT_ID=...
   ATLASSIAN_CLIENT_SECRET=...
   ATLASSIAN_REDIRECT_URI=http://localhost:3000/api/auth/atlassian/callback
   # Optional — override default MCP URL or scope set:
   # ATLASSIAN_MCP_URL=https://mcp.atlassian.com/v1/mcp/authv2
   # ATLASSIAN_OAUTH_SCOPES="read:confluence-content.all search:confluence offline_access"
   ```
5. The "Connect Atlassian" button in the header walks the SE through OAuth. After connecting, Skill 4 calls Claude with the [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) pointed at `https://mcp.atlassian.com/v1/mcp/authv2`, passing the SE's access token. Claude picks Confluence tools (search, page fetch) based on the form's tech slice. If the call fails or Atlassian isn't connected, Skill 4 silently falls back to the static-prompt path so onboarding always completes.

### Seeding the RAG knowledge base (optional)

The RAG layer is a no-op if the Supabase + Voyage env vars aren't set — generations just don't get the pattern injection. To populate it:

1. Run the Supabase migration in `supabase/` to create the `integration_patterns` table with `pgvector`
2. Use the `/api/admin/add-pattern` route (gated by `ADMIN_TOKEN`) to add curated patterns, e.g.:

```bash
curl -X POST https://your-deploy.vercel.app/api/admin/add-pattern \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "Singular",
    "category": "data_export",
    "title": "Singular raw event export to Snowflake",
    "content": "1. Create a storage integration..."
  }'
```

## Project structure

```
src/
├── app/api/                              # App Router API routes
│   ├── auth/salesforce/                  #   OAuth (login, callback, logout, status)
│   ├── extract/                          #   PDF / text → structured JSON via Claude
│   ├── generate/                         #   The 6-skill agent pipeline
│   └── admin/add-pattern/                #   RAG knowledge-base ingest (gated)
├── pages/
│   ├── index.jsx                         # Main page (form + results)
│   └── api/export.js                     # DOCX export (Pages Router for the HTMLtoDOCX dep)
├── components/                           # React components — Form, ResultsTabs, SkillProgress, …
└── lib/
    ├── server/
    │   ├── claudeClient.js               #   Skill prompts, agent tool defs, RAG composition
    │   ├── salesforce.js                 #   SOQL query + token refresh (real & mock)
    │   └── session.js                    #   JWE cookie helpers
    ├── retrievePatterns.js               # RAG retrieval against Supabase
    ├── embeddings.js                     # Voyage embed client (with timeout)
    └── formConfig.js                     # Form sections + validation
```

## Status & roadmap

**Current:** Internal showcase / portfolio project. Phase 1 (agent pipeline), Phase 2 (Salesforce integration for Skill 1), and Phase 3 (Confluence MCP integration for Skill 4 via Anthropic's MCP connector) are live in production.

**Potential next steps** (not currently scheduled):
- Phase 4 — Calendar MCP for Skill 5 to anchor timelines to real engineering availability
- A "Salesforce Picker" UI for fuzzy account name search instead of strict equality
- Custom-field support in the Salesforce lookup (Platforms__c, Current_MMP__c, etc.)
- Surface MCP page citations as clickable links in the rendered analysis
- Output observability — surface `usage.cache_read_input_tokens` to verify prompt caching is firing

## License

[MIT](LICENSE)

## Credits

Built end-to-end with [Claude](https://claude.com/) and [Claude Code](https://claude.com/claude-code) — including the architecture decisions, the agent pipeline, the OAuth integration, and most of this README.
