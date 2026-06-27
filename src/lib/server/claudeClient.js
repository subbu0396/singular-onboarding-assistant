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

function buildRunbookPrompt(form, ragContext = '') {
  const platform = getPlatform(form);
  const ragSection = buildRagSection(ragContext);

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
${ragSection}
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
${ragSection}
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
