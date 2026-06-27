import { useState, useCallback } from 'react';
import Form from '@/components/Form';
import LoadingState from '@/components/LoadingState';
import ResultsTabs from '@/components/ResultsTabs';
import { DOC_TYPES } from '@/lib/formConfig';

const EMPTY_DOCS = {
  [DOC_TYPES.RUNBOOK]: '',
  [DOC_TYPES.FAQ]: '',
  [DOC_TYPES.CHECKLIST]: '',
};

const EMPTY_ERRORS = {
  [DOC_TYPES.RUNBOOK]: null,
  [DOC_TYPES.FAQ]: null,
  [DOC_TYPES.CHECKLIST]: null,
};

const EMPTY_LOADING = {
  [DOC_TYPES.RUNBOOK]: false,
  [DOC_TYPES.FAQ]: false,
  [DOC_TYPES.CHECKLIST]: false,
};

export default function Home() {
  const [view, setView] = useState('form');
  const [formData, setFormData] = useState(null);
  const [documents, setDocuments] = useState(EMPTY_DOCS);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [loadingDocs, setLoadingDocs] = useState(EMPTY_LOADING);
  const [progressStep, setProgressStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateAll = useCallback(async (form) => {
    setIsGenerating(true);
    setView('loading');
    setProgressStep(1);
    setFormData(form);
    setDocuments(EMPTY_DOCS);
    setErrors(EMPTY_ERRORS);

    const progressTimer1 = setTimeout(() => setProgressStep(2), 1500);
    const progressTimer2 = setTimeout(() => setProgressStep(3), 4000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, generateAll: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate documents');
      }

      setDocuments(data.documents);
      setView('results');
    } catch (err) {
      const message = err.message || 'An unexpected error occurred';
      setErrors({
        [DOC_TYPES.RUNBOOK]: message,
        [DOC_TYPES.FAQ]: message,
        [DOC_TYPES.CHECKLIST]: message,
      });
      setView('results');
    } finally {
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      setIsGenerating(false);
      setProgressStep(3);
    }
  }, []);

  const regenerateDoc = useCallback(
    async (docType) => {
      if (!formData) return;

      setLoadingDocs((prev) => ({ ...prev, [docType]: true }));
      setErrors((prev) => ({ ...prev, [docType]: null }));

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: formData, docType }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to regenerate document');
        }

        setDocuments((prev) => ({ ...prev, [docType]: data.content }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [docType]: err.message || 'Failed to regenerate document',
        }));
      } finally {
        setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
      }
    },
    [formData]
  );

  const retryDoc = useCallback(
    (docType) => {
      regenerateDoc(docType);
    },
    [regenerateDoc]
  );

  const handleStartOver = () => {
    setView('form');
    setFormData(null);
    setDocuments(EMPTY_DOCS);
    setErrors(EMPTY_ERRORS);
    setLoadingDocs(EMPTY_LOADING);
    setProgressStep(1);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-accent">
            <span className="text-sm font-bold text-white">S</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Singular Onboarding Assistant</h1>
            <p className="text-xs text-slate-500">AI-powered integration document generator</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        {view === 'form' && (
          <>
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold text-white sm:text-3xl">
                Client Tech Stack Input
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Enter the client&apos;s integration details to generate tailored onboarding documents.
              </p>
            </div>
            <Form onSubmit={generateAll} isLoading={isGenerating} />
          </>
        )}

        {view === 'loading' && <LoadingState progressStep={progressStep} />}

        {view === 'results' && (
          <ResultsTabs
            documents={documents}
            errors={errors}
            loadingDocs={loadingDocs}
            clientName={formData?.clientName}
            onRegenerate={regenerateDoc}
            onRetry={retryDoc}
            onStartOver={handleStartOver}
          />
        )}
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        Singular Onboarding Assistant · Internal use only
      </footer>
    </div>
  );
}
