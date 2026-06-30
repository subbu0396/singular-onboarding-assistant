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
  seAvailabilityNotes: '',
  engineeringAvailabilityNotes: '',
};

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Realistic sample data for the Try Demo flow. */
export function getDemoFormData() {
  const goLiveDate = new Date();
  goLiveDate.setDate(goLiveDate.getDate() + 42);

  return {
    clientName: 'Airtel Digital',
    targetMmp: 'Singular',
    industry: 'E-commerce',
    primaryMarket: 'India',
    platforms: ['iOS', 'Android'],
    currentMmp: 'None',
    attributionModel: 'Last Touch',
    integrationMethods: ['S2S Postbacks', 'Google Ads'],
    dataExportMethods: ['Snowflake'],
    eventTrackingMethod: 'SDK Events',
    backendLanguage: 'Node.js',
    hasDataWarehouse: true,
    usesCdp: false,
    cdpName: '',
    authMethod: 'OAuth 2.0',
    targetGoLiveDate: formatDateInput(goLiveDate),
    onboardingUrgency: 'Standard 4-6 weeks',
  };
}

export const DEMO_SECTION_INDEX = SECTIONS.length - 1;

export const SECTION_FIELDS = {
  clientInfo: ['clientName', 'targetMmp', 'industry', 'primaryMarket'],
  sdkSetup: ['platforms', 'currentMmp', 'attributionModel'],
  integrationType: ['integrationMethods', 'dataExportMethods', 'eventTrackingMethod'],
  techEnvironment: ['backendLanguage', 'hasDataWarehouse', 'usesCdp', 'cdpName', 'authMethod'],
  timeline: ['targetGoLiveDate', 'onboardingUrgency', 'seAvailabilityNotes', 'engineeringAvailabilityNotes'],
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

export function validateSection(sectionIndex, formData) {
  const newErrors = {};

  if (sectionIndex === 0) {
    if (!formData.clientName?.trim()) {
      newErrors.clientName = 'Client name is required';
    }
    if (!formData.targetMmp) {
      newErrors.targetMmp = 'Please select a target MMP platform';
    }
    if (!formData.industry || formData.industry === 'Select...') {
      newErrors.industry = 'Please select an industry';
    }
    if (!formData.primaryMarket || formData.primaryMarket === 'Select...') {
      newErrors.primaryMarket = 'Please select a market';
    }
  }

  if (sectionIndex === 1) {
    if (!formData.platforms?.length) {
      newErrors.platforms = 'Select at least one platform';
    }
    if (!formData.currentMmp || formData.currentMmp === 'Select...') {
      newErrors.currentMMP = 'Please select current MMP';
    }
    if (!formData.attributionModel || formData.attributionModel === 'Select...') {
      newErrors.attributionModel = 'Please select attribution model';
    }
  }

  if (sectionIndex === 2) {
    if (!formData.integrationMethods?.length) {
      newErrors.integrationMethods = 'Select at least one integration method';
    }
    if (!formData.dataExportMethods?.length) {
      newErrors.exportMethods = 'Select at least one export method';
    }
    if (!formData.eventTrackingMethod || formData.eventTrackingMethod === 'Select...') {
      newErrors.eventTracking = 'Please select event tracking method';
    }
  }

  if (sectionIndex === 3) {
    if (!formData.backendLanguage || formData.backendLanguage === 'Select...') {
      newErrors.backendLanguage = 'Please select backend language';
    }
    if (!formData.authMethod || formData.authMethod === 'Select...') {
      newErrors.authMethod = 'Please select auth method';
    }
    if (formData.usesCdp && !formData.cdpName?.trim()) {
      newErrors.cdpName = 'CDP name is required when CDP is enabled';
    }
  }

  if (sectionIndex === 4) {
    if (!formData.targetGoLiveDate) {
      newErrors.goLiveDate = 'Please select a go-live date';
    }
    if (!formData.onboardingUrgency || formData.onboardingUrgency === 'Select...') {
      newErrors.urgency = 'Please select onboarding urgency';
    }
  }

  return newErrors;
}

