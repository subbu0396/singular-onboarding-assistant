import { formatList } from '../formConfig';

function getPlatform(form) {
  return form.targetMmp || 'Mobile Measurement Platform';
}

function getMigrationNote(form) {
  const platform = getPlatform(form);
  if (!form.currentMmp || form.currentMmp === 'None' || form.currentMmp === platform) {
    return '';
  }
  return ` They are migrating from ${form.currentMmp} to ${platform}.`;
}

function getDocSourceNote(form) {
  return form._docUploaded === true
    ? 'Note: Requirements were extracted from a client-provided document. Treat them as confirmed unless marked ambiguous.'
    : 'Note: Requirements were entered manually by the integrations team.';
}

function buildRagSection(ragContext) {
  return ragContext
    ? `\nReference these integration patterns from our knowledge base.
Adapt them specifically to this client's stack — do not copy verbatim:

${ragContext}

---\n`
    : '';
}

// --- Phase 1 agent skills ---
// Each analytical skill (1-5) reads its slice of the form and produces
// a focused considerations block. Skill 6 ("Review & Compile") is the
// existing 3-doc generation, seeded with the analyses below.

export const SKILLS = [
  {
    id: 'client_info',
    name: 'Client Info',
    fields: ['clientName', 'targetMmp', 'industry', 'primaryMarket'],
    focus:
      'Surface industry-specific event taxonomy expectations, regional data residency or regulatory considerations, and how the target MMP commonly serves this client profile.',
  },
  {
    id: 'sdk_setup',
    name: 'Mobile SDK Setup',
    fields: ['platforms', 'currentMmp', 'attributionModel'],
    focus:
      'Surface per-platform SDK considerations, migration-specific gotchas if moving from another MMP, and SDK configuration implications of the chosen attribution model.',
  },
  {
    id: 'integration_type',
    name: 'Integration Type',
    fields: ['integrationMethods', 'dataExportMethods', 'eventTrackingMethod'],
    focus:
      'Surface architectural tradeoffs of the chosen integration methods, export-method coupling, and SDK-vs-S2S event tracking implications.',
  },
  {
    id: 'tech_env',
    name: 'Technical Environment',
    fields: ['backendLanguage', 'hasDataWarehouse', 'usesCdp', 'cdpName', 'authMethod'],
    focus:
      'Surface backend-language SDK availability, warehouse landing patterns, CDP coexistence considerations, and auth-method implications for postbacks and exports.',
  },
  {
    id: 'timeline',
    name: 'Go-Live Timeline',
    fields: ['targetGoLiveDate', 'onboardingUrgency', 'seAvailabilityNotes'],
    focus:
      'Surface timeline feasibility given the stack complexity, recommend a phased rollout if appropriate, and call out the risk areas most likely to slip the date.',
  },
];

const SKILL_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are a section analyst in an MMP onboarding agent. You receive a slice of client information for one section of the onboarding plan and produce a focused, technical analysis of that slice.

Output rules:
- 120-220 words of plain prose, no markdown headers, no bullet lists.
- Audience: senior integrations engineers and solutions engineers.
- Surface considerations, risks, defaults, platform-specific quirks. Do not restate the input verbatim.
- No preamble ("Here is the analysis...") and no closing summary.
- Do not write the runbook, FAQ, or checklist itself — your output is intermediate context for a downstream compilation step.`,
  cache_control: { type: 'ephemeral' },
};

// --- Skill 1: Client Info (tool-using agent) ---
//
// Phase 2 elevates Skill 1 from a static prompt to a Claude agent loop with
// two tools:
//   - lookup_salesforce_client: look up the client account in Salesforce
//   - use_form_data: read the client slice from the submitted form
//
// The agent decides which tool(s) to call. The other skills (2-5) remain
// static prompts for now.

const SKILL1_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are the Client Info skill in an MMP onboarding agent. Your job is to gather authoritative client information and produce 120-220 words of focused analysis surfacing onboarding considerations (industry-specific event taxonomy, regional regulatory or data residency concerns, target MMP fit).

You have two tools:
- lookup_salesforce_client: look up the client in Salesforce CRM. Use this FIRST when you have a client name. The CRM is the source of truth.
- use_form_data: read the client slice from the submitted form. Use this when Salesforce returns not-found, or as a complement to merge known fields.

Process:
1. Call lookup_salesforce_client with the client name EXACTLY as it appears in the user's instruction — do not abbreviate, trim, or guess at alternative spellings. The lookup uses strict equality.
2. If found, base your analysis primarily on the Salesforce record. If specific form fields are also present, mention them as supporting context.
3. If not found, call use_form_data and base your analysis on that. Do not retry the Salesforce lookup with variants — strict equality means a variant will not help.
4. Produce the analysis. Plain prose, no markdown headers, no bullet lists. Note the data source in your output (e.g., "Per Salesforce..." or "Per the submitted form...").

Do not loop more than necessary. Two tool calls is the maximum you should need.`,
  cache_control: { type: 'ephemeral' },
};

export const SKILL1_TOOLS = [
  {
    name: 'lookup_salesforce_client',
    description:
      'Look up the client Account in Salesforce by name. Returns the Account record (Industry, BillingCountry, custom MMP fields) if found, or a not-found marker. Call this first when you have a client name.',
    input_schema: {
      type: 'object',
      properties: {
        clientName: {
          type: 'string',
          description: 'The client company name from the user instruction',
        },
      },
      required: ['clientName'],
      additionalProperties: false,
    },
  },
  {
    name: 'use_form_data',
    description:
      'Read the Client Info slice from the form submitted by the integrations team. Returns clientName, industry, primaryMarket, targetMmp. Use this when Salesforce is not configured, returns not-found, or to complement Salesforce data with form fields.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function buildSkill1UserPrompt(form) {
  return `Gather authoritative information about the client and produce the Client Info section analysis.

Client name from the user instruction: "${form.clientName || '(not provided)'}"
Target MMP: ${getPlatform(form)}

Use your tools to gather data, then produce the analysis as plain prose. Note your data source in the output.`;
}

export function buildFormSlice(skill, form) {
  return Object.fromEntries(skill.fields.map((f) => [f, form[f]]));
}

export { SKILL1_SYSTEM_BLOCK };

// --- Skill 4: Technical Environment (Atlassian/Confluence MCP agent) ---
//
// Phase 3: when the SE has connected their Atlassian account, Skill 4 calls
// Claude with the mcp_servers connector pointing at the Atlassian Rovo MCP
// server. Claude decides which Confluence tools to invoke (search, fetch
// page) based on the form's tech-environment slice. When Atlassian is not
// connected, Skill 4 falls back to the simpler static-prompt path used by
// skills 2, 3, 5.

const SKILL4_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are the Technical Environment skill in an MMP onboarding agent. Your job is to produce 120-220 words of focused technical analysis covering: backend-language SDK availability, warehouse landing patterns, CDP coexistence, and auth-method implications for postbacks and exports.

You have access to Confluence (via the Atlassian MCP server) containing internal integration runbooks, architecture patterns, and SE-authored notes from prior onboardings.

Process:
1. Derive 1-3 short search queries from the client's tech slice (backend language, warehouse presence, CDP name, auth method). Example queries: "Node.js MMP SDK installation", "Snowflake export landing schema", "Segment CDP coexistence", "OAuth client-credentials postback".
2. Search Confluence using those queries. Open the most relevant 1-2 pages.
3. Synthesize the page contents with the form's tech slice into the analysis. Where you pulled a specific operational pattern from a page, name the page title inline (e.g., "Per the 'Snowflake landing schema' runbook, ...").
4. If a search returns nothing relevant, do not invent content from the page titles alone — fall back to general best-practice analysis and say so.

Output rules:
- 120-220 words, plain prose, no markdown headers, no bullet lists.
- No preamble ("Here is the analysis...") and no closing summary.
- Do not write the runbook, FAQ, or checklist itself — this is intermediate context for a downstream compilation step.
- Three Confluence tool calls is the maximum you should need.`,
  cache_control: { type: 'ephemeral' },
};

export function buildSkill4UserPrompt(form, confluenceContext = null) {
  const skill = SKILLS.find((s) => s.id === 'tech_env');
  const slice = buildFormSlice(skill, form);

  let confluenceSection = '';
  if (confluenceContext?.pages?.length) {
    const excerpts = confluenceContext.pages
      .map((p) => `#### ${p.title}\n${p.excerpt}`)
      .join('\n\n');
    confluenceSection = `\n\nConfluence excerpts retrieved for this stack (cite page titles inline when you use them):\n\n${excerpts}`;
  } else if (confluenceContext?.searched) {
    confluenceSection =
      '\n\nConfluence search returned no relevant pages for this stack. Use general best-practice analysis and state that no internal runbook was found.';
  }

  return `Produce the Technical Environment section analysis.

Target MMP: ${getPlatform(form)}

Client tech slice:
${JSON.stringify(slice, null, 2)}
${confluenceSection}

Synthesize the excerpts (if any) with the form slice into the analysis. Cite page titles inline when you pull from one.`;
}

const SKILL4_REST_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are the Technical Environment skill in an MMP onboarding agent. Your job is to produce 120-220 words of focused technical analysis covering: backend-language SDK availability, warehouse landing patterns, CDP coexistence, and auth-method implications for postbacks and exports.

You may be given excerpts from internal Confluence runbooks retrieved for this client's stack. Synthesize those excerpts with the form data. Where you use a specific operational pattern from a page, name the page title inline (e.g., "Per the 'Snowflake landing schema' runbook, ..."). If no excerpts were provided or none are relevant, use general best practices and say so — do not invent content from page titles alone.

Output rules:
- 120-220 words, plain prose, no markdown headers, no bullet lists.
- No preamble ("Here is the analysis...") and no closing summary.
- Do not write the runbook, FAQ, or checklist itself — this is intermediate context for a downstream compilation step.`,
  cache_control: { type: 'ephemeral' },
};

export { SKILL4_SYSTEM_BLOCK, SKILL4_REST_SYSTEM_BLOCK };

// --- Skill 5: Go-Live Timeline (Calendar-aware agent) ---
//
// Phase 4: when a Google (or Microsoft) Calendar is connected, Skill 5
// gets a calendar context object alongside the form slice. The context
// summarizes busy windows for the SE's primary calendar and a shared
// engineering team calendar across a ±2-week window around the target
// go-live date. The skill calls out concrete risks (holiday weeks,
// engineering capacity gaps, SE meeting density conflicts) rather than
// generic timeline platitudes.

const SKILL5_SYSTEM_BLOCK = {
  type: 'text',
  text: `You are the Go-Live Timeline skill in an MMP onboarding agent. Your job is to produce 120-220 words of focused analysis on timeline feasibility for the client's go-live date.

Three possible sources of timeline context — use whichever are present:

1. **Calendar context** (from connected Google/MS Calendar). When provided:
   - engineering_calendar.total_busy_minutes near the go-live date is your primary signal for engineering capacity. High busy minutes in the week before launch = high risk of slippage; low busy minutes = capacity exists. Mention the specific number if it's notable.
   - se_calendar.total_busy_minutes signals how much SE bandwidth is available for client-facing onboarding calls during the window. Flag if it's saturated.
   - Call out specific concerns: "Engineering has X busy minutes in the 14 days before the target, suggesting limited bandwidth for SDK escalations."

2. **SE-provided availability notes** (form field seAvailabilityNotes). When non-empty, treat this as the SE's authoritative statement of when they personally can run kickoff/cutover/escalation calls. Weave concrete callouts ("SE indicated PTO 5–9 Aug — schedule the smoke-test window outside that range"). Prefer the SE's notes over the calendar when they conflict — the SE knows commitments the calendar doesn't.

3. **Form slice only** (stack complexity, urgency, target date). When neither calendar nor SE notes are present, fall back to general timeline analysis based on these, and explicitly say "Calendar data and SE availability notes not available — analysis based on stack complexity only."

Output rules:
- 120-220 words of plain prose, no markdown headers, no bullet lists.
- Audience: senior solutions engineers and integrations engineers.
- Recommend a phased rollout if appropriate, and call out the risk areas most likely to slip the date.
- No preamble ("Here is the analysis...") and no closing summary.
- Do not write the runbook, FAQ, or checklist itself — this is intermediate context for a downstream compilation step.`,
  cache_control: { type: 'ephemeral' },
};

export function buildSkill5UserPrompt(form, calendarContext) {
  const skill = SKILLS.find((s) => s.id === 'timeline');
  const slice = buildFormSlice(skill, form);
  const calBlock = calendarContext
    ? `\nCalendar context (source: ${calendarContext.source}):\n${JSON.stringify(calendarContext, null, 2)}\n`
    : '\nCalendar context: not connected.\n';
  return `Produce the Go-Live Timeline section analysis.

Target MMP: ${getPlatform(form)}

Client timeline slice:
${JSON.stringify(slice, null, 2)}
${calBlock}
Produce the analysis now, grounding any risk callouts in the calendar context when available.`;
}

export { SKILL5_SYSTEM_BLOCK };

function buildSkillUserPrompt(skill, form) {
  const slice = Object.fromEntries(skill.fields.map((f) => [f, form[f]]));
  const platform = getPlatform(form);
  return `Section: ${skill.name}
Target MMP: ${platform}
${getMigrationNote(form).trim()}

Client slice:
${JSON.stringify(slice, null, 2)}

Focus: ${skill.focus}

Produce the focused analysis now.`;
}

function buildAnalysisBlock(skillOutputs) {
  if (!skillOutputs || Object.keys(skillOutputs).length === 0) return '';
  const sections = SKILLS.filter((s) => skillOutputs[s.id])
    .map((s) => `### ${s.name} considerations\n${skillOutputs[s.id].trim()}`)
    .join('\n\n');
  if (!sections) return '';
  return `\nThe agent's section analysts produced the following considerations. Treat these as authoritative context — weave the relevant points into the document, do not contradict them:

${sections}

---\n`;
}

export { SKILL_SYSTEM_BLOCK, buildSkillUserPrompt, buildAnalysisBlock };

const EXPORT_METHOD_HINTS = {
  Snowflake: `Snowflake export setup defaults:
- Use a storage integration object backed by an IAM role; do not embed access keys in stages or DDL.
- Create an external stage (S3 or GCS) and load with COPY INTO using FILE_FORMAT (TYPE = PARQUET preferred, or CSV with FIELD_OPTIONALLY_ENCLOSED_BY = '"') and MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE.
- For the first integration, prefer hourly file-based COPY over Snowpipe — it is simpler to debug and supports backfills cleanly.
- Land raw events in a RAW schema, transform into MODELED with dbt or a scheduled task. Cluster by event_date.
- Grant the loader role USAGE on the warehouse, USAGE on the database/schema, and INSERT on target tables only.`,

  BigQuery: `BigQuery export setup defaults:
- Use the Data Transfer Service (DTS) for scheduled GCS → BQ loads. Native MMP → BQ connectors exist for some platforms; use them when available.
- The destination dataset's location must match the source GCS bucket region. Multi-region is acceptable but increases cost.
- Authenticate with a service account; grant roles/bigquery.dataEditor on the dataset and roles/storage.objectViewer on the source bucket. Do not use user credentials.
- Partition by ingestion-time or by an event_date column; cluster on user_id / install_id for cost control on common query shapes.
- For low-latency needs use streaming inserts (insertAll), but expect higher cost and a 90-minute streaming buffer before partition pruning takes effect.`,

  S3: `S3 export setup defaults:
- Use IAM role assumption with an external ID, not long-lived access keys, for the MMP-to-bucket trust relationship.
- Enable bucket versioning and a 30-day non-current-version lifecycle policy so accidentally-overwritten exports can be recovered.
- Enable default encryption (SSE-S3 minimum; SSE-KMS if compliance requires customer-managed keys).
- Use a prefix convention like s3://<bucket>/<env>/<source>/dt=YYYY-MM-DD/hh=HH/ so downstream consumers can partition-prune.
- Set a bucket policy denying any request without aws:SecureTransport=true.`,

  SFTP: `SFTP export setup defaults:
- ed25519 key authentication only; reject password auth at the server config level.
- One SFTP user per environment (prod, staging); chroot each user to its own home directory.
- Convention: drop new files in /inbound/ as <filename>.part, atomically rename to <filename> when the upload completes, then move processed files to /archive/YYYY/MM/DD/.
- Retain processed files 7 days, then delete via cron. Monitor /inbound/ depth and alert if files older than 1 hour remain.
- Whitelist the MMP's source IPs at the firewall; do not expose SFTP to the public internet.`,

  'API Pull': `API Pull export setup defaults:
- Authenticate per request, not per session. Rotate the API key per environment; never share keys across prod and non-prod.
- Paginate by opaque cursor or by (start_time, end_time) windows — never by offset. Page size 1000–5000 events.
- Implement exponential backoff with jitter on 429 and 5xx; respect Retry-After when present. Cap retries at 5 attempts per page.
- Make pulls idempotent: dedupe on a stable event_id at the warehouse, not at the puller, so reprocessing a window is safe.
- Run pulls on a schedule with a watermark stored in your warehouse so the next run resumes from the correct cursor after a failure.`,
};

const WAREHOUSE_HINT = `Warehouse-present defaults:
- Treat the MMP export as the source of truth for raw events; do not transform inside the MMP. Land raw, transform in the warehouse.
- Stage in a RAW schema (e.g. RAW.MMP_EVENTS) with the same column shape as the export file. Apply transformations into MODELED / MART schemas via dbt or scheduled queries.
- Date-partition raw tables by event_date for query cost and retention control. Set a retention policy (e.g. 90 days raw, indefinite modeled).
- Add a freshness check (max(event_date) > now() - interval '2 hours') and alert when it fires — this catches broken exports faster than the MMP's own monitoring.`;

function buildExportHintsBlock(form) {
  const methods = Array.isArray(form.dataExportMethods) ? form.dataExportMethods : [];
  const hints = methods
    .map((m) => EXPORT_METHOD_HINTS[m])
    .filter(Boolean);
  if (form.hasDataWarehouse) hints.push(WAREHOUSE_HINT);
  if (hints.length === 0) return '';
  return `\nApply these operational defaults in the Data Export Setup section unless the client's stack contradicts them:\n\n${hints.join('\n\n')}\n\n---\n`;
}

function buildRunbookPrompt(form, ragContext = '', skillOutputs = null) {
  const platform = getPlatform(form);
  const ragSection = buildRagSection(ragContext);
  const exportHints = buildExportHintsBlock(form);
  const analysisBlock = buildAnalysisBlock(skillOutputs);

  const clientDetailsBlock = `Generate an Integration Runbook for the following client.
${getDocSourceNote(form)}

Client details:
- Name: ${form.clientName}
- Industry: ${form.industry}
- Primary Market: ${form.primaryMarket}
- Target MMP Platform: ${platform}
- Platforms: ${formatList(form.platforms)}
- Current MMP: ${form.currentMmp}
- Attribution Model: ${form.attributionModel}
- Integration Methods: ${formatList(form.integrationMethods)}
- Data Export: ${formatList(form.dataExportMethods)}
- Event Tracking: ${form.eventTrackingMethod}
- Backend Language: ${form.backendLanguage}
- Has Data Warehouse: ${form.hasDataWarehouse}
- Uses CDP: ${form.usesCdp}${form.cdpName ? ` (${form.cdpName})` : ''}
- Auth Method: ${form.authMethod}
- Go-Live Date: ${form.targetGoLiveDate}
- Urgency: ${form.onboardingUrgency}${getMigrationNote(form)}`;

  return `${clientDetailsBlock}
${ragSection}${exportHints}${analysisBlock}
All steps, SDK references, dashboard URLs, and terminology must be specific to ${platform}. Do not reference other MMPs unless comparing during migration.

Structure the runbook with these sections:
1. Pre-Integration Checklist
2. Onboarding Schedule & Availability
3. SDK Integration Steps (per platform selected)
4. Event Mapping Table (with 8-10 relevant standard events for their industry)
5. Postback/S2S Configuration
6. Data Export Setup
7. QA & Validation Steps
8. Go-Live Sign-off Criteria

Section 2 must surface scheduling specifics from the Go-Live Timeline analysis: quote the SE's availability notes verbatim if provided, propose concrete kickoff / SDK-review / cutover slots within those windows, and call out any engineering-capacity flags from the connected calendar. If no SE notes or calendar data was provided, say "No SE availability or calendar data provided — schedule TBD" and move on.

Use markdown formatting with clear headings. Be specific to their tech stack, industry, and ${platform}.

Generate the Runbook now.`;
}

function buildFaqPrompt(form, ragContext = '', skillOutputs = null) {
  const platform = getPlatform(form);
  const ragSection = buildRagSection(ragContext);
  const analysisBlock = buildAnalysisBlock(skillOutputs);

  const clientDetailsBlock = `Generate a FAQ Document for the following client.
${getDocSourceNote(form)}

Client details:
- Name: ${form.clientName}
- Industry: ${form.industry}
- Primary Market: ${form.primaryMarket}
- Target MMP Platform: ${platform}
- Platforms: ${formatList(form.platforms)}
- Current MMP: ${form.currentMmp}
- Attribution Model: ${form.attributionModel}
- Integration Methods: ${formatList(form.integrationMethods)}
- Data Export: ${formatList(form.dataExportMethods)}
- Event Tracking: ${form.eventTrackingMethod}
- Backend Language: ${form.backendLanguage}
- Auth Method: ${form.authMethod}${getMigrationNote(form)}`;

  return `${clientDetailsBlock}
${ragSection}${analysisBlock}
Generate 12-15 questions a technical client team would realistically ask about ${platform} SDK setup, attribution logic, postback delays, data discrepancies, dashboard access, and ${formatList(form.dataExportMethods)} data delivery.

Answer each FAQ concisely and accurately using ${platform}-specific terminology. Format as markdown with ### for each question and the answer below it.

Generate the FAQ now.`;
}

function buildChecklistPrompt(form, ragContext = '', skillOutputs = null) {
  const platform = getPlatform(form);
  const hasIos = form.platforms?.includes('iOS');
  const skadSection = hasIos ? '- SKAdNetwork Tests' : '';
  const ragSection = buildRagSection(ragContext);
  const exportHints = buildExportHintsBlock(form);
  const analysisBlock = buildAnalysisBlock(skillOutputs);

  const clientDetailsBlock = `Generate a Test Checklist for the following client.
${getDocSourceNote(form)}

Client details:
- Name: ${form.clientName}
- Target MMP Platform: ${platform}
- Platforms: ${formatList(form.platforms)}
- Integration Methods: ${formatList(form.integrationMethods)}
- Data Export: ${formatList(form.dataExportMethods)}
- Event Tracking: ${form.eventTrackingMethod}${getMigrationNote(form)}`;

  return `${clientDetailsBlock}
${ragSection}${exportHints}${analysisBlock}
All test steps must reference ${platform} SDK behavior, dashboards, and validation tools.

Format as a checklist with these sections:
- SDK Initialization Tests
- Event Firing & Mapping Validation
- Attribution Flow Tests (organic, paid, re-engagement)
- Postback Delivery Tests
- Data Export Validation (for ${formatList(form.dataExportMethods)})
${skadSection}
- Edge Cases & Error Scenarios

Each item should have: [ ] checkbox, test description, expected result, pass criteria. Use markdown formatting.

Generate the Checklist now.`;
}

export { buildRunbookPrompt, buildFaqPrompt, buildChecklistPrompt };
