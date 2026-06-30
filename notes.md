# MMP Onboarding Assistant — Build Notes

Personal progress log of what's been built, why, what broke along the way, and what's queued. Paste into Notion or read on GitHub. Reflects state through PR #17.

**Live demo:** [singular-onboarding-assistant.vercel.app](https://singular-onboarding-assistant.vercel.app/)
**Repo:** [subbu0396/singular-onboarding-assistant](https://github.com/subbu0396/singular-onboarding-assistant)

---

## One-line summary

A six-skill Claude agent pipeline that takes a 5-section onboarding form and emits three tailored client docs (Integration Runbook, FAQ, Test Checklist) in ~30 seconds, with each analyst skill optionally grounded in a real external system (Salesforce, Confluence, GitHub, Google Calendar) via per-SE OAuth.

---

## Phase status at a glance

| Phase | Skill grounded | Integration | Status |
|---|---|---|---|
| 1 | Pipeline foundation | — | Live |
| 2 | Skill 1 — Client Info | Salesforce REST (OAuth 3LO) | Live |
| 3 | Skill 4 — Technical Environment | Confluence REST (OAuth 3LO) | Live |
| 4 | Skill 5 — Go-Live Timeline | Google Calendar freeBusy + SE/Engg notes + LLM risk | Live |
| 5 | Skill 2 — Mobile SDK Setup | GitHub repo search + manifest fetch | Live |
| 6 (future) | — | Doc lifecycle: save / version / share via Supabase | Queued |
| — | Skill 3 — Integration Type | Still a static prompt | Open |

---

## Architectural patterns (reused across phases)

Every integration ended up following the same shape, which made each subsequent phase faster:

- **Per-SE OAuth** — four routes (`login`, `callback`, `status`, `logout`) under `/api/auth/<provider>/`. JWE-encrypted session cookie via `jose`. CSRF state cookie during round-trip. Refresh-token rotation rewrites the cookie on the SSE response.
- **Provider library** — `src/lib/server/<provider>.js` holds OAuth token exchange/refresh + API helpers. Always env-overridable URLs (endpoints, redirect URI, scopes) so different deployments don't fight each other.
- **Connect component** — `src/components/<Provider>Connect.jsx` mirrors the pattern: button → status badge → disconnect, all mounted in the header.
- **Skill wiring** — when the relevant session is present, the analyst skill runs as a tool-using agent (or with pre-fetched context); otherwise falls back to the original static-prompt path. Onboarding always completes regardless of which integrations are connected.

---

## Phase 1 — Agent Pipeline (foundation)

Pre-existing before this thread. Six skills running on Claude Sonnet 4.6:

1. Client Info → industry/market analysis
2. Mobile SDK Setup → per-platform SDK considerations
3. Integration Type → S2S vs SDK, export coupling
4. Technical Environment → backend / warehouse / CDP / auth
5. Go-Live Timeline → feasibility and risk
6. Review & Compile → writes the three docs in parallel from the five analyses

Edge runtime (later switched to Node, see Phase 3 notes), SSE streaming for token-by-token delivery, three doc tabs filling concurrently.

---

## Phase 2 — Salesforce for Skill 1

**Shipped before this thread; baseline pattern.** Skill 1 became a tool-using agent with two tools — `lookup_salesforce_client` (real SOQL via REST + token refresh on 401) and `use_form_data` (form fallback). Strict-equality match on Account name; SE enters the canonical client name.

---

## Phase 3 — Confluence for Skill 4 (the rabbit-hole phase)

The intended path was Anthropic's `mcp_servers` connector against the Atlassian Rovo Remote MCP server. The actually-working path is direct Confluence REST. Here's what happened.

**What got built first:** Full OAuth 2.0 (3LO) flow for Atlassian, raw-fetch call into Anthropic's MCP connector with the new `mcp-client-2025-11-20` beta, pointed at the Rovo MCP server.

**What kept failing:**
- SDK `@anthropic-ai/sdk@0.40.1` silently dropped `authorization_token` from `mcp_servers` entries → had to bypass the SDK with raw fetch.
- Atlassian's `/v1/mcp/authv2` endpoint requires OAuth 2.1 + Dynamic Client Registration (RFC 7591) + PKCE, not standard 3LO bearer tokens. Built the full DCR + PKCE flow.
- Even with DCR-issued tokens, the Anthropic MCP connector → Atlassian MCP server roundtrip exceeded Vercel's Edge runtime budget. Hit `300s` runtime kill before the call ever returned.
- Atlassian's org-level allowlist blocked the demo Atlassian site from authorizing the callback URL until the admin allowlisted it.

**Resolution:** Pivoted away from MCP connector to direct Confluence REST calls. The auth flow (3LO) and the OAuth Connect UI stay the same; Skill 4 calls `searchConfluence` + `getConfluencePage` directly via REST and feeds excerpts into the prompt. Switched the route from Edge to Node runtime (`runtime = 'nodejs'`, `maxDuration = 300`) to remove the timeout cliff. Cookie size also caused issues — chunked cookies (`buildAtlassianSessionCookies` returns N cookies for large tokens) so the JWE-encrypted Atlassian access token + scopes fits inside the per-cookie limit.

**Lessons:**
- "External system requires OAuth" can be three different OAuth flows in the same vendor.
- Vercel Edge runtime ≠ unlimited HTTP timeout — anything that hangs upstream hangs you.
- SDK version pinning matters; betas drift fast.
- Cookie size caps in browsers (~4KB per cookie) are real once you carry JWT-shaped access tokens around.

---

## Phase 4 — Google Calendar for Skill 5

Cleaner than Phase 3 because the OAuth shape was already proven. Google Cloud Console OAuth web client, scopes `openid email profile calendar.readonly`, `access_type=offline` + `prompt=consent` so refresh tokens actually get issued.

**What Skill 5 does:**
- Server fetches `freeBusy.query` for two calendars in parallel: `primary` (the SE's own) and `ENGINEERING_CALENDAR_ID` (a shared team calendar set via env var).
- Window is ±2 weeks around `targetGoLiveDate`.
- Result is summarized into compact `{busy_count, total_busy_minutes}` per calendar.
- Skill 5 runs with that context in the prompt and grounds its timeline analysis in real busy-minute counts.

**Bug pattern I hit twice (Phase 4 + Phase 5):** added a new argument to `runAgent`'s signature, used `replace_all` for the call-site update — only one of the two call sites (single-doc regenerate vs full generation) got updated because they had different indentation. Manifested as `vt/bt/yt/r is not a function` in a minified error with no real stack. Now I check both call sites explicitly.

**Additions after the base Phase 4 shipped:**
- **SE availability notes** (PR #12) — free-text textarea on the form for the SE to describe their own commitments (PTO, preferred windows). Goes into Skill 5's prompt as a "tier 2" signal, preferred over calendar when they conflict.
- **Engineering availability notes** (PR #15) — same shape, for engg-team commitments (code freezes, sprint locks, key engineer PTO).
- **Forced "Onboarding Schedule & Availability" runbook section** (PR #13) — Skill 6's runbook prompt now reserves a dedicated section for scheduling specifics so they don't get paraphrased away.
- **Pipeline context panel** (PR #14) — the Go-Live Timeline card in the agent orchestration row shows go-live date, engg busy minutes, SE busy minutes, and both notes excerpts inline, so the SE can see what signals fed the analysis without opening the docs.
- **Timeline risk coloring** (PR #15) — Go-Live Timeline card flips green / amber / red based on combined signals.
- **LLM risk assessment** (PR #16) — replaced a heuristic that ignored free-text date ranges (e.g. counted SE busy as 29% but missed "PTO 5-9 Aug" overlapping a 12 Aug go-live) with a short structured Claude call that reads both notes fields and outputs `{risk_level, rationale}`. The rationale now shows as a "Why: ..." line under the panel and as a tooltip on the risk badge.

**Open thread:** Microsoft Graph / Outlook Calendar was queued as a Phase 4 extension; deferred to focus on Google only.

---

## Phase 5 — GitHub for Skill 2

Classic GitHub OAuth app, scopes `read:user public_repo` (broadenable to `repo` for private codebases via `GITHUB_OAUTH_SCOPES`). Tool-using agent pattern mirroring Skill 1's Salesforce shape.

**Three tools** (`SKILL2_TOOLS` in `claudeClient.js`):
- `search_github_repos(clientName)` — calls `/search/repositories` against the SE's accessible orgs
- `fetch_repo_manifests(fullName)` — pulls Podfile, build.gradle, package.json, pubspec.yaml from the matching repo's default branch
- `use_form_data` — form-data fallback

**Server-side polish:**
- Heuristic MMP-vendor sniff over the manifest body. Each `fetch_repo_manifests` response includes a `detected_mmp_vendors` array (singular / appsflyer / adjust / branch / kochava / tenjin / airbridge / appmetrica / firebase / amplitude / mparticle).
- 8KB truncation per manifest so a giant lockfile can't blow the model's context.
- Lockfiles (Podfile.lock, yarn.lock, etc.) intentionally NOT in the manifest path list.

**Skill 2 output now reads** like "Currently on Adjust 4.32 per Podfile in airtel/mobile; migration to Singular requires SDK init swap and event-name remap" instead of generic install steps.

---

## Live env vars (Vercel project settings)

| Var | Phase | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | 1 | Claude calls |
| `SESSION_SECRET` | 2+ | 32-byte AES-256-GCM key for all JWE session cookies |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | 1 (RAG) | Vector store for integration patterns |
| `VOYAGE_API_KEY` | 1 (RAG) | 512-dim embeddings |
| `ADMIN_TOKEN` | 1 | Gate on `/api/admin/add-pattern` |
| `SALESFORCE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | 2 | Salesforce OAuth |
| `ATLASSIAN_CLIENT_ID` / `_SECRET` | 3 | Atlassian OAuth |
| `GOOGLE_CLIENT_ID` / `_SECRET` | 4 | Google OAuth |
| `ENGINEERING_CALENDAR_ID` | 4 | Shared engineering team calendar for Skill 5 free/busy |
| `GITHUB_CLIENT_ID` / `_SECRET` | 5 | GitHub OAuth |

All redirect URIs are derived from the incoming request host server-side, so each Vercel preview alias works without per-env URI config (except for the OAuth provider's own allowlist — those still need every alias added).

---

## Merged PRs (this thread's work)

| PR | Title | What it shipped |
|---|---|---|
| [#9](https://github.com/subbu0396/singular-onboarding-assistant/pull/9) | Phase 3: Skill 4 Confluence MCP integration via Atlassian Rovo | OAuth flow, MCP connector wiring, fallback path |
| [#10](https://github.com/subbu0396/singular-onboarding-assistant/pull/10) | Phase 4 (Google): Skill 5 grounded in real engineering + SE calendars | Google OAuth, freeBusy fetch, Skill 5 calendar-aware prompt |
| [#11](https://github.com/subbu0396/singular-onboarding-assistant/pull/11) | Fix Skill 5 missing-arg bug and header pill layout | Bug fix + UI compaction |
| [#12](https://github.com/subbu0396/singular-onboarding-assistant/pull/12) | Add SE availability notes as a third Skill 5 timeline signal | Free-text field for SE PTO/availability |
| [#13](https://github.com/subbu0396/singular-onboarding-assistant/pull/13) | Force an 'Onboarding Schedule & Availability' section in the runbook | Dedicated runbook section for scheduling specifics |
| [#14](https://github.com/subbu0396/singular-onboarding-assistant/pull/14) | Show Skill 5 calendar context + SE notes in the agent pipeline UI | `skill_context` SSE event, inline panel under the skill card |
| [#15](https://github.com/subbu0396/singular-onboarding-assistant/pull/15) | Color Go-Live Timeline card green/amber/red from combined SE + Engg availability | Engg notes field + risk coloring |
| [#16](https://github.com/subbu0396/singular-onboarding-assistant/pull/16) | Have Claude assess timeline risk so notes-based conflicts color the card | LLM risk assessment replaces heuristic |
| [#17](https://github.com/subbu0396/singular-onboarding-assistant/pull/17) | Phase 5: Skill 2 grounded in the client's actual GitHub codebase | GitHub OAuth, repo search + manifest fetch, Skill 2 tool-using agent |

---

## What's still queued

Listed roughly by impact-per-effort:

1. **Phase 6 — Doc lifecycle (Supabase).** Persist generated packages keyed by client + timestamp. Recent-generations list on the homepage. Shareable read-only `/share/[token]` URL per package. Lays groundwork for regeneration deltas. (Picked as next phase but not started.)
2. **Skill 3 grounding.** The only remaining static analyst skill. Most natural candidate is a write-action integration (Slack for kickoff coordination, or a different read source like a CDP config dump).
3. **Microsoft Graph for Skill 5.** Mirror Google for SEs on Outlook. Mostly mechanical — same shape as Google, just different endpoints.
4. **Salesforce Picker UI.** Fuzzy account-name search instead of strict equality. Would let SEs find the right Account without knowing the exact canonical name.
5. **Custom-field support in the Salesforce lookup.** `Platforms__c`, `Current_MMP__c`, etc., feeding richer client context into Skill 1.
6. **Output observability.** Surface `usage.cache_read_input_tokens` per skill so we can verify prompt caching is firing.

---

## Recurring gotchas (don't fall in these again)

- **Vercel env-var changes need a redeploy.** Empty commit on the branch triggers a preview rebuild; empty commit on main triggers prod.
- **OAuth redirect URIs are exact-match.** Every Vercel alias (preview hashes change per branch) needs to be added to the provider's allowlist. The redirect URI in the request and the allowlist must match character-for-character including protocol and trailing slash.
- **Browser cookie size cap (~4KB) is real.** Large JWE-encrypted tokens need chunking (see `buildAtlassianSessionCookies`) or aggressive payload trimming.
- **OAuth scopes need to be pre-registered on the consent screen.** Google silently drops scopes that aren't listed; manifests as `ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the first API call.
- **Google OAuth "Testing" mode** requires every test user to be added to the app's test-user list explicitly.
- **`replace_all` on a multi-line param block can miss call sites with different indentation.** Always verify with `grep` after.
- **Minified runtime errors in production give no useful stack.** Wrap risky sections in try/catch with `console.error(err?.stack || err)` so Vercel logs show the real frames.
