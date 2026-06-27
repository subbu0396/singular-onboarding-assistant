import Anthropic from '@anthropic-ai/sdk';
import { formatList } from '../formConfig';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

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

function buildRunbookPrompt(form) {
  const platform = getPlatform(form);
  return `Generate an integration runbook for ${form.clientName}, a ${form.industry} company in ${form.primaryMarket}, onboarding to ${platform}.${getMigrationNote(form)}

They are integrating via ${formatList(form.integrationMethods)} on ${formatList(form.platforms)} using ${form.backendLanguage}. Their data export goes to ${formatList(form.dataExportMethods)}. Event tracking: ${form.eventTrackingMethod}. Current/previous MMP: ${form.currentMmp}. Attribution model: ${form.attributionModel}. Auth method: ${form.authMethod}. Has data warehouse: ${form.hasDataWarehouse ? 'Yes' : 'No'}. Uses CDP: ${form.usesCdp ? `Yes (${form.cdpName})` : 'No'}. Timeline: ${form.onboardingUrgency} with go-live on ${form.targetGoLiveDate}.

All steps, SDK references, dashboard URLs, and terminology must be specific to ${platform}. Do not reference other MMPs unless comparing during migration.

Structure the runbook with these sections:
1. Pre-Integration Checklist
2. SDK Integration Steps (per platform selected)
3. Event Mapping Table (with 8-10 relevant standard events for their industry)
4. Postback/S2S Configuration
5. Data Export Setup
6. QA & Validation Steps
7. Go-Live Sign-off Criteria

Use markdown formatting with clear headings. Be specific to their tech stack, industry, and ${platform}.`;
}

function buildFaqPrompt(form) {
  const platform = getPlatform(form);
  return `Generate 12-15 FAQs for ${form.clientName}'s ${platform} onboarding. They are in ${form.industry}, using ${formatList(form.platforms)}, with ${formatList(form.integrationMethods)}. Data export via ${formatList(form.dataExportMethods)}. Event tracking: ${form.eventTrackingMethod}. Attribution model: ${form.attributionModel}. Auth: ${form.authMethod}.${getMigrationNote(form)}

Include questions a technical client team would realistically ask about ${platform} SDK setup, attribution logic, postback delays, data discrepancies, dashboard access, and ${formatList(form.dataExportMethods)} data delivery.

Answer each FAQ concisely and accurately using ${platform}-specific terminology. Format as markdown with ### for each question and the answer below it.`;
}

function buildChecklistPrompt(form) {
  const platform = getPlatform(form);
  const hasIos = form.platforms?.includes('iOS');
  const skadSection = hasIos ? '- SKAdNetwork Tests' : '';

  return `Create a structured test checklist for ${form.clientName}'s ${platform} integration. Platforms: ${formatList(form.platforms)}. Integration: ${formatList(form.integrationMethods)}. Events: ${form.eventTrackingMethod}. Data export: ${formatList(form.dataExportMethods)}.${getMigrationNote(form)}

All test steps must reference ${platform} SDK behavior, dashboards, and validation tools.

Format as a checklist with these sections:
- SDK Initialization Tests
- Event Firing & Mapping Validation
- Attribution Flow Tests (organic, paid, re-engagement)
- Postback Delivery Tests
- Data Export Validation (for ${formatList(form.dataExportMethods)})
${skadSection}
- Edge Cases & Error Scenarios

Each item should have: [ ] checkbox, test description, expected result, pass criteria. Use markdown formatting.`;
}

function buildSystemPrompt(form, role) {
  const platform = getPlatform(form);
  return `${role} You are creating client-facing onboarding documentation for ${platform}, a mobile measurement and attribution platform. Use ${platform}-specific SDK names, features, dashboard terminology, and integration patterns throughout.`;
}

const PROMPT_BUILDERS = {
  runbook: {
    system: (form) => buildSystemPrompt(form, 'You are a senior integrations engineer.'),
    buildUser: buildRunbookPrompt,
  },
  faq: {
    system: (form) => buildSystemPrompt(form, 'You are a technical account manager creating onboarding FAQs.'),
    buildUser: buildFaqPrompt,
  },
  checklist: {
    system: (form) => buildSystemPrompt(form, 'You are a QA engineer specializing in mobile attribution testing.'),
    buildUser: buildChecklistPrompt,
  },
};

export async function generateDocument(docType, form, apiKey) {
  const config = PROMPT_BUILDERS[docType];
  if (!config) {
    throw new Error(`Unknown document type: ${docType}`);
  }

  const client = getClient(apiKey);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: config.system(form),
    messages: [{ role: 'user', content: config.buildUser(form) }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No text content returned from Claude');
  }

  return textBlock.text;
}

export async function generateAllDocuments(form, apiKey) {
  const types = ['runbook', 'faq', 'checklist'];
  const results = await Promise.all(
    types.map(async (type) => {
      const content = await generateDocument(type, form, apiKey);
      return [type, content];
    })
  );
  return Object.fromEntries(results);
}
