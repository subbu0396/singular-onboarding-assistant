import { useState } from 'react';
import { DOC_TYPES, DOC_LABELS } from '@/lib/formConfig';
import DocCard from './DocCard';

const TAB_ORDER = [DOC_TYPES.RUNBOOK, DOC_TYPES.FAQ, DOC_TYPES.CHECKLIST];

export default function ResultsTabs({
  documents,
  errors,
  loadingDocs,
  onRegenerate,
  onRetry,
  onStartOver,
}) {
  const [activeTab, setActiveTab] = useState(DOC_TYPES.RUNBOOK);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Generated Documents</h2>
          <p className="mt-1 text-sm text-slate-400">
            Review, copy, or download your tailored onboarding materials.
          </p>
        </div>
        <button type="button" onClick={onStartOver} className="btn-secondary shrink-0">
          Start Over
        </button>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-800" role="tablist">
        {TAB_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={activeTab === type}
            onClick={() => setActiveTab(type)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === type
                ? 'border-indigo-accent text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {DOC_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      {TAB_ORDER.map((type) =>
        activeTab === type ? (
          <DocCard
            key={type}
            title={DOC_LABELS[type]}
            content={documents[type]}
            docType={type}
            isLoading={loadingDocs[type]}
            error={errors[type]}
            onRegenerate={onRegenerate}
            onRetry={() => onRetry(type)}
          />
        ) : null
      )}
    </div>
  );
}
