import { useState, useCallback } from 'react';
import Form from '@/components/Form';
import ResultsTabs from '@/components/ResultsTabs';
import { DOC_TYPES } from '@/lib/formConfig';

const DOC_KEYS = [DOC_TYPES.RUNBOOK, DOC_TYPES.FAQ, DOC_TYPES.CHECKLIST];

const EMPTY_DOCS = Object.fromEntries(DOC_KEYS.map((k) => [k, '']));
const EMPTY_ERRORS = Object.fromEntries(DOC_KEYS.map((k) => [k, null]));
const ALL_LOADING = Object.fromEntries(DOC_KEYS.map((k) => [k, true]));
const NONE_LOADING = Object.fromEntries(DOC_KEYS.map((k) => [k, false]));

const SUFFIXES = ['_delta', '_complete', '_error'];

function parseDocEvent(eventType) {
  for (const suffix of SUFFIXES) {
    if (eventType.endsWith(suffix)) {
      return { docType: eventType.slice(0, -suffix.length), kind: suffix.slice(1) };
    }
  }
  return null;
}

async function consumeSSE(res, onEvent) {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // body wasn't JSON; keep generic message
    }
    throw new Error(message);
  }
  if (!res.body) throw new Error('No response stream received');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed.slice(6));
      } catch (parseErr) {
        console.warn('SSE parse error:', parseErr);
        continue;
      }
      onEvent(parsed);
    }
  }
}

export default function Home() {
  const [view, setView] = useState('form');
  const [formData, setFormData] = useState(null);
  const [documents, setDocuments] = useState(EMPTY_DOCS);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [loadingDocs, setLoadingDocs] = useState(NONE_LOADING);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState(null);

  const handleDocEvent = useCallback((event) => {
    const parsed = parseDocEvent(event.type);
    if (!parsed) return false;
    const { docType, kind } = parsed;

    if (kind === 'delta') {
      setDocuments((prev) => ({
        ...prev,
        [docType]: (prev[docType] || '') + event.delta,
      }));
    } else if (kind === 'complete') {
      setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
    } else if (kind === 'error') {
      setErrors((prev) => ({ ...prev, [docType]: event.message || 'Generation failed' }));
      setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
    }
    return true;
  }, []);

  const generateAll = useCallback(
    async (form) => {
      setIsLoading(true);
      setError(null);
      setFormData(form);
      setDocuments(EMPTY_DOCS);
      setErrors(EMPTY_ERRORS);
      setLoadingDocs(ALL_LOADING);
      setLoadingStep('Generating documents...');
      setView('results');

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });

        await consumeSSE(res, (event) => {
          if (handleDocEvent(event)) return;
          if (event.type === 'done') {
            setLoadingStep('');
          } else if (event.type === 'error') {
            setError(event.message || 'Generation failed');
          }
        });
      } catch (err) {
        setError(err.message || 'Something went wrong. Please try again.');
        setLoadingDocs(NONE_LOADING);
      } finally {
        setIsLoading(false);
        setLoadingStep('');
      }
    },
    [handleDocEvent]
  );

  const regenerateDoc = useCallback(
    async (docType) => {
      if (!formData) return;

      setLoadingDocs((prev) => ({ ...prev, [docType]: true }));
      setErrors((prev) => ({ ...prev, [docType]: null }));
      setDocuments((prev) => ({ ...prev, [docType]: '' }));

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: formData, docType }),
        });

        await consumeSSE(res, (event) => {
          if (handleDocEvent(event)) return;
          if (event.type === 'error') {
            setErrors((prev) => ({
              ...prev,
              [docType]: event.message || 'Failed to regenerate document',
            }));
          }
        });
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [docType]: err.message || 'Failed to regenerate document',
        }));
        setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
      }
    },
    [formData, handleDocEvent]
  );

  const retryDoc = useCallback((docType) => regenerateDoc(docType), [regenerateDoc]);

  const handleStartOver = () => {
    setView('form');
    setFormData(null);
    setDocuments(EMPTY_DOCS);
    setErrors(EMPTY_ERRORS);
    setLoadingDocs(NONE_LOADING);
    setError(null);
    setLoadingStep('');
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-accent">
            <span className="text-sm font-bold text-white">M</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">MMP Onboarding Assistant</h1>
            <p className="text-xs text-slate-500">AI-powered onboarding docs for any attribution platform</p>
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
                Enter the client&apos;s integration details and select your MMP platform to generate tailored onboarding documents.
              </p>
            </div>
            <Form
              onSubmit={generateAll}
              isLoading={isLoading}
              loadingStep={loadingStep}
              error={error}
              onClearError={() => setError(null)}
            />
          </>
        )}

        {view === 'results' && (
          <ResultsTabs
            documents={documents}
            errors={errors}
            loadingDocs={loadingDocs}
            isStreaming={isLoading}
            streamingStep={loadingStep}
            streamError={error}
            onClearStreamError={() => setError(null)}
            clientName={formData?.clientName}
            targetMmp={formData?.targetMmp}
            onRegenerate={regenerateDoc}
            onRetry={retryDoc}
            onStartOver={handleStartOver}
          />
        )}
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        MMP Onboarding Assistant · Internal use only
      </footer>
    </div>
  );
}
