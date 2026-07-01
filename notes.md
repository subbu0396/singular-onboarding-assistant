# MMP Onboarding Assistant — Build Notes

Personal progress log of what's been built, why, what broke along the way, and what's queued. Paste into Notion or read on GitHub. Reflects state through PR #29.

**Live demo:** [singular-onboarding-assistant.vercel.app](https://singular-onboarding-assistant.vercel.app/)
**Repo:** [subbu0396/singular-onboarding-assistant](https://github.com/subbu0396/singular-onboarding-assistant)

---

## One-line summary

A six-skill Claude agent pipeline that takes a 5-section onboarding form and emits three tailored client docs (Integration Runbook, FAQ, Test Checklist) in ~30 seconds. Each analyst skill can be grounded in a real external system (Salesforce, Confluence, GitHub, Google Calendar) via per-SE OAuth. Every completed generation is auto-saved to Supabase with a 24-hour shareable read-only link.

---

## Phase status at a glance

| Phase | Skill grounded | Integration | Status |
|---|---|---|---|
| 1 | Pipeline foundation | — | Live |
| 2 | Skill 1 — Client Info | Salesforce REST (OAuth 3LO) | Live |
| 3 | Skill 4 — Technical Environment | Confluence REST tool loop (OAuth 3LO) | Live |
| 4 | Skill 5 — Go-Live Timeline | Google Calendar freeBusy + SE/Engg notes + LLM risk | Live |
| 5 | Skill 2 — Mobile SDK Setup | GitHub repo search + manifest fetch | Live |
| 6 | Companion service on Render | Attempted MCP-heavy skills off Vercel — retired | Artifact |
| 7 | Doc lifecycle | Supabase save + list + 24h share | Live |
| — | Skill 3 — Integration Type | Still a static prompt | Open |

---

## Architectural patterns (reused across phases)

Every integration ended up following the same shape, which made each subsequent phase faster:

- **Per-SE OAuth** — four routes (`login`, `callback`, `status`, `logout`) under `/api/auth/<provider>/`. JWE-encrypted session cookie via `jose`. CSRF state cookie during round-trip. Refresh-token rotation rewrites the cookie on the SSE response. Redirect URI is derived from the incoming request host so every Vercel alias works with the same OAuth app.
- **Provider library** — `src/lib/server/<provider>.js` holds OAuth token exchange/refresh + API helpers. Always env-overridable URLs (endpoints, redirect URI, scopes).
- **Connect component** — `src/components/<Provider>Connect.jsx` mirrors the pattern: button → status pill → disconnect. Now hidden behind a single `<IntegrationsMenu>` dropdown in the header so 4 pills don't crowd the layout.
- **Skill wiring** — when the relevant session is present, the analyst skill runs as a tool-using agent; otherwise falls back to the original static-prompt path. Onboarding always completes regardless of which integrations are connected.
- **Tool badges as SSE events** — every tool call emits `tool_call_start` / `tool_call_complete` with a `count` field and an optional `input.url`. The pipeline row UI renders each badge with 3-tier colour (green with hit count / amber ⚠ / grey with error) and turns it into a click-through link to the underlying artefact when a URL is attached.

---

## Phase 1 — Agent Pipeline (foundation)

Pre-existing before the recent work. Six skills running on Claude Sonnet 4.6:

1. Client Info → industry / market analysis
2. Mobile SDK Setup → per-platform SDK considerations
3. Integration Type → S2S vs SDK, export coupling
4. Technical Environment → backend / warehouse / CDP / auth
5. Go-Live Timeline → feasibility and risk
6. Review & Compile → writes the three docs in parallel from the five analyses

Edge runtime originally, later moved to Node runtime with `maxDuration=300` to accommodate longer tool loops. SSE streaming for token-by-token delivery. Three doc tabs filling concurrently.

---

## Phase 2 — Salesforce for Skill 1

**Baseline pattern.** Skill 1 became a tool-using agent with two tools — `lookup_salesforce_client` (SOQL via REST + token refresh on 401) and `use_form_data` (form fallback). Strict-equality match on Account name; SE enters the canonical client name.

---

## Phase 3 — Confluence for Skill 4 (the MCP rabbit-hole)

The intended path was Anthropic's `mcp_servers` connector against the Atlassian Rovo Remote MCP server. The path that actually ships is a Vercel-side tool-using agent hitting Confluence REST directly. Here's the arc.

**Round 1:** OAuth 2.0 (3LO) flow for Atlassian + raw fetch into Anthropic's MCP connector with the new `mcp-client-2025-11-20` beta pointed at `mcp.atlassian.com/v1/mcp/authv2`.
- SDK `@anthropic-ai/sdk@0.40.1` silently dropped `authorization_token` from `mcp_servers` entries — had to bypass the SDK with raw fetch.
- `authv2` endpoint requires OAuth 2.1 + Dynamic Client Registration (RFC 7591) + PKCE, not standard 3LO bearer tokens. Built the full DCR + PKCE flow.
- Even with DCR-issued tokens, the Anthropic MCP connector → Atlassian roundtrip exceeded Vercel's edge runtime budget. Hit `300s` runtime kill.
- Atlassian's org-level allowlist blocked the demo Atlassian site from authorizing the callback URL until the admin allowlisted it.

**Resolution.** Skill 4 currently uses a tool-using agent — Claude calls `search_confluence` and `get_confluence_page` tools that hit the Confluence REST API directly. The badges show what Claude actually searched for (one per axis of the client's tech stack) and link straight to the Confluence page. Site URL is re-derived from `accessible-resources` per Skill 4 run so the badges can carry fully-qualified `https://<site>.atlassian.net/wiki/...` URLs. Route runtime is `nodejs` + `maxDuration=300`, removing the timeout cliff.

Cookie size was another issue — large JWE-encrypted Atlassian access tokens + scopes were being silently dropped by browsers. Solution: `buildAtlassianSessionCookies` returns N cookies when the payload exceeds ~4KB, with a `count` cookie so the server knows how many chunks to reassemble.

**Lessons:**
- "External system requires OAuth" can be three different OAuth flows in the same vendor.
- Vercel Edge runtime ≠ unlimited HTTP timeout — anything that hangs upstream hangs you.
- SDK version pinning matters; betas drift fast.
- Cookie size caps in browsers (~4KB per cookie) are real once you carry JWT-shaped access tokens.
- Vendor MCP servers are still slow / restrictive enough that direct REST is more reliable for a real-time pipeline.

---

## Phase 4 — Google Calendar for Skill 5

Cleaner than Phase 3 because the OAuth shape was already proven. Google Cloud Console OAuth web client, scopes `openid email profile calendar.readonly`, `access_type=offline` + `prompt=consent` so refresh tokens actually get issued.

**What Skill 5 does:**
- Server fetches `freeBusy.query` for two calendars in parallel: `primary` (the SE's own) and `ENGINEERING_CALENDAR_ID` (a shared team calendar set via env var).
- Window is ±2 weeks around `targetGoLiveDate`.
- Result is summarised into `{busy_count, total_busy_minutes}` per calendar.
- Skill 5 runs with that context in the prompt and grounds its timeline analysis in real busy-minute counts.

**Bug pattern hit twice (Phase 4 + Phase 5):** added a new argument to `runAgent`'s signature, used `replace_all` for the call-site update — only one of the two call sites (single-doc regenerate vs full generation) got updated because they had different indentation. Manifested as `vt/bt/yt/r is not a function` in a minified error with no real stack. Now I check both call sites explicitly.

**Iterative Phase 4 improvements (a lot happened here):**
- **SE availability notes** — free-text textarea on the form for the SE to describe their own commitments (PTO, preferred windows). Goes into Skill 5's prompt as a "tier 2" signal, preferred over calendar when they conflict.
- **Engineering availability notes** — same shape, for engg-team commitments (code freezes, sprint locks, key engineer PTO).
- **Forced "Onboarding Schedule & Availability" runbook section** — Skill 6's runbook prompt reserves a dedicated section for scheduling specifics so they don't get paraphrased away.
- **Pipeline context panel** — the Go-Live Timeline card in the agent orchestration row shows go-live date, engg busy minutes, SE busy minutes, and both notes excerpts inline.
- **Timeline risk coloring** — Go-Live Timeline card flips green / amber / red based on combined signals.
- **LLM risk assessment via tool_use** — replaced a heuristic that ignored free-text date ranges (e.g. counted SE busy as 29% but missed "PTO 5–9 Aug" overlapping a 12 Aug go-live) with a structured Claude tool_use call that reads both notes fields and outputs `{risk_level, rationale}`. The rationale shows as a "Why: …" line under the panel and as a tooltip on the risk badge. Tool_use replaced free-text JSON regex parsing which was picking up the wrong field when the model wrote its reasoning out loud.

**Open thread:** Microsoft Graph / Outlook Calendar was queued as a Phase 4 extension; deferred.

---

## Phase 5 — GitHub for Skill 2

Classic GitHub OAuth app, scopes `read:user public_repo`. Tool-using agent pattern mirroring Skill 1's Salesforce shape.

**Three tools** in `SKILL2_TOOLS`:
- `search_github_repos(clientName)` — calls `/search/repositories` against the SE's accessible orgs
- `fetch_repo_manifests(fullName)` — pulls Podfile, build.gradle, package.json, pubspec.yaml from the matching repo's default branch
- `use_form_data` — form-data fallback

**Server-side polish:**
- Heuristic MMP-vendor sniff over the manifest body. Each response includes a `detected_mmp_vendors` array.
- 8KB truncation per manifest so a giant lockfile can't blow the model's context.
- Lockfiles (`Podfile.lock`, `yarn.lock`, etc.) intentionally NOT in the manifest path list.

**Skill 2 output now reads** like "Currently on Adjust 4.32 per Podfile in airtel/mobile; migration to Singular requires SDK init swap and event-name remap" instead of generic install steps.

**Recent badge improvements** (PR #27, #28):
- Every search badge now shows the specific query / repo / client in the label so a row of three Confluence searches doesn't look like duplicates.
- Every badge with a URL renders as a clickable link with a small ↗ marker.
- 3-tier colour differentiates "green with N results" from "amber empty result" from "grey with error tooltip".

---

## Phase 6 — Render companion service for MCP (retired)

Attempted to move the MCP-heavy skills off Vercel to a long-lived Node process on Render, so Anthropic's MCP connector wouldn't be bound by Vercel's serverless timeout.

**What shipped:** `/render-service/` — Express app with `/health`, `/skill4/mcp`, `/skill2/mcp` routes and a shared-secret auth header. Vercel front-end proxies MCP calls through this service via `MCP_SERVICE_URL` / `MCP_SERVICE_SECRET` env vars. `render.yaml` blueprint at the repo root.

**Why it retired:**
- **GitHub MCP** (`api.githubcopilot.com/mcp/`) rejects our classic OAuth-app tokens — it expects Copilot-issued ones. Skill 2's `/skill2/mcp` endpoint removed.
- **Atlassian Rovo MCP** (`mcp.atlassian.com/v1/mcp/authv2`) has unbounded response time in practice. Bumped internal timeout from 3 to 5 minutes and still hit it. Every submission fell back to Confluence REST anyway. Skill 4's Render call removed.

**Left in the repo** as an honest artifact of the experiment. If either vendor's MCP server speeds up or opens up, wiring it back in is a small change. `.vercelignore` ensures Vercel skips the subfolder.

---

## Phase 7 — Doc lifecycle (save, list, share)

Persist every completed generation to Supabase and give the SE a way to revisit / share past packages.

**Data.** `supabase/generations.sql` creates a `generations` table with `id, client_name, target_mmp, form_snapshot (jsonb), documents (jsonb), share_token, share_expires_at, created_at`. Indexed on `created_at DESC` and `share_token`. Runs on the existing `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — no new env vars.

**Server.**
- `src/lib/server/generations.js` — `saveGeneration`, `listRecentGenerations`, `getGenerationById`, `getGenerationByShareToken` (server-side 24h expiry check).
- `POST /api/generations` — auto-save on completion. Guards that all three docs are present + non-empty so half-finished pipelines don't pollute the list.
- `GET /api/generations` — top 10 rows for the "Recent Generated Forms" list.
- `GET /api/generations/[id]` — full row for the Open-past-generation flow.
- `GET /api/share/[token]` — full row minus the share token itself, with expiry check. 410 on expired, 404 on unknown.

**UI.**
- `<RecentGenerations>` under the form (top 10 rows, click Open to restore the results view without re-running the pipeline).
- `<ShareButton>` in the results header — copies the `/share/<token>` URL to clipboard with a small "expires in Xh" hint.
- `/share/[token]` — public read-only page. Server-side rendered via `getServerSideProps` so the token never reaches the client bundle. Renders the three docs in tabs, no form / no app navigation.

**Auto-save fires** exactly once per completed submission via a `useEffect` keyed on `isLoading + documents + errors`. Guarded by a ref so a re-render doesn't double-save. Silent no-op when Supabase isn't configured — pipeline still works.

---

## Recent quality passes (post-Phase-7)

- **Skill 4 → real tool-using agent** (PR #27). Replaces the earlier deterministic server-side query derivation with a Claude tool loop. One badge per query, one per page fetch — instead of a single "search" / "page" badge in a burst at the end.
- **Client-stack framing** on Skills 2 and 4. System prompts rewritten to demand every claim in the analysis reference the client's specific form values (`backendLanguage`, `hasDataWarehouse`, `usesCdp`, `cdpName`, `authMethod`, `platforms`, `currentMmp`, `attributionModel`). Actionable pointers, not textbook theory.
- **Badge query / repo in label + clickable URL** (PR #28). Confluence search badges show the specific query, page badges show the resolved page title. GitHub search badge shows the client name searched for, manifests badge shows `owner/repo`. Every badge with a URL becomes an `<a target=_blank>` with a small ↗ marker.
- **Code fence sanitizer** (PR #29). Stopped raw code fragments from leaking to the top of runbooks. Two-pronged fix: tightened `CACHED_SYSTEM_BLOCK` to require language-tagged fences and ASCII arrows only inside code; defensive `sanitizeMarkdown` in `DocCard.jsx` auto-closes trailing unclosed fences and normalises Unicode arrows inside fenced blocks before ReactMarkdown sees the string.
- **File upload removed** (PR #19). PDF SOW upload / extract path deleted — manual form entry is the only entry now.
- **Integrations menu** (PR #18). Four standalone Connect pills collapsed into a single "Integrations 4/4" dropdown so the header doesn't crowd the logo + title. Trigger shows a 4-dot status indicator.

---

## Live env vars (Vercel project settings)

| Var | Phase | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | 1 | Claude calls |
| `SESSION_SECRET` | 2+ | 32-byte AES-256-GCM key for all JWE session cookies |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | 1 (RAG) + 7 (generations) | Vector store + generations persistence |
| `VOYAGE_API_KEY` | 1 (RAG) | 512-dim embeddings |
| `ADMIN_TOKEN` | 1 | Gate on `/api/admin/add-pattern` |
| `SALESFORCE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | 2 | Salesforce OAuth |
| `ATLASSIAN_CLIENT_ID` / `_SECRET` | 3 | Atlassian OAuth |
| `GOOGLE_CLIENT_ID` / `_SECRET` | 4 | Google OAuth |
| `ENGINEERING_CALENDAR_ID` | 4 | Shared engineering team calendar for Skill 5 free/busy |
| `GITHUB_CLIENT_ID` / `_SECRET` | 5 | GitHub OAuth |

Redirect URIs are derived from the incoming request host server-side, so each Vercel preview alias works without per-env URI config (except for the OAuth provider's own allowlist — those still need every alias added).

The Render service's `MCP_SERVICE_URL` / `MCP_SERVICE_SECRET` are no longer read by Vercel; they can be dropped when convenient.

---

## Merged PRs (chronological)

| PR | Title | What it shipped |
|---|---|---|
| [#9](https://github.com/subbu0396/singular-onboarding-assistant/pull/9) | Phase 3: Skill 4 Confluence MCP integration via Atlassian Rovo | OAuth flow, MCP connector wiring, fallback path |
| [#10](https://github.com/subbu0396/singular-onboarding-assistant/pull/10) | Phase 4 (Google): Skill 5 grounded in real engineering + SE calendars | Google OAuth, freeBusy fetch, Skill 5 calendar-aware prompt |
| [#11](https://github.com/subbu0396/singular-onboarding-assistant/pull/11) | Fix Skill 5 missing-arg bug and header pill layout | Bug fix + UI compaction |
| [#12](https://github.com/subbu0396/singular-onboarding-assistant/pull/12) | Add SE availability notes as a third Skill 5 timeline signal | Free-text field for SE PTO/availability |
| [#13](https://github.com/subbu0396/singular-onboarding-assistant/pull/13) | Force an 'Onboarding Schedule & Availability' section in the runbook | Dedicated runbook section for scheduling specifics |
| [#14](https://github.com/subbu0396/singular-onboarding-assistant/pull/14) | Show Skill 5 calendar context + SE notes in the agent pipeline UI | `skill_context` SSE event, inline panel under the skill card |
| [#15](https://github.com/subbu0396/singular-onboarding-assistant/pull/15) | Color Go-Live Timeline card green/amber/red from combined SE + Engg availability | Engg notes field + risk coloring heuristic |
| [#16](https://github.com/subbu0396/singular-onboarding-assistant/pull/16) | Have Claude assess timeline risk so notes-based conflicts color the card | Tool_use risk assessment replaces heuristic |
| [#17](https://github.com/subbu0396/singular-onboarding-assistant/pull/17) | Phase 5: Skill 2 grounded in the client's actual GitHub codebase | GitHub OAuth, repo search + manifest fetch, Skill 2 tool-using agent |
| [#18](https://github.com/subbu0396/singular-onboarding-assistant/pull/18) | Fix risk-color mismatch (tool_use) and collapse header into an Integrations menu | Tool_use for risk; single dropdown replaces 4 pills |
| [#19](https://github.com/subbu0396/singular-onboarding-assistant/pull/19) | Remove PDF SOW upload / extract feature | ~470 LOC deleted |
| [#20](https://github.com/subbu0396/singular-onboarding-assistant/pull/20) | Phase 6: move the MCP-heavy skills to a Render companion service | Two-service architecture, blueprint, shared-secret auth |
| [#21](https://github.com/subbu0396/singular-onboarding-assistant/pull/21) | Move render.yaml to repo root so Render Blueprint detects it | One-line config fix |
| [#22](https://github.com/subbu0396/singular-onboarding-assistant/pull/22) | Drop Skill 2 MCP endpoint — GitHub hosted server rejects OAuth-app tokens | Cleanup |
| [#23](https://github.com/subbu0396/singular-onboarding-assistant/pull/23) | Bump Render MCP call budget to 5 min; Vercel timeout right-sized | Timeout tune |
| [#24](https://github.com/subbu0396/singular-onboarding-assistant/pull/24) | Phase 7: save, list, and share generated onboarding packages | Supabase table + APIs + Recent list + Share button + public share page |
| [#25](https://github.com/subbu0396/singular-onboarding-assistant/pull/25) | Drop Skill 4 MCP path; always use Confluence REST agent | Retired the Render MCP path for Skill 4 |
| [#26](https://github.com/subbu0396/singular-onboarding-assistant/pull/26) | Rename Recent generations to 'Recent Generated Forms', cap at 10 rows | Small UX polish |
| [#27](https://github.com/subbu0396/singular-onboarding-assistant/pull/27) | Skill 4 tool loop; 3-tier badges; client-stack framing | Real tool-using agent, `count` field, green/amber/grey |
| [#28](https://github.com/subbu0396/singular-onboarding-assistant/pull/28) | GitHub badges get query + link treatment; re-land Confluence URL work | Badge labels carry query/repo; every badge with URL is a link |
| [#29](https://github.com/subbu0396/singular-onboarding-assistant/pull/29) | Stop raw code fragments leaking to the top of generated docs | Fenced-code prompt tightening + defensive `sanitizeMarkdown` |

Earlier PRs (before this notes file was started) covered Phase 1 and Phase 2.

---

## What's still queued

Listed roughly by impact-per-effort:

1. **SE authentication + multi-tenancy.** Ranked as the highest-impact next step. Every OAuth cookie becomes user-scoped, generations list filters by SE identity, share links get proper owner semantics. Needs a login flow (magic-link or Google sign-in) + Supabase schema changes.
2. **Prompt-caching observability.** Read `usage.cache_read_input_tokens` off the Claude responses and surface it in the pipeline row as a "cache hit N%" indicator per skill.
3. **Doc versioning / regeneration diffs.** Regenerate creates a new `generations` row instead of replacing. Add a version selector + side-by-side diff.
4. **Salesforce fuzzy picker + custom fields.** Typeahead over SF accounts (fuzzy match instead of strict equality) plus custom-field support (`Platforms__c`, `Current_MMP__c`) feeding into Skill 1.
5. **Microsoft Graph (Outlook)** as a second calendar provider for Skill 5.
6. **Skill 3 grounding.** The last remaining static analyst skill. Slack-for-kickoff-coordination is one candidate; a CDP config source is another.

---

## Recurring gotchas (don't fall in these again)

- **Vercel env-var changes need a redeploy.** Empty commit on the branch triggers a preview rebuild; empty commit on main triggers prod.
- **OAuth redirect URIs are exact-match.** Every Vercel alias (preview hashes change per branch) needs to be added to the provider's allowlist. Protocol and trailing slash must match character-for-character.
- **Browser cookie size cap (~4KB) is real.** Large JWE-encrypted tokens need chunking (see `buildAtlassianSessionCookies`) or aggressive payload trimming.
- **OAuth scopes need to be pre-registered on the consent screen.** Google silently drops scopes not listed; manifests as `ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the first API call.
- **Google OAuth "Testing" mode** requires every test user to be added to the app's test-user list explicitly.
- **`replace_all` on a multi-line param block can miss call sites with different indentation.** Always verify with `grep` after — hit this on both `runAgent` signature changes.
- **Minified runtime errors in production give no useful stack.** Wrap risky sections in try/catch with `console.error(err?.stack || err)` so Vercel logs show the real frames.
- **Vendor MCP servers are still fragile.** Atlassian Rovo hangs unboundedly; GitHub Copilot MCP requires Copilot-issued tokens. Direct REST is more reliable for a real-time pipeline. If you must use MCP, put it on a long-lived process (not Vercel Edge).
- **Squash-merges can quietly drop commits.** Saw at least one case where a second commit on a PR branch didn't make it into the squashed main commit. Verify by reading the target file after merge if the change was small enough to have been overlooked.
- **Free-text JSON parsing from LLM output is unreliable.** Use `tool_use` for structured output when you need a specific shape — the timeline risk assessment was picking up the wrong field via regex before we switched.
- **Fenced code blocks inside numbered lists need 4-space indentation** for remark-gfm to recognise them. Unicode arrows inside Swift code (`→` instead of `->`) can also confuse the render.
