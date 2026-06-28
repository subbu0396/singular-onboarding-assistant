function mapExtractedToForm(extracted) {
  return {
    clientName: extracted.clientName,
    industry: extracted.industry,
    primaryMarket: extracted.primaryMarket,
    platforms: extracted.platforms,
    currentMmp: extracted.currentMMP,
    attributionModel: extracted.attributionModel,
    integrationMethods: extracted.integrationMethods,
    dataExportMethods: extracted.exportMethods,
    eventTrackingMethod: extracted.eventTracking,
    backendLanguage: extracted.backendLanguage,
    hasDataWarehouse: extracted.hasDataWarehouse,
    usesCdp: extracted.usesCDP,
    cdpName: extracted.cdpName,
    authMethod: extracted.authMethod,
    targetGoLiveDate: extracted.goLiveDate,
    onboardingUrgency: extracted.urgency,
    _docUploaded: true,
  };
}

function isFieldEmpty(prev, key) {
  const val = prev[key];
  if (val === null || val === undefined || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (key === 'hasDataWarehouse' && val === false) return true;
  if (key === 'usesCdp' && val === false) return true;
  return false;
}

export function mergeExtractedFields(prev, extracted) {
  const mapped = mapExtractedToForm(extracted);
  const merged = { ...prev };

  Object.entries(mapped).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (isFieldEmpty(prev, key)) {
      merged[key] = value;
    }
  });

  return merged;
}
