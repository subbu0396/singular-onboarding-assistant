import { useState, useCallback, useEffect, useRef } from 'react';
import Form from '@/components/Form';
import ResultsTabs from '@/components/ResultsTabs';
import IntegrationsMenu from '@/components/IntegrationsMenu';
import RecentGenerations from '@/components/RecentGenerations';
import IntakeChat from '@/components/IntakeChat';
import SignInGate from '@/components/SignInGate';
import UserChip from '@/components/UserChip';
import { DOC_TYPES } from '@/lib/formConfig';
import { useSession } from '@/lib/useSession';

const DOC_KEYS = [DOC_TYPES.RUNBOOK, DOC_TYPES.FAQ, DOC_TYPES.CHECKLIST];

const SKILL_IDS = [
  'client_info',
  'sdk_setup',
  'integration_type',
  'tech_env',
  'timeline',
  'review_compile',
];

const EMPTY_DOCS = Object.fromEntries(DOC_KEYS.map((k) => [k, '']));
const EMPTY_ERRORS = Object.fromEntries(DOC_KEYS.map((k) => [k, null]));
const ALL_LOADING = Object.fromEntries(DOC_KEYS.map((k) => [k, true]));
const NONE_LOADING = Object.fromEntries(DOC_KEYS.map((k) => [k, false]));
const EMPTY_SKILL_STATUS = Object.fromEntries(
  SKILL_IDS.map((id) => [id, 'pending'])
);
const EMPTY_TOOL_CALLS = {};

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
  const [chatOpen, setChatOpen] = useState(false);
  const [intakePrefill, setIntakePrefill] = useState(null);
  const [intakeMeta, setIntakeMeta] = useState(null);
  // Bumped when a chat completes so the Form remounts and re-seeds its
  // internal state from the new initialForm prop.
  const [formKey, setFormKey] = useState(0);
  const [formData, setFormData] = useState(null);
  const [documents, setDocuments] = useState(EMPTY_DOCS);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [loadingDocs, setLoadingDocs] = useState(NONE_LOADING);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState(null);
  const [skillStatus, setSkillStatus] = useState(EMPTY_SKILL_STATUS);
  const [toolCalls, setToolCalls] = useState(EMPTY_TOOL_CALLS);
  const [skillContexts, setSkillContexts] = useState({});
  const [savedGeneration, setSavedGeneration] = useState(null);

  const deltaBufferRef = useRef({});
  const flushScheduledRef = useRef(false);
  // Guard so autosave fires exactly once per completed generation.
  const savedForRef = useRef(null);

  const session = useSession();

  const flushDeltas = useCallback(() => {
    flushScheduledRef.current = false;
    const buffer = deltaBufferRef.current;
    const docTypes = Object.keys(buffer);
    if (docTypes.length === 0) return;
    deltaBufferRef.current = {};
    setDocuments((prev) => {
      const next = { ...prev };
      for (const docType of docTypes) {
        next[docType] = (next[docType] || '') + buffer[docType];
      }
      return next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flushDeltas);
    } else {
      setTimeout(flushDeltas, 16);
    }
  }, [flushDeltas]);

  const handleSkillEvent = useCallback((event) => {
    if (event.type === 'skill_start') {
      setSkillStatus((prev) => ({ ...prev, [event.skillId]: 'active' }));
      return true;
    }
    if (event.type === 'skill_complete') {
      setSkillStatus((prev) => ({ ...prev, [event.skillId]: 'complete' }));
      return true;
    }
    if (event.type === 'skill_error') {
      setSkillStatus((prev) => ({ ...prev, [event.skillId]: 'error' }));
      return true;
    }
    if (event.type === 'skill_context') {
      setSkillContexts((prev) => ({ ...prev, [event.skillId]: event.context }));
      return true;
    }
    if (event.type === 'tool_call_start') {
      setToolCalls((prev) => {
        const existing = prev[event.skillId] || [];
        return {
          ...prev,
          [event.skillId]: [
            ...existing,
            {
              toolName: event.toolName,
              status: 'running',
              ok: null,
              input: event.input || null,
              count: null,
            },
          ],
        };
      });
      return true;
    }
    if (event.type === 'tool_call_complete') {
      setToolCalls((prev) => {
        const existing = prev[event.skillId] || [];
        // Match the most recent running call for this toolName so we don't
        // accidentally close a badge that's already done.
        const idx = existing
          .map((c, i) => ({ c, i }))
          .reverse()
          .find(({ c }) => c.toolName === event.toolName && c.status === 'running');
        if (!idx) return prev;
        const next = [...existing];
        next[idx.i] = {
          ...next[idx.i],
          status: 'done',
          ok: event.ok !== false,
          count: typeof event.count === 'number' ? event.count : next[idx.i].count,
          // If the server re-sent input on completion (e.g. resolved a
          // Confluence page title), prefer the fresher shape.
          input: event.input || next[idx.i].input,
          message: event.message || null,
        };
        return { ...prev, [event.skillId]: next };
      });
      return true;
    }
    return false;
  }, []);

  const handleDocEvent = useCallback(
    (event) => {
      const parsed = parseDocEvent(event.type);
      if (!parsed) return false;
      const { docType, kind } = parsed;

      if (kind === 'delta') {
        deltaBufferRef.current[docType] =
          (deltaBufferRef.current[docType] || '') + event.delta;
        scheduleFlush();
      } else if (kind === 'complete') {
        flushDeltas();
        setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
      } else if (kind === 'error') {
        flushDeltas();
        setErrors((prev) => ({ ...prev, [docType]: event.message || 'Generation failed' }));
        setLoadingDocs((prev) => ({ ...prev, [docType]: false }));
      }
      return true;
    },
    [flushDeltas, scheduleFlush]
  );

  const generateAll = useCallback(
    async (form) => {
      deltaBufferRef.current = {};
      setIsLoading(true);
      setError(null);
      setFormData(form);
      setDocuments(EMPTY_DOCS);
      setErrors(EMPTY_ERRORS);
      setLoadingDocs(ALL_LOADING);
      setSkillStatus(EMPTY_SKILL_STATUS);
      setToolCalls(EMPTY_TOOL_CALLS);
      setLoadingStep('Agent analyzing client stack...');
      setView('results');

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });

        await consumeSSE(res, (event) => {
          if (handleSkillEvent(event)) {
            if (event.type === 'skill_start' && event.skillId === 'review_compile') {
              setLoadingStep('Compiling documents...');
            }
            return;
          }
          if (handleDocEvent(event)) return;
          if (event.type === 'doc_compile_start') {
            const labels = {
              runbook: 'Integration Runbook',
              faq: 'FAQ Document',
              checklist: 'Test Checklist',
            };
            setLoadingStep(`Writing ${labels[event.docType] || event.docType}...`);
            return;
          }
          if (event.type === 'done') {
            setLoadingStep('');
            setLoadingDocs(NONE_LOADING);
          } else if (event.type === 'error') {
            setError(event.message || 'Generation failed');
            setLoadingDocs(NONE_LOADING);
          }
        });
      } catch (err) {
        setError(err.message || 'Something went wrong. Please try again.');
        setLoadingDocs(NONE_LOADING);
      } finally {
        flushDeltas();
        setIsLoading(false);
        setLoadingStep('');
        setLoadingDocs(NONE_LOADING);
      }
    },
    [handleDocEvent, handleSkillEvent]
  );

  const regenerateDoc = useCallback(
    async (docType) => {
      if (!formData) return;

      delete deltaBufferRef.current[docType];
      setLoadingDocs((prev) => ({ ...prev, [docType]: true }));
      setErrors((prev) => ({ ...prev, [docType]: null }));
      setDocuments((prev) => ({ ...prev, [docType]: '' }));
      setSkillStatus(EMPTY_SKILL_STATUS);
      setToolCalls(EMPTY_TOOL_CALLS);

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: formData, docType }),
        });

        await consumeSSE(res, (event) => {
          if (handleSkillEvent(event)) return;
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
    [formData, handleDocEvent, handleSkillEvent]
  );

  const retryDoc = useCallback((docType) => regenerateDoc(docType), [regenerateDoc]);

  const openPastGeneration = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/generations/${id}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const g = await res.json();
      // Restore the results view with the stored docs; no pipeline re-run.
      savedForRef.current = `${g.form_snapshot?.clientName}::${g.form_snapshot?.targetGoLiveDate}::${g.form_snapshot?.targetMmp}`;
      setFormData(g.form_snapshot || {});
      setDocuments({
        [DOC_TYPES.RUNBOOK]: g.documents?.runbook || '',
        [DOC_TYPES.FAQ]: g.documents?.faq || '',
        [DOC_TYPES.CHECKLIST]: g.documents?.checklist || '',
      });
      setErrors(EMPTY_ERRORS);
      setLoadingDocs(NONE_LOADING);
      // Mark all skills complete so the pipeline row shows a finished
      // state rather than sitting at 'pending' for a doc that isn't
      // being regenerated.
      setSkillStatus(
        Object.fromEntries(SKILL_IDS.map((id) => [id, 'complete']))
      );
      setToolCalls(EMPTY_TOOL_CALLS);
      setSkillContexts({});
      setSavedGeneration({
        id: g.id,
        share_token: g.share_token || null,
        share_expires_at: g.share_expires_at || null,
        created_at: g.created_at,
      });
      setError(null);
      setLoadingStep('');
      setIsLoading(false);
      setView('results');
    } catch (err) {
      setError(err?.message || 'Failed to open past generation');
    }
  }, []);

  const handleStartOver = () => {
    deltaBufferRef.current = {};
    savedForRef.current = null;
    setView('form');
    setFormData(null);
    setDocuments(EMPTY_DOCS);
    setErrors(EMPTY_ERRORS);
    setLoadingDocs(NONE_LOADING);
    setSkillStatus(EMPTY_SKILL_STATUS);
    setToolCalls(EMPTY_TOOL_CALLS);
    setSkillContexts({});
    setSavedGeneration(null);
    setError(null);
    setLoadingStep('');
    setIsLoading(false);
  };

  // Phase 7 auto-save: once all three docs are non-empty and no doc is
  // still streaming, persist the generation and stash the returned
  // share_token so the Share button in the results view can use it.
  useEffect(() => {
    if (isLoading) return;
    if (!formData) return;
    if (!DOC_KEYS.every((k) => documents[k]?.trim())) return;
    if (DOC_KEYS.some((k) => loadingDocs[k])) return;
    if (DOC_KEYS.some((k) => errors[k])) return;
    // Guests aren't authenticated, so /api/generations would 401 and the
    // row couldn't be attributed anyway. Skip the write silently.
    if (session.authConfigured && !session.signedIn) return;
    // Guard: only save once per generation (client name + go-live is
    // enough entropy to distinguish two consecutive submissions).
    const generationKey = `${formData.clientName}::${formData.targetGoLiveDate}::${formData.targetMmp}`;
    if (savedForRef.current === generationKey) return;
    savedForRef.current = generationKey;

    (async () => {
      try {
        const res = await fetch('/api/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: formData, documents }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.warn('auto-save failed', body?.error || res.status);
          return;
        }
        const saved = await res.json();
        setSavedGeneration(saved);
      } catch (err) {
        console.warn('auto-save network error', err?.message || err);
      }
    })();
  }, [isLoading, formData, documents, loadingDocs, errors, session.authConfigured, session.signedIn]);

  return (
    <SignInGate>
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-accent">
              <span className="text-sm font-bold text-white">M</span>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-white">MMP Onboarding Assistant</h1>
              <p className="truncate text-xs text-slate-500">AI-powered onboarding docs for any attribution platform</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IntegrationsMenu />
            <UserChip />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        {view === 'form' && (
          <>
            {session.guest && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
                <span>
                  You&apos;re browsing as a guest — generations won&apos;t be saved to your history.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.sessionStorage.removeItem('mmp_guest_mode');
                    } catch {
                      // no-op
                    }
                    window.location.reload();
                  }}
                  className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/20"
                >
                  Sign in
                </button>
              </div>
            )}
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <div>
                <h2 className="text-2xl font-bold text-white sm:text-3xl">
                  Client Tech Stack Input
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Enter the client&apos;s integration details and select your MMP platform to generate tailored onboarding documents.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                disabled={isLoading}
                className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prefer to describe the client instead? Chat with the intake copilot →
              </button>
            </div>
            <Form
              key={formKey}
              onSubmit={generateAll}
              isLoading={isLoading}
              loadingStep={loadingStep}
              error={error}
              onClearError={() => setError(null)}
              initialForm={intakePrefill}
              initialAutofillMeta={intakeMeta}
            />
            {session.signedIn && <RecentGenerations onOpen={openPastGeneration} />}
          </>
        )}

        <IntakeChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onComplete={(filledForm, meta) => {
            setIntakePrefill(filledForm);
            setIntakeMeta({
              missingFields: meta?.missingFields || [],
              source: meta?.source || 'chat',
            });
            setFormKey((k) => k + 1);
            setChatOpen(false);
          }}
        />

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
            skillStatus={skillStatus}
            toolCalls={toolCalls}
            skillContexts={skillContexts}
            savedGeneration={savedGeneration}
          />
        )}
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        MMP Onboarding Assistant · Internal use only
      </footer>
    </div>
    </SignInGate>
  );
}
