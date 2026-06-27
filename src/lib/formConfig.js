export const SECTIONS = [
  { id: 'A', title: 'Client Info', key: 'clientInfo' },
  { id: 'B', title: 'Mobile SDK Setup', key: 'sdkSetup' },
  { id: 'C', title: 'Integration Type', key: 'integrationType' },
  { id: 'D', title: 'Technical Environment', key: 'techEnvironment' },
  { id: 'E', title: 'Go-Live Timeline', key: 'timeline' },
];

export const INDUSTRIES = [
  'E-commerce',
  'Gaming',
  'Fintech',
  'Travel',
  'OTT/Media',
  'Other',
];

export const PRIMARY_MARKETS = [
  'India',
  'SEA',
  'MENA',
  'US',
  'Europe',
  'Other',
];

export const PLATFORMS = [
  'iOS',
  'Android',
  'React Native',
  'Flutter',
  'Unity',
];

export const TARGET_MMP_PLATFORMS = [
  'Singular',
  'AppsFlyer',
  'Adjust',
  'Branch',
  'Kochava',
  'Tenjin',
  'Airbridge',
  'AppMetrica',
  'Firebase / Google Analytics',
  'CleverTap',
  'Amplitude',
  'TikTok Measurement',
  'Meta Attribution',
  'GameAnalytics',
  'BytePlus (AppLog)',
  'MyTracker',
  'Rockerbox',
  'mParticle',
  'Adobe Analytics',
  'Netcore Smartech',
  'Flurry Analytics',
  'Other',
];

export const CURRENT_MMP_OPTIONS = ['None', ...TARGET_MMP_PLATFORMS.filter((p) => p !== 'Other')];

export const ATTRIBUTION_MODELS = [
  'Last Touch',
  'Data Driven',
  'Multi-Touch',
];

export const INTEGRATION_METHODS = [
  'S2S Postbacks',
  'SKAdNetwork',
  'Google Ads',
  'Meta Ads',
  'Firebase Import',
  'Custom Dashboard Export',
];

export const DATA_EXPORT_METHODS = [
  'S3',
  'SFTP',
  'Snowflake',
  'BigQuery',
  'API Pull',
];

export const EVENT_TRACKING_METHODS = [
  'SDK Events',
  'S2S Events',
  'Both',
];

export const BACKEND_LANGUAGES = [
  'Python',
  'Node.js',
  'Java',
  'PHP',
  'Ruby',
  'Go',
  'Other',
];

export const AUTH_METHODS = [
  'OAuth 2.0',
  'API Key',
  'SAML SSO',
  'Other',
];

export const URGENCY_OPTIONS = [
  'Standard 4-6 weeks',
  'Accelerated 2-3 weeks',
  'Critical <2 weeks',
];

export const DOC_TYPES = {
  RUNBOOK: 'runbook',
  FAQ: 'faq',
  CHECKLIST: 'checklist',
};

export const DOC_LABELS = {
  [DOC_TYPES.RUNBOOK]: 'Integration Runbook',
  [DOC_TYPES.FAQ]: 'FAQ Document',
  [DOC_TYPES.CHECKLIST]: 'Test Checklist',
};

export const INITIAL_FORM_STATE = {
  clientName: '',
  targetMmp: '',
  industry: '',
  primaryMarket: '',
  platforms: [],
  currentMmp: '',
  attributionModel: '',
  integrationMethods: [],
  dataExportMethods: [],
  eventTrackingMethod: '',
  backendLanguage: '',
  hasDataWarehouse: false,
  usesCdp: false,
  cdpName: '',
  authMethod: '',
  targetGoLiveDate: '',
  onboardingUrgency: '',
};

export const SECTION_FIELDS = {
  clientInfo: ['clientName', 'targetMmp', 'industry', 'primaryMarket'],
  sdkSetup: ['platforms', 'currentMmp', 'attributionModel'],
  integrationType: ['integrationMethods', 'dataExportMethods', 'eventTrackingMethod'],
  techEnvironment: ['backendLanguage', 'hasDataWarehouse', 'usesCdp', 'cdpName', 'authMethod'],
  timeline: ['targetGoLiveDate', 'onboardingUrgency'],
};

export function getSectionDefaults(sectionKey) {
  const fields = SECTION_FIELDS[sectionKey] || [];
  return Object.fromEntries(fields.map((field) => [field, INITIAL_FORM_STATE[field]]));
}

export function resetSectionFields(form, sectionKey) {
  return { ...form, ...getSectionDefaults(sectionKey) };
}

export function isSectionDirty(form, sectionKey) {
  const defaults = getSectionDefaults(sectionKey);
  return Object.keys(defaults).some((field) => {
    const current = form[field];
    const initial = defaults[field];
    if (Array.isArray(current) && Array.isArray(initial)) {
      return current.length > 0;
    }
    if (typeof current === 'boolean') {
      return current !== initial;
    }
    return Boolean(current);
  });
}

export function formatList(items) {
  if (!items || items.length === 0) return 'Not specified';
  return items.join(', ');
}

export function validateForm(form) {
  const errors = [];

  if (!form.clientName?.trim()) errors.push('Client Name is required');
  if (!form.targetMmp) errors.push('Target MMP Platform is required');
  if (!form.industry) errors.push('Industry is required');
  if (!form.primaryMarket) errors.push('Primary Market is required');
  if (!form.platforms?.length) errors.push('At least one platform is required');
  if (!form.currentMmp) errors.push('Current MMP is required');
  if (!form.attributionModel) errors.push('Attribution model is required');
  if (!form.integrationMethods?.length) errors.push('At least one integration method is required');
  if (!form.dataExportMethods?.length) errors.push('At least one data export method is required');
  if (!form.eventTrackingMethod) errors.push('Event tracking method is required');
  if (!form.backendLanguage) errors.push('Backend language is required');
  if (!form.authMethod) errors.push('Authentication method is required');
  if (!form.targetGoLiveDate) errors.push('Target go-live date is required');
  if (!form.onboardingUrgency) errors.push('Onboarding urgency is required');
  if (form.usesCdp && !form.cdpName?.trim()) errors.push('CDP name is required when CDP is enabled');

  return errors;
}
