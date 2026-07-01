// Shared intake tool — Claude's structured extraction schema for populating
// the onboarding form from unstructured context (Salesforce records today,
// conversational chat next). The property names mirror INITIAL_FORM_STATE
// exactly so the filled object drops straight into the existing form
// component and the 6-skill pipeline needs no changes.

import {
  TARGET_MMP_PLATFORMS,
  CURRENT_MMP_OPTIONS,
  INDUSTRIES,
  PRIMARY_MARKETS,
  PLATFORMS,
  ATTRIBUTION_MODELS,
  INTEGRATION_METHODS,
  DATA_EXPORT_METHODS,
  EVENT_TRACKING_METHODS,
  BACKEND_LANGUAGES,
  AUTH_METHODS,
  URGENCY_OPTIONS,
  INITIAL_FORM_STATE,
} from '@/lib/formConfig';

export const INTAKE_TOOL_NAME = 'capture_client_intake';

export const INTAKE_TOOL = {
  name: INTAKE_TOOL_NAME,
  description:
    'Populate the onboarding intake object from unstructured client context (Salesforce records, meeting notes, emails). Only set a field when the source clearly supports it — leave the rest null so the SE can fill them in. List every unpopulated field in missingFields.',
  input_schema: {
    type: 'object',
    properties: {
      clientName: { type: ['string', 'null'] },
      targetMmp: { type: ['string', 'null'], enum: [...TARGET_MMP_PLATFORMS, null] },
      industry: { type: ['string', 'null'], enum: [...INDUSTRIES, null] },
      primaryMarket: { type: ['string', 'null'], enum: [...PRIMARY_MARKETS, null] },
      platforms: {
        type: 'array',
        items: { type: 'string', enum: PLATFORMS },
        description: 'Empty array if unknown.',
      },
      currentMmp: { type: ['string', 'null'], enum: [...CURRENT_MMP_OPTIONS, null] },
      attributionModel: { type: ['string', 'null'], enum: [...ATTRIBUTION_MODELS, null] },
      integrationMethods: {
        type: 'array',
        items: { type: 'string', enum: INTEGRATION_METHODS },
      },
      dataExportMethods: {
        type: 'array',
        items: { type: 'string', enum: DATA_EXPORT_METHODS },
      },
      eventTrackingMethod: {
        type: ['string', 'null'],
        enum: [...EVENT_TRACKING_METHODS, null],
      },
      backendLanguage: { type: ['string', 'null'], enum: [...BACKEND_LANGUAGES, null] },
      hasDataWarehouse: { type: ['boolean', 'null'] },
      usesCdp: { type: ['boolean', 'null'] },
      cdpName: { type: ['string', 'null'] },
      authMethod: { type: ['string', 'null'], enum: [...AUTH_METHODS, null] },
      targetGoLiveDate: {
        type: ['string', 'null'],
        description: 'YYYY-MM-DD only. Null if the source has no target date.',
      },
      onboardingUrgency: { type: ['string', 'null'], enum: [...URGENCY_OPTIONS, null] },
      seAvailabilityNotes: { type: ['string', 'null'] },
      engineeringAvailabilityNotes: { type: ['string', 'null'] },
      missingFields: {
        type: 'array',
        items: { type: 'string' },
        description:
          'List every field the source did not confidently support, so the SE knows what to fill in on review.',
      },
      confidenceNotes: {
        type: ['string', 'null'],
        description:
          'One-line note on how confident you were and what you inferred vs. found verbatim.',
      },
    },
    required: ['missingFields'],
  },
};

const INTAKE_SYSTEM_PROMPT = `You are the intake assistant for a Singular Solutions Engineer. Your job is to read unstructured client context and populate the onboarding form schema by calling the ${INTAKE_TOOL_NAME} tool.

Ground rules:
- Only populate a field when the source clearly supports it. Guessing pollutes the form.
- Every enum value must match the schema exactly (case, spacing, hyphens).
- targetGoLiveDate must be YYYY-MM-DD. If the source says "Q3" or "mid-August", leave it null and note it in confidenceNotes.
- List every unpopulated field in missingFields — the SE uses that to see what to fill in.
- Do not narrate. Call the tool once and stop.`;

// Merge Claude's tool input onto INITIAL_FORM_STATE, dropping nulls so
// unset fields stay at their defaults (empty string / empty array / false)
// rather than becoming literal null and breaking the form inputs.
export function mergeIntakeIntoForm(toolInput) {
  const merged = { ...INITIAL_FORM_STATE };
  const known = new Set(Object.keys(INITIAL_FORM_STATE));

  for (const [key, value] of Object.entries(toolInput || {})) {
    if (!known.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }

  return merged;
}

/**
 * Run Claude with the intake tool forced. Returns
 *   { form, missingFields, confidenceNotes, toolInput, stopReason }
 * where `form` is a full INITIAL_FORM_STATE-shaped object ready to seed the UI.
 */
export async function runIntakeExtraction(client, contextText, model) {
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [INTAKE_TOOL],
    tool_choice: { type: 'tool', name: INTAKE_TOOL_NAME },
    system: INTAKE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract the onboarding intake object from the following client context. Populate only fields the context supports.\n\n<client_context>\n${contextText}\n</client_context>`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    return {
      form: { ...INITIAL_FORM_STATE },
      missingFields: Object.keys(INITIAL_FORM_STATE),
      confidenceNotes: 'Model did not return a tool_use block.',
      toolInput: null,
      stopReason: response.stop_reason,
    };
  }

  const toolInput = toolUse.input || {};
  return {
    form: mergeIntakeIntoForm(toolInput),
    missingFields: Array.isArray(toolInput.missingFields) ? toolInput.missingFields : [],
    confidenceNotes: toolInput.confidenceNotes || null,
    toolInput,
    stopReason: response.stop_reason,
  };
}
