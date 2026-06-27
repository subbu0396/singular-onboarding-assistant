import { DOC_TYPES, DOC_LABELS } from './formConfig';

export const DOC_ORDER = [DOC_TYPES.RUNBOOK, DOC_TYPES.FAQ, DOC_TYPES.CHECKLIST];

export function getPackageTitle(clientName) {
  return `Singular Onboarding Package — ${clientName?.trim() || 'Client'}`;
}

export function getPackageFilename(clientName, extension) {
  const slug = (clientName?.trim() || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `singular-onboarding-${slug}.${extension}`;
}

export function buildCombinedMarkdown(documents) {
  const sections = DOC_ORDER.map((type) => {
    const label = DOC_LABELS[type];
    const content = documents[type]?.trim() || '_No content generated._';
    return `## ${label}\n\n${content}`;
  });

  return sections.join('\n\n---\n\n');
}

export function hasAllDocuments(documents, loadingDocs = {}) {
  return DOC_ORDER.every((type) => documents[type]?.trim() && !loadingDocs[type]);
}
