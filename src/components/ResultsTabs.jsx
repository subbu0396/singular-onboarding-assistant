import { useState } from 'react';
import { DOC_TYPES, DOC_LABELS } from '@/lib/formConfig';
import { hasAllDocuments } from '@/lib/combineDocuments';
import { DOWNLOAD_FORMATS, exportCombinedPackage } from '@/lib/exportDocument';
import DocCard from './DocCard';
import SkillProgress from './SkillProgress';
import ShareButton from './ShareButton';

const TAB_ORDER = [DOC_TYPES.RUNBOOK, DOC_TYPES.FAQ, DOC_TYPES.CHECKLIST];

export default function ResultsTabs({
  documents,
  errors,
  loadingDocs,
  isStreaming = false,
  streamingStep = '',
  streamError = null,
  onClearStreamError,
  clientName,
  targetMmp,
  onRegenerate,
  onRetry,
  onStartOver,
  skillStatus,
  toolCalls,
  skillContexts,
  savedGeneration,
}) {
  const hasSkillActivity =
    skillStatus &&
    Object.values(skillStatus).some((s) => s !== 'pending');
  const [activeTab, setActiveTab] = useState(DOC_TYPES.RUNBOOK);
  const [downloadFormat, setDownloadFormat] = useState('pdf');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const canDownloadAll = hasAllDocuments(documents, loadingDocs);

  const handleDownloadAll = async () => {
    setExportError(null);
    setIsExporting(true);
    try {
      await exportCombinedPackage(documents, clientName, targetMmp, downloadFormat);
    } catch {
      setExportError('Export failed. Please try again or choose a different format.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Generated Documents</h2>
          <p className="mt-1 text-sm text-slate-400">
            {targetMmp ? `${targetMmp} onboarding docs` : 'Onboarding docs'} for{' '}
            {clientName || 'your client'} — review each tab, then download the full package.
          </p>
          {isStreaming && streamingStep && (
            <p className="mt-2 text-xs text-indigo-400">{streamingStep}</p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <ShareButton savedGeneration={savedGeneration} />
          <button type="button" onClick={onStartOver} className="btn-secondary">
            Start Over
          </button>
        </div>
      </div>

      <SkillProgress
        skillStatus={skillStatus}
        toolCalls={toolCalls}
        skillContexts={skillContexts}
        visible={hasSkillActivity}
      />

      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white">Download Complete Package</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Integration Runbook, FAQ Document, and Test Checklist in one file
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={downloadFormat}
              onChange={(e) => {
                setDownloadFormat(e.target.value);
                setExportError(null);
              }}
              disabled={!canDownloadAll || isExporting}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs text-slate-200 focus:border-indigo-accent focus:outline-none focus:ring-1 focus:ring-indigo-accent disabled:opacity-40"
              aria-label="Download format"
            >
              {DOWNLOAD_FORMATS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={!canDownloadAll || isExporting}
              className="btn-primary text-xs disabled:opacity-40"
            >
              {isExporting ? 'Exporting...' : 'Download All'}
            </button>
          </div>
        </div>
        {!canDownloadAll && (
          <p className="mt-3 text-xs text-slate-500">
            {isStreaming
              ? 'Documents appear below as each one finishes generating.'
              : 'All three documents must finish generating before you can download the package.'}
          </p>
        )}
        {streamError && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
            <span>⚠ {streamError}</span>
            <button
              type="button"
              onClick={onClearStreamError}
              className="cursor-pointer border-none bg-transparent px-1 text-base text-red-400"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
        {exportError && (
          <p className="mt-3 text-xs text-red-300">{exportError}</p>
        )}
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
            {isStreaming && !documents[type] && (
              <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
            )}
            {!isStreaming && documents[type] && (
              <span className="ml-2 text-xs text-emerald-500">✓</span>
            )}
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
            isLoading={(isStreaming && !documents[type]) || loadingDocs[type]}
            error={errors[type]}
            onRegenerate={onRegenerate}
            onRetry={() => onRetry(type)}
          />
        ) : null
      )}
    </div>
  );
}
