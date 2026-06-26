import Anthropic from '@anthropic-ai/sdk';
import { formatList } from './formConfig';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  return new Anthropic({ apiKey });
}

function buildRunbookPrompt(form) {
  return `Generate an integration runbook for ${form.clientName}, a ${form.industry} company in ${form.primaryMarket}. They are integrating via ${formatList(form.integrationMethods)} on ${formatList(form.platforms)} using ${form.backendLanguage}. Their data export goes to ${formatList(form.dataExportMethods)}. Event tracking: ${form.eventTrackingMethod}. Current MMP: ${form.currentMmp}. Attribution model: ${form.attributionModel}. Auth method: ${form.authMethod}. Has data warehouse: ${form.hasDataWarehouse ? 'Yes' : 'No'}. Uses CDP: ${form.usesCdp ? `Yes (${form.cdpName})` : 'No'}. Timeline: ${form.onboardingUrgency} with go-live on ${form.targetGoLiveDate}.

Structure the runbook with these sections:
1. Pre-Integration Checklist
2. SDK Integration Steps (per platform selected)
3. Event Mapping Table (with 8-10 relevant standard events for their industry)
4. Postback/S2S Configuration
5. Data Export Setup
6. QA & Validation Steps
7. Go-Live Sign-off Criteria

Use markdown formatting with clear headings. Be specific to their tech stack and industry.`;
}

function buildFaqPrompt(form) {
  return `Generate 12-15 FAQs for ${form.clientName}'s Singular onboarding. They are in ${form.industry}, using ${formatList(form.platforms)}, with ${formatList(form.integrationMethods)}. Data export via ${formatList(form.dataExportMethods)}. Event tracking: ${form.eventTrackingMethod}. Attribution model: ${form.attributionModel}. Auth: ${form.authMethod}.

Include questions a technical client team would realistically ask about SDK setup, attribution logic, postback delays, data discrepancies, dashboard access, and ${formatList(form.dataExportMethods)} data delivery.

Answer each FAQ concisely and accurately. Format as markdown with ### for each question and the answer below it.`;
}

function buildChecklistPrompt(form) {
  const hasIos = form.platforms?.includes('iOS');
  const skadSection = hasIos
    ? '- SKAdNetwork Tests'
    : '';

  return `Create a structured test checklist for ${form.clientName}'s Singular integration. Platforms: ${formatList(form.platforms)}. Integration: ${formatList(form.integrationMethods)}. Events: ${form.eventTrackingMethod}. Data export: ${formatList(form.dataExportMethods)}.

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

const PROMPT_BUILDERS = {
  runbook: {
    system: 'You are a senior integrations engineer at a mobile attribution platform. Generate a detailed, client-ready integration runbook.',
    buildUser: buildRunbookPrompt,
  },
  faq: {
    system: 'You are a technical account manager creating client-facing onboarding FAQs.',
    buildUser: buildFaqPrompt,
  },
  checklist: {
    system: 'You are a QA engineer specializing in mobile attribution testing.',
    buildUser: buildChecklistPrompt,
  },
};

export async function generateDocument(docType, form) {
  const config = PROMPT_BUILDERS[docType];
  if (!config) {
    throw new Error(`Unknown document type: ${docType}`);
  }

  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: config.system,
    messages: [{ role: 'user', content: config.buildUser(form) }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No text content returned from Claude');
  }

  return textBlock.text;
}

export async function generateAllDocuments(form) {
  const types = ['runbook', 'faq', 'checklist'];
  const results = await Promise.all(
    types.map(async (type) => {
      const content = await generateDocument(type, form);
      return [type, content];
    })
  );
  return Object.fromEntries(results);
}
