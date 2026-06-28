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

function buildRunbookPrompt(form, ragContext = '') {
  const platform = getPlatform(form);
  const ragSection = buildRagSection(ragContext);
  const exportHints = buildExportHintsBlock(form);

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
${ragSection}${exportHints}
All steps, SDK references, dashboard URLs, and terminology must be specific to ${platform}. Do not reference other MMPs unless comparing during migration.

Structure the runbook with these sections:
1. Pre-Integration Checklist
2. SDK Integration Steps (per platform selected)
3. Event Mapping Table (with 8-10 relevant standard events for their industry)
4. Postback/S2S Configuration
5. Data Export Setup
6. QA & Validation Steps
7. Go-Live Sign-off Criteria

Use markdown formatting with clear headings. Be specific to their tech stack, industry, and ${platform}.

Generate the Runbook now.`;
}

function buildFaqPrompt(form, ragContext = '') {
  const platform = getPlatform(form);
  const ragSection = buildRagSection(ragContext);

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
${ragSection}
Generate 12-15 questions a technical client team would realistically ask about ${platform} SDK setup, attribution logic, postback delays, data discrepancies, dashboard access, and ${formatList(form.dataExportMethods)} data delivery.

Answer each FAQ concisely and accurately using ${platform}-specific terminology. Format as markdown with ### for each question and the answer below it.

Generate the FAQ now.`;
}

function buildChecklistPrompt(form, ragContext = '') {
  const platform = getPlatform(form);
  const hasIos = form.platforms?.includes('iOS');
  const skadSection = hasIos ? '- SKAdNetwork Tests' : '';
  const ragSection = buildRagSection(ragContext);
  const exportHints = buildExportHintsBlock(form);

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
${ragSection}${exportHints}
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
